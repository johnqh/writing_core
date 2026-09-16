/**
 * UAX #29 grapheme cluster conformance (spec 02 §6.1, task 6). The official
 * `GraphemeBreakTest.txt` (`test/ucd/`, downloaded and committed by `scripts/build-ucd.ts`)
 * plus the brief's four explicit cases.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { graphemeBreakProperty, graphemeClusters, nextCluster, previousCluster } from './grapheme.js';

const TEST_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd/GraphemeBreakTest.txt');

interface ConformanceCase {
  line: number;
  text: string;
  expectedStarts: number[];
  comment: string;
}

/** Parses one `GraphemeBreakTest.txt` data line (÷/× tokens interleaved with hex code points) into a test case. */
function parseConformanceLine(raw: string, lineNo: number): ConformanceCase | null {
  const hashIndex = raw.indexOf('#');
  const data = (hashIndex >= 0 ? raw.slice(0, hashIndex) : raw).trim();
  const comment = hashIndex >= 0 ? raw.slice(hashIndex + 1).trim() : '';
  if (!data) return null;
  const tokens = data.split(/\s+/);
  const codePoints: number[] = [];
  const breakBeforeAt: boolean[] = []; // breakBeforeAt[k] = is there a ÷ immediately before codePoints[k]?
  for (const tok of tokens) {
    if (tok === '÷' || tok === '×') {
      breakBeforeAt.push(tok === '÷');
    } else {
      codePoints.push(parseInt(tok, 16));
    }
  }
  // tokens alternate break-symbol, codepoint, break-symbol, codepoint, ..., break-symbol
  // (one more break-symbol than code points). breakBeforeAt[k] is the break decision
  // immediately preceding codePoints[k]; the trailing symbol (end of string) is discarded.
  let text = '';
  const offsets: number[] = [];
  for (const cp of codePoints) {
    offsets.push(text.length);
    text += String.fromCodePoint(cp);
  }
  const expectedStarts = offsets.filter((_, k) => breakBeforeAt[k]);
  return { line: lineNo, text, expectedStarts, comment };
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

describe('graphemeClusters — UAX #29 official conformance (GraphemeBreakTest.txt)', () => {
  const cases = loadConformanceCases();

  it('loads the conformance file (sanity: about 1 000 cases)', () => {
    expect(cases.length).toBeGreaterThan(900);
  });

  for (const c of cases) {
    it(`line ${c.line}: ${JSON.stringify(c.text)} — ${c.comment}`, () => {
      expect(graphemeClusters(c.text)).toEqual(c.expectedStarts);
    });
  }
});

describe('graphemeClusters — explicit cases (task 6 brief)', () => {
  it('a family emoji ZWJ sequence is one cluster', () => {
    // MAN, ZWJ, WOMAN, ZWJ, GIRL, ZWJ, BOY
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(graphemeClusters(family)).toEqual([0]);
  });

  it('a Devanagari क + virama + ष is one cluster (GB9c, Indic_Conjunct_Break)', () => {
    const text = 'क्ष'; // क (Consonant) + virama (Linker) + ष (Consonant)
    expect(graphemeClusters(text)).toEqual([0]);
  });

  it('a regional-indicator pair is one cluster', () => {
    const usFlag = '\u{1F1FA}\u{1F1F8}'; // 🇺🇸
    expect(graphemeClusters(usFlag)).toEqual([0]);
  });

  it('four regional indicators are two clusters', () => {
    const twoFlags = '\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}'; // 🇺🇸🇬🇧
    expect(graphemeClusters(twoFlags)).toEqual([0, 4]);
  });
});

describe('graphemeBreakProperty / nextCluster / previousCluster', () => {
  it('classifies a few pinned code points', () => {
    expect(graphemeBreakProperty(0x0d)).toBe('CR');
    expect(graphemeBreakProperty(0x0a)).toBe('LF');
    expect(graphemeBreakProperty(0x200d)).toBe('ZWJ');
    expect(graphemeBreakProperty(0x1f1e6)).toBe('Regional_Indicator');
    expect(graphemeBreakProperty(0x41)).toBe('Other');
  });

  it('nextCluster/previousCluster walk the same boundaries as graphemeClusters', () => {
    const text = 'a' + 'क्ष' + 'b'; // a, [क+virama+ष], b
    const starts = graphemeClusters(text); // [0, 1, 4]
    expect(starts).toEqual([0, 1, 4]);
    expect(nextCluster(text, 0)).toBe(1);
    expect(nextCluster(text, 1)).toBe(4);
    expect(nextCluster(text, 4)).toBe(text.length);
    expect(previousCluster(text, text.length)).toBe(4);
    expect(previousCluster(text, 4)).toBe(1);
    expect(previousCluster(text, 1)).toBe(0);
  });

  it('graphemeClusters of the empty string is empty', () => {
    expect(graphemeClusters('')).toEqual([]);
  });
});
