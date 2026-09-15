export interface IdSource {
  now(): number;
  randomBytes(length: number): Uint8Array;
}

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** Web, Bun and Hermes (with react-native-get-random-values installed by the app). */
export const cryptoIdSource: IdSource = {
  now: () => Date.now(),
  randomBytes(length) {
    const c = (globalThis as { crypto?: CryptoLike }).crypto;
    if (!c) throw new Error('globalThis.crypto.getRandomValues is unavailable; install a polyfill');
    return c.getRandomValues(new Uint8Array(length));
  },
};

/** Deterministic source for tests: xorshift32 randomness and a clock that advances 1 ms per call. */
export function createSeededIdSource(seed: number, startMs = 1_700_000_000_000): IdSource {
  let state = seed >>> 0 || 0x9e3779b9;
  let clock = startMs;
  return {
    now: () => clock++,
    randomBytes(length) {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        out[i] = state & 0xff;
      }
      return out;
    },
  };
}
