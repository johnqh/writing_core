import { describe, expect, it } from 'vitest';
import { roundHalfEven } from '../layout/round.js';
import { createFontRegistry } from './registry.js';
import { fallbackChain } from './fallback.js';

describe('fallback chains (spec 02 §3.3)', () => {
  const fonts = createFontRegistry();

  it('keeps Greek and Cyrillic on Liberation Mono under a Courier Prime primary', () => {
    const face = fonts.fallbackFor('courier-screenplay', 0x0410 /* А */, false, false, 'ru');
    expect(face.faceId).toMatch(/liberation-?mono/i);
    expect(face.monospace).toBe(true);
  });

  it('routes CJK by language, not by code point alone', () => {
    const ja = fonts.fallbackFor('courier-screenplay', 0x6f22 /* 漢 */, false, false, 'ja');
    const ko = fonts.fallbackFor('courier-screenplay', 0xd55c /* 한 */, false, false, 'ko');
    expect(ja.faceId).toMatch(/jp/i);
    expect(ko.faceId).toMatch(/kr/i);
  });

  it('falls back to symbols, then emoji, then tofu', () => {
    expect(fonts.fallbackFor('times', 0x2708, false, false, 'en').faceId).toMatch(/symbols|emoji/i);
    expect(fonts.fallbackFor('times', 0x1f600, false, false, 'en').faceId).toMatch(/emoji/i);
    // The tail of the chain is `tofuFace`, whose advance is 0.5 em for anything (§3.3) —
    // NOT the primary's `.notdef` advance, which §4.2 keeps for uncovered lookups.
    const tofu = fonts.fallbackFor('times', 0x10ffff, false, false, 'en');
    expect(tofu.advance(0x10ffff)).toBe(roundHalfEven(tofu.unitsPerEm / 2));
    expect(tofu.advance(0x4e00)).toBe(roundHalfEven(tofu.unitsPerEm / 2));
  });

  it('puts the primary first for characters it covers', () => {
    expect(fallbackChain('times', 'Latn', false, false, 'en')[0]).toMatch(/liberation-?serif/i);
  });
});
