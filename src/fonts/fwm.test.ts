import { describe, expect, it } from 'vitest';
import { emuFromFontUnits, sizeEmuFromPoints } from '../layout/round.js';
import { FWM_FORMAT_VERSION, FWM_MAGIC, advanceTableFor, decodeFwm, encodeFwm } from './fwm.js';
import { bytes as carlitoRegular } from './generated/carlito-regular.fwm.js';
import { bytes as courierPrimeRegular } from './generated/courier-prime-regular.fwm.js';
import { bytes as notoSansCjkJpRegular } from './generated/noto-sans-cjk-jp-regular.fwm.js';
import { FACES } from './generated/registry.generated.js';

const FACE_ID = 'courier-prime:regular';
const courierLike = {
  faceId: FACE_ID,
  unitsPerEm: 2048,
  ascender: 1705, descender: -615, lineGap: 0,
  capHeight: 1365, xHeight: 1024,
  underlinePosition: -155, underlineThickness: 90,
  strikeoutPosition: 512, strikeoutThickness: 90,
  italicAngle: 0,
  monospace: true, requiresShaping: false,
  defaultAdvance: 1228,        // Courier Prime's .notdef advance (spec 02 §4.2)
  sourceSha256: 'deadbeefcafef00d',
  // A uniform range (ASCII) plus an explicit range (two accented letters).
  ranges: [
    { start: 0x20, length: 0x5f, mode: 'uniform' as const, advance: 1228 },
    { start: 0xe0, length: 2, mode: 'explicit' as const, advances: [1228, 1228] },
  ],
  kernPairs: [] as { left: number; right: number; value: number }[],
};

describe('fwm round trip', () => {
  it('starts with the magic and format version', () => {
    const bytes = encodeFwm(courierLike);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(FWM_MAGIC);
    expect(view.getUint16(4, true)).toBe(FWM_FORMAT_VERSION);
  });

  it('round-trips head metrics', () => {
    const face = decodeFwm(encodeFwm(courierLike), FACE_ID);
    expect(face.faceId).toBe('courier-prime:regular');
    expect(face.unitsPerEm).toBe(2048);
    expect(face.ascender).toBe(1705);
    expect(face.descender).toBe(-615);
    expect(face.capHeight).toBe(1365);
    expect(face.monospace).toBe(true);
    expect(face.requiresShaping).toBe(false);
  });

  it('answers advances from uniform and explicit ranges', () => {
    const face = decodeFwm(encodeFwm(courierLike), FACE_ID);
    expect(face.advance(0x41)).toBe(1228);   // 'A', uniform range
    expect(face.advance(0xe0)).toBe(1228);   // 'à', explicit range
    expect(face.covers(0x41)).toBe(true);
    expect(face.covers(0x4e00)).toBe(false); // uncovered ideograph
    expect(face.advance(0x4e00)).toBe(1228); // .notdef advance, NOT a 0.5 em tofu box (§3.3 is Task 4's)
  });

  it('reads distinct per-code-point advances out of the explicit-range pool', () => {
    // courierLike's own explicit range (0xe0, 0xe1) happens to carry the same value as
    // defaultAdvance (1228), so a decoder that collapsed every explicit lookup to
    // `defaultAdvance` would still pass the assertions above. This fixture uses two
    // different values so that regression is actually observable.
    const face = decodeFwm(
      encodeFwm({
        ...courierLike,
        defaultAdvance: 999,
        ranges: [
          { start: 0x20, length: 0x5f, mode: 'uniform' as const, advance: 1228 },
          { start: 0xe0, length: 2, mode: 'explicit' as const, advances: [1300, 1350] },
        ],
      }),
      FACE_ID,
    );
    expect(face.advance(0xe0)).toBe(1300);
    expect(face.advance(0xe1)).toBe(1350);
  });

  it('answers kern pairs and 0 for unknown pairs', () => {
    const face = decodeFwm(
      encodeFwm({ ...courierLike, monospace: false, kernPairs: [{ left: 0x41, right: 0x56, value: -80 }] }),
      FACE_ID,
    );
    expect(face.kern(0x41, 0x56)).toBe(-80);
    expect(face.kern(0x41, 0x41)).toBe(0);
  });

  it('rejects a short buffer as truncated and a same-length buffer as bad magic', () => {
    // The length check runs first, so an 8-byte buffer is "truncated", never "bad magic".
    expect(() => decodeFwm(new Uint8Array(8), FACE_ID)).toThrow(/truncated/i);
    const wrongMagic = encodeFwm(courierLike);
    new DataView(wrongMagic.buffer).setUint32(0, 0xdeadbeef, true);
    expect(() => decodeFwm(wrongMagic, FACE_ID)).toThrow(/magic/i);
    const good = encodeFwm(courierLike);
    expect(() => decodeFwm(good.slice(0, 20), FACE_ID)).toThrow(/truncated/i);
  });

  it('rejects a buffer truncated mid-range-table and one truncated mid-advance-pool', () => {
    // A full header (48 bytes) but not enough bytes for the 2-entry range table (24 bytes,
    // ending at offset 72): distinct from the header-truncation case above, and otherwise
    // unreachable by any assertion in this file.
    const good = encodeFwm(courierLike);
    expect(() => decodeFwm(good.slice(0, 60), FACE_ID)).toThrow(/truncated ranges/i);

    // Full range table (ends at 72) plus a full kern pair (12 bytes, needs 12 bytes at the
    // tail) but the 4-byte explicit-advance pool between them is cut to 2 bytes: byteLength
    // 74 clears the range-table check (>= 72) but leaves kernOff (74 - 12 = 62) < poolOff (72).
    // Asserting the exact message (not just /truncated/i) is what makes this distinguishable
    // from the range-table check above — both guards match a loose "truncated" regex.
    const withKern = encodeFwm({ ...courierLike, monospace: false, kernPairs: [{ left: 0x41, right: 0x56, value: -80 }] });
    expect(withKern.byteLength).toBe(88); // header 48 + ranges 24 + pool 4 + kern 12
    expect(() => decodeFwm(withKern.slice(0, 74), FACE_ID)).toThrow(/truncated advance pool/i);
  });
});

describe('advanceTableFor', () => {
  it('answers the same value as the uncached path for 1000 sampled code points', () => {
    const face = decodeFwm(encodeFwm(courierLike), FACE_ID);
    const sizeEmu = 999_001; // a sizeEmu unused by any other test in this file, to avoid cache collisions
    const table = advanceTableFor(face, sizeEmu, 'courier-screenplay', (cp) => face.advance(cp));
    for (let cp = 0; cp < 1000; cp += 1) {
      expect(table.get(cp)).toBe(face.advance(cp));
    }
  });

  it('consults the callback at most once per distinct code point', () => {
    const face = decodeFwm(encodeFwm(courierLike), FACE_ID);
    const sizeEmu = 999_002;
    const calls = new Map<number, number>();
    const table = advanceTableFor(face, sizeEmu, 'courier-screenplay', (cp) => {
      calls.set(cp, (calls.get(cp) ?? 0) + 1);
      return face.advance(cp);
    });
    const sample = [0x20, 0x41, 0x100, 0x4e00, 0x41, 0x20, 0x4e00, 0x7f, 0x80];
    for (const cp of sample) table.get(cp);
    for (const cp of sample) table.get(cp); // repeat — every hit must come from cache
    for (const [, count] of calls) expect(count).toBe(1);
  });

  it('reuses the same table instance for a repeated (faceId, sizeEmu) pair', () => {
    const face = decodeFwm(encodeFwm(courierLike), FACE_ID);
    const sizeEmu = 999_003;
    const first = advanceTableFor(face, sizeEmu, 'courier-screenplay', () => 42);
    // A second call for the same (faceId, sizeEmu) must return the cached instance, not
    // a fresh one built from this (deliberately different) callback.
    const second = advanceTableFor(face, sizeEmu, 'courier-screenplay', () => -1);
    expect(second).toBe(first);
    expect(second.get(0x41)).toBe(42);
  });
});

describe('generated Courier Prime metrics', () => {
  const face = decodeFwm(courierPrimeRegular, 'courier-prime:regular');
  it('is monospaced at 1228/2048 em', () => {
    expect(face.unitsPerEm).toBe(2048);
    expect(face.monospace).toBe(true);
    for (const ch of 'AWil .,') expect(face.advance(ch.codePointAt(0)!)).toBe(1228);
  });
  it('converts its own advance to 91 380 EMU at 12 pt (spec 02 §2)', () => {
    // The FONT's advance. What the paginator actually measures is the 10 cpi
    // override of §3.2 — 91 440 EMU, asserted in Task 18's layoutAdvance tests.
    expect(emuFromFontUnits(face.advance(0x41), sizeEmuFromPoints(12), face.unitsPerEm)).toBe(91_380);
  });
  it('registers every face under a `family:style` id with its source SHA', () => {
    const ids = FACES.map((f) => f.faceId);
    expect(ids).toContain('courier-prime:regular');
    expect(ids).toContain('courier-prime:bolditalic');
    for (const f of FACES) {
      expect(f.faceId).toMatch(/^[a-z0-9-]+:(regular|bold|italic|bolditalic)$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.classification).toMatch(/^(mono|serif|sans)$/);
    }
  });
});

describe('bundled kerning (spec 02 §4.2, fix round 1 rulings C and D)', () => {
  // Every value below was independently verified against `fontkit`'s own shaped advance for
  // the same font (`font.layout('AV').positions[0].xAdvance - font.glyphForCodePoint(A's cp)
  // .advanceWidth`, the reviewer's own method) — these are not invented numbers, they are
  // what the vendored binaries' GPOS tables actually say.

  it("keeps Carlito's everyday kerning pairs (AV, Wa, VA) — ruling C: the cap now budgets against actual gzipped size, not raw bytes, so common pairs are no longer the first to be dropped", () => {
    const face = decodeFwm(carlitoRegular, 'carlito:regular');
    expect(face.kern(0x41, 0x56), 'AV').toBe(-89);
    expect(face.kern(0x57, 0x61), 'Wa').toBe(-71);
    expect(face.kern(0x56, 0x41), 'VA').toBe(-96);
  });

  it('ships restricted-range Latin kerning on a CJK face too — ruling D: §4.2 keys kerning on monospace vs proportional, not on script, and Noto Sans CJK is proportional', () => {
    const face = decodeFwm(notoSansCjkJpRegular, 'noto-sans-cjk-jp:regular');
    expect(face.kern(0x41, 0x56), 'AV').toBe(-15);
    expect(face.kern(0x57, 0x61), 'Wa').toBe(-18);
    expect(face.kern(0x54, 0x6f), 'To').toBe(-74);
  });
});
