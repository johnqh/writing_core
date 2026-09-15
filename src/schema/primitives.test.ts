import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import { Bcp47, Emu, FontFamilyId, HexColor, I18nKey, Lines, StyleIdSchema, idSchema } from './primitives.js';
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
