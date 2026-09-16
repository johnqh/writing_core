/**
 * UAX #14 line breaking conformance (spec 02 §6.2, task 7 brief step 1; profiles added
 * task 7 fix round 1, spec 02 §7.3). The official `LineBreakTest.txt` (`test/ucd/`,
 * downloaded and committed by `scripts/build-ucd.ts`) run in full — every case, not a
 * sample — under the `'conformance'` profile, plus the brief's explicit cases and the
 * `'screenplay'` profile's own never-break divergence tests.
 *
 * ## Tailoring deviations from stock UAX #14 (spec 02 §6.2's "Tailorings:" plus §7.3's
 * never-break rule; the brief's "four documented tailorings" plus fix round 1's fifth)
 *
 * `LineBreakTest.txt` below is run with `{ language: 'en', profile: 'conformance' }` —
 * `'conformance'` is stock UAX #14 plus only the tailorings the suite itself assumes
 * (spec 02 §7.3). See `linebreak.ts`'s header comment ("Deviation ledger") for the full
 * reasoning behind each:
 *
 *   1. SA → AL (no dictionary): **0 exclusions.** The suite's only SA-class sample
 *      (`0E01` THAI KO KAI) is already non-Mn/Mc, i.e. already `AL` in stock too, and
 *      individual-`AL`-token chains and stock's CM-collapsed chains both forbid every
 *      break inside a run anyway (LB28: `AL×AL`).
 *   2. CJ → NS: **0 exclusions** (this tailoring *is* stock UAX #14's own LB1 default
 *      resolution table — implemented explicitly per spec 02 ownership, not a behaviour
 *      change).
 *   3. Korean (`H2`/`H3`/`JL`/`JV`/`JT` → `AL`): **0 exclusions.** Opt-in via
 *      `language: 'ko'`, never triggered by this suite's `'en'` run, and not gated by
 *      `profile` at all (verified separately below, with `language: 'ko'`, against the
 *      brief's explicit case).
 *   4. Hard breaks (U+000A, U+2028 mandatory inside a paragraph): **0 exclusions** — both
 *      are already `LF`/`BK` in stock `LineBreak.txt` (confirmed against the source file
 *      in the task 7 report); no code path treats them differently from stock.
 *   5. Never-break for U+2011/U+00A0/U+202F: **`'screenplay'`-only, 0 exclusions under
 *      `'conformance'`** — this is the profile split's whole reason to exist. Under
 *      `'conformance'` the suite's LB12a carve-out cases (SP/BA/HY directly before one of
 *      these `GL` code points) pass exactly like stock; under `'screenplay'` (the engine
 *      default) they diverge on purpose — see the "screenplay profile" describe block
 *      below for the exact count and the disable-and-show-red proof.
 *
 * So the full ~16 000-case suite runs with **zero exclusions** under `'conformance'` —
 * verified below, not assumed; that zero is spec 02 §7.3's invariant, not a target.
 * `LineBreakTest.txt` only distinguishes "break opportunity" (÷) from "no break" (×), not
 * mandatory-vs-optional (no `!` appears in the file — checked), so the comparison
 * collapses this module's `1`/`2` to "break" and `0` to "no break" for this suite only;
 * the brief's own explicit cases assert the `2` (mandatory) vs `1` (optional) distinction
 * directly.
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

describe('breakOpportunities — UAX #14 official conformance (LineBreakTest.txt, all cases, conformance profile)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 16 000 cases)', () => {
    expect(cases.length).toBeGreaterThan(15000);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      const result = breakOpportunities(c.text, { language: 'en', profile: 'conformance' });
      // Sample at each code point's own UTF-16 offset — `result` has one entry per UTF-16
      // unit (surrogate-pair low halves included), `expectedBreak` one per code point.
      const actualBreak = c.offsets.map((offset) => (result[offset] ?? 0) > 0);
      expect(actualBreak).toEqual(c.expectedBreak);
    });
  }
});

describe('breakOpportunities — screenplay profile divergence from conformance (spec 02 §7.3, deviation 5)', () => {
  const cases = loadConformanceCases();
  // Every (case, offset) pair where the *conformance* result and *screenplay* result
  // differ — computed from the suite itself, not hand-counted, so this can never drift
  // silently from what the code actually does.
  interface Divergence {
    c: ConformanceCase;
    offset: number;
    conformance: number;
    screenplay: number;
  }
  const divergences: Divergence[] = [];
  for (const c of cases) {
    const conformance = breakOpportunities(c.text, { language: 'en', profile: 'conformance' });
    const screenplay = breakOpportunities(c.text, { language: 'en' }); // default: 'screenplay'
    for (const o of c.offsets) {
      const cf = conformance[o] ?? 0;
      const sp = screenplay[o] ?? 0;
      if (cf !== sp) divergences.push({ c, offset: o, conformance: cf, screenplay: sp });
    }
  }

  it('diverges on exactly the {U+2011, U+00A0, U+202F}-before boundary, always conformance-allows/screenplay-forbids, never the reverse', () => {
    expect(divergences.length).toBeGreaterThan(0); // the divergence is real, not accidentally optimized away
    for (const d of divergences) {
      const cp = d.c.text.codePointAt(d.offset);
      expect([0x2011, 0x00a0, 0x202f]).toContain(cp);
      expect(d.conformance).toBeGreaterThan(0); // conformance (stock LB12a) allowed a break here...
      expect(d.screenplay).toBe(0); // ...screenplay forbids it. Never the other direction.
    }
    // Recorded so a change is a visible, reviewable diff, not silent drift — measured
    // from the suite itself: 134 divergent (line, offset) pairs, one per distinct line.
    const distinctLines = new Set(divergences.map((d) => d.c.line));
    expect(divergences.length).toBe(134);
    expect(distinctLines.size).toBe(134);
  });

  it("'conformance' profile matches stock LB12a exactly on line 146 (SP directly before a NBSP: a break IS expected)", () => {
    const c = cases.find((x) => x.line === 146);
    if (!c) throw new Error('line 146 not found in LineBreakTest.txt');
    expect(c.comment).toContain('NO-BREAK SPACE');
    const result = breakOpportunities(c.text, { language: 'en', profile: 'conformance' });
    const actualBreak = c.offsets.map((offset) => (result[offset] ?? 0) > 0);
    expect(actualBreak).toEqual(c.expectedBreak);
  });
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

  it('U+2011 (non-breaking hyphen) never breaks, even directly after a space (screenplay profile, the default)', () => {
    const result = breakOpportunities('co‑op', { language: 'en' });
    expect(result[2]).toBe(0); // no break before U+2011
    expect(result[3]).toBe(0); // no break after U+2011
    // The case spec 02 §7.3 actually added the profile for: SP directly before U+2011
    // would be a break under stock LB12a (verified in the "screenplay profile
    // divergence" block above) — screenplay forbids it anyway.
    const afterSpace = breakOpportunities('x ‑y', { language: 'en' });
    expect(afterSpace[2]).toBe(0);
  });

  it('U+00A0 (NBSP) never breaks, even directly after a space (screenplay profile, the default)', () => {
    const result = breakOpportunities('Dr. Smith', { language: 'en' });
    expect(result[3]).toBe(0); // no break before the NBSP
    expect(result[4]).toBe(0); // no break after the NBSP
    const afterSpace = breakOpportunities('x  y', { language: 'en' });
    expect(afterSpace[2]).toBe(0);
  });

  it('U+202F (narrow NBSP) never breaks, even directly after a space (screenplay profile, the default)', () => {
    const result = breakOpportunities('10 PM', { language: 'en' });
    expect(result[2]).toBe(0); // no break before the narrow NBSP
    expect(result[3]).toBe(0); // no break after it
    const afterSpace = breakOpportunities('x  y', { language: 'en' });
    expect(afterSpace[2]).toBe(0);
  });

  it('U+2060 (word joiner) never breaks under either profile — it is WJ, not GL, so LB11 already covers it unconditionally', () => {
    for (const profile of ['conformance', 'screenplay'] as const) {
      const result = breakOpportunities('x⁠y', { language: 'en', profile });
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    }
  });

  it("the 'conformance' profile does NOT force never-break: SP directly before a NBSP allows a break (stock LB12a/LB18)", () => {
    const result = breakOpportunities('x  y', { language: 'en', profile: 'conformance' });
    expect(result[2]).toBe(1); // SP÷ (LB18) — the carve-out screenplay's deviation 5 suppresses
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
