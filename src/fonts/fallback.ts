/**
 * Font family resolution and fallback chains (spec 02 §3.2, §3.3). Owns the data this
 * bundle's `FontFamilyId` → bundled-face binding needs — `FAMILY_BINDING`,
 * `FAMILY_CLASSIFICATION`, `rowsFor`/`pickStyled` (moved here from Task 3's
 * `registry.ts`, which now imports them) — so the binding table has exactly one
 * declaration. A duplicated copy is exactly the "wrong-metrics substitution" bug this task
 * exists to close: two tables that are supposed to agree but don't.
 *
 * `registry.ts` imports from here, never the reverse — `fallbackChain` only needs
 * `FACES`/`.fwm` bytes (Task 2's generated data), not the `FontRegistry` instance, so this
 * module has no dependency on `registry.ts` and no import cycle results.
 */
import { roundHalfEven } from '../layout/round.js';
import type { FaceId, FontFaceMetrics } from '../layout/types.js';
import type { FontFamilyId } from '../schema/primitives.js';
import { LOGICAL_FONT_FAMILIES, type LogicalFontFamily } from '../schema/vocab.js';
import { FACES } from './generated/registry.generated.js';

type FaceRow = (typeof FACES)[number];
type FaceStyle = 'regular' | 'bold' | 'italic' | 'bolditalic';

/** Spec 02 §3.2: `FontFamilyId` → the bundled face family it binds to. */
export const FAMILY_BINDING: Record<LogicalFontFamily, string> = {
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
 * Spec 02 §3.1's role classification. Every logical family now has its own bound face
 * bundled (`FAMILY_BINDING` above always resolves to a non-empty `rowsForFamily`), so this
 * table's only live use is as `fallbackChain`'s Sans/Serif choice for the CJK/Thai/Hebrew
 * step (§3.3: "mono and serif → Serif; sans → Sans") — the classification-search and
 * last-resort branches of `rowsFor` below are unreachable for these ten families and exist
 * only as a defensive fallback for a `custom:` family that has not registered yet.
 */
export const FAMILY_CLASSIFICATION: Record<LogicalFontFamily, 'mono' | 'serif' | 'sans'> = {
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

export function isLogicalFamily(id: string): id is LogicalFontFamily {
  return (LOGICAL_FONT_FAMILIES as readonly string[]).includes(id);
}

export function rowsForFamily(slug: string): FaceRow[] {
  return FACES.filter((f) => f.family === slug);
}

function rowsForClassification(classification: 'mono' | 'serif' | 'sans'): FaceRow[] {
  return FACES.filter((f) => f.classification === classification);
}

/**
 * Every logical family resolves to *some* bundled rows: its own bound family, else any
 * bundled face sharing its classification, else — only while a classification has no
 * bundled face at all — every bundled face. The array is never empty as long as `FACES`
 * isn't, so callers never see "no face for this family".
 */
export function rowsFor(id: LogicalFontFamily): FaceRow[] {
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
export function pickStyled(rows: FaceRow[], bold: boolean, italic: boolean): { row: FaceRow; synthBold: boolean; synthItalic: boolean } {
  const first = rows[0];
  if (!first) throw new Error('fonts/fallback: no bundled faces (unreachable — FACES is non-empty)');
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

function familyIdOf(primary: FontFamilyId): LogicalFontFamily {
  return isLogicalFamily(primary) ? primary : 'mono';
}

// ─── §3.3 script detection (fallback-routing only — not the full UAX #24 Script property;
// spec 02 §6's UCD tables are a later milestone) ────────────────────────────────────────

/** ISO 15924-style tags for exactly the scripts this bundle's chain routes specially. */
export type FallbackScript =
  | 'Hani' | 'Hira' | 'Kana' | 'Bopo' | 'Hang'
  | 'Thai' | 'Hebr' | 'Arab'
  | 'Deva' | 'Beng' | 'Taml' | 'Telu' | 'Gujr' | 'Guru' | 'Knda' | 'Mlym'
  | 'Grek' | 'Cyrl'
  | 'Zzzz';

const SCRIPT_RANGES: readonly [FallbackScript, number, number][] = [
  ['Hira', 0x3040, 0x309f],
  ['Kana', 0x30a0, 0x30ff],
  ['Bopo', 0x3100, 0x312f],
  ['Hani', 0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  ['Hani', 0x4e00, 0x9fff], // CJK Unified Ideographs
  ['Hani', 0xf900, 0xfaff], // CJK Compatibility Ideographs
  ['Hani', 0x20000, 0x2ebef], // astral CJK extensions (not bundled — still routed to CJK, falls to tofu)
  ['Hang', 0x1100, 0x11ff],
  ['Hang', 0xac00, 0xd7a3],
  ['Guru', 0x0a00, 0x0a7f],
  ['Deva', 0x0900, 0x097f],
  ['Beng', 0x0980, 0x09ff],
  ['Gujr', 0x0a80, 0x0aff],
  ['Taml', 0x0b80, 0x0bff],
  ['Telu', 0x0c00, 0x0c7f],
  ['Knda', 0x0c80, 0x0cff],
  ['Mlym', 0x0d00, 0x0d7f],
  ['Thai', 0x0e00, 0x0e7f],
  ['Hebr', 0x0590, 0x05ff],
  ['Arab', 0x0600, 0x06ff],
  ['Arab', 0x0750, 0x077f],
  ['Grek', 0x0370, 0x03ff],
  ['Cyrl', 0x0400, 0x04ff],
];

/** Enough of the Unicode Script property to route spec 02 §3.3's fallback chain — every
 * script that chain names a face for. Not a general-purpose script classifier (§6 owns
 * that, later). */
export function scriptOf(cp: number): FallbackScript {
  for (const [script, start, end] of SCRIPT_RANGES) if (cp >= start && cp <= end) return script;
  return 'Zzzz';
}

/** Spec 02 §3.3: "the run's `lang` mark if set, else the document `meta.language`, else the
 * UI locale; `zh-Hant`/`zh-TW`/`zh-HK` → TC, `ja` → JP, `ko` → KR, otherwise SC." */
export function cjkRegion(lang: string): 'SC' | 'TC' | 'JP' | 'KR' {
  const l = lang.toLowerCase();
  if (l === 'ja' || l.startsWith('ja-')) return 'JP';
  if (l === 'ko' || l.startsWith('ko-')) return 'KR';
  if (l === 'zh-hant' || l === 'zh-tw' || l === 'zh-hk' || l.startsWith('zh-hant-')) return 'TC';
  return 'SC';
}

const INDIC_FAMILY: Readonly<Partial<Record<FallbackScript, string>>> = {
  Deva: 'noto-sans-devanagari',
  Beng: 'noto-sans-bengali',
  Taml: 'noto-sans-tamil',
  Telu: 'noto-sans-telugu',
  Gujr: 'noto-sans-gujarati',
  Guru: 'noto-sans-gurmukhi',
  Knda: 'noto-sans-kannada',
  Mlym: 'noto-sans-malayalam',
};

/**
 * Spec 02 §3.3's fallback chain as data: the ordered list of `FaceId`s a caller (the
 * registry's `fallbackFor`) walks, returning the first whose `covers(cp)` is true. The list
 * is returned in full regardless of which code point triggered the lookup — cheaper than
 * threading `cp` through here, and correct, because the spec's own chain always tries every
 * later step (script face, then symbols, then math, then emoji) for any code point the
 * earlier steps miss, not only for code points "of that script".
 */
export function fallbackChain(primary: FontFamilyId, script: string, bold: boolean, italic: boolean, lang: string): FaceId[] {
  const logicalPrimary = familyIdOf(primary);
  const primaryRows = rowsFor(logicalPrimary);
  const chain: FaceId[] = [pickStyled(primaryRows, bold, italic).row.faceId];

  const pushFamily = (slug: string) => {
    const rows = rowsForFamily(slug);
    if (rows.length === 0) return;
    chain.push(pickStyled(rows, bold, italic).row.faceId);
  };

  // §3.3: "{Sans|Serif} follows the primary's classification (mono and serif → Serif;
  // sans → Sans)."
  const serifSide = FAMILY_CLASSIFICATION[logicalPrimary] !== 'sans';

  switch (script as FallbackScript) {
    case 'Hani':
    case 'Hira':
    case 'Kana':
    case 'Bopo': {
      const region = cjkRegion(lang).toLowerCase();
      pushFamily(`noto-${serifSide ? 'serif' : 'sans'}-cjk-${region}`);
      break;
    }
    case 'Hang':
      pushFamily(`noto-${serifSide ? 'serif' : 'sans'}-cjk-kr`);
      break;
    case 'Thai':
      pushFamily(serifSide ? 'noto-serif-thai' : 'noto-sans-thai');
      break;
    case 'Hebr':
      pushFamily(serifSide ? 'noto-serif-hebrew' : 'noto-sans-hebrew');
      break;
    case 'Arab':
      // §3.1 bundles Noto Naskh Arabic only (not the Sans Arabic alternate spec 02's own
      // table also lists).
      pushFamily('noto-naskh-arabic');
      break;
    case 'Grek':
    case 'Cyrl':
      // §3.3: only when the primary is Courier Prime (Latin-only) does Greek/Cyrillic get
      // a dedicated step — every other bundled family covers Greek/Cyrillic natively.
      if (FAMILY_BINDING[logicalPrimary] === 'courier-prime') pushFamily('liberation-mono');
      break;
    default: {
      const indicFamily = INDIC_FAMILY[script as FallbackScript];
      if (indicFamily) pushFamily(indicFamily);
    }
  }

  pushFamily('noto-sans-symbols-2');
  pushFamily('noto-sans-math');
  pushFamily('noto-emoji');

  return chain;
}

/**
 * The end of the chain (§3.3): every code point advances 0.5 em and the face reports
 * `glyphMissing` (the diagnostic itself is emitted by the paginator that calls this, a
 * later task — this module only owns the metrics contract). This is the *only* place the
 * 0.5 em rule lives; `decodeFwm`'s `defaultAdvance` stays the face's own `.notdef` advance
 * (spec §4.2), used when a *covered* face is queried for a code point outside its ranges,
 * which is a different situation from "nothing in the whole fallback chain covers this".
 */
export function tofuFace(primary: FontFaceMetrics): FontFaceMetrics {
  const half = roundHalfEven(primary.unitsPerEm / 2);
  return {
    ...primary,
    covers: () => true,
    advance: () => half,
    kern: () => 0,
  };
}
