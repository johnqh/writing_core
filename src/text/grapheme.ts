/**
 * Extended grapheme clusters, UAX #29 (spec 02 §6.1, task 6). Extended grapheme clusters
 * are the unit of caret movement, deletion (subject to the Indic/Thai per-code-point
 * exception a later task owns — spec 02 §6.1's prose, not this module's concern: this
 * module only segments, callers decide what a "delete" does with a cluster boundary),
 * selection snapping and emergency line breaking.
 *
 * Imports the grapheme-specific generated tables directly (not through
 * `./ucd.generated.js`) so the per-keystroke import graph stays minimal — this module
 * never touches Line_Break, Bidi_Class, Script, General_Category, Word_Break or
 * Sentence_Break, all of which are separate lazily-importable files (see
 * `scripts/build-ucd.ts`'s header comment and `src/text/ucd-lookup.ts` for why the
 * lookup is a binary search over merged ranges rather than a trie).
 *
 * **Algorithm.** UAX #29's GB rules are a left-to-right scan with three pieces of state
 * beyond the previous code point's Grapheme_Cluster_Break class:
 *   - `riRun` — count of consecutive Regional_Indicator code points ending at the
 *     current position (GB12/GB13: an odd run pairs the next RI with this one).
 *   - `pictoState` — 0 (not chaining), 1 (positioned after an Extended_Pictographic,
 *     possibly through zero or more Extend), 2 (positioned after the ZWJ that follows
 *     state 1) — GB11's `\p{Extended_Pictographic} Extend* ZWJ ×
 *     \p{Extended_Pictographic}`.
 *   - `incbState` — 0 (no chain), 1 (after an Indic_Conjunct_Break=Consonant, possibly
 *     through zero or more Extend/Linker with no Linker seen yet), 2 (same, but at least
 *     one Linker seen) — GB9c's Indic conjunct-cluster rule (Unicode 15.1+; needs
 *     Indic_Conjunct_Break from DerivedCoreProperties.txt, not part of
 *     GraphemeBreakProperty.txt — see `scripts/build-ucd.ts`'s "Deviation" comment).
 *
 * Each rule's condition is checked in GB-rule order; because every code point has
 * exactly one Grapheme_Cluster_Break class, at most one of GB3–GB9b's category-pair
 * checks can match for a given boundary, so a plain `if`/`else if` chain (ending in
 * GB999's default "break") is a faithful, branch-free-per-rule transcription — no
 * priority conflicts to resolve.
 */
import { EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES } from './generated/extended-pictographic.generated.js';
import { GRAPHEME_BREAK_NAMES, GRAPHEME_BREAK_STARTS, GRAPHEME_BREAK_VALUES, type GraphemeBreakClass } from './generated/grapheme-break.generated.js';
import { INDIC_CONJUNCT_BREAK_NAMES, INDIC_CONJUNCT_BREAK_STARTS, INDIC_CONJUNCT_BREAK_VALUES, type IndicConjunctBreakClass } from './generated/indic-conjunct-break.generated.js';
import { lookupRangeValue } from './ucd-lookup.js';

export type { GraphemeBreakClass } from './generated/grapheme-break.generated.js';

/** Unicode 16.0 Grapheme_Cluster_Break (spec 02 §6.1). Exported per task 6's interface. */
export function graphemeBreakProperty(cp: number): GraphemeBreakClass {
  return GRAPHEME_BREAK_NAMES[lookupRangeValue(GRAPHEME_BREAK_STARTS, GRAPHEME_BREAK_VALUES, cp)] ?? 'Other';
}

function isExtendedPictographic(cp: number): boolean {
  return lookupRangeValue(EXTENDED_PICTOGRAPHIC_STARTS, EXTENDED_PICTOGRAPHIC_VALUES, cp) === 1;
}

function indicConjunctBreak(cp: number): IndicConjunctBreakClass {
  return INDIC_CONJUNCT_BREAK_NAMES[lookupRangeValue(INDIC_CONJUNCT_BREAK_STARTS, INDIC_CONJUNCT_BREAK_VALUES, cp)] ?? 'None';
}

/** One decoded code point plus its UTF-16 start offset in the source string. */
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

/** Per-code-point automaton state, threaded left to right across `decode(text)`. */
interface ScanState {
  riRun: number;
  pictoState: 0 | 1 | 2;
  incbState: 0 | 1 | 2;
}

const INITIAL_STATE: ScanState = { riRun: 0, pictoState: 0, incbState: 0 };

/** True when GB1–GB999 forbid a break between `prev` and `curr` (`state` is the state after consuming `prev`). */
function noBreak(prevCat: GraphemeBreakClass, curr: CodePointAt, state: ScanState): boolean {
  const currCat = graphemeBreakProperty(curr.cp);
  // GB3: CR × LF
  if (prevCat === 'CR' && currCat === 'LF') return true;
  // GB4: (Control | CR | LF) ÷  — break after, so no "no-break" here.
  if (prevCat === 'Control' || prevCat === 'CR' || prevCat === 'LF') return false;
  // GB5: ÷ (Control | CR | LF) — break before, so no "no-break" here.
  if (currCat === 'Control' || currCat === 'CR' || currCat === 'LF') return false;
  // GB6: L × (L | V | LV | LVT)
  if (prevCat === 'L' && (currCat === 'L' || currCat === 'V' || currCat === 'LV' || currCat === 'LVT')) return true;
  // GB7: (LV | V) × (V | T)
  if ((prevCat === 'LV' || prevCat === 'V') && (currCat === 'V' || currCat === 'T')) return true;
  // GB8: (LVT | T) × T
  if ((prevCat === 'LVT' || prevCat === 'T') && currCat === 'T') return true;
  // GB9: × (Extend | ZWJ)
  if (currCat === 'Extend' || currCat === 'ZWJ') return true;
  // GB9a: × SpacingMark
  if (currCat === 'SpacingMark') return true;
  // GB9b: Prepend ×
  if (prevCat === 'Prepend') return true;
  // GB9c: Indic conjunct clusters.
  if (state.incbState === 2 && indicConjunctBreak(curr.cp) === 'Consonant') return true;
  // GB11: \p{Extended_Pictographic} Extend* ZWJ × \p{Extended_Pictographic}
  if (state.pictoState === 2 && isExtendedPictographic(curr.cp)) return true;
  // GB12/GB13: sot (RI RI)* RI × RI  /  [^RI] (RI RI)* RI × RI
  if (prevCat === 'Regional_Indicator' && currCat === 'Regional_Indicator' && state.riRun % 2 === 1) return true;
  // GB999: Any ÷ Any
  return false;
}

/** Advances `state` past `cp` (whose Grapheme_Cluster_Break class is `cat`), for the next boundary's decision. */
function advance(state: ScanState, cp: number, cat: GraphemeBreakClass): ScanState {
  const riRun = cat === 'Regional_Indicator' ? state.riRun + 1 : 0;

  let pictoState: 0 | 1 | 2;
  if (isExtendedPictographic(cp)) pictoState = 1;
  else if (state.pictoState === 1 && cat === 'Extend') pictoState = 1;
  else if (state.pictoState === 1 && cat === 'ZWJ') pictoState = 2;
  else pictoState = 0;

  const incb = indicConjunctBreak(cp);
  let incbState: 0 | 1 | 2;
  if (incb === 'Consonant') incbState = 1;
  else if (incb === 'Linker') incbState = state.incbState === 1 || state.incbState === 2 ? 2 : 0;
  else if (incb === 'Extend') incbState = state.incbState === 1 || state.incbState === 2 ? state.incbState : 0;
  else incbState = 0;

  return { riRun, pictoState, incbState };
}

/**
 * Extended grapheme cluster start offsets (UTF-16 indices into `text`), UAX #29 (spec 02
 * §6.1). Always starts with `0` for non-empty input (GB1); the implicit end-of-text
 * boundary (GB2) is not included — callers who need it use `text.length`.
 */
export function graphemeClusters(text: string): number[] {
  const cps = decode(text);
  if (cps.length === 0) return [];
  const starts: number[] = [0];
  let state = INITIAL_STATE;
  let prevCat = graphemeBreakProperty(cps[0]!.cp);
  state = advance(state, cps[0]!.cp, prevCat);
  for (let i = 1; i < cps.length; i++) {
    const curr = cps[i]!;
    if (!noBreak(prevCat, curr, state)) starts.push(curr.index);
    prevCat = graphemeBreakProperty(curr.cp);
    state = advance(state, curr.cp, prevCat);
  }
  return starts;
}

/**
 * The UTF-16 offset of the next grapheme cluster boundary strictly after `i`
 * (0 ≤ i < text.length), or `text.length` if `i`'s cluster is the last one.
 */
export function nextCluster(text: string, i: number): number {
  const starts = graphemeClusters(text);
  for (const s of starts) if (s > i) return s;
  return text.length;
}

/**
 * The UTF-16 offset of the grapheme cluster boundary strictly before `i` (0 < i ≤
 * text.length), or `0` if `i`'s cluster is the first one.
 */
export function previousCluster(text: string, i: number): number {
  const starts = graphemeClusters(text);
  let last = 0;
  for (const s of starts) {
    if (s >= i) break;
    last = s;
  }
  return last;
}
