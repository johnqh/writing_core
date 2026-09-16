/**
 * Font registry (spec 02 §4.3): builds the `FontFamilyId` → bundled-faces map from
 * `FACES`'s `family`/`style`/`classification` columns (Task 2's generated table),
 * never by parsing file or module names; resolves style synthesis (§3.4); and wraps
 * Task 2's per-`(faceId, sizeEmu)` advance cache (`advanceTableFor`, `./fwm.ts`).
 *
 * `FontRegistry` itself is Task 1's exact spec §4.3 shape (`src/layout/types.ts`);
 * this module implements it rather than redeclaring it.
 */
import { canonicalJSON } from '../hash/canonical-json.js';
import { sha256Hex } from '../hash/sha256.js';
import { emuFromFontUnits } from '../layout/round.js';
import type { FontRegistry } from '../layout/types.js';
import type { FontFamilyId } from '../schema/primitives.js';
import { LOGICAL_FONT_FAMILIES, type LogicalFontFamily } from '../schema/vocab.js';
import { FONT_ALIASES } from './aliases.js';
import { type AdvanceTable, type FaceId, type FontFaceMetrics, advanceTableFor, decodeFwm } from './fwm.js';
import { bytes as courierPrimeBold } from './generated/courier-prime-bold.fwm.js';
import { bytes as courierPrimeBoldItalic } from './generated/courier-prime-bolditalic.fwm.js';
import { bytes as courierPrimeItalic } from './generated/courier-prime-italic.fwm.js';
import { bytes as courierPrimeRegular } from './generated/courier-prime-regular.fwm.js';
import { FACES } from './generated/registry.generated.js';

type FaceRow = (typeof FACES)[number];
type FaceStyle = 'regular' | 'bold' | 'italic' | 'bolditalic';

/**
 * The generator's module-naming rule (`faceId.replace(':', '-')`,
 * `scripts/build-font-metrics.ts`) as a static map from `faceId` to its committed `.fwm`
 * bytes module. Bytes load with the module (ESM has no lazy static import); "lazily" below
 * refers to `decodeFwm` — the binary-to-`FontFaceMetrics` parse — which runs at most once
 * per `faceId`, on first use, memoized on the registry instance.
 */
const FACE_BYTES: Readonly<Record<string, Uint8Array>> = {
  'courier-prime:bold': courierPrimeBold,
  'courier-prime:bolditalic': courierPrimeBoldItalic,
  'courier-prime:italic': courierPrimeItalic,
  'courier-prime:regular': courierPrimeRegular,
};

// Guards a silently-missing static import above: every row `build-font-metrics.ts` commits
// to `FACES` must have a wired bytes module, or decoding it would throw at first use deep
// inside layout instead of here, at load time.
for (const row of FACES) {
  if (!(row.faceId in FACE_BYTES)) throw new Error(`fonts/registry: no .fwm bytes wired for ${row.faceId}`);
}

/** Spec 02 §3.2: `FontFamilyId` → the bundled face family it binds to. */
const FAMILY_BINDING: Record<LogicalFontFamily, string> = {
  'courier-screenplay': 'courier-prime',
  'courier-new': 'liberation-mono',
  times: 'liberation-serif',
  arial: 'liberation-sans',
  calibri: 'carlito',
  cambria: 'caladea',
  georgia: 'gelasio',
  serif: 'noto-serif',
  sans: 'noto-sans',
  mono: 'noto-sans-mono',
};

/**
 * Spec 02 §3.1's role classification, used to fall back to any bundled face of the right
 * shape when a logical family's own bound face has not shipped yet. Today `fonts/src/`
 * (§4.1) holds only Courier Prime, so every non-mono family — and `courier-new`, whose own
 * Liberation Mono is not bundled either — falls back through this table; layout must never
 * block on a font that has not arrived (§3.5).
 */
const FAMILY_CLASSIFICATION: Record<LogicalFontFamily, 'mono' | 'serif' | 'sans'> = {
  'courier-screenplay': 'mono',
  'courier-new': 'mono',
  mono: 'mono',
  times: 'serif',
  georgia: 'serif',
  cambria: 'serif',
  serif: 'serif',
  arial: 'sans',
  calibri: 'sans',
  sans: 'sans',
};

const ALIAS_VERSION = sha256Hex(canonicalJSON(FONT_ALIASES)).slice(0, 16);
/**
 * Spec 02 §3.3's full script/CJK/symbol/emoji fallback chain is data (`fonts/fallback.ts`)
 * that ships with those fonts' asset data in a later task; until then `fallbackFor` below
 * only implements the binding/classification tables, so those are what this registry's
 * version needs to track.
 */
const FALLBACK_VERSION = sha256Hex(canonicalJSON({ binding: FAMILY_BINDING, classification: FAMILY_CLASSIFICATION })).slice(0, 16);

function isLogicalFamily(id: string): id is LogicalFontFamily {
  return (LOGICAL_FONT_FAMILIES as readonly string[]).includes(id);
}

function rowsForFamily(slug: string): FaceRow[] {
  return FACES.filter((f) => f.family === slug);
}

function rowsForClassification(classification: 'mono' | 'serif' | 'sans'): FaceRow[] {
  return FACES.filter((f) => f.classification === classification);
}

/**
 * Every logical family resolves to *some* bundled rows: its own bound family, else any
 * bundled face sharing its classification, else — only while a classification has no
 * bundled face at all — every bundled face. The array is never empty as long as `FACES`
 * isn't (guarded above), so callers never see "no face for this family".
 */
function rowsFor(id: LogicalFontFamily): FaceRow[] {
  const bound = rowsForFamily(FAMILY_BINDING[id]);
  if (bound.length > 0) return bound;
  const byClassification = rowsForClassification(FAMILY_CLASSIFICATION[id]);
  if (byClassification.length > 0) return byClassification;
  return FACES.slice();
}

function pickRow(rows: FaceRow[], style: FaceStyle): FaceRow | undefined {
  return rows.find((r) => r.style === style);
}

/** Spec 02 §3.4 style synthesis: prefer the exact styled face; otherwise fall back to
 * regular (or, for bold+italic, to whichever single styled face exists) and report which
 * axis was synthesized. The caller's advance must not depend on which branch ran. */
function pickStyled(rows: FaceRow[], bold: boolean, italic: boolean): { row: FaceRow; synthBold: boolean; synthItalic: boolean } {
  const first = rows[0];
  if (!first) throw new Error('fonts/registry: no bundled faces (unreachable — FACES is non-empty)');
  const regular = pickRow(rows, 'regular') ?? first;
  if (!bold && !italic) return { row: regular, synthBold: false, synthItalic: false };
  if (bold && italic) {
    const both = pickRow(rows, 'bolditalic');
    if (both) return { row: both, synthBold: false, synthItalic: false };
    const boldOnly = pickRow(rows, 'bold');
    if (boldOnly) return { row: boldOnly, synthBold: false, synthItalic: true };
    const italicOnly = pickRow(rows, 'italic');
    if (italicOnly) return { row: italicOnly, synthBold: true, synthItalic: false };
    return { row: regular, synthBold: true, synthItalic: true };
  }
  if (bold) {
    const boldRow = pickRow(rows, 'bold');
    return boldRow ? { row: boldRow, synthBold: false, synthItalic: false } : { row: regular, synthBold: true, synthItalic: false };
  }
  const italicRow = pickRow(rows, 'italic');
  return italicRow ? { row: italicRow, synthBold: false, synthItalic: false } : { row: regular, synthBold: false, synthItalic: true };
}

/**
 * `FontRegistry` plus the one method spec §4.3 lists alongside it that isn't part of the
 * interface Task 1 transcribed: the advance-table accessor. Extending, not redeclaring,
 * `FontRegistry` keeps `src/index.ts`'s `export *` of `../layout/types.js` the single
 * declaration.
 */
export interface FontRegistryHandle extends FontRegistry {
  /**
   * Task 2's per-`(faceId, sizeEmu)` advance cache (`advanceTableFor`, `./fwm.ts`), keyed
   * (as that function requires) by `(faceId, sizeEmu, familyId)`. Its memoization is a
   * process-wide module-level `Map` inside `fwm.ts`, not scoped to this registry instance —
   * every `FontRegistryHandle` sharing a `(faceId, sizeEmu, familyId)` key shares one table,
   * which is safe because `decodeFwm`'s output for a given `faceId` never changes.
   *
   * The `advanceOf` callback here is plain font-unit-to-EMU conversion
   * (`emuFromFontUnits`), standing in for Task 18's `layoutAdvance` (which adds the §3.2
   * 10 cpi Courier override) until that function exists — see `advanceTableFor`'s own
   * doc comment.
   */
  advanceTable(faceId: FaceId, sizeEmu: number, familyId: FontFamilyId): AdvanceTable;
}

/** Reserved for a future host seam; empty today — every caller uses `createFontRegistry()`. */
export type CreateFontRegistryOptions = Record<string, never>;

export function createFontRegistry(_opts: CreateFontRegistryOptions = {}): FontRegistryHandle {
  const decodedByFaceId = new Map<FaceId, FontFaceMetrics>();
  const customFaces = new Map<FontFamilyId, FontFaceMetrics[]>();
  let version = computeVersion();

  function decodedFace(faceId: FaceId): FontFaceMetrics {
    const cached = decodedByFaceId.get(faceId);
    if (cached) return cached;
    const bytes = FACE_BYTES[faceId];
    if (!bytes) throw new Error(`fonts/registry: unknown faceId ${faceId}`);
    const face = decodeFwm(bytes, faceId);
    decodedByFaceId.set(faceId, face);
    return face;
  }

  function computeVersion(): string {
    const facePairs = FACES.map((f) => [f.faceId, f.sha256] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const customEntries = [...customFaces.entries()]
      .map(([familyId, faces]) => [familyId, faces.map((f) => f.faceId).sort()] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return sha256Hex(
      canonicalJSON({ faces: facePairs, aliasVersion: ALIAS_VERSION, fallbackVersion: FALLBACK_VERSION, custom: customEntries }),
    ).slice(0, 16);
  }

  function resolveFamily(id: FontFamilyId): { familyId: FontFamilyId; substituted: boolean } {
    if (isLogicalFamily(id)) return { familyId: id, substituted: false };
    if (customFaces.has(id)) return { familyId: id, substituted: false };
    return { familyId: 'mono', substituted: true };
  }

  function face(familyId: FontFamilyId, bold: boolean, italic: boolean): { face: FontFaceMetrics; synthBold: boolean; synthItalic: boolean } {
    const registered = customFaces.get(familyId);
    if (registered && registered.length > 0) {
      // Custom fonts (§3.5) register as a flat face list, not yet a style-indexed table —
      // that arrives with whichever later task adds style variants to custom uploads.
      const first = registered[0];
      if (!first) throw new Error('fonts/registry: unreachable — length checked above');
      return { face: first, synthBold: bold, synthItalic: italic };
    }
    const resolved = resolveFamily(familyId);
    const logicalId = isLogicalFamily(resolved.familyId) ? resolved.familyId : 'mono';
    const { row, synthBold, synthItalic } = pickStyled(rowsFor(logicalId), bold, italic);
    return { face: decodedFace(row.faceId), synthBold, synthItalic };
  }

  function fallbackFor(primary: FontFamilyId, _cp: number, bold: boolean, italic: boolean, _lang: string): FontFaceMetrics {
    // Spec 02 §3.3's script/CJK/symbol/emoji fallback chain ships with those fonts' asset
    // data in a later task. Today's bundle (Courier Prime, Latin-only) means the chain
    // always ends where the spec's own chain ends when nothing else covers a code point:
    // the primary's own face (the ".notdef of the primary face" tofu step).
    return face(primary, bold, italic).face;
  }

  function registerCustom(familyId: FontFamilyId, faces: FontFaceMetrics[]): void {
    customFaces.set(familyId, faces);
    for (const f of faces) decodedByFaceId.set(f.faceId, f);
    version = computeVersion();
  }

  function advanceTable(faceId: FaceId, sizeEmu: number, familyId: FontFamilyId): AdvanceTable {
    const metrics = decodedFace(faceId);
    return advanceTableFor(metrics, sizeEmu, familyId, (cp) => emuFromFontUnits(metrics.advance(cp), sizeEmu, metrics.unitsPerEm));
  }

  return {
    get version() {
      return version;
    },
    resolveFamily,
    face,
    fallbackFor,
    registerCustom,
    advanceTable,
  };
}
