/**
 * Sentence boundaries, two distinct algorithms sharing one Sentence_Break property table
 * (spec 02 §6.5, task 9).
 *
 * **`sentenceBoundaries`** is the full UAX #29 SB1–SB998 rule engine, conformant against
 * the official `SentenceBreakTest.txt` with zero exclusions (context item 2's bar). Its
 * default rule (SB998, "Any × Any") is *no break* — the opposite convention from
 * `grapheme.ts`/`linebreak.ts`/`words.ts`, whose default is "break". Sentence boundaries are
 * rare; most inter-token positions are not one.
 *
 * **`sentenceEnds`** is spec 02 §6.5's own, deliberately simpler, screenplay-facing rule
 * ("break on sentences", §13.6): a sentence ends after a run of `STerm`/`ATerm` characters,
 * optionally followed by closing punctuation, then whitespace or end of paragraph — except
 * when the token ending in `.` is a single uppercase letter (an initial), or is in one of the
 * language's two curated abbreviation classes (`ABBREVIATIONS`, never-end; the fix-round-1
 * `MAY_END_ABBREVIATIONS`, may-end — see `ABBREVIATIONS`'s doc comment for why an
 * unconditional exception silently merged genuine sentence ends). This is **not** a
 * tailoring of `sentenceBoundaries` the way `linebreak.ts`'s `screenplay` profile is a
 * tailoring of stock UAX #14: no official conformance case exercises a curated abbreviation
 * list or the initials exception (context item 3 — "no UAX case will ever test that `INT.`
 * fails to end a sentence"), so `sentenceEnds` is written directly against spec 02 §6.5's
 * prose and carries its own dedicated tests, not a `SentenceBreakTest.txt` sample.
 *
 * **Why `sentenceBoundaries` needs backward/forward scans instead of `linebreak.ts`'s
 * incremental chain state.** SB8 ("ATerm Close* Sp* × (¬(OLetter|Upper|Lower|Sep|CR|LF|
 * STerm|ATerm))* Lower") requires unbounded lookahead past an arbitrary run of tokens that
 * are none of a specific set, stopping only at `Lower` (match) or one of the excluded
 * classes (no match) — an incremental left-to-right chain state cannot express "look ahead
 * until X or fail," so `decideBoundary` instead scans backward (to match the `(STerm|ATerm)
 * Close*` / `(STerm|ATerm) Close* Sp*` contexts SB6–SB11 share) and forward (SB8's lookahead)
 * from each boundary directly. Both scans are bounded by the nearest terminal-punctuation
 * run, not by paragraph length, so the per-keystroke cost stays local.
 */
import { GENERAL_CATEGORY_NAMES, GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES } from './generated/general-category.generated.js';
import { SENTENCE_BREAK_NAMES, SENTENCE_BREAK_STARTS, SENTENCE_BREAK_VALUES, type SentenceBreakClass } from './generated/sentence-break.generated.js';
import { lookupRangeValue } from './ucd-lookup.js';

export type { SentenceBreakClass } from './generated/sentence-break.generated.js';

// ─── UCD accessors ──────────────────────────────────────────────────────────────────────

export function sentenceBreakProperty(cp: number): SentenceBreakClass {
  return SENTENCE_BREAK_NAMES[lookupRangeValue(SENTENCE_BREAK_STARTS, SENTENCE_BREAK_VALUES, cp)] ?? 'Other';
}

function generalCategory(cp: number): string {
  return GENERAL_CATEGORY_NAMES[lookupRangeValue(GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, cp)] ?? 'Cn';
}

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

// ═══════════════════════════════════════════════════════════════════════════════════════
// Part 1: sentenceBoundaries — full UAX #29 SB1–SB998 (conformance engine)
// ═══════════════════════════════════════════════════════════════════════════════════════

interface SToken {
  /** The class SB3–SB11 match against (SB5: "X (Extend|Format)* → X"). */
  cls: SentenceBreakClass;
  offset: number;
  end: number;
}

/** SB4 fires on these at higher priority than SB5's fold. */
const SB_EXCLUDED_BASE: ReadonlySet<SentenceBreakClass> = new Set(['CR', 'LF', 'Sep']);

function tokenizeSentence(text: string): SToken[] {
  const cps = decode(text);
  const tokens: SToken[] = [];
  const endOf = (i: number): number => (i + 1 < cps.length ? (cps[i + 1] as CodePointAt).index : text.length);

  for (let i = 0; i < cps.length; i++) {
    const { cp, index } = cps[i] as CodePointAt;
    const raw = sentenceBreakProperty(cp);
    const canAttach = (raw === 'Extend' || raw === 'Format') && tokens.length > 0 && !SB_EXCLUDED_BASE.has((tokens[tokens.length - 1] as SToken).cls);
    if (canAttach) {
      (tokens[tokens.length - 1] as SToken).end = endOf(i);
      continue;
    }
    tokens.push({ cls: raw, offset: index, end: endOf(i) });
  }
  return tokens;
}

/** Backward scan for SB9's "(STerm|ATerm) Close* ×" context. Returns the terminal class or null. */
function closeOnlyContext(tokens: SToken[], k: number): SentenceBreakClass | null {
  let i = k - 1;
  while (i >= 0 && (tokens[i] as SToken).cls === 'Close') i--;
  const cls = i >= 0 ? (tokens[i] as SToken).cls : null;
  return cls === 'ATerm' || cls === 'STerm' ? cls : null;
}

/** Backward scan for SB8/8a/10/11's "(STerm|ATerm) Close* Sp* ×" context. Returns the terminal class or null. */
function closeSpContext(tokens: SToken[], k: number): SentenceBreakClass | null {
  let i = k - 1;
  while (i >= 0 && (tokens[i] as SToken).cls === 'Sp') i--;
  while (i >= 0 && (tokens[i] as SToken).cls === 'Close') i--;
  const cls = i >= 0 ? (tokens[i] as SToken).cls : null;
  return cls === 'ATerm' || cls === 'STerm' ? cls : null;
}

/** SB8's forward lookahead: skip tokens outside the excluded set until Lower (match) or an excluded class/eot (no match). */
const SB8_STOP: ReadonlySet<SentenceBreakClass> = new Set(['OLetter', 'Upper', 'Lower', 'Sep', 'CR', 'LF', 'STerm', 'ATerm']);
function sb8LowerFollows(tokens: SToken[], k: number): boolean {
  let i = k;
  while (i < tokens.length) {
    const cls = (tokens[i] as SToken).cls;
    if (cls === 'Lower') return true;
    if (SB8_STOP.has(cls)) return false;
    i++;
  }
  return false;
}

function decideSentenceBoundary(tokens: SToken[], k: number): 0 | 1 {
  const prev = tokens[k - 1] as SToken;
  const curr = tokens[k] as SToken;
  const prevCls = prev.cls;
  const currCls = curr.cls;
  const prevPrevCls: SentenceBreakClass | undefined = tokens[k - 2]?.cls;

  // SB3: CR × LF
  if (prevCls === 'CR' && currCls === 'LF') return 0;
  // SB4: (Sep | CR | LF) ÷
  if (prevCls === 'Sep' || prevCls === 'CR' || prevCls === 'LF') return 1;
  // SB6: ATerm × Numeric
  if (prevCls === 'ATerm' && currCls === 'Numeric') return 0;
  // SB7: (Upper | Lower) ATerm × Upper
  if (prevCls === 'ATerm' && (prevPrevCls === 'Upper' || prevPrevCls === 'Lower') && currCls === 'Upper') return 0;
  // SB8: ATerm Close* Sp* × (¬(OLetter|Upper|Lower|Sep|CR|LF|STerm|ATerm))* Lower
  if (closeSpContext(tokens, k) === 'ATerm' && sb8LowerFollows(tokens, k)) return 0;
  // SB8a: (STerm|ATerm) Close* Sp* × (SContinue|STerm|ATerm)
  if (closeSpContext(tokens, k) !== null && (currCls === 'SContinue' || currCls === 'STerm' || currCls === 'ATerm')) return 0;
  // SB9: (STerm|ATerm) Close* × (Close|Sp|Sep|CR|LF)
  if (closeOnlyContext(tokens, k) !== null && (currCls === 'Close' || currCls === 'Sp' || currCls === 'Sep' || currCls === 'CR' || currCls === 'LF')) return 0;
  // SB10: (STerm|ATerm) Close* Sp* × (Sp|Sep|CR|LF)
  if (closeSpContext(tokens, k) !== null && (currCls === 'Sp' || currCls === 'Sep' || currCls === 'CR' || currCls === 'LF')) return 0;
  // SB11: (STerm|ATerm) Close* Sp* ÷
  if (closeSpContext(tokens, k) !== null) return 1;
  // SB998 (default): Any × Any
  return 0;
}

/**
 * Sentence boundary offsets (UTF-16 indices into `text`), full UAX #29 SB1–SB998 (spec 02
 * §6.5's conformance engine). Always includes `0` for non-empty input (SB1); `text.length`
 * (SB2) is not included, matching `graphemeClusters`/`wordBoundaries`'s convention.
 */
export function sentenceBoundaries(text: string): number[] {
  const tokens = tokenizeSentence(text);
  const starts: number[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (k === 0 || decideSentenceBoundary(tokens, k) === 1) starts.push((tokens[k] as SToken).offset);
  }
  return starts;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Part 2: sentenceEnds — spec 02 §6.5's screenplay "break on sentences" rule
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Spec 02 §6.5's two abbreviation classes (amended after fix round 1 — an earlier draft
 * made the exception unconditional, which silently merged every genuine sentence end that
 * happened to fall on an abbreviation: `Buy milk, eggs, etc. Then go home.` returned one
 * sentence, not two).
 *
 * - **`ABBREVIATIONS` (never ends a sentence):** always mid-sentence, regardless of what
 *   follows. Includes the scene-heading forms (INT., EXT., I/E.) *deliberately* — inside an
 *   all-caps slug line the "followed by an uppercase letter" signal `MAY_END_ABBREVIATIONS`
 *   relies on is worthless (every letter is uppercase), so those three must never consult it.
 * - **`MAY_END_ABBREVIATIONS` (may end a sentence):** suppressed mid-sentence, but honoured
 *   — treated as a genuine sentence end — when the whitespace following the abbreviation is
 *   itself succeeded by an uppercase letter, an opening quote, or an opening bracket (or by
 *   nothing at all: end of paragraph), and suppressed otherwise. See `mayEndHonoured`.
 *
 * Only English's lists are given verbatim by spec 02 §6.5; es/fr/de are the implementer's
 * own reasonable choices (task 9 report flags this as a known M2 limitation, not to be grown
 * further without a native-speaker pass). Fix round 1 only *reclassifies* those existing
 * entries into the two new classes — it adds no new abbreviations: `etc.`/`usw.` ("etc." in
 * es/fr/de) move to the may-end class by the same real-world reasoning spec 02 §6.5 gives
 * for English `etc.`; the es/fr/de lists have no existing Jr./Sr.-equivalent to move.
 */
export const ABBREVIATIONS: Record<string, readonly string[]> = {
  en: [
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'vs.', 'e.g.', 'i.e.',
    'INT.', 'EXT.', 'I/E.', 'approx.', 'No.', 'Mt.', 'Ft.', 'Lt.', 'Sgt.', 'Capt.', 'Col.', 'Gen.', 'Prof.', 'Rev.',
  ],
  es: ['Sr.', 'Sra.', 'Srta.', 'Dr.', 'Dra.', 'Ud.', 'Uds.', 'pág.', 'núm.', 'art.', 'vol.', 'cap.', 'INT.', 'EXT.'],
  fr: ['M.', 'Mme.', 'Mlle.', 'Dr.', 'c.-à-d.', 'INT.', 'EXT.', 'n°.', 'p.', 'vol.', 'ch.'],
  de: ['Hr.', 'Fr.', 'Dr.', 'z.B.', 'd.h.', 'INT.', 'EXT.', 'Nr.', 'S.', 'Bd.', 'Kap.'],
};

/** Spec 02 §6.5's may-end class — see `ABBREVIATIONS`'s doc comment. */
export const MAY_END_ABBREVIATIONS: Record<string, readonly string[]> = {
  en: ['etc.', 'Jr.', 'Sr.'],
  es: ['etc.'],
  fr: ['etc.'],
  de: ['usw.'],
};

/**
 * Reads the given table fresh on every call (no memoization) rather than caching a `Set` per
 * language: the lists are tiny (a few dozen entries at most), the lookup only runs at
 * candidate sentence-end positions (not per character), and a cache keyed by language would
 * make the table unobservable after its first use — exactly the property the regression
 * proof (sentences.test.ts, "emptying the abbreviation list") needs to *not* hold.
 */
function abbreviationSetFrom(table: Record<string, readonly string[]>, lang: string): ReadonlySet<string> | undefined {
  const primary = (lang.split('-')[0] ?? '').toLowerCase();
  const list = table[primary];
  return list && list.length > 0 ? new Set(list) : undefined;
}

/** Spec 02 §6.5's closing-punctuation set, optionally skipped between the terminal run and whitespace/EOP. */
const CLOSING_PUNCT: ReadonlySet<number> = new Set(
  [')', ']', '"', "'", '”', '’', '」', '』'].map((c) => c.codePointAt(0) as number),
);

/**
 * Spec 02 §6.5's may-end trigger set, **exactly** (fix round 2): `(`, `[`, `{`, the curly
 * opening quotes `‘` and `“`, and the straight double quote `"`. Deliberately **not** the
 * straight apostrophe `'` (U+0027) or the curly apostrophe `’` (U+2019) — both serve double
 * duty as a contraction mark (`'tis`, `'twas`, `'em`, all common in screenplay dialogue), so
 * including either would fire the may-end rule on `etc. 'tis done.` and wrongly split a
 * contraction, not a real new sentence. `"` is kept because, unlike `'`, it has no
 * contraction use. Not the same set as `CLOSING_PUNCT` (whose `'`/`’`/CJK corner brackets do
 * not appear here) — this is a different, narrower, spec-pinned set for a different purpose.
 */
const OPENING_PUNCT: ReadonlySet<number> = new Set(['(', '[', '{', '“', '‘', '"'].map((c) => c.codePointAt(0) as number));

/** Spec 02 §6.5's literal "CJK full stops always end a sentence (no whitespace required)" set. */
const CJK_ALWAYS_END: ReadonlySet<number> = new Set(['。', '！', '？'].map((c) => c.codePointAt(0) as number));

/** A "word char" for the purposes of finding the token immediately before a terminal run (letters, digits, and `/` for "I/E."). */
function isWordChar(cp: number): boolean {
  const gc = generalCategory(cp);
  return gc.startsWith('L') || gc === 'Nd' || cp === 0x2f;
}

function isWhitespace(cp: number): boolean {
  return sentenceBreakProperty(cp) === 'Sp' || cp === 0x0a || cp === 0x0d || generalCategory(cp) === 'Zs';
}

/** Finds the abbreviation-list token ending at `runEndIdx` (exclusive), starting from `runStart`'s preceding word chars. */
function abbreviationToken(cps: CodePointAt[], runStart: number, runEndIdx: number): string {
  let k = runStart - 1;
  while (k >= 0 && isWordChar((cps[k] as CodePointAt).cp)) k--;
  const wordStart = k + 1;
  if (wordStart >= runStart) return '';
  let token = '';
  for (let i = wordStart; i < runEndIdx; i++) token += String.fromCodePoint((cps[i] as CodePointAt).cp);
  return token;
}

/** Spec 02 §6.5: "A single uppercase letter followed by `.` ... is never a sentence end" (initials, "J. Smith"). */
function isSingleUppercaseInitial(cps: CodePointAt[], runStart: number): boolean {
  if (runStart < 1) return false;
  const prev = cps[runStart - 1] as CodePointAt;
  if (generalCategory(prev.cp) !== 'Lu') return false;
  if (runStart - 2 >= 0 && isWordChar((cps[runStart - 2] as CodePointAt).cp)) return false;
  return true;
}

/**
 * Spec 02 §6.5's may-end rule: "ends a sentence when the following whitespace is succeeded
 * by an uppercase letter or an opening quote or bracket, and is suppressed otherwise." `j`
 * is the position right after the terminal run and any closing punctuation — by the time a
 * caller reaches this, `followedByWhitespaceOrEop` is already known true, so `j` is either
 * `cps.length` (end of paragraph) or the index of a whitespace code point. Skips that
 * whitespace run; true end of paragraph after skipping it is treated as an honoured end too
 * (spec 02 §6.5's general rule already ends a sentence at "whitespace or end of paragraph" —
 * the uppercase/opening-punct refinement only disambiguates the case where more text follows).
 *
 * **Two deliberate, accepted imprecisions (spec 02 §6.5, do not "fix"):** a digit is not a
 * trigger (`etc. 42 items remained.` stays one sentence — misses a genuine new sentence
 * starting with a number), and this checks General_Category `Lu` alone with no semantic
 * check, so it also misfires on `etc. Kraft brand.` (a capitalized common noun, not a new
 * sentence). Both are accepted: the rule is a heuristic, and a missed split only costs
 * `breakOnSentences` (§13.6) one fewer place to break, while a wrong split would put a page
 * break inside a sentence — asymmetric costs, so the rule suppresses when in doubt.
 */
function mayEndHonoured(cps: CodePointAt[], j: number): boolean {
  let k = j;
  while (k < cps.length && isWhitespace((cps[k] as CodePointAt).cp)) k++;
  if (k >= cps.length) return true;
  const cp = (cps[k] as CodePointAt).cp;
  return generalCategory(cp) === 'Lu' || OPENING_PUNCT.has(cp);
}

/**
 * Sentence-end offsets (spec 02 §6.5, for "break on sentences", §13.6) — the UTF-16 offset
 * immediately after each sentence's terminal punctuation (and any closing punctuation),
 * before trailing whitespace, mirroring §6.2's "trailing whitespace hangs" convention.
 *
 * `lang`'s primary subtag selects the abbreviation lists (`ABBREVIATIONS`, the never-end
 * class; `MAY_END_ABBREVIATIONS`, the may-end class); any other language uses the rule with
 * no abbreviation exception (spec 02 §6.5).
 */
export function sentenceEnds(text: string, lang: string): number[] {
  const cps = decode(text);
  const neverEnd = abbreviationSetFrom(ABBREVIATIONS, lang);
  const mayEnd = abbreviationSetFrom(MAY_END_ABBREVIATIONS, lang);
  const ends: number[] = [];
  let i = 0;
  while (i < cps.length) {
    const cls = sentenceBreakProperty((cps[i] as CodePointAt).cp);
    if (cls !== 'STerm' && cls !== 'ATerm') {
      i++;
      continue;
    }
    const runStart = i;
    let isCjkAlways = true;
    while (i < cps.length) {
      const cp = (cps[i] as CodePointAt).cp;
      const c = sentenceBreakProperty(cp);
      if (c !== 'STerm' && c !== 'ATerm') break;
      if (!CJK_ALWAYS_END.has(cp)) isCjkAlways = false;
      i++;
    }
    const runEndIdx = i;

    let j = runEndIdx;
    while (j < cps.length && CLOSING_PUNCT.has((cps[j] as CodePointAt).cp)) j++;
    const afterCloseOffset = j < cps.length ? (cps[j] as CodePointAt).index : text.length;
    const followedByWhitespaceOrEop = j >= cps.length || isWhitespace((cps[j] as CodePointAt).cp);

    if (!isCjkAlways && !followedByWhitespaceOrEop) continue;

    const token = abbreviationToken(cps, runStart, runEndIdx);
    if (neverEnd && neverEnd.has(token)) continue; // always mid-sentence
    if (mayEnd && mayEnd.has(token)) {
      if (!mayEndHonoured(cps, j)) continue; // suppressed mid-sentence
      // else: honoured — a genuine sentence end, fall through to push below
    } else if (isSingleUppercaseInitial(cps, runStart)) {
      continue;
    }

    ends.push(afterCloseOffset);
  }
  return ends;
}
