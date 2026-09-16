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

// The shape-cache key joins an input's fields with a separator character guaranteed not to
// appear in any field (a face id, script tag, BCP 47 tag or shaped text could in principle
// contain almost any other printable character). Built at runtime with `fromCharCode`
// rather than written as an escape sequence in this file's own source text: a file-writing
// tool can turn a source-level control-character escape into a literal control byte on
// disk, which the repo's own guard tooling then flags.
const CACHE_KEY_SEP = String.fromCharCode(0);

function shapeCacheKey(input: ShapeInput): string {
  return [input.faceId, input.sizeEmu, input.script, input.direction, input.language, input.text].join(CACHE_KEY_SEP);
}

export async function createHarfBuzzShaper(deps: HarfBuzzDeps): Promise<Shaper> {
  const hb = await deps.load();
  const disabledLigatures = DISABLED_LIGATURE_TAGS.map((tag) => new hb.Feature(tag, 0));

  const faceCache = new Map<FaceId, FaceEntry>();
  // Insertion-ordered Map used as an LRU: a hit is deleted and re-inserted so the oldest
  // entry is always the first key; bounded at SHAPE_CACHE_LIMIT (spec 02 §5.2).
  const shapeCache = new Map<string, ShapeOutput>();

  /**
   * Builds (or returns the cached) `hb.Face`/`hb.Font` pair for `faceId`, verifying the
   * face binary's SHA-256 against its `FACES` row first (spec 02 §4.5's renderer
   * obligation, checkable here because the shaper draws from the same injected bytes).
   * `deps.faceBytes` may return a `Promise`, but `Shaper.shape` is synchronous (spec 02
   * §5.2's contract, transcribed in `src/layout/types.ts`), so an async source must already
   * be resolved (a plain `Uint8Array`) by the time a given `faceId` is first shaped — an
   * async host pre-warms a face before routing text to it.
   */
  function faceFor(faceId: FaceId): FaceEntry {
    const cached = faceCache.get(faceId);
    if (cached) return cached;

    const row = FACES.find((f) => f.faceId === faceId);
    if (!row) throw new Error(`harfbuzz: unknown faceId ${faceId}`);

    const bytes = deps.faceBytes(faceId);
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError(
        `harfbuzz: faceBytes(${faceId}) returned a Promise, but Shaper.shape is synchronous ` +
          '(spec 02 §5.2) — pre-warm this face (call and await faceBytes for it once) before shaping it.',
      );
    }

    const digest = sha256Hex(bytes);
    if (digest !== row.sha256) throw new Error(`fwm: face binary does not match metrics (faceId ${faceId})`);

    const blob = new hb.Blob(bytes);
    const face = new hb.Face(blob, 0);
    const font = new hb.Font(face);
    const entry: FaceEntry = { font, unitsPerEm: face.upem };
    faceCache.set(faceId, entry);
    return entry;
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
  };
}
