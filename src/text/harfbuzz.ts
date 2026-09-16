/**
 * The pinned HarfBuzz shaping backend (spec 02 §5.1, §5.2), wrapping `harfbuzzjs@1.6.1`'s
 * class-based API (`new hb.Blob/Face/Font/Buffer`, `buf.getGlyphInfos()`/
 * `buf.getGlyphPositions()`) as verified by the M0 spike
 * (research/spikes/s3-harfbuzz-wasm.md in screenwriter_plans, which also amended spec 02 to
 * the real embedded core version — `harfbuzzjs`'s own npm version does not track it 1:1).
 *
 * `writing_core` stays platform-free: both the WASM module and every face's font binary
 * arrive through `HarfBuzzDeps`, injected by the host (a service-worker cache on web, the
 * app bundle on native, `/usr/share/fadewright/fonts` in the API image) — this module never
 * does a top-level `import 'harfbuzzjs'` or a filesystem read of its own. `Shaper` is Task
 * 1's exact spec §5.2 shape (`src/layout/types.ts`); this module implements it rather than
 * redeclaring it.
 */
import { FACES } from '../fonts/generated/registry.generated.js';
import { sha256Hex } from '../hash/sha256.js';
import { emuFromFontUnits } from '../layout/round.js';
import type { FaceId, Shaper } from '../layout/types.js';

/**
 * Spec 02 §5.1: HarfBuzz core version pinned by the M0 spike, embedded by
 * `harfbuzzjs@1.6.1`. `harfbuzzjs`'s own npm version does not track the embedded core
 * version 1:1, so the pin is enforced by (a) an exact `package.json`/`bun.lock` version (no
 * `^`/`~`) and (b) asserting `hb.versionString() === HARFBUZZ_CORE_VERSION` in tests —
 * never by trusting the npm package version.
 */
export const HARFBUZZ_CORE_VERSION = '14.4.0';

/**
 * The `harfbuzzjs@1.6.1` module shape, taken from the package's own type declarations
 * rather than hand-copied, so this stays exactly in sync with what `deps.load()` actually
 * returns (a ready, already-initialized module — no separate init call, per the M0 spike).
 */
export type HbModule = typeof import('harfbuzzjs');

export interface HarfBuzzDeps {
  /** The WASM module, injected — never a top-level import. */
  load: () => Promise<HbModule>;
  /** The font binary for that face. May be synchronous or asynchronous. */
  faceBytes: (faceId: FaceId) => Uint8Array | Promise<Uint8Array>;
}

/** Spec 02 §5.2: the shaping-result LRU is bounded at 20 000 entries. */
const SHAPE_CACHE_LIMIT = 20_000;

/**
 * Spec 02 §5.2: `liga`/`clig`/`dlig` are disabled for scripts where they are optional
 * (required contextual forms — `init`/`medi`/`fina`/`isol`/`rlig`, Indic reordering — stay
 * on, since those are HarfBuzz's defaults for the script and are never in this list).
 */
const DISABLED_LIGATURE_TAGS = ['liga', 'clig', 'dlig'];

type ShapeInput = Parameters<Shaper['shape']>[0];
type ShapeOutput = ReturnType<Shaper['shape']>;

interface FaceEntry {
  font: InstanceType<HbModule['Font']>;
  unitsPerEm: number;
}

/**
 * Spec 02 §5.2 (amended, review finding A): the shaping cache key must be genuinely
 * injective. Joining an input's fields with a single fixed separator and no escaping is
 * not injective — whenever the separator (or, for a naive choice like a plain space,
 * ordinary field content) can occur inside a field, two different inputs can concatenate
 * to the same string. Concretely, for fields joined as `language SEP text`:
 * `('a' + SEP + 'b', 'c')` and `('a', 'b' + SEP + 'c')` both produce `a SEP b SEP c` —
 * one run would silently receive another run's cached glyphs. `harfbuzz.test.ts`
 * ("shape cache key injectivity") proves this collision against the join-based
 * construction this replaces and proves the replacement does not collide on the same
 * inputs.
 *
 * The fix is netstring-style length-prefixing: each field is written as
 * `<UTF-16 length>:<field>`, back to back, with nothing between records. Field
 * boundaries are then determined purely by position (read the digits up to `:`, then
 * read exactly that many characters), never by scanning for a delimiter character — so
 * no possible field content, including a colon, a digit run, or the character used as
 * the old separator, can ever be mistaken for a boundary. This is provably injective for
 * any string content, which is why it is used here rather than `JSON.stringify` on the
 * tuple (encoding is simple, well-understood, and — unlike JSON — doesn't collapse
 * distinct numeric edge cases such as `NaN`/`Infinity`/`-0` to the same output).
 */
function encodeCacheField(value: string): string {
  return `${value.length}:${value}`;
}

export function shapeCacheKey(input: ShapeInput): string {
  return [input.faceId, String(input.sizeEmu), input.script, input.direction, input.language, input.text]
    .map(encodeCacheField)
    .join('');
}

export async function createHarfBuzzShaper(deps: HarfBuzzDeps): Promise<Shaper> {
  const hb = await deps.load();
  const disabledLigatures = DISABLED_LIGATURE_TAGS.map((tag) => new hb.Feature(tag, 0));

  // Per-face `hb.Face`/`hb.Font` cache (review finding C). Deliberately left unbounded:
  // `requireFaceRow` below only ever admits a `faceId` present in the generated, closed
  // `FACES` registry (spec 02 §3.1/§4.1's bundled set — a fixed, build-time-generated
  // list, 83 faces as of this build), so this cache's key space — and therefore its
  // maximum possible size — is fixed at build time, not by anything a caller controls or
  // by user input. An LRU here would add eviction machinery to bound a collection that
  // provably cannot grow past a compile-time constant. Custom/user fonts (spec §3.5,
  // `FontRegistry.registerCustom`) are not wired into this shaper at all yet — `shape`/
  // `prepareFace` only resolve `faceId`s against `FACES` — so they cannot inflate this
  // cache either; when custom-font shaping is added, this invariant (and this comment)
  // will need revisiting, e.g. an LRU or a separate bounded cache for the custom subset.
  const faceCache = new Map<FaceId, FaceEntry>();
  // Concurrent/repeated `prepareFace(faceId)` calls for a face not yet cached share one
  // in-flight promise (spec 02 §5.2 amendment: "concurrent calls ... resolve once").
  const pendingFaces = new Map<FaceId, Promise<void>>();
  // Insertion-ordered Map used as an LRU: a hit is deleted and re-inserted so the oldest
  // entry is always the first key; bounded at SHAPE_CACHE_LIMIT (spec 02 §5.2).
  const shapeCache = new Map<string, ShapeOutput>();

  function requireFaceRow(faceId: FaceId): (typeof FACES)[number] {
    const row = FACES.find((f) => f.faceId === faceId);
    if (!row) throw new Error(`harfbuzz: unknown faceId ${faceId}`);
    return row;
  }

  /**
   * Verifies `bytes`' SHA-256 against `row` (spec 02 §4.5's renderer obligation,
   * checkable here because the shaper draws from the same injected bytes the `FACES`
   * table was generated from) and builds the `hb.Face`/`hb.Font` pair. Never touches
   * `faceCache`/`pendingFaces` itself — callers decide when/whether to cache.
   */
  function buildFaceEntry(faceId: FaceId, row: (typeof FACES)[number], bytes: Uint8Array): FaceEntry {
    const digest = sha256Hex(bytes);
    if (digest !== row.sha256) throw new Error(`fwm: face binary does not match metrics (faceId ${faceId})`);

    const blob = new hb.Blob(bytes);
    const face = new hb.Face(blob, 0);
    const font = new hb.Font(face);
    return { font, unitsPerEm: face.upem };
  }

  /**
   * Builds (or returns the cached) `hb.Face`/`hb.Font` pair for `faceId` for the
   * synchronous `shape()` path. `deps.faceBytes` may return a `Promise`, but
   * `Shaper.shape` is synchronous (spec 02 §5.2's contract, transcribed in
   * `src/layout/types.ts`), so a face whose source is asynchronous must already have
   * been resolved — by `prepareFace`, spec 02 §5.2's sanctioned way to warm a face —
   * before it is first shaped; `shape` on an unprepared face throws a clear error naming
   * the face rather than substituting a face or returning wrong metrics.
   */
  function faceFor(faceId: FaceId): FaceEntry {
    const cached = faceCache.get(faceId);
    if (cached) return cached;

    const row = requireFaceRow(faceId);

    const bytes = deps.faceBytes(faceId);
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError(
        `harfbuzz: face ${faceId} is not prepared — Shaper.shape is synchronous (spec 02 §5.2). ` +
          `Call and await shaper.prepareFace(${JSON.stringify(faceId)}) before shaping this face.`,
      );
    }

    const entry = buildFaceEntry(faceId, row, bytes);
    faceCache.set(faceId, entry);
    return entry;
  }

  /**
   * Spec 02 §5.2 (amendment): resolves `faceId`'s bytes (awaiting `deps.faceBytes` when
   * it is asynchronous) and builds its `hb.Face`/`hb.Font` ahead of a later synchronous
   * `shape()` call. Idempotent — a face already cached resolves immediately without
   * re-fetching or re-verifying its bytes — and concurrent calls for the same
   * not-yet-cached face share one in-flight build rather than racing to build it twice.
   */
  async function prepareFace(faceId: FaceId): Promise<void> {
    if (faceCache.has(faceId)) return;

    const existing = pendingFaces.get(faceId);
    if (existing) return existing;

    const row = requireFaceRow(faceId);
    const promise = (async () => {
      try {
        const bytes = await deps.faceBytes(faceId);
        const entry = buildFaceEntry(faceId, row, bytes);
        faceCache.set(faceId, entry);
      } finally {
        pendingFaces.delete(faceId);
      }
    })();
    pendingFaces.set(faceId, promise);
    return promise;
  }

  function runShape(input: ShapeInput): ShapeOutput {
    const { font, unitsPerEm } = faceFor(input.faceId);

    const buf = new hb.Buffer();
    buf.addText(input.text);
    buf.setDirection(input.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
    buf.setScript(input.script);
    buf.setLanguage(input.language);

    hb.shape(font, buf, disabledLigatures);

    const infos = buf.getGlyphInfos();
    const positions = buf.getGlyphPositions();
    if (positions.length !== infos.length) throw new Error('harfbuzz: glyph info/position length mismatch');

    const glyphIds = new Uint16Array(infos.length);
    const clusters = new Uint32Array(infos.length);
    const advancesEmu = new Int32Array(infos.length);
    const offsetsEmu = new Int32Array(infos.length * 2);

    for (let i = 0; i < infos.length; i += 1) {
      const info = infos[i];
      const pos = positions[i];
      if (!info || !pos) throw new Error('harfbuzz: glyph info/position length mismatch');
      glyphIds[i] = info.codepoint;
      clusters[i] = info.cluster;
      // Font units → EMU rounded per glyph (spec 02 §2's accumulation rule), never summed
      // in font units first.
      advancesEmu[i] = emuFromFontUnits(pos.xAdvance, input.sizeEmu, unitsPerEm);
      offsetsEmu[i * 2] = emuFromFontUnits(pos.xOffset, input.sizeEmu, unitsPerEm);
      offsetsEmu[i * 2 + 1] = emuFromFontUnits(pos.yOffset, input.sizeEmu, unitsPerEm);
    }

    return { glyphIds, clusters, advancesEmu, offsetsEmu };
  }

  return {
    version: `harfbuzz-${HARFBUZZ_CORE_VERSION}`,
    shape(input: ShapeInput): ShapeOutput {
      const key = shapeCacheKey(input);
      const cached = shapeCache.get(key);
      if (cached) {
        shapeCache.delete(key);
        shapeCache.set(key, cached);
        return cached;
      }

      const result = runShape(input);
      shapeCache.set(key, result);
      if (shapeCache.size > SHAPE_CACHE_LIMIT) {
        const oldest = shapeCache.keys().next().value;
        if (oldest !== undefined) shapeCache.delete(oldest);
      }
      return result;
    },
    prepareFace,
  };
}
