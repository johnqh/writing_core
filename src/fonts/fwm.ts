/**
 * The `.fwm` ("Fadewright metrics") binary format, its encoder/decoder and the
 * per-(faceId, sizeEmu) advance cache (spec 02 §4.2, §4.3). `FaceId` and
 * `FontFaceMetrics` are the Task 1 skeleton's exact spec §4.3 shapes
 * (`src/layout/types.ts`); this module implements them rather than redeclaring them.
 */
import { roundHalfEven } from '../layout/round.js';
import type { FaceId, FontFaceMetrics } from '../layout/types.js';
import type { FontFamilyId } from '../schema/primitives.js';

export type { FaceId, FontFaceMetrics } from '../layout/types.js';

export const FWM_MAGIC = 0x314d5746; // 'FWM1' little-endian
export const FWM_FORMAT_VERSION = 1;

// 48 bytes exactly: the header ends with sourceSha256Prefix at 40–47. Spec 02 §4.2's
// field list used to carry a trailing `reserved u32` that contradicted its own
// "Header (48 bytes)"; the spec was amended to drop it.
const HEADER_BYTES = 48;
const RANGE_BYTES = 12;
const KERN_BYTES = 12;

export interface FwmRange {
  start: number;
  length: number;
  mode: 'uniform' | 'explicit';
  advance?: number; // uniform
  advances?: number[]; // explicit, length === range length
}

export interface FwmInput {
  faceId: FaceId;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
  underlinePosition: number;
  underlineThickness: number;
  strikeoutPosition: number;
  strikeoutThickness: number;
  italicAngle: number;
  monospace: boolean;
  requiresShaping: boolean;
  defaultAdvance: number;
  sourceSha256: string; // hex; the low 8 bytes are stored
  ranges: FwmRange[];
  kernPairs: { left: number; right: number; value: number }[];
}

export function encodeFwm(input: FwmInput): Uint8Array {
  const ranges = [...input.ranges].sort((a, b) => a.start - b.start);
  const pool: number[] = [];
  for (const r of ranges) if (r.mode === 'explicit') pool.push(...(r.advances ?? []));
  const kerns = [...input.kernPairs].sort((a, b) => a.left - b.left || a.right - b.right);

  const size = HEADER_BYTES + ranges.length * RANGE_BYTES + pool.length * 2 + kerns.length * KERN_BYTES;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);

  let flags = 0;
  if (input.monospace) flags |= 1;
  if (kerns.length > 0) flags |= 2;
  if (input.requiresShaping) flags |= 4;

  view.setUint32(0, FWM_MAGIC, true);
  view.setUint16(4, FWM_FORMAT_VERSION, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, input.unitsPerEm, true);
  view.setInt16(10, input.ascender, true);
  view.setInt16(12, input.descender, true);
  view.setInt16(14, input.lineGap, true);
  view.setInt16(16, input.capHeight, true);
  view.setInt16(18, input.xHeight, true);
  view.setInt16(20, input.underlinePosition, true);
  view.setInt16(22, input.underlineThickness, true);
  view.setInt16(24, input.strikeoutPosition, true);
  view.setInt16(26, input.strikeoutThickness, true);
  view.setInt16(28, roundHalfEven(input.italicAngle * 100), true);
  view.setUint16(30, input.defaultAdvance, true);
  view.setUint32(32, ranges.length, true);
  view.setUint32(36, kerns.length, true);
  view.setBigUint64(40, BigInt(`0x${input.sourceSha256.slice(0, 16).padStart(16, '0')}`), true);

  let off = HEADER_BYTES;
  let poolIndex = 0;
  for (const r of ranges) {
    view.setUint32(off, r.start, true);
    view.setUint16(off + 4, r.length, true);
    view.setUint8(off + 6, r.mode === 'uniform' ? 0 : 1);
    view.setUint32(off + 8, r.mode === 'uniform' ? (r.advance ?? 0) : poolIndex, true);
    if (r.mode === 'explicit') poolIndex += r.advances?.length ?? 0;
    off += RANGE_BYTES;
  }
  for (const advance of pool) {
    view.setUint16(off, advance, true);
    off += 2;
  }
  for (const k of kerns) {
    view.setUint32(off, k.left, true);
    view.setUint32(off + 4, k.right, true);
    view.setInt16(off + 8, k.value, true);
    off += KERN_BYTES;
  }
  return bytes;
}

export function decodeFwm(bytes: Uint8Array, faceId: FaceId): FontFaceMetrics {
  // Length first, then magic: an 8-byte buffer is truncated, not mis-magicked.
  if (bytes.byteLength < HEADER_BYTES) throw new Error('fwm: truncated header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== FWM_MAGIC) throw new Error('fwm: bad magic');
  const rangeCount = view.getUint32(32, true);
  const kernCount = view.getUint32(36, true);
  const rangesOff = HEADER_BYTES;
  const poolOff = rangesOff + rangeCount * RANGE_BYTES;
  if (bytes.byteLength < poolOff) throw new Error('fwm: truncated ranges');

  // Pool length is implied: everything between the pool and the kern table.
  const kernOff = bytes.byteLength - kernCount * KERN_BYTES;
  if (kernOff < poolOff) throw new Error('fwm: truncated advance pool');

  const defaultAdvance = view.getUint16(30, true);
  const flags = view.getUint16(6, true);

  const findRange = (cp: number): number => {
    let lo = 0;
    let hi = rangeCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const off = rangesOff + mid * RANGE_BYTES;
      const start = view.getUint32(off, true);
      const length = view.getUint16(off + 4, true);
      if (cp < start) hi = mid - 1;
      else if (cp >= start + length) lo = mid + 1;
      else return off;
    }
    return -1;
  };

  const advance = (cp: number): number => {
    const off = findRange(cp);
    if (off < 0) return defaultAdvance;
    const start = view.getUint32(off, true);
    const uniform = view.getUint8(off + 6) === 0;
    const value = view.getUint32(off + 8, true);
    return uniform ? value : view.getUint16(poolOff + (value + (cp - start)) * 2, true);
  };

  const kern = (left: number, right: number): number => {
    let lo = 0;
    let hi = kernCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const off = kernOff + mid * KERN_BYTES;
      const l = view.getUint32(off, true);
      const r = view.getUint32(off + 4, true);
      if (l < left || (l === left && r < right)) lo = mid + 1;
      else if (l > left || (l === left && r > right)) hi = mid - 1;
      else return view.getInt16(off + 8, true);
    }
    return 0;
  };

  return {
    faceId,
    unitsPerEm: view.getUint16(8, true),
    ascender: view.getInt16(10, true),
    descender: view.getInt16(12, true),
    lineGap: view.getInt16(14, true),
    capHeight: view.getInt16(16, true),
    xHeight: view.getInt16(18, true),
    underlinePosition: view.getInt16(20, true),
    underlineThickness: view.getInt16(22, true),
    strikeoutPosition: view.getInt16(24, true),
    strikeoutThickness: view.getInt16(26, true),
    italicAngle: view.getInt16(28, true) / 100,
    monospace: (flags & 1) !== 0,
    requiresShaping: (flags & 4) !== 0,
    covers: (cp) => findRange(cp) >= 0,
    advance,
    kern,
  };
}

// ─── §4.3 advance cache ──────────────────────────────────────────────────────

/**
 * Spec 02 §4.3's per-(faceId, sizeEmu) advance cache: EMU advances keyed by
 * code point. `get` is the only advance call site Task 18's paginator uses —
 * nothing on the measurement path calls `face.advance()` or `layoutAdvance()`
 * directly.
 */
export interface AdvanceTable {
  get(cp: number): number;
}

/** U+0000–U+007F: the range worth a flat typed array instead of a Map lookup. */
const ASCII_LIMIT = 0x80;

/** EMU advances are never negative, so -1 is a safe "not yet measured" sentinel. */
const UNMEASURED = -1;

const advanceTableCache = new Map<string, AdvanceTable>();

/**
 * Builds, on first use per `(faceId, sizeEmu)`, a 128-entry `Int32Array` of EMU
 * advances for U+0000–U+007F plus a `Map<number, number>` tail for everything
 * above, each entry filled lazily by `advanceOf` — so a cold layout (~180 000
 * code points measured for a `feature-120` screenplay, spec 02 §33) looks up an
 * already-seen code point in O(1) instead of re-running `decodeFwm`'s binary
 * search over the range table every time.
 *
 * `advanceOf` stands in for Task 18's `layoutAdvance(face, familyId, cp, sizeEmu)`
 * until that function exists; it is given just the code point because the
 * face/familyId/sizeEmu it needs are already closed over by the caller.
 * `familyId` is accepted (and folded into the cache key) now so this signature
 * does not change when Task 18 starts calling it directly.
 *
 * A subsequent call for the same `(faceId, sizeEmu, familyId)` returns the
 * cached table — `advanceOf` is assumed pure for that key, matching
 * `layoutAdvance`'s contract — so callers must not pass a size-dependent
 * closure that changes between calls for the same key.
 */
export function advanceTableFor(
  face: FontFaceMetrics,
  sizeEmu: number,
  familyId: FontFamilyId,
  advanceOf: (cp: number) => number,
): AdvanceTable {
  const key = `${face.faceId}|${sizeEmu}|${familyId}`;
  const cached = advanceTableCache.get(key);
  if (cached) return cached;

  const ascii = new Int32Array(ASCII_LIMIT).fill(UNMEASURED);
  const tail = new Map<number, number>();

  const table: AdvanceTable = {
    get(cp: number): number {
      if (cp >= 0 && cp < ASCII_LIMIT) {
        const existing = ascii[cp];
        if (existing !== undefined && existing !== UNMEASURED) return existing;
        const value = advanceOf(cp);
        ascii[cp] = value;
        return value;
      }
      const existing = tail.get(cp);
      if (existing !== undefined) return existing;
      const value = advanceOf(cp);
      tail.set(cp, value);
      return value;
    },
  };
  advanceTableCache.set(key, table);
  return table;
}
