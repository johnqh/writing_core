import { describe, expect, it } from 'vitest';
import type { NumberLabel } from '../schema/template.js';
import type { NumberMode } from '../schema/vocab.js';
import {
  alphabetFor, compareLabels, formatNumberLabel, indicesToLetters, letters, lettersToIndices,
} from './number-label.js';

// ─── Rendering: M1 cases (same assertions as src/read-model/structure.test.ts's M1 tests — kept
// here too so this dedicated file exercises the module on its own; structure.test.ts's copies are
// left untouched) ────────────────────────────────────────────────────────────────────────────
describe('formatNumberLabel — M1 rendering (no opts)', () => {
  it('renders a plain base', () => {
    expect(formatNumberLabel({ base: 12, prefix: [], suffix: [] })).toBe('12');
  });

  it('renders base + single-letter suffix', () => {
    expect(formatNumberLabel({ base: 12, prefix: [], suffix: [{ kind: 'letters', value: [1] }] })).toBe('12A');
  });

  it('renders prefix + base', () => {
    expect(formatNumberLabel({ base: 2, prefix: [{ kind: 'letters', value: [2] }], suffix: [] })).toBe('B2');
  });

  it('renders mixed letters + digits suffix', () => {
    expect(
      formatNumberLabel({ base: 10, prefix: [], suffix: [{ kind: 'letters', value: [1] }, { kind: 'digits', value: 3 }] }),
    ).toBe('10A3');
  });

  it('custom overrides everything, verbatim', () => {
    expect(formatNumberLabel({ base: 1, prefix: [], suffix: [], custom: '1-X' })).toBe('1-X');
  });

  it('multi-letter suffix segment', () => {
    expect(formatNumberLabel({ base: 10, prefix: [], suffix: [{ kind: 'letters', value: [1, 2] }] })).toBe('10AB');
  });

  it('letters() tolerates out-of-range indices', () => {
    expect(letters([0])).toBe('');
    expect(letters([-3, 2])).toBe('B');
    expect(letters([27])).toBe('AA');
  });

  it('an out-of-range letter index contributes nothing to the label', () => {
    expect(formatNumberLabel({ base: 4, prefix: [], suffix: [{ kind: 'letters', value: [0] }] })).toBe('4');
  });
});

// ─── Rendering: skipIO (Task 12 bugfix) ────────────────────────────────────────────────────────
describe('skipIO alphabet', () => {
  it('alphabetFor(false) is the full 26-letter alphabet, alphabetFor(true) is 24 letters without I/O', () => {
    expect(alphabetFor(false)).toHaveLength(26);
    expect(alphabetFor(true)).toHaveLength(24);
    expect(alphabetFor(true)).not.toContain('I');
    expect(alphabetFor(true)).not.toContain('O');
  });

  it('index 9 renders I without skipIO and J with skipIO — the shipped bug', () => {
    expect(letters([9])).toBe('I');
    expect(letters([9], { skipIO: true })).toBe('J');
  });

  it('formatNumberLabel threads skipIO through to letters()', () => {
    const label: NumberLabel = { base: 10, prefix: [], suffix: [{ kind: 'letters', value: [9] }] };
    expect(formatNumberLabel(label)).toBe('10I');
    expect(formatNumberLabel(label, { skipIO: true })).toBe('10J');
  });

  it('custom overrides skipIO too — displayed verbatim regardless of opts', () => {
    expect(formatNumberLabel({ base: 5, prefix: [], suffix: [], custom: '5-X' }, { skipIO: true })).toBe('5-X');
  });
});

// ─── Rendering: romanUpper / romanLower ────────────────────────────────────────────────────────
describe('formatNumberLabel — roman modes', () => {
  it('romanUpper renders the base in upper Roman numerals and wraps a single suffix segment', () => {
    const label: NumberLabel = { base: 1, prefix: [], suffix: [{ kind: 'letters', value: [1] }] };
    expect(formatNumberLabel(label, { mode: 'romanUpper' })).toBe('I(A)');
  });

  it('romanUpper wraps each suffix segment in its own parentheses', () => {
    const label: NumberLabel = {
      base: 1, prefix: [], suffix: [{ kind: 'letters', value: [1] }, { kind: 'digits', value: 1 }],
    };
    expect(formatNumberLabel(label, { mode: 'romanUpper' })).toBe('I(A)(1)');
  });

  it('romanLower lowercases the base and its parenthesized segments, including a prefix', () => {
    const label: NumberLabel = { base: 1, prefix: [{ kind: 'letters', value: [1] }], suffix: [] };
    expect(formatNumberLabel(label, { mode: 'romanLower' })).toBe('(a)i');
  });

  it('plain base with no mode is unaffected (backward compatible)', () => {
    expect(formatNumberLabel({ base: 1, prefix: [], suffix: [] })).toBe('1');
  });
});

// ─── letters/indices round trip (Z-extension helpers) ──────────────────────────────────────────
describe('lettersToIndices / indicesToLetters', () => {
  it('round-trips a plain single-segment run', () => {
    expect(indicesToLetters([1, 2])).toBe('AB');
    expect(lettersToIndices('AB')).toEqual([1, 2]);
  });

  it('Z-extension: ZA, ZB, …, ZZ, ZZA render from their multi-index arrays', () => {
    expect(indicesToLetters([26, 1])).toBe('ZA');
    expect(indicesToLetters([26, 2])).toBe('ZB');
    expect(indicesToLetters([26, 26])).toBe('ZZ');
    expect(indicesToLetters([26, 26, 1])).toBe('ZZA');
  });

  it('lettersToIndices inverts indicesToLetters for the Z-extension', () => {
    expect(lettersToIndices('ZA')).toEqual([26, 1]);
    expect(lettersToIndices('ZZA')).toEqual([26, 26, 1]);
  });

  it('is case-insensitive and skipIO-aware', () => {
    expect(lettersToIndices('za')).toEqual([26, 1]);
    expect(lettersToIndices('J', { skipIO: true })).toEqual([9]);
    expect(indicesToLetters([9], { skipIO: true })).toBe('J');
  });

  it('throws on a letter outside the selected alphabet', () => {
    expect(() => lettersToIndices('I', { skipIO: true })).toThrow(RangeError);
  });
});

// ─── Ordering (spec 02 §22.2) ───────────────────────────────────────────────────────────────────

function letterSeg(...value: number[]): NumberLabel['suffix'][number] {
  return { kind: 'letters', value };
}

function label(base: number, prefix: NumberLabel['prefix'] = [], suffix: NumberLabel['suffix'] = [], custom?: string): NumberLabel {
  return custom === undefined ? { base, prefix, suffix } : { base, prefix, suffix, custom };
}

function expectAscending(labels: NumberLabel[], mode: NumberMode): void {
  for (let i = 0; i + 1 < labels.length; i += 1) {
    expect(compareLabels(labels[i]!, labels[i + 1]!, mode), `index ${i} < ${i + 1}`).toBeLessThan(0);
    expect(compareLabels(labels[i + 1]!, labels[i]!, mode), `index ${i + 1} > ${i}`).toBeGreaterThan(0);
  }
}

describe('compareLabels — 1AB / 1A2 / romanUpper / romanLower ordering', () => {
  const modes: NumberMode[] = ['1AB', '1A2', 'romanUpper', 'romanLower'];

  it.each(modes)('%s: 1, 1A, 1AA, 1AB, 1B, 2 (spec §22.2 sequence)', (mode) => {
    expectAscending(
      [
        label(1),
        label(1, [], [letterSeg(1)]),
        label(1, [], [letterSeg(1), letterSeg(1)]),
        label(1, [], [letterSeg(1), letterSeg(2)]),
        label(1, [], [letterSeg(2)]),
        label(2),
      ],
      mode,
    );
  });

  it.each(modes)('%s: prefix sorts before plain for an equal base (preSeq: A1, B1 sort before 1)', (mode) => {
    expectAscending([label(1, [letterSeg(1)]), label(1, [letterSeg(2)]), label(1)], mode);
  });

  it('compareLabels(a, a, mode) is 0 for every mode', () => {
    const l = label(3, [letterSeg(1)], [letterSeg(2), { kind: 'digits', value: 4 }]);
    for (const mode of ['1AB', '1A2', 'AB2', 'BA2', 'romanUpper', 'romanLower'] as const) {
      expect(compareLabels(l, l, mode)).toBe(0);
    }
  });

  it('custom never participates — ordering is by the structured base/prefix/suffix', () => {
    const a = label(1, [], [], 'X');
    const b = label(2, [], [], 'A');
    expect(compareLabels(a, b, '1AB')).toBeLessThan(0);
  });
});

describe('compareLabels — AB2 ordering (left-to-right prefix comparison)', () => {
  it('A2 < AA2 < AB2 < B2', () => {
    expectAscending(
      [
        label(2, [letterSeg(1)]),
        label(2, [letterSeg(1, 1)]),
        label(2, [letterSeg(1, 2)]),
        label(2, [letterSeg(2)]),
      ],
      'AB2',
    );
  });

  it('equal base: prefixed sorts before plain', () => {
    expect(compareLabels(label(1, [letterSeg(1)]), label(1), 'AB2')).toBeLessThan(0);
  });

  it('AA2, AB2 from the §22.4 generation vector (AB2 | A2 | B2 | 2 | AA2, AB2)', () => {
    expectAscending([label(2, [letterSeg(1)]), label(2, [letterSeg(1, 1)]), label(2, [letterSeg(1, 2)]), label(2, [letterSeg(2)])], 'AB2');
  });
});

describe('compareLabels — BA2 ordering (right-to-left prefix comparison)', () => {
  it('A2 < AA2 < BA2 < B2', () => {
    expectAscending(
      [
        label(2, [letterSeg(1)]), // A2
        label(2, [letterSeg(1, 1)]), // AA2
        label(2, [letterSeg(2, 1)]), // BA2 — prefix grown at the LEFT end: B prepended to A2's A
        label(2, [letterSeg(2)]), // B2
      ],
      'BA2',
    );
  });

  it('§22.4 generation vector (BA2 | A2 | B2 | 2 | AA2, BA2)', () => {
    const A2 = label(2, [letterSeg(1)]);
    const AA2 = label(2, [letterSeg(1, 1)]);
    const BA2 = label(2, [letterSeg(2, 1)]);
    const B2 = label(2, [letterSeg(2)]);
    expect(compareLabels(A2, AA2, 'BA2')).toBeLessThan(0);
    expect(compareLabels(AA2, BA2, 'BA2')).toBeLessThan(0);
    expect(compareLabels(BA2, B2, 'BA2')).toBeLessThan(0);
  });

  // Regression proof (brief step 2–4): comparing BA2's flattened prefixes left-to-right instead of
  // right-to-left is exactly the bug this task fixes. BA2's prefix is [B, A] ([2, 1]) and B2's is
  // [B] ([2]): compared left-to-right, their first (and B2's only) element is equal, so the
  // *shorter* array — B2 — would be judged "less", giving `B2 < BA2` and breaking the ordering
  // `compareLabels` is required to produce (`BA2 < B2`).
  it('regression: a left-to-right comparator on BA2 prefixes gets B2 < BA2 backwards', () => {
    function naiveLeftToRight(a: readonly number[], b: readonly number[]): number {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i += 1) {
        const d = a[i]! - b[i]!;
        if (d !== 0) return d;
      }
      return a.length - b.length;
    }
    const BA2flat = [2, 1]; // B, A
    const B2flat = [2]; // B
    // The naive (wrong) left-to-right rule says B2 < BA2 —
    expect(naiveLeftToRight(BA2flat, B2flat)).toBeGreaterThan(0);
    // — but the spec-correct, right-to-left rule (what compareLabels implements) says BA2 < B2.
    expect(compareLabels(label(2, [letterSeg(2, 1)]), label(2, [letterSeg(2)]), 'BA2')).toBeLessThan(0);
  });
});
