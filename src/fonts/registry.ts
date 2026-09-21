/**
 * Font registry (spec 02 §4.3): builds the `FontFamilyId` → bundled-faces map from
 * `FACES`'s `family`/`style`/`classification` columns (Task 2's generated table),
 * never by parsing file or module names; resolves style synthesis (§3.4); wires §3.3's
 * fallback chains (`fonts/fallback.ts`); and wraps Task 2's per-`(faceId, sizeEmu)`
 * advance cache (`advanceTableFor`, `./fwm.ts`).
 *
 * `FontRegistry` itself is Task 1's exact spec §4.3 shape (`src/layout/types.ts`);
 * this module implements it rather than redeclaring it. Family binding, classification and
 * style-pick logic live in `./fallback.ts` (this module is a one-directional consumer of
 * it, never the reverse — see that module's doc comment).
 */
import { canonicalJSON } from '../hash/canonical-json.js';
import { sha256Hex } from '../hash/sha256.js';
import { measuredAdvance } from '../layout/measure.js';
import type { FontRegistry } from '../layout/types.js';
import type { FontFamilyId } from '../schema/primitives.js';
import { FONT_ALIASES } from './aliases.js';
import { FAMILY_BINDING, FAMILY_CLASSIFICATION, fallbackChain, isLogicalFamily, pickStyled, rowsFor, scriptOf, tofuFace } from './fallback.js';
import { type AdvanceTable, type FaceId, type FontFaceMetrics, advanceTableFor, decodeFwm } from './fwm.js';
import { FACE_BYTES } from './generated/face-bytes.generated.js';
import { FACES } from './generated/registry.generated.js';

// Guards a silently-missing generated wiring: every row `build-font-metrics.ts` commits to
// `FACES` must have a wired bytes entry in `face-bytes.generated.ts`, or decoding it would
// throw at first use deep inside layout instead of here, at load time.
for (const row of FACES) {
  if (!(row.faceId in FACE_BYTES)) throw new Error(`fonts/registry: no .fwm bytes wired for ${row.faceId}`);
}

const ALIAS_VERSION = sha256Hex(canonicalJSON(FONT_ALIASES)).slice(0, 16);
/** Spec 02 §3.3's fallback chain is data (`fonts/fallback.ts`); its binding/classification
 * tables are covered by `facePairs` below (they only ever select among `FACES` rows), so
 * only the routing tables `fallbackChain` adds beyond `face()`'s own resolution need their
 * own hash input here. */
const FALLBACK_VERSION = sha256Hex(canonicalJSON({ binding: FAMILY_BINDING, classification: FAMILY_CLASSIFICATION })).slice(0, 16);

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
   * The `advanceOf` callback is `measuredAdvance` (`layout/measure.ts`): `layoutAdvance`'s
   * §3.2 10 cpi Courier override plus §7.4's zero-width/NBSP special cases.
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

  function fallbackFor(primary: FontFamilyId, cp: number, bold: boolean, italic: boolean, lang: string): FontFaceMetrics {
    // Spec 02 §3.3: walk the chain (primary, script face, symbols, math, emoji) and return
    // the first face whose cmap covers `cp`; the chain is built once per call, not
    // per-face-covers-check, because `fallbackChain` already orders it correctly.
    const chain = fallbackChain(primary, scriptOf(cp), bold, italic, lang);
    for (const faceId of chain) {
      const metrics = decodedFace(faceId);
      if (metrics.covers(cp)) return metrics;
    }
    // Nothing in the chain covers it: the primary's own tofu (§3.3's ".notdef of the
    // primary face"), never a different family's tofu.
    return tofuFace(face(primary, bold, italic).face);
  }

  function registerCustom(familyId: FontFamilyId, faces: FontFaceMetrics[]): void {
    customFaces.set(familyId, faces);
    for (const f of faces) decodedByFaceId.set(f.faceId, f);
    version = computeVersion();
  }

  function advanceTable(faceId: FaceId, sizeEmu: number, familyId: FontFamilyId): AdvanceTable {
    const metrics = decodedFace(faceId);
    return advanceTableFor(metrics, sizeEmu, familyId, (cp) => measuredAdvance(metrics, familyId, cp, sizeEmu));
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
