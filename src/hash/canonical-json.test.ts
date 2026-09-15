import { describe, expect, it } from 'vitest';
import { canonicalJSON } from './canonical-json.js';

describe('canonicalJSON', () => {
  it('sorts keys by UTF-16 code unit at every depth', () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }))
      .toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJSON({ a: 1, B: 2, é: 3 })).toBe('{"B":2,"a":1,"é":3}');
  });
  it('omits undefined object fields and uses shortest numbers', () => {
    expect(canonicalJSON({ a: undefined, b: 1.5, c: 1e21 })).toBe('{"b":1.5,"c":1e+21}');
  });
  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJSON({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJSON([undefined])).toThrow(TypeError);
    expect(() => canonicalJSON({ a: () => 1 })).toThrow(TypeError);
  });
});
