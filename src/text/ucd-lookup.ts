/**
 * Shared binary-search lookup over the generated UCD range tables (spec 02 §6, task 6).
 *
 * **Lookup shape.** Each Unicode property is encoded as a pair of flat, parallel typed
 * arrays: a sorted `Uint32Array` of range-start code points and a `Uint8Array` of value
 * indices (an index into that property's own `..._NAMES` tuple). Segmentation runs on
 * every keystroke (spec 02 §33's "Local echo" and "Keystroke re-pagination" rows), so the
 * lookup has to be cheap without being large: a binary search over merged ranges needs at
 * most ~13 comparisons for the biggest table generated here (General_Category, ~4 100
 * ranges) and touches no more memory than the two arrays themselves — no per-code-point
 * entries, no allocation, nothing to warm up. A two-level trie (block index + per-block
 * array, the shape §6's own prose first suggests) would give O(1) lookups instead of
 * O(log n), but at the cost of one array slot per code point *block* rather than per
 * *run of same-valued code points": for properties whose merged range count is already
 * small relative to the codespace (Grapheme_Cluster_Break merges to ~1 700 ranges; a
 * trie with 256-wide leaf blocks over 0x110000 code points still needs ~4 400 blocks
 * before de-duplication), the range encoding is both smaller on disk and simpler to keep
 * byte-identical across regenerations (no block-splitting heuristic to pin). Measured
 * sizes are in `scripts/build-ucd.ts`'s header comment and the task 6 report; at a few
 * thousand ranges per property the binary search is sub-microsecond, far under the
 * per-keystroke budget.
 */

/** Returns the index into `starts`/the matching value array whose range contains `cp`. */
export function lookupRangeIndex(starts: Uint32Array, cp: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const s = starts[mid];
    if (s !== undefined && s <= cp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Looks up `cp`'s value index in a `(starts, values)` pair produced by `build-ucd.ts`. */
export function lookupRangeValue(starts: Uint32Array, values: Uint8Array, cp: number): number {
  return values[lookupRangeIndex(starts, cp)] ?? 0;
}

/** Exact-match binary search over a sorted `Uint32Array` of code points (sparse mappings: BidiBrackets/BidiMirroring). Returns -1 if absent. */
export function exactIndex(codes: Uint32Array, cp: number): number {
  let lo = 0;
  let hi = codes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = codes[mid];
    if (v === undefined) return -1;
    if (v === cp) return mid;
    if (v < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
