import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.js';

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('hashes UTF-8 bytes', () => {
    expect(sha256Hex('é')).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
  });
});
