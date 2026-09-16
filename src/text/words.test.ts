/**
 * UAX #29 word-break conformance (spec 02 §6.5, task 9 brief step 1/2) plus the explicit
 * word-boundary cases the brief names. `WordBreakTest.txt` (`test/ucd/`, fetched and
 * committed by `scripts/build-ucd.ts`) is run in full — every case, not a sample, per spec
 * 02 §6's "a generator that fetches data without also fetching the conformance file for it
 * is incomplete" and the milestone-wide zero-exclusion bar (context item 2).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { wordBoundaries } from './words.js';
import type { DictionarySegmenter } from './linebreak.js';

const TEST_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd/WordBreakTest.txt');

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

describe('wordBoundaries — UAX #29 official conformance (WordBreakTest.txt, all cases)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 1800 cases)', () => {
    expect(cases.length).toBeGreaterThan(1700);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      const boundaries = new Set(wordBoundaries(c.text, 'en'));
      const actualBreak = c.offsets.map((offset) => boundaries.has(offset));
      expect(actualBreak).toEqual(c.expectedBreak);
    });
  }
});

describe('wordBoundaries — explicit cases (spec 02 §6.5)', () => {
  it('starts with offset 0 for non-empty text and never includes text.length', () => {
    const b = wordBoundaries('cat dog', 'en');
    expect(b[0]).toBe(0);
    expect(b).not.toContain('cat dog'.length);
  });

  it('breaks between words at a space, not inside a word (WB5, WB999)', () => {
    const b = wordBoundaries('cat dog', 'en');
    expect(b).toEqual([0, 3, 4]); // "cat" | " " | "dog"
  });

  it("does not break on an apostrophe inside a word (WB6/WB7 MidNumLetQ, e.g. contraction \"don't\")", () => {
    const b = wordBoundaries("don't stop", 'en');
    expect(b).toEqual([0, 5, 6]); // "don't" | " " | "stop"
  });

  it('does not break inside a decimal number (WB11/WB12 MidNum)', () => {
    const b = wordBoundaries('3.14 pi', 'en');
    expect(b).toEqual([0, 4, 5]); // "3.14" | " " | "pi"
  });

  it('breaks between two emoji regional indicators only in pairs (WB15/16)', () => {
    // U+1F1FA U+1F1F8 = a flag (RI RI pair, no internal break); a third RI starts a new pair.
    const flag = String.fromCodePoint(0x1f1fa, 0x1f1f8);
    const b = wordBoundaries(flag + flag, 'en');
    expect(b).toEqual([0, 4]); // one boundary between the two flags, none inside either
  });

  it('folds a combining mark onto its base character (WB4) rather than starting a new word', () => {
    const b = wordBoundaries('éx', 'en'); // e + combining acute + x
    expect(b).toEqual([0]); // "é" (folded) and "x" are not AHLetter-adjacent across... actually both ALetter, so no break at all
  });
});

describe('wordBoundaries — DictionarySegmenter injection (spec 02 §6.4)', () => {
  it("without a dictionary, a Thai run breaks at every base character (grapheme-cluster fallback, spec 02 §6.4)", () => {
    const thai = 'ประเทศไทย'; // "Thailand" with no spaces
    const b = wordBoundaries(thai, 'th');
    // Every code point here is Word_Break=Other with no Extend/Format/ZWJ, so the fallback
    // is one boundary per code point (WB999 default fires at every position).
    expect(b.length).toBe([...thai].length);
  });

  it('with a dictionary, uses its reported offsets as the run\'s internal boundaries instead', () => {
    const thai = 'กขค'; // three single-consonant "words" per the stub dictionary below
    const stub: DictionarySegmenter = {
      segment(text) {
        // one boundary after the first character only
        return text.length > 1 ? [1] : [];
      },
    };
    const b = wordBoundaries(thai, 'th', stub);
    expect(b).toEqual([0, 1]);
  });
});
