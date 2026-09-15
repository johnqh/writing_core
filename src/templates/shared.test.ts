import { describe, expect, it } from 'vitest';
import { RevisionColorSeed, StyleDef, TagCategorySeed } from '../schema/template.js';
import {
  REVISION_COLOR_SEEDS, ROOT_STYLE_DEFAULTS, SCREENPLAY_MACRO_SEEDS, TAG_CATEGORY_SEEDS, TITLE_PAGE_STYLES,
  standardTitlePageSeeds,
} from './shared.js';

describe('shared seeds', () => {
  it('has the WGA revision cycle twice', () => {
    expect(REVISION_COLOR_SEEDS).toHaveLength(20);
    expect(REVISION_COLOR_SEEDS[1]).toMatchObject({ key: 'blue', color: '#0000FF', pageColor: '#C6EDFE', mark: '*' });
    expect(REVISION_COLOR_SEEDS[10]).toMatchObject({ key: 'doubleWhite', mark: '**' });
    for (const s of REVISION_COLOR_SEEDS) RevisionColorSeed.parse(s);
  });
  it('has 29 tag categories with Final Draft GUIDs and no storyline', () => {
    expect(TAG_CATEGORY_SEEDS).toHaveLength(29);
    expect(TAG_CATEGORY_SEEDS.find((c) => c.key === 'cast')).toMatchObject({ entityKind: 'character', fdxGuid: '01fc9642-84ff-4366-b37c-a3068dee57e8' });
    expect(TAG_CATEGORY_SEEDS.every((c) => c.fdxGuid !== null)).toBe(true);
    expect(TAG_CATEGORY_SEEDS.some((c) => c.key === 'storyline')).toBe(false);
    for (const c of TAG_CATEGORY_SEEDS) TagCategorySeed.parse(c);
  });
  it('has 20 default macros with the spec 09 chords', () => {
    expect(SCREENPLAY_MACRO_SEEDS).toHaveLength(20);
    expect(SCREENPLAY_MACRO_SEEDS[3]).toMatchObject({ shortcut: 'Mod+Alt+4', text: ' - DAY', styleId: null, nextStyleId: 'st_action' });
    expect(SCREENPLAY_MACRO_SEEDS[19]).toMatchObject({ shortcut: 'Mod+Alt+F10', text: 'FLASHBACK:' });
  });
  it('title page styles parse and seeds bind fields', () => {
    for (const s of TITLE_PAGE_STYLES) StyleDef.parse(s);
    expect(TITLE_PAGE_STYLES[0]).toMatchObject({ ...ROOT_STYLE_DEFAULTS, id: 'st_title_center', basedOn: null, align: 'center' });
    expect(standardTitlePageSeeds().map((s) => s.titleField)).toEqual(['title', 'credit', 'author', 'copyright', 'draftDate', 'contact']);
  });
});
