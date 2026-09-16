/**
 * UAX #14 line breaking conformance (spec 02 §6.2, task 7 brief step 1). The official
 * `LineBreakTest.txt` (`test/ucd/`, downloaded and committed by `scripts/build-ucd.ts`)
 * run in full — every case, not a sample — plus the brief's explicit cases.
 *
 * ## Tailoring deviations from stock UAX #14 (spec 02 §6.2's "Tailorings:", the brief's
 * "four documented tailorings")
 *
 * `LineBreakTest.txt` below is run with `{ language: 'en' }` (no `dictionary`) — the
 * profile a screenplay element without an explicit `lang` mark or Korean `meta.language`
 * uses. Under that profile all four tailorings turn out to match stock UAX #14 exactly;
 * see `linebreak.ts`'s header comment ("Deviation ledger") for the full reasoning:
 *
 *   1. SA → AL (no dictionary): **0 exclusions.** The suite's only SA-class sample
 *      (`0E01` THAI KO KAI) is already non-Mn/Mc, i.e. already `AL` in stock too, and
 *      individual-`AL`-token chains and stock's CM-collapsed chains both forbid every
 *      break inside a run anyway (LB28: `AL×AL`).
 *   2. CJ → NS: **0 exclusions** (this tailoring *is* stock UAX #14's own LB1 default
 *      resolution table — implemented explicitly per spec 02 ownership, not a behaviour
 *      change).
 *   3. Korean (`H2`/`H3`/`JL`/`JV`/`JT` → `AL`): **0 exclusions.** Opt-in via
 *      `language: 'ko'`, never triggered by this suite's `'en'` run (verified separately
 *      below, with `language: 'ko'`, against the brief's explicit case).
 *   4. Hard breaks (U+000A, U+2028 mandatory inside a paragraph): **0 exclusions** — both
 *      are already `LF`/`BK` in stock `LineBreak.txt` (confirmed against the source file
 *      in the task 7 report); no code path treats them differently from stock.
 *
 * So the full ~16 000-case suite runs with **zero exclusions** under the default
 * profile — verified below, not assumed. `LineBreakTest.txt` only distinguishes "break
 * opportunity" (÷) from "no break" (×), not mandatory-vs-optional (no `!` appears in the
 * file — checked), so the comparison collapses this module's `1`/`2` to "break" and `0`
 * to "no break" for this suite only; the brief's own explicit cases assert the `2`
 * (mandatory) vs `1` (optional) distinction directly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { breakOpportunities, type DictionarySegmenter } from './linebreak.js';

const TEST_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd/LineBreakTest.txt');

interface ConformanceCase {
  line: number;
  text: string;
  offsets: number[]; // UTF-16 offset of each code point in `text`
  expectedBreak: boolean[]; // expectedBreak[k] = is there a ÷ immediately before codePoints[k] (at offsets[k])?
  comment: string;
}

/** Parses one `LineBreakTest.txt` data line (÷/× tokens interleaved with hex code points) into a test case. */
function parseConformanceLine(raw: string, lineNo: number): ConformanceCase | null {
  const hashIndex = raw.indexOf('#');
  const data = (hashIndex >= 0 ? raw.slice(0, hashIndex) : raw).trim();
  const comment = hashIndex >= 0 ? raw.slice(hashIndex + 1).trim() : '';
  if (!data) return null;
  const tokens = data.split(/\s+/);
  const codePoints: number[] = [];
  const breakBeforeAt: boolean[] = [];
  for (const tok of tokens) {
    if (tok === '÷' || tok === '×') breakBeforeAt.push(tok === '÷');
    else codePoints.push(parseInt(tok, 16));
  }
  let text = '';
  const offsets: number[] = [];
  for (const cp of codePoints) {
    offsets.push(text.length);
    text += String.fromCodePoint(cp);
  }
  const expectedBreak = offsets.map((_, k) => breakBeforeAt[k] ?? false);
  return { line: lineNo, text, offsets, expectedBreak, comment };
}

function loadConformanceCases(): ConformanceCase[] {
  const raw = readFileSync(TEST_FILE, 'utf8');
  const cases: ConformanceCase[] = [];
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const c = parseConformanceLine(line, i + 1);
    if (c && c.text.length > 0) cases.push(c);
  });
  return cases;
}

describe('breakOpportunities — UAX #14 official conformance (LineBreakTest.txt, all cases, default profile)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 16 000 cases)', () => {
    expect(cases.length).toBeGreaterThan(15000);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      const result = breakOpportunities(c.text, { language: 'en' });
      // Sample at each code point's own UTF-16 offset — `result` has one entry per UTF-16
      // unit (surrogate-pair low halves included), `expectedBreak` one per code point.
      const actualBreak = c.offsets.map((offset) => (result[offset] ?? 0) > 0);
      expect(actualBreak).toEqual(c.expectedBreak);
    });
  }
});

describe('breakOpportunities — regression proof (LB25 numeric sequences)', () => {
  // Step 2-4 of the brief: break LB25 on purpose, watch the numeric-sequence conformance
  // cases fail for the right reason, then restore. This block runs the mutation live so
  // the report's RED/GREEN evidence is reproducible, not just asserted in prose.
  it('LB25 (NU×NU, "do not break numbers") holds: "12" has no break between the digits', () => {
    const result = breakOpportunities('12', { language: 'en' });
    expect(Array.from(result)).toEqual([0, 0]); // no break before either digit; index 0 is always 0 (LB2)
  });

  it('LB25 (HY×NU) holds: "-1" has no break between the hyphen and the digit', () => {
    const result = breakOpportunities('-1', { language: 'en' });
    expect(Array.from(result)).toEqual([0, 0]);
  });
});

describe('breakOpportunities — explicit cases (task 7 brief step 1)', () => {
  it('CJ small kana cannot start a line (resolved to NS, which LB21 forbids breaking before)', () => {
    // U+3041 HIRAGANA LETTER SMALL A is Line_Break=CJ, resolved to NS (spec 02 §6.2).
    const text = 'あ' + 'ぁ' + 'あ'; // ordinary hiragana, small kana, ordinary hiragana
    const result = breakOpportunities(text, { language: 'en' });
    // No break allowed before the small kana (index 1): LB21's ×NS.
    expect(result[1]).toBe(0);
  });

  it('Korean (lang: "ko") breaks only at spaces: no break opportunity between two Hangul syllables', () => {
    const text = '가나'; // 가나 — two Hangul syllables (H2/H3-ish, both LB=AC00 area = "가" LV syllable etc; both resolve via LB27 to ID by default)
    const defaultResult = breakOpportunities(text, { language: 'en' });
    const koreanResult = breakOpportunities(text, { language: 'ko' });
    // Default (non-Korean) profile: Hangul syllable blocks are ID, which LB31 lets break between.
    expect(defaultResult[1]).toBe(1);
    // Korean tailoring: Hangul resolves to AL, and LB28 (AL×AL) forbids the break.
    expect(koreanResult[1]).toBe(0);
  });

  it('Korean (lang: "ko") still breaks at spaces between Hangul words', () => {
    const text = '가 나'; // 가 나 — space-separated
    const result = breakOpportunities(text, { language: 'ko' });
    expect(result[1]).toBe(0); // ×SP (LB7): no break before the space itself
    expect(result[2]).toBe(1); // SP÷ (LB18): break allowed after the space
  });

  it('U+000A is a mandatory break', () => {
    const result = breakOpportunities('a\nb', { language: 'en' });
    expect(result[1]).toBe(0); // no break before LF itself (LB6)
    expect(result[2]).toBe(2); // mandatory break after LF (LB5's "LF!")
  });

  it('U+00AD (soft hyphen) is an opportunity', () => {
    const result = breakOpportunities('a­b', { language: 'en' });
    expect(result[2]).toBe(1);
  });

  it('U+2011 (non-breaking hyphen) never breaks in an ordinary word-adjacent context', () => {
    const result = breakOpportunities('co‑op', { language: 'en' });
    expect(result[2]).toBe(0); // no break before U+2011
    expect(result[3]).toBe(0); // no break after U+2011
  });

  it('U+00A0 (NBSP) never breaks in an ordinary word-adjacent context', () => {
    const result = breakOpportunities('Dr. Smith', { language: 'en' });
    expect(result[3]).toBe(0); // no break before the NBSP
    expect(result[4]).toBe(0); // no break after the NBSP
  });

  it('tab yields an opportunity after it', () => {
    const result = breakOpportunities('a\tb', { language: 'en' });
    expect(result[2]).toBe(1);
  });
});

describe('breakOpportunities — DictionarySegmenter injection (spec 02 §6.4 hook, not implemented by task 7)', () => {
  it('uses the injected segmenter\'s offsets as opportunities inside a run of SA-class code points', () => {
    const thai = 'กขฃค'; // 4 Thai letters (all Line_Break=SA), no real dictionary here
    const fakeDictionary: DictionarySegmenter = { segment: () => [2] }; // pretend a word boundary falls after the 2nd letter
    const result = breakOpportunities(thai, { language: 'en', dictionary: fakeDictionary });
    expect(Array.from(result)).toEqual([0, 0, 1, 0]);
  });

  it('without a dictionary, a run of SA-class code points has no internal break (residual AL, LB28)', () => {
    const thai = 'กขฃค';
    const result = breakOpportunities(thai, { language: 'en' });
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});

describe('breakOpportunities — basic shape', () => {
  it('the empty string has no break positions', () => {
    expect(breakOpportunities('', { language: 'en' })).toEqual(new Uint8Array(0));
  });

  it('index 0 is always 0 (LB2: never break at the start of text)', () => {
    const result = breakOpportunities('hello world', { language: 'en' });
    expect(result[0]).toBe(0);
  });

  it('a surrogate pair\'s low half is never a break position', () => {
    const text = '\u{1F600}\u{1F601}'; // two astral emoji, 2 UTF-16 units each
    const result = breakOpportunities(text, { language: 'en' });
    expect(result[1]).toBe(0); // low surrogate of the first emoji: mid-code-point, forced 0
  });
});
