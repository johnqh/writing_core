import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { comparePositions, positionBetween } from '../model/positions.js';
import { OrderIndex } from './order-index.js';

describe('OrderIndex', () => {
  it('orders by pos then id and supports rank queries', () => {
    const idx = new OrderIndex();
    idx.upsert('b', 'M');
    idx.upsert('a', 'M');
    idx.upsert('c', 'A');
    expect(idx.ids()).toEqual(['c', 'a', 'b']);
    expect(idx.indexOf('a')).toBe(1);
    expect(idx.idAt(2)).toBe('b');
    idx.upsert('c', 'Z');
    expect(idx.ids()).toEqual(['a', 'b', 'c']);
    expect(idx.remove('a')).toBe(true);
    expect(idx.remove('a')).toBe(false);
    expect(idx.indexOf('a')).toBe(-1);
    expect(idx.size).toBe(2);
    expect(idx.ids(1, 2)).toEqual(['c']);
  });

  it('agrees with a sorted array under 5000 random operations', () => {
    const src = createSeededIdSource(123);
    const idx = new OrderIndex();
    const truth = new Map<string, string>();
    for (let i = 0; i < 5000; i++) {
      const r = src.randomBytes(2);
      const id = `id${r[0]! % 300}`;
      if (r[1]! % 4 === 0) {
        idx.remove(id);
        truth.delete(id);
      } else {
        const pos = positionBetween(null, null, src);
        idx.upsert(id, pos);
        truth.set(id, pos);
      }
    }
    const expected = [...truth.entries()].sort(([ia, pa], [ib, pb]) => comparePositions(pa, pb) || (ia < ib ? -1 : 1)).map(([id]) => id);
    expect(idx.ids()).toEqual(expected);
    expected.forEach((id, i) => expect(idx.indexOf(id)).toBe(i));
  });
});
