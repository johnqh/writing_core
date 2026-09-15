export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME = 2 ** 48 - 1;

/** Encode the first `chars` 5-bit groups of `bytes`, most significant bit first. */
export function encodeBase32Bytes(bytes: Uint8Array, chars: number): string {
  if (bytes.length * 8 < chars * 5) throw new RangeError('not enough bytes for requested characters');
  let out = '';
  let buffer = 0;
  let bits = 0;
  let index = 0;
  while (out.length < chars) {
    if (bits < 5) {
      buffer = (buffer << 8) | bytes[index++]!;
      bits += 8;
    }
    bits -= 5;
    out += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** 26-char ULID body: 10 chars of millisecond time + 16 chars of 80 random bits. */
export function encodeUlidBody(timeMs: number, random: Uint8Array): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
    throw new RangeError(`ULID time out of range: ${timeMs}`);
  }
  if (random.length !== 10) throw new RangeError('ULID randomness must be 10 bytes');
  let time = '';
  let t = timeMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD_ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + encodeBase32Bytes(random, 16);
}
