import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import { Bcp47, Emu, EmuSigned, FontFamilyId, HexColor, I18nKey, JsonValue, Lines, StyleIdSchema, Timestamp, TokenString, idSchema } from './primitives.js';
import { ENTITY_KINDS, LINE_SPACING_FACTORS, STYLE_ROLES, TITLE_FIELDS } from './vocab.js';

describe('primitives', () => {
  it('validates EMU as non-negative safe integers', () => {
    expect(Emu.safeParse(7_772_400).success).toBe(true);
    expect(Emu.safeParse(1.5).success).toBe(false);
    expect(Emu.safeParse(-1).success).toBe(false);
  });
  it('validates lines, colours, keys and languages', () => {
    expect(Lines.safeParse(0.25).success).toBe(true);
    expect(Lines.safeParse(0.3).success).toBe(false);
    expect(HexColor.safeParse('#00FF00').success).toBe(true);
    expect(HexColor.safeParse('#00ff00').success).toBe(false);
    expect(I18nKey.safeParse('template.style.sceneHeading').success).toBe(true);
    expect(Bcp47.safeParse('zh-Hans').success).toBe(true);
    expect(Bcp47.safeParse('english').success).toBe(false);
  });
  it('validates ids and font families', () => {
    const src = createSeededIdSource(3);
    expect(idSchema('el').safeParse(newId('el', src)).success).toBe(true);
    expect(idSchema('el').safeParse(newId('ent', src)).success).toBe(false);
    expect(StyleIdSchema.safeParse('st_scene_heading').success).toBe(true);
    expect(FontFamilyId.safeParse('courier-screenplay').success).toBe(true);
    expect(FontFamilyId.safeParse(`custom:${newId('asset', src)}`).success).toBe(true);
    expect(FontFamilyId.safeParse('comic-sans').success).toBe(false);
  });
});

describe('vocabularies', () => {
  it('match spec 01 counts', () => {
    expect(STYLE_ROLES).toHaveLength(27);
    expect(ENTITY_KINDS).toHaveLength(26);
    expect(TITLE_FIELDS).toHaveLength(15);
    expect(LINE_SPACING_FACTORS).toEqual({ veryTight: 0.94, tight: 0.97, normal: 1, loose: 1.03 });
  });
});

// The suite above only ever asserted the accepting side of several primitives; a schema that
// accepts everything passes those just as well as the real one.
describe('primitives reject what they are supposed to reject', () => {
  const src = createSeededIdSource(9);

  it('StyleIdSchema takes built-in slots and style ULIDs, nothing else', () => {
    expect(StyleIdSchema.safeParse('st_scene_heading').success).toBe(true);
    expect(StyleIdSchema.safeParse(newId('st', src)).success).toBe(true);
    for (const bad of ['scene_heading', 'st_', 'st_Scene_Heading', 'st_scene heading', 'el_01ARYZ6S410000000000000000', '', 42, null, undefined, {}]) {
      expect(StyleIdSchema.safeParse(bad).success, `StyleIdSchema accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('EmuSigned takes negative integers but not fractions or non-numbers', () => {
    expect(EmuSigned.safeParse(-91_440).success).toBe(true);
    expect(EmuSigned.safeParse(0).success).toBe(true);
    for (const bad of [-1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2, '0', null]) {
      expect(EmuSigned.safeParse(bad).success, `EmuSigned accepted ${String(bad)}`).toBe(false);
    }
  });

  it('Timestamp is a non-negative integer of milliseconds', () => {
    expect(Timestamp.safeParse(0).success).toBe(true);
    expect(Timestamp.safeParse(1_764_000_000_000).success).toBe(true);
    for (const bad of [-1, 1.5, Number.NaN, '1764000000000', null, new Date(0)]) {
      expect(Timestamp.safeParse(bad).success, `Timestamp accepted ${String(bad)}`).toBe(false);
    }
  });

  it('I18nKey is a dotted lowerCamel path with at least two segments', () => {
    expect(I18nKey.safeParse('writing.reason.notFound').success).toBe(true);
    expect(I18nKey.safeParse('template.style.normal_text-2').success).toBe(true);
    for (const bad of ['template', 'Template.style', '.style', 'template.', 'template..style', 'template.style ', '1template.style', 7]) {
      expect(I18nKey.safeParse(bad).success, `I18nKey accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('JsonValue accepts nested JSON and rejects anything that cannot round-trip through it', () => {
    expect(JsonValue.safeParse({ a: [1, 'two', null, { b: false }] }).success).toBe(true);
    expect(JsonValue.safeParse([]).success).toBe(true);
    for (const bad of [undefined, () => 0, Symbol('x'), new Map(), new Date(0), { a: undefined }, [undefined]]) {
      expect(JsonValue.safeParse(bad).success, `JsonValue accepted ${String(bad)}`).toBe(false);
    }
  });

  it('TokenString is bounded, and Emu rejects the unsafe end of the range', () => {
    expect(TokenString.safeParse('a'.repeat(1000)).success).toBe(true);
    expect(TokenString.safeParse('a'.repeat(1001)).success).toBe(false);
    expect(Emu.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(Emu.safeParse(Number.MAX_SAFE_INTEGER + 2).success).toBe(false);
  });

  it('idSchema rejects a prefix that is only a prefix of the right one', () => {
    expect(idSchema('el').safeParse('el_01ARYZ6S410000000000000000').success).toBe(true);
    for (const bad of ['el_01ARYZ6S41000000000000000', 'el_01ARYZ6S4100000000000000000', 'EL_01ARYZ6S410000000000000000', 'el01ARYZ6S410000000000000000', 'ele_01ARYZ6S410000000000000000', 'el_01ARYZ6S41000000000000000U']) {
      expect(idSchema('el').safeParse(bad).success, `idSchema('el') accepted ${bad}`).toBe(false);
    }
  });
});
