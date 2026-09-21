import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { inchesToEmu } from '../units.js';
import { itemize } from './itemize.js';
import { isCourierFamily, layoutAdvance, measureItem } from './measure.js';
import { emuFromFontUnits, sizeEmuFromPoints } from './round.js';

const fonts = createFontRegistry();
const size12 = sizeEmuFromPoints(12);
const style = (family: string) =>
  ({
    font: { family, size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
    direction: 'auto',
  }) as never;

describe('layoutAdvance (spec 02 §3.2, V-02-7)', () => {
  it('lays every monospaced Courier family out at exactly 10 cpi', () => {
    for (const family of ['courier-screenplay', 'courier-new'] as const) {
      const { face } = fonts.face(family, false, false);
      expect(layoutAdvance(face, family, 0x41, size12)).toBe(91_440);
      expect(layoutAdvance(face, family, 0x41, size12) * 60).toBe(inchesToEmu(6));
    }
  });

  it('keeps the fonts own advances on the metrics path', () => {
    expect(fonts.face('courier-screenplay', false, false).face.advance(0x41)).toBe(1228);
    expect(fonts.face('courier-new', false, false).face.advance(0x41)).toBe(1229);
  });

  it('leaves proportional families on their true metrics and scales with size', () => {
    const { face } = fonts.face('times', false, false);
    expect(layoutAdvance(face, 'times', 0x41, size12)).toBe(emuFromFontUnits(face.advance(0x41), size12, face.unitsPerEm));
    const cs = fonts.face('courier-screenplay', false, false).face;
    expect(layoutAdvance(cs, 'courier-screenplay', 0x41, sizeEmuFromPoints(10))).toBe(76_200);
  });

  it('knows the Courier families', () => {
    expect(isCourierFamily('courier-new')).toBe(true);
    expect(isCourierFamily('times')).toBe(false);
  });
});

describe('measureItem', () => {
  it('measures 60 Courier characters as 6.0 in, and accumulates across run boundaries', () => {
    const text = 'A'.repeat(60);
    const [item] = itemize(text, [], style('courier-new'), fonts, 'en');
    expect(measureItem(item!, fonts, null).width).toBe(inchesToEmu(6));
    const whole = itemize('ABCDEF', [], style('courier-screenplay'), fonts, 'en');
    const a = itemize('ABC', [], style('courier-screenplay'), fonts, 'en');
    const b = itemize('DEF', [], style('courier-screenplay'), fonts, 'en');
    expect(measureItem(whole[0]!, fonts, null).width).toBe(measureItem(a[0]!, fonts, null).width + measureItem(b[0]!, fonts, null).width);
  });

  it('sums proportional advances with kerning', () => {
    const [item] = itemize('AV', [], style('times'), fonts, 'en');
    const m = measureItem(item!, fonts, null);
    const { face } = fonts.face('times', false, false);
    const expected =
      emuFromFontUnits(face.advance(0x41), size12, face.unitsPerEm) +
      emuFromFontUnits(face.advance(0x56), size12, face.unitsPerEm) +
      emuFromFontUnits(face.kern(0x41, 0x56), size12, face.unitsPerEm);
    expect(m.width).toBe(expected);
  });

  it('falls back to summation with an approximateShaping diagnostic for tier 2 without a shaper', () => {
    const [item] = itemize('العربية', [], style('courier-screenplay'), fonts, 'ar');
    const m = measureItem(item!, fonts, null);
    expect(m.approximateShaping).toBe(true);
    expect(m.diagnostics[0]?.code).toBe('approximateShaping');
    expect(m.width).toBeGreaterThan(0);
  });
});
