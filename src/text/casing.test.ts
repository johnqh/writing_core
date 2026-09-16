/**
 * `upperCaseWithMap` (spec 02 §7.1, §29.4, task 10). Covers: the `ß`→`SS` cluster map with its
 * second-cluster-non-caret guarantee, the three named language tailorings (Turkish/Azerbaijani,
 * Lithuanian, Greek) each proven to route the language through rather than merely matching
 * platform behaviour (context item 2), a round-trip proof mixing an expanding transform, an
 * unchanged run and a combining sequence (context item 1), the brief's own regression proof
 * that dropping the cluster map breaks the `ß` caret case, and (fix round 1) six real Greek
 * words verified against this repo's own runtime to need cross-cluster dialytika insertion, not
 * just per-letter tonos removal — each proven to fail under the per-cluster-concatenation
 * approach the fix replaced.
 */
import { describe, expect, it } from 'vitest';
import { graphemeClusters } from './grapheme.js';
import { upperCaseWithMap } from './casing.js';

/** `clusterSource[i]`'s source length, per spec 02 §29.4: the diff to the next entry, or to `runEnd` for the last. */
function sourceLength(clusterSource: Uint32Array, i: number, runEnd: number): number {
  return (i + 1 < clusterSource.length ? (clusterSource[i + 1] as number) : runEnd) - (clusterSource[i] as number);
}

describe('upperCaseWithMap — ß cluster map (spec 02 §29.4)', () => {
  it('"ß" uppercases to two display clusters ("S","S") mapped to one source offset, second non-caret', () => {
    const text = 'ß'; // ß
    const { display, clusterSource } = upperCaseWithMap(text, 'de');
    expect(display).toBe('SS');
    expect(graphemeClusters(display)).toEqual([0, 1]); // two separate display clusters — S and S don't combine
    expect(clusterSource.length).toBe(2);
    expect(clusterSource[0]).toBe(0);
    expect(clusterSource[1]).toBe(text.length); // the source's own end, not a fresh start
    expect(sourceLength(clusterSource, 0, text.length)).toBe(1); // first "S": real content, caret allowed
    expect(sourceLength(clusterSource, 1, text.length)).toBe(0); // second "S": non-caret
  });

  it('ß→SS is unconditional (no language needed) — same result under "de" and "en"', () => {
    expect(upperCaseWithMap('ß', 'de').display).toBe('SS');
    expect(upperCaseWithMap('ß', 'en').display).toBe('SS');
  });
});

describe('upperCaseWithMap — language-tailored uppercasing (spec 02 §7.1, context item 2: mechanism not platform)', () => {
  it('Turkish/Azerbaijani: "i" uppercases to İ (U+0130) under tr/az, but to plain I when the language is dropped', () => {
    expect(upperCaseWithMap('i', 'tr').display).toBe('İ');
    expect(upperCaseWithMap('i', 'az').display).toBe('İ');
    // Mechanism proof: the *same input string* gives a genuinely different result once the
    // language argument changes — this is not "toLocaleUpperCase happens to always do this",
    // it is conditional on the language this function is handed actually being routed through.
    expect(upperCaseWithMap('i', 'en').display).toBe('I');
    expect(upperCaseWithMap('i', 'en').display).not.toBe(upperCaseWithMap('i', 'tr').display);
  });

  it('Greek: tonos is removed under el, kept when the language is dropped ("άλφα" → "ΑΛΦΑ" vs "ΆΛΦΑ")', () => {
    const text = 'άλφα'; // άλφα
    expect(upperCaseWithMap(text, 'el').display).toBe('ΑΛΦΑ'); // ΑΛΦΑ, no tonos
    const withoutLanguage = upperCaseWithMap(text, 'en').display;
    expect(withoutLanguage).toBe('ΆΛΦΑ'); // ΆΛΦΑ, tonos kept
    expect(withoutLanguage).not.toBe(upperCaseWithMap(text, 'el').display);
  });

  // Fix round 1 (Important finding 1): the el-Upper transform §7.1 names doesn't just strip
  // tonos, it also inserts a dialytika on ι/υ after an accented vowel to keep the result from
  // misreading as a diphthong once the accent is gone — a genuinely cross-cluster rule. These
  // six words are exactly the ones review verified diverge (whole-string vs per-cluster) against
  // this repo's own runtime, not invented cases.
  const DIALYTIKA_WORDS: readonly [source: string, expectedUpper: string][] = [
    ['νεράιδα', 'ΝΕΡΑΪΔΑ'],
    ['άυλος', 'ΑΫΛΟΣ'],
    ['κορόιδο', 'ΚΟΡΟΪΔΟ'],
    ['ρολόι', 'ΡΟΛΟΪ'],
    ['γάιδαρος', 'ΓΑΪΔΑΡΟΣ'],
    ['μπέικον', 'ΜΠΕΪΚΟΝ'],
  ];

  it.each(DIALYTIKA_WORDS)('Greek dialytika insertion: %s → %s (cross-cluster, not just per-letter tonos removal)', (source, expectedUpper) => {
    const { display, clusterSource } = upperCaseWithMap(source, 'el');
    expect(display).toBe(expectedUpper);
    // The map must still be structurally sound: one entry per display cluster, every source
    // code unit accounted for exactly once (no cluster map regression from the content fix).
    expect(clusterSource.length).toBe(graphemeClusters(display).length);
    let total = 0;
    for (let i = 0; i < clusterSource.length; i++) total += sourceLength(clusterSource, i, source.length);
    expect(total).toBe(source.length);
  });

  it.each(DIALYTIKA_WORDS)('REGRESSION: per-cluster concatenation (the pre-fix approach) gives %s the wrong result, missing the dialytika', (source, expectedUpper) => {
    // The exact per-cluster approach fix round 1 replaced: uppercase each source grapheme
    // cluster in isolation and concatenate — correct for ß/tr/lt (verified elsewhere in this
    // file) but blind to this cross-cluster Greek rule.
    const srcStarts = graphemeClusters(source);
    let naive = '';
    for (let i = 0; i < srcStarts.length; i++) {
      const start = srcStarts[i] as number;
      const end = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : source.length;
      naive += source.slice(start, end).toLocaleUpperCase('el');
    }
    expect(naive).not.toBe(expectedUpper); // fails before the fix — no dialytika inserted
    expect(upperCaseWithMap(source, 'el').display).toBe(expectedUpper); // the real function gets it right
  });

  it('Lithuanian: "i" + combining dot above drops the dot under lt (2 source units → 1 display unit), kept otherwise', () => {
    const text = 'i̇'; // i + COMBINING DOT ABOVE — one grapheme cluster, 2 UTF-16 units
    expect(graphemeClusters(text)).toEqual([0]); // confirms it really is one cluster, not two
    const lt = upperCaseWithMap(text, 'lt');
    expect(lt.display).toBe('I');
    expect(lt.clusterSource).toEqual(new Uint32Array([0]));
    expect(sourceLength(lt.clusterSource, 0, text.length)).toBe(2); // the single display "I" still owns the whole 2-unit source range
    const en = upperCaseWithMap(text, 'en');
    // NOT the precomposed U+0130 (İ) — the default mapping keeps the source's own decomposed
    // "I" + COMBINING DOT ABOVE, dot un-dropped (only "lt" strips it, per SpecialCasing.txt).
    expect(en.display).toBe('İ');
    expect(en.display).not.toBe(lt.display);
  });
});

describe('upperCaseWithMap — round trip: expansion + unchanged run + combining sequence (context item 1)', () => {
  it('"AB" (unchanged) + "ß" (expands) + "e\\u0301" (combining sequence) round-trips exactly', () => {
    const text = 'ABßé'; // A, B, ß, e, COMBINING ACUTE ACCENT — 5 UTF-16 units
    expect(text.length).toBe(5);
    const { display, clusterSource } = upperCaseWithMap(text, 'en');
    expect(display).toBe('ABSSÉ');
    expect(clusterSource).toEqual(new Uint32Array([0, 1, 2, 3, 3]));

    // Unchanged run: "A" and "B" each round-trip 1:1, both real caret positions.
    expect(sourceLength(clusterSource, 0, text.length)).toBe(1); // "A" ← source[0,1)
    expect(sourceLength(clusterSource, 1, text.length)).toBe(1); // "B" ← source[1,2)
    // Expansion: first "S" is real (owns ß's one source unit), second "S" is non-caret.
    expect(sourceLength(clusterSource, 2, text.length)).toBe(1);
    expect(sourceLength(clusterSource, 3, text.length)).toBe(0);
    // Combining sequence: the single display cluster "E"+combining owns the whole 2-unit source range.
    expect(sourceLength(clusterSource, 4, text.length)).toBe(2);

    // Every source code unit is accounted for exactly once, split correctly across display clusters.
    let total = 0;
    for (let i = 0; i < clusterSource.length; i++) total += sourceLength(clusterSource, i, text.length);
    expect(total).toBe(text.length);
  });
});

describe('upperCaseWithMap — misc', () => {
  it('empty string', () => {
    expect(upperCaseWithMap('', 'en')).toEqual({ display: '', clusterSource: new Uint32Array(0) });
  });

  it('already-uppercase text takes the identity fast path (display clusters === source clusters)', () => {
    const text = 'JOHN SMITH';
    const { display, clusterSource } = upperCaseWithMap(text, 'en');
    expect(display).toBe(text);
    expect(clusterSource).toEqual(Uint32Array.from(graphemeClusters(text)));
  });
});

describe('upperCaseWithMap — regression proof: dropping the cluster map breaks the ß caret case (context item 1, brief step 2–4)', () => {
  /**
   * `upperCaseWithMap` minus its one load-bearing fix: every display cluster produced by a
   * source cluster's expansion is assigned that source cluster's *start* (the obvious,
   * "no cluster map" thing to do), instead of the real implementation's rule (first display
   * cluster → source start, every subsequent one → source end, so its length comes out zero).
   * Everything else is identical to `casing.ts`'s real algorithm.
   */
  function withoutClusterMapFix(text: string, lang: string): { display: string; clusterSource: Uint32Array } {
    const srcStarts = graphemeClusters(text);
    const parts: string[] = [];
    const map: number[] = [];
    for (let i = 0; i < srcStarts.length; i++) {
      const srcStart = srcStarts[i] as number;
      const srcEnd = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : text.length;
      const upperCluster = text.slice(srcStart, srcEnd).toLocaleUpperCase(lang);
      parts.push(upperCluster);
      const displayClusterCount = upperCluster.length > 0 ? graphemeClusters(upperCluster).length : 0;
      for (let j = 0; j < displayClusterCount; j++) map.push(srcStart); // BUG: always srcStart, no cluster map
    }
    return { display: parts.join(''), clusterSource: Uint32Array.from(map) };
  }

  it('RED: without the cluster map, the FIRST "S" is wrongly non-caret and the SECOND is wrongly a real caret', () => {
    const text = 'ß';
    const naive = withoutClusterMapFix(text, 'de');
    expect(naive.clusterSource).toEqual(new Uint32Array([0, 0]));
    expect(sourceLength(naive.clusterSource, 0, text.length)).toBe(0); // WRONG: real content marked non-caret
    expect(sourceLength(naive.clusterSource, 1, text.length)).toBe(1); // WRONG: the collapsed clone marked as real
  });

  it('GREEN: the real implementation gets it the other way round — second "S" is the non-caret one', () => {
    const text = 'ß';
    const real = upperCaseWithMap(text, 'de');
    expect(sourceLength(real.clusterSource, 0, text.length)).toBe(1);
    expect(sourceLength(real.clusterSource, 1, text.length)).toBe(0);
  });
});
