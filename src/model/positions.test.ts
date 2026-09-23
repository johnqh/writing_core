import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import {
  MAX_POSITION_LENGTH, comparePositions, generatePositions, positionBetween, rebalanceDegenerateRuns, rebalancePositions,
} from './positions.js';

const src = createSeededIdSource(1);

describe('positionBetween', () => {
  it('orders strictly between bounds, including open bounds', () => {
    const a = positionBetween(null, null, src);
    const b = positionBetween(a, null, src);
    const c = positionBetween(null, a, src);
    const m = positionBetween(c, a, src);
    expect(comparePositions(c, m)).toBeLessThan(0);
    expect(comparePositions(m, a)).toBeLessThan(0);
    expect(comparePositions(a, b)).toBeLessThan(0);
  });
  it('never returns a key ending in 0 and handles prefix neighbours', () => {
    const lo = 'U';
    const hi = 'U01';
    const k = positionBetween(lo, hi, src);
    expect(lo < k && k < hi).toBe(true);
    expect(k.endsWith('0')).toBe(false);
  });
  it('gives distinct keys to concurrent inserts at the same place', () => {
    const a = positionBetween('A', 'B', createSeededIdSource(10));
    const b = positionBetween('A', 'B', createSeededIdSource(11));
    expect(a).not.toBe(b);
    for (const k of [a, b]) expect('A' < k && k < 'B').toBe(true);
  });
  it('rejects inverted bounds', () => {
    expect(() => positionBetween('B', 'A', null)).toThrow(RangeError);
  });
  it('stays ordered through 2000 random inserts', () => {
    const keys: string[] = [];
    const rnd = createSeededIdSource(99);
    for (let i = 0; i < 2000; i++) {
      const at = rnd.randomBytes(2).reduce((x, y) => x * 256 + y, 0) % (keys.length + 1);
      keys.splice(at, 0, positionBetween(keys[at - 1] ?? null, keys[at] ?? null, rnd));
    }
    const sorted = [...keys].sort(comparePositions);
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('generatePositions', () => {
  it('distributes n keys with logarithmic length', () => {
    const keys = generatePositions(10_000, null, null, src);
    expect([...keys].sort(comparePositions)).toEqual(keys);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(24);
  });
  it('rebalances deterministically', () => {
    expect(rebalancePositions(500)).toEqual(rebalancePositions(500));
    expect(Math.max(...rebalancePositions(500).map((k) => k.length))).toBeLessThan(MAX_POSITION_LENGTH);
  });
});

describe('rebalanceDegenerateRuns', () => {
  it('touches only the over-long positions, bracketed by their real, unchanged neighbours', () => {
    const positions = ['A', 'B'.repeat(80), 'C'.repeat(80), 'D'];
    const fixes = rebalanceDegenerateRuns(positions);
    expect([...fixes.keys()].sort()).toEqual([1, 2]);
    expect(positions[0]).toBe('A'); // untouched — not a map entry at all
    expect(positions[3]).toBe('D');
    const [k1, k2] = [fixes.get(1)!, fixes.get(2)!];
    expect(k1.length).toBeLessThanOrEqual(MAX_POSITION_LENGTH);
    expect(k2.length).toBeLessThanOrEqual(MAX_POSITION_LENGTH);
    expect(comparePositions('A', k1)).toBeLessThan(0);
    expect(comparePositions(k1, k2)).toBeLessThan(0);
    expect(comparePositions(k2, 'D')).toBeLessThan(0);
  });

  it('handles a degenerate run at the very start or end (an open bound on that side)', () => {
    const atStart = rebalanceDegenerateRuns(['X'.repeat(80), 'Y'.repeat(80), 'Z']);
    expect([...atStart.keys()].sort()).toEqual([0, 1]);
    expect(comparePositions(atStart.get(0)!, atStart.get(1)!)).toBeLessThan(0);
    expect(comparePositions(atStart.get(1)!, 'Z')).toBeLessThan(0);

    const atEnd = rebalanceDegenerateRuns(['A', 'X'.repeat(80), 'Y'.repeat(80)]);
    expect([...atEnd.keys()].sort()).toEqual([1, 2]);
    expect(comparePositions('A', atEnd.get(1)!)).toBeLessThan(0);
    expect(comparePositions(atEnd.get(1)!, atEnd.get(2)!)).toBeLessThan(0);
  });

  it('returns an empty map when nothing is degenerate', () => {
    expect(rebalanceDegenerateRuns(['A', 'B', 'C']).size).toBe(0);
  });

  it('handles two separate degenerate runs independently', () => {
    const positions = ['A'.repeat(80), 'B', 'C'.repeat(80), 'D'];
    const fixes = rebalanceDegenerateRuns(positions);
    expect([...fixes.keys()].sort()).toEqual([0, 2]);
    expect(comparePositions(fixes.get(0)!, 'B')).toBeLessThan(0);
    expect(comparePositions('B', fixes.get(2)!)).toBeLessThan(0);
    expect(comparePositions(fixes.get(2)!, 'D')).toBeLessThan(0);
  });

  it('is deterministic: the same degenerate input rebalances to the same keys', () => {
    const positions = ['A', 'B'.repeat(80), 'C'.repeat(80), 'D'];
    expect(rebalanceDegenerateRuns(positions)).toEqual(rebalanceDegenerateRuns(positions));
  });
});
