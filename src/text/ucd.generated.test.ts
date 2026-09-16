/**
 * Pinned-value sanity checks for the UCD property getters (spec 02 §6, task 6). The real
 * UAX #14 (line break)/#9 (bidi)/#29 word+sentence algorithms these feed are later tasks'
 * work; this file only proves each generated table + lookup wires up to the right raw
 * Unicode property value for a handful of well-known code points, independent of
 * `grapheme.test.ts`'s conformance suite (which only exercises Grapheme_Cluster_Break,
 * Extended_Pictographic and Indic_Conjunct_Break).
 */
import { describe, expect, it } from 'vitest';
import {
  UNICODE_VERSION,
  bidiClass, generalCategory, lineBreakClass, script, sentenceBreakProperty, wordBreakProperty,
} from './ucd.generated.js';

describe('UCD property getters (spec 02 §6)', () => {
  it('pins the Unicode version', () => {
    expect(UNICODE_VERSION).toBe('16.0.0');
  });

  it('lineBreakClass', () => {
    expect(lineBreakClass(0x41)).toBe('AL'); // LATIN CAPITAL LETTER A
    expect(lineBreakClass(0x20)).toBe('SP'); // SPACE
    expect(lineBreakClass(0x0a)).toBe('LF'); // LINE FEED
    expect(lineBreakClass(0x4e00)).toBe('ID'); // CJK UNIFIED IDEOGRAPH (Ideographic)
    expect(lineBreakClass(0x2c)).toBe('IS'); // COMMA (infix numeric separator)
  });

  it('bidiClass', () => {
    expect(bidiClass(0x41)).toBe('L'); // LATIN CAPITAL LETTER A
    expect(bidiClass(0x5d0)).toBe('R'); // HEBREW LETTER ALEF
    expect(bidiClass(0x627)).toBe('AL'); // ARABIC LETTER ALEF
    expect(bidiClass(0x31)).toBe('EN'); // DIGIT ONE
  });

  it('bidiClass returns the canonical short alias for @missing-default code points, not the long alias DerivedBidiClass.txt spells its defaults with (task 8 fix round 1)', () => {
    // U+0590 is unassigned (General_Category Cn) inside the Hebrew block's own narrower
    // @missing default (0590..05FF -> Right_To_Left) — before the fix this returned the
    // literal string 'Right_To_Left', a value `BidiClass` distinguishes from 'R' even
    // though they are the same abstract Bidi_Class value.
    expect(bidiClass(0x590)).toBe('R');
    // U+0378 is unassigned and outside every one of DerivedBidiClass.txt's 24 narrower
    // @missing ranges, so it falls all the way to the base `0000..10FFFF -> Left_To_Right`
    // default — before the fix this returned 'Left_To_Right', not 'L'.
    expect(bidiClass(0x378)).toBe('L');
  });

  it('script', () => {
    expect(script(0x41)).toBe('Latin');
    expect(script(0x5d0)).toBe('Hebrew');
    expect(script(0x627)).toBe('Arabic');
    expect(script(0x4e00)).toBe('Han');
    expect(script(0x3042)).toBe('Hiragana');
  });

  it('generalCategory', () => {
    expect(generalCategory(0x41)).toBe('Lu'); // uppercase letter
    expect(generalCategory(0x61)).toBe('Ll'); // lowercase letter
    expect(generalCategory(0x31)).toBe('Nd'); // decimal digit
    expect(generalCategory(0x20)).toBe('Zs'); // space separator
    expect(generalCategory(0x378)).toBe('Cn'); // unassigned
  });

  it('wordBreakProperty', () => {
    expect(wordBreakProperty(0x41)).toBe('ALetter');
    expect(wordBreakProperty(0x31)).toBe('Numeric');
    expect(wordBreakProperty(0x20)).toBe('WSegSpace'); // SPACE
  });

  it('sentenceBreakProperty', () => {
    expect(sentenceBreakProperty(0x2e)).toBe('ATerm'); // FULL STOP
    expect(sentenceBreakProperty(0x41)).toBe('Upper');
    expect(sentenceBreakProperty(0x61)).toBe('Lower');
  });
});
