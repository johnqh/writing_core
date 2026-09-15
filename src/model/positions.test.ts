import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import {
  MAX_POSITION_LENGTH, comparePositions, generatePositions, positionBetween, rebalancePositions,
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
