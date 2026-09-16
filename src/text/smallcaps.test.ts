/**
 * `smallCapsRuns` (spec 02 §7.2, task 10). Not named as a required test file in the task 10
 * brief (only `casing.test.ts` and `special.test.ts` are), but `smallcaps.ts` is a required
 * source file with real segmentation logic — added on the same "every module gets its own test
 * file" basis every other `src/text/*.ts` module in this repo follows.
 */
import { describe, expect, it } from 'vitest';
import { smallCapsRuns } from './smallcaps.js';

describe('smallCapsRuns — basic segmentation (spec 02 §7.2)', () => {
  it('empty string', () => {
    expect(smallCapsRuns('')).toEqual([]);
  });

  it('all-uppercase text is one non-synthesized run', () => {
    expect(smallCapsRuns('ABC')).toEqual([{ start: 0, end: 3, synthesize: false }]);
  });

  it('all-lowercase text is one synthesized run', () => {
    expect(smallCapsRuns('abc')).toEqual([{ start: 0, end: 3, synthesize: true }]);
  });

  it('"Hello World" alternates: H / ello / (space+W, merged — both non-synthesized) / orld', () => {
    expect(smallCapsRuns('Hello World')).toEqual([
      { start: 0, end: 1, synthesize: false }, // H
      { start: 1, end: 5, synthesize: true }, // ello
      { start: 5, end: 7, synthesize: false }, // space + W — adjacent non-synthesized clusters merge into one run
      { start: 7, end: 11, synthesize: true }, // orld
    ]);
  });

  it('digits and punctuation are non-synthesized, same as uppercase', () => {
    expect(smallCapsRuns('12 P.M.')).toEqual([{ start: 0, end: 7, synthesize: false }]);
  });

  it('runs are contiguous and exhaustive over the whole string', () => {
    const text = 'Dr. Smith called at 3pm.';
    const runs = smallCapsRuns(text);
    expect(runs[0]?.start).toBe(0);
    expect(runs[runs.length - 1]?.end).toBe(text.length);
    for (let i = 0; i < runs.length - 1; i++) expect(runs[i]?.end).toBe(runs[i + 1]?.start);
  });
});

describe('smallCapsRuns — grapheme-cluster awareness (module header comment)', () => {
  it('a combining mark stays in its base letter\'s run, not split into its own run', () => {
    // "a" + COMBINING ACUTE ACCENT (General_Category=Mn, not Ll) + "B": if this classified by
    // code point instead of by cluster, the accent alone would break the "a" run right after
    // offset 1 (Mn isn't Ll, so a naive per-code-point scan sees a false boundary there).
    const text = 'áB';
    expect(smallCapsRuns(text)).toEqual([
      { start: 0, end: 2, synthesize: true }, // "a"+combining acute, one cluster, one run
      { start: 2, end: 3, synthesize: false }, // "B"
    ]);
  });

  it('the same holds when the accented letter is already uppercase (no synthesis needed either way)', () => {
    const text = 'Áb';
    expect(smallCapsRuns(text)).toEqual([
      { start: 0, end: 2, synthesize: false }, // "A"+combining acute
      { start: 2, end: 3, synthesize: true }, // "b"
    ]);
  });
});
