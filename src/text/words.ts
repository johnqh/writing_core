/**
 * Word boundaries, UAX #29 (spec 02 §6.5, task 9). Used for double-click selection,
 * Option/Ctrl+arrow word movement, word counts and Auto Adjust Lines (§28).
 *
 * **Algorithm shape.** Same two-phase shape as `grapheme.ts` (UAX #29 GB) and
 * `linebreak.ts` (UAX #14 LB): rule WB4 ("X (Extend | Format | ZWJ)* → X") is not itself a
 * boundary decision, it is a *folding* convention that makes every later rule (WB5–WB16)
 * see one token per base character rather than one per code point — so `tokenize` builds
 * that token stream first (folding a trailing run of Extend/Format/ZWJ onto its preceding
 * base token, exactly like `linebreak.ts`'s LB9/10 handling of CM/ZWJ), then
 * `decideBoundary` walks token boundaries applying WB1–WB16 in priority order.
 *
 * WB3c ("ZWJ × \p{Extended_Pictographic}") needs to know whether a token's *last physical
 * code point* was literally ZWJ even after folding — carried as `endsWithZWJ`, the same
 * field `linebreak.ts`'s `Token` uses for its own LB8a check.
 *
 * **Southeast Asian dictionary segmentation (spec 02 §6.4).** Word_Break assigns Thai,
 * Lao, Khmer and Myanmar letters the class `Other` (not `ALetter`) precisely because UAX
 * #29 does not specify how to segment them — the official `WordBreakTest.txt` conformance
 * suite tests no such case, and without help every code point in a run of these scripts
 * gets its own "word" under the default WB999 rule (indistinguishable from per-grapheme-
 * cluster boundaries, which is exactly spec 02 §6.4's documented fallback: "unknown
 * sequences fall back to grapheme-cluster break opportunities"). When a caller supplies a
 * `dictionary` (from `loadDictionary`, `dict.ts`) and a maximal run's script (Unicode
 * `Script` property, not `Word_Break`) is Thai/Lao/Khmer/Myanmar, that run's internal
 * boundaries come from the dictionary's own longest-match segmentation instead — mirroring
 * `linebreak.ts`'s identical SA-run/`DictionarySegmenter` hook, reusing its exported
 * `DictionarySegmenter` type rather than redeclaring it. `lang` does not otherwise change
 * any WB1–WB16 decision (UAX #29 defines no per-language tailoring the way UAX #14 does for
 * Korean), so the official conformance suite — which never supplies a dictionary — must and
 * does pass identically regardless of what `lang` is passed.
 */
import { SCRIPT_NAMES, SCRIPT_STARTS, SCRIPT_VALUES } from './generated/script.generated.js';
import { EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES } from './generated/extended-pictographic.generated.js';
import { WORD_BREAK_NAMES, WORD_BREAK_STARTS, WORD_BREAK_VALUES, type WordBreakClass } from './generated/word-break.generated.js';
import { lookupRangeValue } from './ucd-lookup.js';
import type { DictionarySegmenter } from './linebreak.js';

export type { WordBreakClass } from './generated/word-break.generated.js';
export type { DictionarySegmenter } from './linebreak.js';

// ─── UCD accessors (imported directly, not through ./ucd.generated.js — see grapheme.ts's
// header comment for why the per-keystroke import graph stays minimal). ───────────────────

function rawWordBreakClass(cp: number): WordBreakClass {
  return WORD_BREAK_NAMES[lookupRangeValue(WORD_BREAK_STARTS, WORD_BREAK_VALUES, cp)] ?? 'Other';
}

function isExtendedPictographic(cp: number): boolean {
  return lookupRangeValue(EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES, cp) === 1;
}

/** Unicode Script property, sufficient to detect the four dictionary-backed scripts (spec 02 §6.4). */
function scriptOf(cp: number): string {
  return SCRIPT_NAMES[lookupRangeValue(SCRIPT_STARTS, SCRIPT_VALUES, cp)] ?? 'Unknown';
}

const DICTIONARY_SCRIPTS: ReadonlySet<string> = new Set(['Thai', 'Lao', 'Khmer', 'Myanmar']);

// ─── Decoding ───────────────────────────────────────────────────────────────────────────

interface CodePointAt {
  cp: number;
  index: number;
}

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

// ─── WB4 + tailorings: text -> tokens ──────────────────────────────────────────────────

interface WToken {
  /** The class WB5–WB16 match against (WB4: "as if it were X"). */
  cls: WordBreakClass;
  /** UTF-16 offset of the token's first code point. */
  offset: number;
  /** UTF-16 offset one past the token's last code point (a dictionary-run token spans more than one base character). */
  end: number;
  /** The token's base (first) code point — WB3c's right-hand `\p{Extended_Pictographic}` check runs against this. */
  baseCp: number;
  /** True when the token's last physical code point is literally ZWJ (WB3c). */
  endsWithZWJ: boolean;
  /**
   * True when nothing was folded onto this token (it is exactly its one base code point).
   * WB3d ("WSegSpace × WSegSpace") requires the two spaces to be *literally* adjacent — a
   * conformance case with an Extend character folded onto the first space (SP, combining
   * mark, SP) breaks at the second boundary (WB999 default), not WB3d — so WB3d must check
   * this, not just `cls`, which stays `WSegSpace` regardless of what folded onto it.
   */
  plain: boolean;
}

/** WB3a/3b fire on these classes at higher priority than WB4's fold, so they must not be folding targets. */
const EXCLUDED_BASE: ReadonlySet<WordBreakClass> = new Set(['CR', 'LF', 'Newline']);

/**
 * Builds the token stream: WB4's "X (Extend|Format|ZWJ)* → X" fold, plus (when `dictionary`
 * is supplied) collapsing a maximal same-script run of Thai/Lao/Khmer/Myanmar code points
 * into one token per dictionary-reported word (spec 02 §6.4). `dictionaryBreaks` are applied
 * directly onto the result array by `wordBoundaries` — they bypass the WB5–WB16 rule engine
 * entirely, since a dictionary's word boundary is not a Word_Break class decision.
 */
function tokenize(text: string, dictionary: DictionarySegmenter | undefined): { tokens: WToken[]; dictionaryBreaks: number[] } {
  const cps = decode(text);
  const tokens: WToken[] = [];
  const dictionaryBreaks: number[] = [];

  const endOf = (i: number): number => (i + 1 < cps.length ? (cps[i + 1] as CodePointAt).index : text.length);

  let i = 0;
  while (i < cps.length) {
    const { cp, index } = cps[i] as CodePointAt;
    const script = scriptOf(cp);

    if (dictionary && DICTIONARY_SCRIPTS.has(script)) {
      let j = i;
      while (j < cps.length && DICTIONARY_SCRIPTS.has(scriptOf((cps[j] as CodePointAt).cp))) j++;
      const runEnd = endOf(j - 1);
      const runText = text.slice(index, runEnd);
      for (const rel of dictionary.segment(runText)) {
        if (rel > 0 && rel < runText.length) dictionaryBreaks.push(index + rel);
      }
      tokens.push({ cls: 'Other', offset: index, end: runEnd, baseCp: cp, endsWithZWJ: false, plain: false });
      i = j;
      continue;
    }

    const raw = rawWordBreakClass(cp);
    const canAttach =
      (raw === 'Extend' || raw === 'Format' || raw === 'ZWJ') && tokens.length > 0 && !EXCLUDED_BASE.has((tokens[tokens.length - 1] as WToken).cls);
    if (canAttach) {
      const base = tokens[tokens.length - 1] as WToken;
      base.end = endOf(i);
      base.endsWithZWJ = raw === 'ZWJ';
      base.plain = false;
      i++;
      continue;
    }

    tokens.push({ cls: raw, offset: index, end: endOf(i), baseCp: cp, endsWithZWJ: raw === 'ZWJ', plain: true });
    i++;
  }

  return { tokens, dictionaryBreaks };
}

// ─── WB1–WB16: token boundaries -> break decisions ─────────────────────────────────────

type ClassOrSentinel = WordBreakClass | 'sot' | 'eot';

function classAt(tokens: WToken[], idx: number): ClassOrSentinel {
  if (idx < 0) return 'sot';
  const t = tokens[idx];
  return t === undefined ? 'eot' : t.cls;
}

function isAH(cls: ClassOrSentinel): boolean {
  return cls === 'ALetter' || cls === 'Hebrew_Letter';
}
/** WB6/WB7's "MidLetter | MidNumLetQ" where MidNumLetQ = MidNumLet | Single_Quote. */
function isMidLetterQ(cls: ClassOrSentinel): boolean {
  return cls === 'MidLetter' || cls === 'MidNumLet' || cls === 'Single_Quote';
}
/** WB11/WB12's "MidNum | MidNumLetQ". */
function isMidNumQ(cls: ClassOrSentinel): boolean {
  return cls === 'MidNum' || cls === 'MidNumLet' || cls === 'Single_Quote';
}

/** Decides the boundary immediately before `tokens[k]` (`k >= 1`). `1` = break, `0` = no break. */
function decideBoundary(tokens: WToken[], k: number, riRun: number): 0 | 1 {
  const prev = tokens[k - 1] as WToken;
  const curr = tokens[k] as WToken;
  const prevCls = prev.cls;
  const currCls = curr.cls;
  const prevPrevCls = classAt(tokens, k - 2);
  const nextCls = classAt(tokens, k + 1);

  // WB3: CR × LF
  if (prevCls === 'CR' && currCls === 'LF') return 0;
  // WB3a: (Newline | CR | LF) ÷
  if (prevCls === 'CR' || prevCls === 'LF' || prevCls === 'Newline') return 1;
  // WB3b: ÷ (Newline | CR | LF)
  if (currCls === 'CR' || currCls === 'LF' || currCls === 'Newline') return 1;
  // WB3c: ZWJ × \p{Extended_Pictographic}
  if (prev.endsWithZWJ && isExtendedPictographic(curr.baseCp)) return 0;
  // WB3d: WSegSpace × WSegSpace (the two spaces must be literally adjacent — see `plain`'s doc comment)
  if (prevCls === 'WSegSpace' && currCls === 'WSegSpace' && prev.plain) return 0;
  // WB5: AHLetter × AHLetter
  if (isAH(prevCls) && isAH(currCls)) return 0;
  // WB6: AHLetter × (MidLetter | MidNumLetQ) AHLetter
  if (isAH(prevCls) && isMidLetterQ(currCls) && isAH(nextCls)) return 0;
  // WB7: AHLetter (MidLetter | MidNumLetQ) × AHLetter
  if (isMidLetterQ(prevCls) && isAH(prevPrevCls) && isAH(currCls)) return 0;
  // WB7a: Hebrew_Letter × Single_Quote
  if (prevCls === 'Hebrew_Letter' && currCls === 'Single_Quote') return 0;
  // WB7b: Hebrew_Letter × Double_Quote Hebrew_Letter
  if (prevCls === 'Hebrew_Letter' && currCls === 'Double_Quote' && nextCls === 'Hebrew_Letter') return 0;
  // WB7c: Hebrew_Letter Double_Quote × Hebrew_Letter
  if (prevCls === 'Double_Quote' && prevPrevCls === 'Hebrew_Letter' && currCls === 'Hebrew_Letter') return 0;
  // WB8: Numeric × Numeric
  if (prevCls === 'Numeric' && currCls === 'Numeric') return 0;
  // WB9: AHLetter × Numeric
  if (isAH(prevCls) && currCls === 'Numeric') return 0;
  // WB10: Numeric × AHLetter
  if (prevCls === 'Numeric' && isAH(currCls)) return 0;
  // WB11: Numeric (MidNum | MidNumLetQ) × Numeric
  if (prevPrevCls === 'Numeric' && isMidNumQ(prevCls) && currCls === 'Numeric') return 0;
  // WB12: Numeric × (MidNum | MidNumLetQ) Numeric
  if (prevCls === 'Numeric' && isMidNumQ(currCls) && nextCls === 'Numeric') return 0;
  // WB13: Katakana × Katakana
  if (prevCls === 'Katakana' && currCls === 'Katakana') return 0;
  // WB13a: (AHLetter | Numeric | Katakana | ExtendNumLet) × ExtendNumLet
  if ((isAH(prevCls) || prevCls === 'Numeric' || prevCls === 'Katakana' || prevCls === 'ExtendNumLet') && currCls === 'ExtendNumLet') return 0;
  // WB13b: ExtendNumLet × (AHLetter | Numeric | Katakana)
  if (prevCls === 'ExtendNumLet' && (isAH(currCls) || currCls === 'Numeric' || currCls === 'Katakana')) return 0;
  // WB15/WB16: regional indicator pairing
  if (prevCls === 'Regional_Indicator' && currCls === 'Regional_Indicator' && riRun % 2 === 1) return 0;
  // WB999 (default): Any ÷ Any
  return 1;
}

/**
 * Word boundary offsets (UTF-16 indices into `text`), UAX #29 (spec 02 §6.5). Always
 * includes `0` for non-empty input (WB1); `text.length` (WB2, "always break at end of
 * text") is not included — a caller already knows the paragraph ends there, matching
 * `graphemeClusters`'s identical convention.
 *
 * `lang` is accepted for interface symmetry with `sentenceEnds`/`breakOpportunities`
 * (spec 02 §6.2/§6.5) but does not itself change any WB1–WB16 decision — UAX #29 defines no
 * per-language word-break tailoring. `dictionary` (optional; from `dict.ts`'s
 * `loadDictionary`) is the mechanism spec 02 §6.4 actually asks for: without it, a run of
 * Thai/Lao/Khmer/Myanmar script falls back to one boundary per token (WB4's fold already
 * makes that per-grapheme-cluster, not per-code-point); with it, that run's internal
 * boundaries come from the dictionary's own longest-match segmentation.
 */
export function wordBoundaries(text: string, lang: string, dictionary?: DictionarySegmenter): number[] {
  void lang; // see doc comment: UAX #29 has no per-language word-break tailoring
  const { tokens, dictionaryBreaks } = tokenize(text, dictionary);
  const starts: number[] = [];
  let riRun = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k] as WToken;
    if (k === 0) starts.push(t.offset);
    else if (decideBoundary(tokens, k, riRun) === 1) starts.push(t.offset);
    riRun = t.cls === 'Regional_Indicator' ? riRun + 1 : 0;
  }
  if (dictionaryBreaks.length > 0) {
    const merged = new Set(starts);
    for (const b of dictionaryBreaks) merged.add(b);
    return Array.from(merged).sort((a, b) => a - b);
  }
  return starts;
}
