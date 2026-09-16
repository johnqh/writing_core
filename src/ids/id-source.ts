export interface IdSource {
  now(): number;
  randomBytes(length: number): Uint8Array;
  /**
   * An independent id source that starts from this source's current state. Ids minted
   * from the fork never advance this source's own stream — used to let a command batch
   * be rehearsed on a throwaway replica without burning ids the real apply would need.
   */
  fork(): IdSource;
}

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** Web, Bun and Hermes (with react-native-get-random-values installed by the app). */
export const cryptoIdSource: IdSource = {
  // platform-free-allow-clock: IdSource.now default (ULID timestamps) — an injectable seam; createSeededIdSource is the deterministic one tests/rehearsal use instead (spec 02 §1.1)
  now: () => Date.now(),
  randomBytes(length) {
    const c = (globalThis as { crypto?: CryptoLike }).crypto;
    if (!c) throw new Error('globalThis.crypto.getRandomValues is unavailable; install a polyfill');
    return c.getRandomValues(new Uint8Array(length));
  },
  // Stateless (backed by the platform CSPRNG, not a reproducible stream), so there is
  // nothing for a fork to diverge from; the same source is safe to reuse as its own fork.
  fork: () => cryptoIdSource,
};

/** Builds a deterministic source (xorshift32 randomness, a clock advancing 1 ms per call) starting from given state. */
function seededIdSource(initialState: number, initialClock: number): IdSource {
  let state = initialState;
  let clock = initialClock;
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
    // Snapshots the *current* state/clock (not the original seed), so a fork continues
    // this source's stream without either one seeing the other's subsequent draws.
    fork: () => seededIdSource(state, clock),
  };
}

/** Deterministic source for tests: xorshift32 randomness and a clock that advances 1 ms per call. */
export function createSeededIdSource(seed: number, startMs = 1_700_000_000_000): IdSource {
  return seededIdSource(seed >>> 0 || 0x9e3779b9, startMs);
}
