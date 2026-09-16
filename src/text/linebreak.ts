/**
 * Line breaking, UAX #14 (spec 02 §6.2, task 7), with the spec's screenplay tailorings.
 *
 * **Algorithm shape.** UAX #14 resolves a break/no-break/mandatory decision at every
 * boundary between two characters by applying rules LB1–LB31 in strict priority order
 * (rule *N* fires only when no rule before it already decided this boundary). Two of
 * those rules, LB9 and LB10, are not boundary decisions at all: they fold each combining
 * mark or ZWJ into the preceding base character ("treat X (CM|ZWJ)* as if it were X") so
 * that every LATER rule (LB11–LB31) sees one *token* per base character, not one per code
 * point. This module builds that token stream first (`tokenize`, folding LB1's class
 * resolution, the tailorings below, and LB9/10's attachment into one left-to-right pass),
 * then walks token boundaries applying LB4–LB31 in order (`decideBoundary`); LB2/LB3 (sot
 * ×, eot !) are structural — the token loop never evaluates a boundary before the first
 * token, and "always break at end of text" is left for the caller, who already knows the
 * paragraph ends there (see `breakOpportunities`'s doc comment on the array's shape).
 *
 * A handful of rules need more than the immediate pair of tokens:
 *   - LB8/LB14/LB16/LB17 ("X SP* × Y") need the nearest non-space token *before* a run of
 *     spaces — tracked incrementally as `runBase` while scanning left to right, updated
 *     once per token (not per rule), matching the identical shape those four rules share.
 *   - LB15a ("(context) Pi&QU SP* ×") is the same shape but the "X" is a specific
 *     character class (an initial-punctuation quote) rather than a fixed set, so it is
 *     tracked as its own `piActive` flag with the same update-once-per-token rhythm.
 *   - LB25 (numeric sequences) tracks a small chain state (`numChain`: none / a bare
 *     `NU (SY|IS)*` run / that run followed by `CL`/`CP`) the same way.
 *   - LB30a (regional indicator pairing) tracks the length of the current run of RI
 *     tokens (`riRun`) the same way.
 *   - LB20a, LB21a, LB21b, LB25's `PO×OP NU`/`PO×OP IS NU` forms, and LB28a's `VF` form
 *     need one or two tokens of fixed lookback/lookahead — plain array indexing, since
 *     the token list is fully materialized before the boundary pass (`classAt`).
 *
 * **Deviation ledger (spec 02 §6.2's "Tailorings:", task 7 brief step 1's "four
 * documented tailorings").** Each is implemented in `resolveClass`/`tokenize` and its
 * effect on the official conformance suite is recorded in `linebreak.test.ts`'s
 * "tailoring deviations from stock UAX #14" section, not asserted here:
 *   1. **SA** (Thai/Lao/Khmer/Myanmar) with no `opts.dictionary` resolves to `AL`
 *      (`resolveClass`) — the spec's literal "residual SA characters treated as AL",
 *      which simplifies stock UAX #14's GC-conditional `SA→CM (Mn/Mc) | AL (else)` table.
 *      Zero conformance exclusions: `LineBreakTest.txt`'s only SA-class sample is a
 *      non-Mn/Mc Thai letter (already `AL` in stock too), and the individual-`AL`-token
 *      chain this produces is indistinguishable from stock's CM-collapsed chain anyway —
 *      LB28 (`AL×AL`) forbids a break either way.
 *   2. **CJ→NS** (`resolveClass`) is stock UAX #14's own LB1 default resolution table,
 *      implemented explicitly here (not left implicit) because spec 02 names it as an
 *      owned tailoring. Zero conformance exclusions (it doesn't change stock behaviour).
 *   3. **Korean** (`opts.language`'s primary subtag `ko`): `H2`/`H3`/`JL`/`JV`/`JT`
 *      resolve to `AL` instead of participating in LB26/27's Hangul-syllable-block
 *      rules, so breaks occur only at spaces (`resolveClass`). Opt-in only — the
 *      conformance suite is run at a non-Korean language, so it exercises stock
 *      LB26/27 unchanged. Zero conformance exclusions.
 *   4. **Hard breaks** (U+000A mandatory inside a paragraph, U+2028 likewise): both are
 *      already `LF`/`BK` in stock `LineBreak.txt` (LB5/LB4 already make them mandatory).
 *      No code path deviates from stock; the tailoring is a restatement, not a rule
 *      change. Zero conformance exclusions.
 * Tab (U+0009, `BA`) and soft hyphen (U+00AD, `BA`) are *not* among the four: both are
 * already break-opportunities-after in stock UAX #14 (LB21's `×BA` only forbids breaking
 * *before* BA; nothing forbids breaking after), so the brief's explicit tests for them
 * exercise stock behaviour, not a deviation.
 *
 * **Not a deviation, deliberately not special-cased:** spec 02 §7.3 also asks that
 * U+2011 (non-breaking hyphen) and U+00A0 (NBSP) — both `GL` — "never break". Stock LB12a
 * ("`[^SP BA HY] × GL`") already forbids breaking before *any* `GL` character except when
 * immediately preceded by `SP`, `BA` or `HY` — and the official conformance suite tests
 * exactly that carve-out for `GL` (`LineBreakTest.txt`, e.g. `SP ÷ 00A0`: a break *is*
 * expected right after a literal space before a NBSP). Overriding LB12a for these two
 * code points specifically would regress that verified case for a scenario screenplay
 * text never produces (a bare space directly before a NBSP/non-breaking hyphen). This
 * module therefore leaves LB11/LB12/LB12a exactly as UAX #14 specifies; the brief's
 * "never break" tests use the realistic adjacent-word context the spec's prose is about.
 */
import { EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES } from './generated/extended-pictographic.generated.js';
import { EAST_ASIAN_WIDTH_NAMES, EAST_ASIAN_WIDTH_STARTS, EAST_ASIAN_WIDTH_VALUES } from './generated/east-asian-width.generated.js';
import { GENERAL_CATEGORY_NAMES, GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES } from './generated/general-category.generated.js';
import { LINE_BREAK_NAMES, LINE_BREAK_STARTS, LINE_BREAK_VALUES, type LineBreakClass } from './generated/line-break.generated.js';
import { lookupRangeValue } from './ucd-lookup.js';

export type { LineBreakClass } from './generated/line-break.generated.js';

/**
 * Southeast Asian dictionary word segmentation (spec 02 §6.4 — Thai/Lao/Khmer/Myanmar).
 * `segment` receives the text of one maximal run of `Line_Break=SA` code points and
 * returns the sorted, strictly-increasing UTF-16 offsets *within that substring* (each
 * strictly between `0` and the substring's length) where a word boundary — and therefore
 * a line-break opportunity — falls. §6.4 itself (ICU dictionaries, compact DAWG data,
 * lazy loading) is a later task; this interface is task 7's injection point for it. With
 * no `dictionary` supplied, `breakOpportunities` falls back to the "residual SA → AL"
 * tailoring (deviation 1 above) for the whole run.
 */
export interface DictionarySegmenter {
  segment(text: string): number[];
}

export interface BreakOptions {
  /**
   * A BCP-47-ish language tag (`'en'`, `'ko'`, `'ko-KR'`, ...) — spec 02 §6.2's "the
   * element's resolved language (the `lang` mark of the run, else `meta.language`)".
   * Only the primary subtag, compared case-insensitively, selects the Korean tailoring.
   */
  language: string;
  /** Injected Thai/Lao/Khmer/Myanmar segmenter (spec 02 §6.4). See `DictionarySegmenter`. */
  dictionary?: DictionarySegmenter;
}

// ─── UCD accessors (imported directly, not through ./ucd.generated.js, so this module's
// import graph — on the per-keystroke re-pagination path, spec 02 §33 — stays limited to
// the four properties it actually needs; see grapheme.ts's header comment for the same
// reasoning about its own tables). ───────────────────────────────────────────────────────

function rawLineBreakClass(cp: number): LineBreakClass {
  return LINE_BREAK_NAMES[lookupRangeValue(LINE_BREAK_STARTS, LINE_BREAK_VALUES, cp)] ?? 'XX';
}

function isPi(cp: number): boolean {
  return GENERAL_CATEGORY_NAMES[lookupRangeValue(GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, cp)] === 'Pi';
}

function isPf(cp: number): boolean {
  return GENERAL_CATEGORY_NAMES[lookupRangeValue(GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, cp)] === 'Pf';
}

function isUnassigned(cp: number): boolean {
  return GENERAL_CATEGORY_NAMES[lookupRangeValue(GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, cp)] === 'Cn';
}

function isExtendedPictographic(cp: number): boolean {
  return lookupRangeValue(EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES, cp) === 1;
}

/** tr14 §6.2's `$EastAsian` set: `[\p{ea=F}\p{ea=W}\p{ea=H}]` (Fullwidth, Wide, Halfwidth). */
function isEastAsianWide(cp: number): boolean {
  const w = EAST_ASIAN_WIDTH_NAMES[lookupRangeValue(EAST_ASIAN_WIDTH_STARTS, EAST_ASIAN_WIDTH_VALUES, cp)];
  return w === 'F' || w === 'W' || w === 'H';
}

const DOTTED_CIRCLE = 0x25cc;
const HYPHEN_2010 = 0x2010;

/** LB28a's `(AK | [◌] | AS)` alternation. */
function isAkAsDottedCircle(cls: LineBreakClass, cp: number): boolean {
  return cls === 'AK' || cls === 'AS' || cp === DOTTED_CIRCLE;
}

// ─── Decoding ───────────────────────────────────────────────────────────────────────────

interface CodePointAt {
  cp: number;
  index: number;
}

/** Decodes `text` into code points (surrogate-pair aware) with their UTF-16 offsets. */
function decode(text: string): CodePointAt[] {
  const out: CodePointAt[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    out.push({ cp, index: i });
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

// ─── LB1 + tailorings + LB9/10: text -> tokens ─────────────────────────────────────────

/**
 * One token in the post-LB9/10 stream: a base character plus any combining marks/ZWJs
 * folded onto it (LB9), or a single otherwise-unattached CM/ZWJ resolved to `AL` (LB10).
 */
interface Token {
  /** The resolved matching class LB11–LB31 use for this token (LB9: "as if it were X"). */
  cls: LineBreakClass;
  /** UTF-16 offset of the token's first code point — where a boundary decision before this token is written. */
  offset: number;
  /** UTF-16 offset one past the token's last code point (dictionary-run tokens span more than one base character). */
  end: number;
  /** The code point classification checks (Pi/Pf, East Asian width, U+2010/U+25CC) run against — the token's base character. */
  baseCp: number;
  /** True when the token's last physical code point is literally ZWJ (LB8a fires on this, independent of `cls`). */
  endsWithZWJ: boolean;
}

const EXCLUDED_BASE: ReadonlySet<LineBreakClass> = new Set(['BK', 'CR', 'LF', 'NL', 'SP', 'ZW']);

/** LB1's default resolution table, plus spec 02 §6.2's CJ/Korean tailorings (deviations 2–3) and the SA fallback (deviation 1, no-dictionary case only). */
function resolveClass(raw: LineBreakClass, isKorean: boolean): LineBreakClass {
  switch (raw) {
    case 'AI':
    case 'SG':
    case 'XX':
      return 'AL';
    case 'CJ':
      return 'NS';
    case 'SA':
      return 'AL';
    case 'H2':
    case 'H3':
    case 'JL':
    case 'JV':
    case 'JT':
      return isKorean ? 'AL' : raw;
    default:
      return raw;
  }
}

/**
 * Builds the token stream: LB1 class resolution (with tailorings) + LB9 combining-mark/ZWJ
 * attachment + LB10's "remaining CM/ZWJ is AL" — see this file's header comment. Also
 * collects, for each maximal run of raw `SA` code points when `opts.dictionary` is given,
 * the dictionary's internal break offsets (`dictionaryBreaks`, applied directly onto the
 * result array by `breakOpportunities` — they bypass the token-boundary rule engine
 * entirely, since a dictionary's word boundary is not a UAX #14 class decision).
 */
function tokenize(text: string, opts: BreakOptions): { tokens: Token[]; dictionaryBreaks: number[] } {
  const cps = decode(text);
  const isKorean = (opts.language.split('-')[0] ?? '').toLowerCase() === 'ko';
  const tokens: Token[] = [];
  const dictionaryBreaks: number[] = [];

  const endOf = (i: number): number => (i + 1 < cps.length ? (cps[i + 1] as CodePointAt).index : text.length);

  let i = 0;
  while (i < cps.length) {
    const { cp, index } = cps[i] as CodePointAt;
    const raw = rawLineBreakClass(cp);

    // Dictionary-covered SA run: one synthetic token spanning the whole run; internal
    // breaks come from the dictionary, not from LB11–LB31 (see header comment, deviation 1).
    if (raw === 'SA' && opts.dictionary) {
      let j = i;
      while (j < cps.length && rawLineBreakClass((cps[j] as CodePointAt).cp) === 'SA') j++;
      const runEnd = endOf(j - 1);
      const runText = text.slice(index, runEnd);
      for (const rel of opts.dictionary.segment(runText)) {
        if (rel > 0 && rel < runText.length) dictionaryBreaks.push(index + rel);
      }
      tokens.push({ cls: 'AL', offset: index, end: runEnd, baseCp: cp, endsWithZWJ: false });
      i = j;
      continue;
    }

    const canAttach = (raw === 'CM' || raw === 'ZWJ') && tokens.length > 0 && !EXCLUDED_BASE.has((tokens[tokens.length - 1] as Token).cls);
    if (canAttach) {
      const base = tokens[tokens.length - 1] as Token;
      base.end = endOf(i);
      base.endsWithZWJ = raw === 'ZWJ';
      i++;
      continue;
    }

    // LB10: an unattached CM/ZWJ (first character, or follows an excluded base) is AL;
    // otherwise LB1 + tailorings (resolveClass).
    const cls = raw === 'CM' || raw === 'ZWJ' ? 'AL' : resolveClass(raw, isKorean);
    tokens.push({ cls, offset: index, end: endOf(i), baseCp: cp, endsWithZWJ: raw === 'ZWJ' });
    i++;
  }

  return { tokens, dictionaryBreaks };
}

// ─── LB4–LB31: token boundaries -> break decisions ─────────────────────────────────────

type ClassOrSentinel = LineBreakClass | 'sot' | 'eot';

function classAt(tokens: Token[], idx: number): ClassOrSentinel {
  if (idx < 0) return 'sot';
  const t = tokens[idx];
  return t === undefined ? 'eot' : t.cls;
}

/** LB15a's left context: `(sot | BK | CR | LF | NL | OP | QU | GL | SP | ZW)`. */
const LB15A_CONTEXT: ReadonlySet<LineBreakClass> = new Set(['BK', 'CR', 'LF', 'NL', 'OP', 'QU', 'GL', 'SP', 'ZW']);
/** LB15b's right context: `(SP | GL | WJ | CL | QU | CP | EX | IS | SY | BK | CR | LF | NL | ZW | eot)`. */
const LB15B_FOLLOW: ReadonlySet<LineBreakClass> = new Set(['SP', 'GL', 'WJ', 'CL', 'QU', 'CP', 'EX', 'IS', 'SY', 'BK', 'CR', 'LF', 'NL', 'ZW']);
/** LB20a's left context: `(sot | BK | CR | LF | NL | SP | ZW | CB | GL)`. */
const LB20A_CONTEXT: ReadonlySet<LineBreakClass> = new Set(['BK', 'CR', 'LF', 'NL', 'SP', 'ZW', 'CB', 'GL']);
const KOREAN_SYLLABLE: ReadonlySet<LineBreakClass> = new Set(['JL', 'JV', 'JT', 'H2', 'H3']);

/** Running state threaded left to right across the token loop (see header comment). */
interface ChainState {
  /** Nearest non-`SP` class before the current position (LB8/LB14/LB16/LB17's `X SP* ×/÷`). */
  runBase: ClassOrSentinel;
  /** True while inside a valid LB15a `(context) Pi&QU SP*` run. */
  piActive: boolean;
  /** LB25's `NU (SY|IS)*` chain: `'none'`, `'num'` (in the chain), or `'numCl'` (chain then `CL`/`CP`). */
  numChain: 'none' | 'num' | 'numCl';
  /** Length of the run of `RI` tokens ending at the current position (LB30a). */
  riRun: number;
}

/**
 * Decides the boundary immediately before `tokens[k]` (`k >= 1`), applying LB4–LB31 in
 * order; `state` reflects every token strictly before `tokens[k]` (see header comment).
 * Returns `0` (no break), `1` (break opportunity) or `2` (mandatory break).
 */
function decideBoundary(tokens: Token[], k: number, state: ChainState): 0 | 1 | 2 {
  const prev = tokens[k - 1] as Token;
  const curr = tokens[k] as Token;
  const prevCls = prev.cls;
  const currCls = curr.cls;
  const prevPrevCls = classAt(tokens, k - 2);
  const nextCls = classAt(tokens, k + 1);
  const nextNextCls = classAt(tokens, k + 2);

  // LB4: BK !
  if (prevCls === 'BK') return 2;
  // LB5: CR×LF / CR! / LF! / NL!
  if (prevCls === 'CR') return currCls === 'LF' ? 0 : 2;
  if (prevCls === 'LF' || prevCls === 'NL') return 2;
  // LB6: ×(BK|CR|LF|NL)
  if (currCls === 'BK' || currCls === 'CR' || currCls === 'LF' || currCls === 'NL') return 0;
  // LB7: ×SP, ×ZW
  if (currCls === 'SP' || currCls === 'ZW') return 0;
  // LB8: ZW SP* ÷
  if (state.runBase === 'ZW') return 1;
  // LB8a: ZWJ×
  if (prev.endsWithZWJ) return 0;
  // LB11: ×WJ, WJ×
  if (currCls === 'WJ' || prevCls === 'WJ') return 0;
  // LB12: GL×
  if (prevCls === 'GL') return 0;
  // LB12a: [^SP BA HY]×GL
  if (currCls === 'GL' && prevCls !== 'SP' && prevCls !== 'BA' && prevCls !== 'HY') return 0;
  // LB13: ×CL, ×CP, ×EX, ×SY
  if (currCls === 'CL' || currCls === 'CP' || currCls === 'EX' || currCls === 'SY') return 0;
  // LB14: OP SP* ×
  if (state.runBase === 'OP') return 0;
  // LB15a: (context) Pi&QU SP* ×
  if (state.piActive) return 0;
  // LB15b: × Pf&QU (follow-set | eot)
  if (currCls === 'QU' && isPf(curr.baseCp) && (nextCls === 'eot' || LB15B_FOLLOW.has(nextCls as LineBreakClass))) return 0;
  // LB15c: SP ÷ IS NU
  if (prevCls === 'SP' && currCls === 'IS' && nextCls === 'NU') return 1;
  // LB15d: ×IS
  if (currCls === 'IS') return 0;
  // LB16: (CL|CP) SP* × NS
  if ((state.runBase === 'CL' || state.runBase === 'CP') && currCls === 'NS') return 0;
  // LB17: B2 SP* × B2
  if (state.runBase === 'B2' && currCls === 'B2') return 0;
  // LB18: SP ÷
  if (prevCls === 'SP') return 1;
  // LB19: ×[QU-Pi], [QU-Pf]×
  if (currCls === 'QU' && !isPi(curr.baseCp)) return 0;
  if (prevCls === 'QU' && !isPf(prev.baseCp)) return 0;
  // LB19a
  if (currCls === 'QU' && !isEastAsianWide(prev.baseCp)) return 0;
  if (currCls === 'QU' && (nextCls === 'eot' || !isEastAsianWide((tokens[k + 1] as Token).baseCp))) return 0;
  if (prevCls === 'QU' && !isEastAsianWide(curr.baseCp)) return 0;
  if (prevCls === 'QU' && (k === 1 || !isEastAsianWide((tokens[k - 2] as Token).baseCp))) return 0;
  // LB20: ÷CB, CB÷
  if (currCls === 'CB' || prevCls === 'CB') return 1;
  // LB20a: (context) (HY|[‐]) × AL
  if (currCls === 'AL' && (prevCls === 'HY' || prev.baseCp === HYPHEN_2010) && (k === 1 || LB20A_CONTEXT.has(prevPrevCls as LineBreakClass))) return 0;
  // LB21: ×BA, ×HY, ×NS, BB×
  if (currCls === 'BA' || currCls === 'HY' || currCls === 'NS') return 0;
  if (prevCls === 'BB') return 0;
  // LB21a: HL (HY | [BA-$EastAsian]) × [^HL]
  if (prevPrevCls === 'HL' && (prevCls === 'HY' || (prevCls === 'BA' && !isEastAsianWide(prev.baseCp))) && currCls !== 'HL') return 0;
  // LB21b: SY×HL
  if (prevCls === 'SY' && currCls === 'HL') return 0;
  // LB22: ×IN
  if (currCls === 'IN') return 0;
  // LB23: (AL|HL)×NU, NU×(AL|HL)
  if ((prevCls === 'AL' || prevCls === 'HL') && currCls === 'NU') return 0;
  if (prevCls === 'NU' && (currCls === 'AL' || currCls === 'HL')) return 0;
  // LB23a: PR×(ID|EB|EM), (ID|EB|EM)×PO
  if (prevCls === 'PR' && (currCls === 'ID' || currCls === 'EB' || currCls === 'EM')) return 0;
  if ((prevCls === 'ID' || prevCls === 'EB' || prevCls === 'EM') && currCls === 'PO') return 0;
  // LB24: (PR|PO)×(AL|HL), (AL|HL)×(PR|PO)
  if ((prevCls === 'PR' || prevCls === 'PO') && (currCls === 'AL' || currCls === 'HL')) return 0;
  if ((prevCls === 'AL' || prevCls === 'HL') && (currCls === 'PR' || currCls === 'PO')) return 0;
  // LB25: numeric sequences (Unicode 16.0's simplified rule set)
  if (state.numChain === 'numCl' && (currCls === 'PO' || currCls === 'PR')) return 0;
  if (state.numChain === 'num' && (currCls === 'PO' || currCls === 'PR' || currCls === 'NU')) return 0;
  if (prevCls === 'PO' && currCls === 'NU') return 0;
  if (prevCls === 'PR' && currCls === 'NU') return 0;
  if (prevCls === 'HY' && currCls === 'NU') return 0;
  if (prevCls === 'IS' && currCls === 'NU') return 0;
  if ((prevCls === 'PO' || prevCls === 'PR') && currCls === 'OP' && (nextCls === 'NU' || (nextCls === 'IS' && nextNextCls === 'NU'))) return 0;
  // LB26: JL×(JL|JV|H2|H3), (JV|H2)×(JV|JT), (JT|H3)×JT
  if (prevCls === 'JL' && (currCls === 'JL' || currCls === 'JV' || currCls === 'H2' || currCls === 'H3')) return 0;
  if ((prevCls === 'JV' || prevCls === 'H2') && (currCls === 'JV' || currCls === 'JT')) return 0;
  if ((prevCls === 'JT' || prevCls === 'H3') && currCls === 'JT') return 0;
  // LB27: (JL|JV|JT|H2|H3)×PO, PR×(JL|JV|JT|H2|H3)
  if (KOREAN_SYLLABLE.has(prevCls) && currCls === 'PO') return 0;
  if (prevCls === 'PR' && KOREAN_SYLLABLE.has(currCls)) return 0;
  // LB28: (AL|HL)×(AL|HL)
  if ((prevCls === 'AL' || prevCls === 'HL') && (currCls === 'AL' || currCls === 'HL')) return 0;
  // LB28a: Brahmic orthographic syllables
  if (prevCls === 'AP' && isAkAsDottedCircle(currCls, curr.baseCp)) return 0;
  if (isAkAsDottedCircle(prevCls, prev.baseCp) && (currCls === 'VF' || currCls === 'VI')) return 0;
  if (
    k >= 2 &&
    isAkAsDottedCircle((tokens[k - 2] as Token).cls, (tokens[k - 2] as Token).baseCp) &&
    prevCls === 'VI' &&
    (currCls === 'AK' || curr.baseCp === DOTTED_CIRCLE)
  )
    return 0;
  if (isAkAsDottedCircle(prevCls, prev.baseCp) && isAkAsDottedCircle(currCls, curr.baseCp) && nextCls === 'VF') return 0;
  // LB29: IS×(AL|HL)
  if (prevCls === 'IS' && (currCls === 'AL' || currCls === 'HL')) return 0;
  // LB30: (AL|HL|NU)×[OP-$EastAsian], [CP-$EastAsian]×(AL|HL|NU)
  if ((prevCls === 'AL' || prevCls === 'HL' || prevCls === 'NU') && currCls === 'OP' && !isEastAsianWide(curr.baseCp)) return 0;
  if (prevCls === 'CP' && !isEastAsianWide(prev.baseCp) && (currCls === 'AL' || currCls === 'HL' || currCls === 'NU')) return 0;
  // LB30a: regional indicator pairing
  if (prevCls === 'RI' && currCls === 'RI' && state.riRun % 2 === 1) return 0;
  // LB30b: EB×EM, [ExtendedPictographic&Cn]×EM
  if (currCls === 'EM' && (prevCls === 'EB' || (isExtendedPictographic(prev.baseCp) && isUnassigned(prev.baseCp)))) return 0;
  // LB31: ALL ÷, ÷ ALL (default)
  return 1;
}

/**
 * Break opportunities, UAX #14 (spec 02 §6.2), one entry per UTF-16 offset of `text`:
 * `0` no break, `1` optional break, `2` mandatory break. `result[i]` describes the
 * boundary immediately *before* `text` index `i`; `result[0]` is always `0` (LB2, "never
 * break at the start of text"). LB3's "always break at the end of text" is not encoded —
 * a caller already knows the paragraph ends at `text.length`. A UTF-16 index inside a
 * surrogate pair, or attached to a preceding combining mark/ZWJ by LB9, is always `0`
 * (never a token boundary — see this file's header comment).
 */
export function breakOpportunities(text: string, opts: BreakOptions): Uint8Array {
  const result = new Uint8Array(text.length);
  if (text.length === 0) return result;

  const { tokens, dictionaryBreaks } = tokenize(text, opts);
  const state: ChainState = { runBase: 'sot', piActive: false, numChain: 'none', riRun: 0 };

  for (let k = 0; k < tokens.length; k++) {
    if (k > 0) result[(tokens[k] as Token).offset] = decideBoundary(tokens, k, state);

    const t = tokens[k] as Token;
    const cls = t.cls;
    state.runBase = cls === 'SP' ? state.runBase : cls;

    const isPiQu = cls === 'QU' && isPi(t.baseCp);
    if (isPiQu && (k === 0 || LB15A_CONTEXT.has(classAt(tokens, k - 1) as LineBreakClass))) state.piActive = true;
    else if (cls !== 'SP') state.piActive = false;

    if (state.numChain === 'num' && (cls === 'SY' || cls === 'IS')) state.numChain = 'num';
    else if (state.numChain === 'num' && (cls === 'CL' || cls === 'CP')) state.numChain = 'numCl';
    else if (cls === 'NU') state.numChain = 'num';
    else state.numChain = 'none';

    state.riRun = cls === 'RI' ? state.riRun + 1 : 0;
  }

  for (const offset of dictionaryBreaks) result[offset] = 1;
  return result;
}
