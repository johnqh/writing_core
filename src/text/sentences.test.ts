/**
 * Two independent test surfaces (see sentences.ts's header comment for why they're separate):
 *  1. `sentenceBoundaries` against the official `SentenceBreakTest.txt` — every case, zero
 *     exclusions (context item 2's bar).
 *  2. `sentenceEnds` against spec 02 §6.5's own screenplay rule, with dedicated tests for
 *     the abbreviation-list and single-uppercase-initial exceptions — deliberately, because
 *     (context item 3) no official conformance case will ever exercise them. Both the
 *     abbreviation-list regression and the Thai-dictionary regression (dict.test.ts) are
 *     proven live: the mechanism is disabled, the case is shown to fail, then restored.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABBREVIATIONS, sentenceBoundaries, sentenceEnds } from './sentences.js';

const TEST_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd/SentenceBreakTest.txt');

interface ConformanceCase {
  line: number;
  text: string;
  offsets: number[];
  expectedBreak: boolean[];
  comment: string;
}

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

describe('sentenceBoundaries — UAX #29 official conformance (SentenceBreakTest.txt, all cases)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 400+ cases)', () => {
    expect(cases.length).toBeGreaterThan(400);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      const boundaries = new Set(sentenceBoundaries(c.text));
      const actualBreak = c.offsets.map((offset) => boundaries.has(offset));
      expect(actualBreak).toEqual(c.expectedBreak);
    });
  }
});

describe('sentenceEnds — spec 02 §6.5 explicit cases', () => {
  it('"INT." does not end a sentence (abbreviation list)', () => {
    const text = 'INT. SFPD BRIEFING ROOM - DAY';
    expect(sentenceEnds(text, 'en')).toEqual([]);
  });

  it('"Mr." does not end a sentence (abbreviation list)', () => {
    const text = 'Mr. Smith arrived.';
    const ends = sentenceEnds(text, 'en');
    expect(ends).toEqual([text.length]); // only the final period ends a sentence
  });

  it('"J. Smith" does not end a sentence after "J." (single uppercase initial)', () => {
    const text = 'J. Smith walked in.';
    const ends = sentenceEnds(text, 'en');
    expect(ends).toEqual([text.length]); // not after "J."
  });

  it('CJK full stop "。" ends a sentence with no whitespace required', () => {
    const text = '今日は。明日は。'; // "today is. tomorrow is." with 。, no spaces
    const ends = sentenceEnds(text, 'ja');
    // one boundary right after each 。, with no trailing whitespace involved
    const firstStop = text.indexOf('。') + 1;
    const secondStop = text.lastIndexOf('。') + 1;
    expect(ends).toEqual([firstStop, secondStop]);
  });

  it('`?"` followed by a space ends a sentence (STerm + closing quote + whitespace)', () => {
    const text = 'She asked, "Really?" He nodded.';
    const ends = sentenceEnds(text, 'en');
    const afterQuote = text.indexOf('?"') + 2; // right after the closing quote
    expect(ends).toContain(afterQuote);
  });

  it('a plain "." followed by whitespace ends an ordinary sentence', () => {
    const text = 'She left. He stayed.';
    expect(sentenceEnds(text, 'en')).toEqual([9, text.length]);
  });

  it('an abbreviation NOT in the list (e.g. a made-up "Xk.") still ends the sentence normally', () => {
    const text = 'Xk. Fine.';
    expect(sentenceEnds(text, 'en')).toEqual([3, text.length]);
  });

  it('an unlisted language (no abbreviation list) applies the rule with no exceptions', () => {
    // Japanese has no curated abbreviation list (spec 02 §6.5: "others use the rule without
    // exceptions"), so a Latin "Mr." run in Japanese-tagged text still ends a sentence.
    const text = 'Mr. Tanaka desu.';
    expect(sentenceEnds(text, 'ja')).toEqual([3, text.length]);
  });
});

describe('sentenceEnds — abbreviation-list regression proof (spec 02 §6.5, context item 3)', () => {
  it('with the abbreviation list intact, "INT. SFPD BRIEFING ROOM - DAY" is one sentence (no end inside)', () => {
    expect(sentenceEnds('INT. SFPD BRIEFING ROOM - DAY', 'en')).toEqual([]);
  });

  it('REGRESSION: emptying ABBREVIATIONS.en makes "INT." end a sentence, splitting the heading in two', () => {
    // Live proof that the abbreviation list, not luck, is what keeps "INT." from ending a
    // sentence — mutate the actual exported list, show the case goes RED, then restore it
    // and show it goes GREEN again (context item 3: disable the mechanism, watch it fail).
    const text = 'INT. SFPD BRIEFING ROOM - DAY';
    expect(sentenceEnds(text, 'en')).toEqual([]); // GREEN before touching anything

    const mutable = ABBREVIATIONS as Record<string, readonly string[]>;
    const original = mutable.en as readonly string[];
    mutable.en = [];
    try {
      expect(sentenceEnds(text, 'en')).toEqual([4]); // RED: splits right after "INT." with no list
    } finally {
      mutable.en = original;
    }
    expect(sentenceEnds(text, 'en')).toEqual([]); // GREEN again, restored
  });

  it('ships abbreviation lists for en, es, fr, de (spec 02 §6.5)', () => {
    for (const lang of ['en', 'es', 'fr', 'de']) {
      expect(ABBREVIATIONS[lang]?.length).toBeGreaterThan(0);
    }
  });
});
