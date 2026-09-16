import { describe, expect, it } from 'vitest';
import { LAYOUT_ENGINE_VERSION, emuFromFontUnits, roundHalfEven, sizeEmuFromPoints } from './round.js';

describe('roundHalfEven', () => {
  it('rounds halves to the even neighbour', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    // `Math.floor(-0.5) + 1` is +0, and `toBe` is `Object.is`, so `-0` would fail here.
    // Layout never distinguishes the two zeroes; assert the value, not the sign of zero.
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });
  it('rounds non-halves normally', () => {
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
    expect(roundHalfEven(-2.6)).toBe(-3);
  });
  it('passes integers through', () => {
    expect(roundHalfEven(7)).toBe(7);
  });
});

describe('emuFromFontUnits', () => {
  // This is the FONT-UNIT CONVERSION, not the laid-out width. Courier Prime's own
  // advance is 1228/2048 em = 91 380 EMU at 12 pt, but the paginator lays every
  // monospaced Courier family out at 10 cpi = 91 440 EMU (spec 02 §3.2, V-02-7);
  // that override lives in `layoutAdvance` (Task 18), which is where the
  // 60 × 91 440 = 5 486 400 EMU line-width assertion belongs.
  it('converts Courier Prime advances exactly (spec 02 §2)', () => {
    const size12 = sizeEmuFromPoints(12);
    expect(size12).toBe(152_400);
    expect(emuFromFontUnits(1228, size12, 2048)).toBe(91_380);
  });
  it('converts Liberation Mono advances (1229/2048 = 91 455 EMU)', () => {
    expect(emuFromFontUnits(1229, sizeEmuFromPoints(12), 2048)).toBe(91_455);
  });
  it('is exact for CJK full-width ideographs (1000/1000 em)', () => {
    expect(emuFromFontUnits(1000, sizeEmuFromPoints(12), 1000)).toBe(152_400);
  });
});

describe('LAYOUT_ENGINE_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(LAYOUT_ENGINE_VERSION)).toBe(true);
    expect(LAYOUT_ENGINE_VERSION).toBeGreaterThan(0);
  });
});
