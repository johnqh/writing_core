import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { DOC_TOP_LEVEL_KEYS } from '../schema/document.js';
import { getMap, lastPosition, orderElements, readJSONMap, sortedRecords } from './ymap.js';

describe('getMap', () => {
  it('returns the same live Y.Map instance as doc.getMap for a top-level key', () => {
    const doc = new Y.Doc();
    const key = DOC_TOP_LEVEL_KEYS[0];
    const map = getMap(doc, key);
    expect(map).toBeInstanceOf(Y.Map);
    expect(map).toBe(doc.getMap(key));
    map.set('x', 1);
    expect(doc.getMap(key).get('x')).toBe(1);
  });

  it('returns a distinct map per top-level key', () => {
    const doc = new Y.Doc();
    expect(getMap(doc, 'meta')).not.toBe(getMap(doc, 'elements'));
  });
});

describe('readJSONMap', () => {
  it('reads a flat Y.Map back into a plain JSON object', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('m');
    map.set('a', 1);
    map.set('b', 'x');
    map.set('c', true);
    expect(readJSONMap<{ a: number; b: string; c: boolean }>(map)).toEqual({ a: 1, b: 'x', c: true });
  });

  it('reads an empty map to an empty object', () => {
    const doc = new Y.Doc();
    expect(readJSONMap(doc.getMap('m'))).toEqual({});
  });
});

describe('orderElements', () => {
  it('orders Y.Map records by (pos, then id) and ignores non-Y.Map values', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('m');
    const c = new Y.Map<unknown>();
    c.set('id', 'c');
    c.set('pos', 'B');
    const a = new Y.Map<unknown>();
    a.set('id', 'a');
    a.set('pos', 'A');
    // Same pos: broken tie by id.
    const tieZ = new Y.Map<unknown>();
    tieZ.set('id', 'z');
    tieZ.set('pos', 'C');
    const tieY = new Y.Map<unknown>();
    tieY.set('id', 'y');
    tieY.set('pos', 'C');
    map.set('cKey', c);
    map.set('aKey', a);
    map.set('zKey', tieZ);
    map.set('yKey', tieY);
    map.set('stray', 'not a Y.Map value');
    const ordered = orderElements(map);
    expect(ordered.map((m) => m.get('id'))).toEqual(['a', 'c', 'y', 'z']);
  });

  it('returns an empty array for an empty map', () => {
    const doc = new Y.Doc();
    expect(orderElements(doc.getMap('m'))).toEqual([]);
  });
});

describe('lastPosition', () => {
  it('returns the greatest pos among Y.Map records', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('m');
    const a = new Y.Map<unknown>();
    a.set('pos', 'A');
    const b = new Y.Map<unknown>();
    b.set('pos', 'M');
    const c = new Y.Map<unknown>();
    c.set('pos', 'G');
    map.set('a', a);
    map.set('b', b);
    map.set('c', c);
    expect(lastPosition(map)).toBe('M');
  });

  it('also works over plain `{ pos }` JSON values, not just Y.Map records', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('m');
    map.set('a', { pos: 'A' });
    map.set('b', { pos: 'Z' });
    expect(lastPosition(map)).toBe('Z');
  });

  it('returns null for an empty map', () => {
    const doc = new Y.Doc();
    expect(lastPosition(doc.getMap('m'))).toBeNull();
  });

  it('ignores entries without a string pos', () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>('m');
    map.set('a', { notPos: 'A' });
    map.set('b', null);
    expect(lastPosition(map)).toBeNull();
  });
});

describe('sortedRecords', () => {
  it('orders by pos when every record has one', () => {
    expect(sortedRecords([{ id: 'b', pos: 'B' }, { id: 'a', pos: 'A' }, { id: 'c', pos: 'C' }]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to id order when pos is absent', () => {
    expect(sortedRecords([{ id: 'b' }, { id: 'a' }, { id: 'c' }]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [{ id: 'b', pos: 'B' }, { id: 'a', pos: 'A' }];
    const out = sortedRecords(input);
    expect(out).not.toBe(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
