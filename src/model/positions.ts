import type { IdSource } from '../ids/id-source.js';

/** Base-62 in byte order, so plain string comparison is document order. */
export const POSITION_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const MAX_POSITION_LENGTH = 64;
const JITTER_LENGTH = 4;

export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function digit(c: string | undefined): number {
  return c === undefined ? 0 : POSITION_DIGITS.indexOf(c);
}

/** Fractional midpoint of digit strings (no trailing zeros); `b === null` is the upper bound 1. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RangeError(`positions out of order: ${a} >= ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? digit(a[0]) : 0;
  const db = b !== null ? digit(b[0]) : POSITION_DIGITS.length;
  if (db - da > 1) return POSITION_DIGITS[Math.round((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return POSITION_DIGITS[da] + midpoint(a.slice(1), null);
}

function jitter(source: IdSource): string {
  const bytes = source.randomBytes(JITTER_LENGTH);
  let out = '';
  for (let i = 0; i < JITTER_LENGTH; i++) {
    const last = i === JITTER_LENGTH - 1;
    // the last character is never '0', so keys never end in the zero digit
    out += last ? POSITION_DIGITS[1 + (bytes[i]! % 61)] : POSITION_DIGITS[bytes[i]! % 62];
  }
  return out;
}

export function positionBetween(a: string | null, b: string | null, source: IdSource | null): string {
  const lo = a ?? '';
  if (b !== null && lo >= b) throw new RangeError(`positions out of order: ${lo} >= ${b}`);
  let key = midpoint(lo, b);
  // A key that is a prefix of `b` would let an appended jitter overtake `b`.
  while (b !== null && b.startsWith(key)) key += midpoint('', b.slice(key.length));
  return source ? key + jitter(source) : key;
}

export function generatePositions(n: number, a: string | null, b: string | null, source: IdSource | null): string[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`invalid count: ${n}`);
  if (n === 0) return [];
  const mid = positionBetween(a, b, source);
  const left = Math.floor((n - 1) / 2);
  return [
    ...generatePositions(left, a, mid, source),
    mid,
    ...generatePositions(n - 1 - left, mid, b, source),
  ];
}

/** Deterministic: two replicas rebalancing the same sequence write identical keys. */
export function rebalancePositions(count: number): string[] {
  return generatePositions(count, null, null, null);
}

/**
 * A confirmed, real hazard (`commands/convergence.test.ts`'s own regression test, `CLAUDE.md`
 * gotcha): `rebalancePositions` regenerates the WHOLE key space from scratch, unrelated to the old
 * one, so an element inserted concurrently against an old neighbor key — anywhere in the document —
 * has no way to land correctly once a full rebalance replaces every key. This is not a rare,
 * deliberately invoked maintenance action: I19's own auto-repair (`model/validate/structural.ts`)
 * calls it whenever ANY element's key has grown past `MAX_POSITION_LENGTH`, and repair runs by
 * default on every document open — so the destructive form could run silently, concurrently with a
 * real edit from another session, on an ordinary open.
 *
 * The real fix: never touch a key that is not itself degenerate. This finds only the CONTIGUOUS
 * runs of over-long keys and regenerates keys for just those runs, bracketed by the nearest short
 * (unchanged) neighbor on each side — `generatePositions` already supports bounded generation
 * between two real keys, so no new position-algebra primitive is needed, only bounding it. A
 * concurrent insert anchored to any element OUTSIDE a touched run is now provably unaffected: its
 * neighbor's key literally never changes. The one hazard this does NOT remove: an insert whose
 * anchor is itself one of the degenerate elements being compacted, concurrently with the repair that
 * compacts it — a much narrower window (it requires editing right next to an already-pathological,
 * over-long key at the exact moment something repairs it) than "any rebalance, anywhere, ever races
 * with any insert", which this closes. Eliminating that narrower window too would need a persisted
 * "logical predecessor" to reposition against, which no element record carries today.
 */
export function rebalanceDegenerateRuns(positions: readonly string[], maxLength: number = MAX_POSITION_LENGTH): Map<number, string> {
  const out = new Map<number, string>();
  let i = 0;
  while (i < positions.length) {
    if ((positions[i] as string).length <= maxLength) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < positions.length && (positions[j] as string).length > maxLength) j++;
    const before = i > 0 ? (positions[i - 1] as string) : null;
    const after = j < positions.length ? (positions[j] as string) : null;
    const fresh = generatePositions(j - i, before, after, null);
    fresh.forEach((p, k) => out.set(i + k, p));
    i = j;
  }
  return out;
}
