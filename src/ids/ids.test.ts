import { describe, expect, it } from 'vitest';
import { encodeUlidBody } from './crockford.js';
import { createSeededIdSource } from './id-source.js';
import {
  builtinStyleId, deterministicId, idKind, isId, isStyleId, newDualGroupId, newId,
} from './ids.js';

describe('crockford ULID body', () => {
  it('encodes 48-bit time then 80 random bits into 26 characters', () => {
    const body = encodeUlidBody(1_469_918_176_385, new Uint8Array(10));
    expect(body).toBe('01ARYZ6S410000000000000000');
    expect(encodeUlidBody(0, new Uint8Array(10).fill(255))).toBe('0000000000ZZZZZZZZZZZZZZZZ');
  });
  it('rejects times outside 48 bits', () => {
    expect(() => encodeUlidBody(2 ** 48, new Uint8Array(10))).toThrow(RangeError);
  });
});

describe('ids', () => {
  const source = createSeededIdSource(42, 1_700_000_000_000);
  it('mints prefixed, validated, time-ordered ids', () => {
    const a = newId('el', source);
    const b = newId('el', source);
    expect(a).toMatch(/^el_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isId('el', a)).toBe(true);
    expect(isId('ent', a)).toBe(false);
    expect(idKind(a)).toBe('el');
    expect(a < b).toBe(true);
  });
  it('is deterministic for seeded sources', () => {
    const x = newId('doc', createSeededIdSource(7, 1));
    const y = newId('doc', createSeededIdSource(7, 1));
    expect(x).toBe(y);
  });
  it('derives deterministic ids from parts', () => {
    const id = deterministicId('el', ['doc_1', 'el_old', 'a0']);
    expect(id).toBe(deterministicId('el', ['doc_1', 'el_old', 'a0']));
    expect(id).not.toBe(deterministicId('el', ['doc_1', 'el_old', 'a1']));
    expect(isId('el', id)).toBe(true);
  });
  it('separates parts unambiguously', () => {
    expect(deterministicId('el', ['ab', 'c'])).not.toBe(deterministicId('el', ['a', 'bc']));
    expect(deterministicId('el', ['a b', 'c'])).not.toBe(deterministicId('el', ['a', 'b c']));
  });
  it('accepts built-in and generated style ids only', () => {
    expect(isStyleId(builtinStyleId('scene_heading'))).toBe(true);
    expect(isStyleId(newId('st', source))).toBe(true);
    expect(isStyleId('st_Scene')).toBe(false);
    expect(() => builtinStyleId('Scene Heading')).toThrow();
  });
  it('mints dual dialogue group ids', () => {
    expect(newDualGroupId(source)).toMatch(/^dd_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it('rejects unknown prefixes', () => {
    expect(idKind('zz_01ARYZ6S410000000000000000')).toBeNull();
    expect(idKind('not-an-id')).toBeNull();
  });
});
