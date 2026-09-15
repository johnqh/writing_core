import { describe, expect, it } from 'vitest';
import { RevisionColorSeed, StyleDef, TagCategorySeed } from '../schema/template.js';
import { inchesToEmu } from '../units.js';
import { LOCALE_SCRIPT_WORDS } from './script-words.js';
import {
  DEFAULT_PAGE_NUMBERING, defaultPagination, disabledFooter, ENGLISH_CONTINUEDS, letterPage, NOTE_TYPE_SEEDS,
  REVISION_COLOR_SEEDS, ROOT_STYLE_DEFAULTS, sceneHeadingNumbering, SCREENPLAY_MACRO_SEEDS, standardHeader,
  TAG_CATEGORY_SEEDS, TITLE_PAGE_STYLES, TRAIT_DEF_SEEDS, standardTitlePageSeeds,
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
  it('derives the credit seed from the single source of script words (registry R30)', () => {
    const credit = standardTitlePageSeeds().find((s) => s.titleField === 'credit');
    expect(credit?.text).toBe(LOCALE_SCRIPT_WORDS.en.credit);
    expect(credit?.text).toBe('Written by');
  });
  it('has 6 note types with stable keys and no markers', () => {
    expect(NOTE_TYPE_SEEDS).toHaveLength(6);
    expect(NOTE_TYPE_SEEDS.map((n) => n.key)).toEqual(['general', 'research', 'polish', 'continuity', 'question', 'production']);
    expect(NOTE_TYPE_SEEDS[0]).toMatchObject({ nameKey: 'template.noteType.general', color: '#FFD700', marker: '' });
    expect(NOTE_TYPE_SEEDS.every((n) => n.marker === '')).toBe(true);
  });
  it('has 7 trait defs: a Lead/Supporting/Featured/Background role choice plus 6 free-text traits', () => {
    expect(TRAIT_DEF_SEEDS).toHaveLength(7);
    expect(TRAIT_DEF_SEEDS[0]).toMatchObject({
      key: 'role', nameKey: 'template.trait.role', type: 'choice', options: ['Lead', 'Supporting', 'Featured', 'Background'],
    });
    expect(TRAIT_DEF_SEEDS.slice(1).map((t) => t.key)).toEqual(['gender', 'age', 'ethnicity', 'orientation', 'disability', 'occupation']);
    expect(TRAIT_DEF_SEEDS.slice(1).every((t) => t.type === 'text' && t.options.length === 0)).toBe(true);
  });
  it('English continued texts mirror LOCALE_SCRIPT_WORDS.en verbatim', () => {
    expect(ENGLISH_CONTINUEDS).toEqual({
      more: "(MORE)", cont: "(CONT'D)", joiner: ' ', sceneBottom: '(CONTINUED)', sceneTop: 'CONTINUED:',
      sceneTopNumbered: 'CONTINUED: (#)', omitted: 'OMITTED', styleId: null,
    });
    expect(ENGLISH_CONTINUEDS.more).toBe(LOCALE_SCRIPT_WORDS.en.more);
    expect(ENGLISH_CONTINUEDS.omitted).toBe(LOCALE_SCRIPT_WORDS.en.omitted);
  });
  it('default pagination matches spec 01 §4.3 dialogue-break and widow/orphan rules', () => {
    const p = defaultPagination();
    expect(p.dialogue).toEqual({ allowBreaks: true, minLinesBeforeBreak: 2, minLinesAfterBreak: 2, moreAtBottom: true, contAtTop: true });
    expect(p.widowOrphan).toEqual({ minLinesAtPageBottom: 2, minLinesAtPageTop: 2 });
    expect(p.keepWithNextMinLines).toBe(2);
    expect(p.headingsNeverOrphaned).toBe(true);
    expect(p.dualDialogue).toMatchObject({ enabled: true, columnGap: inchesToEmu(0.25), stackWhileEditing: false });
    expect(p.runningTime).toEqual({ method: 'pages', wordsPerMinute: 150, soundCueSeconds: 3 });
    expect(p.panels).toEqual({ autoHeadingText: true });
  });
  it('default pagination accepts overrides', () => {
    expect(defaultPagination({ breakOnSentences: false }).breakOnSentences).toBe(false);
    expect(defaultPagination().breakOnSentences).toBe(true);
  });
  it('scene heading numbering carries the spec offsets for the requested position', () => {
    expect(sceneHeadingNumbering('both')).toMatchObject({
      enabled: false, counter: 'own', start: 1, format: '{n}', position: 'both',
      leftOffset: 685_800, rightOffset: 6_748_272, hideRightOnOverlap: true, suffixMode: '1AB', skipIO: false,
    });
    expect(sceneHeadingNumbering('right').position).toBe('right');
  });
  it('default page numbering formats with a trailing period and 1AB scene suffixes', () => {
    expect(DEFAULT_PAGE_NUMBERING).toEqual({
      start: 1, format: '{n}.', suffixMode: '1AB', skipIO: false, combineDeletedRanges: true, titlePage: 'none',
    });
  });
  it('letter page is 8.5x11in portrait with half-inch header/footer offsets and the given margins', () => {
    const margins = { top: inchesToEmu(1), bottom: inchesToEmu(1), left: inchesToEmu(1.5), right: inchesToEmu(1) };
    const page = letterPage(margins);
    expect(page).toMatchObject({
      paper: 'letter', width: inchesToEmu(8.5), height: inchesToEmu(11), orientation: 'portrait', margins,
      headerOffset: inchesToEmu(0.5), footerOffset: inchesToEmu(0.5), linesPerInch: 6, elementSpacing: 1,
      lineSpacingPreset: 'normal', bindingGutter: 0,
    });
  });
  it('standard header shows the page number on the right, hidden on title/first page', () => {
    expect(standardHeader()).toMatchObject({ enabled: true, left: '', center: '', right: '{page}.', showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 });
    expect(standardHeader('custom').right).toBe('custom');
  });
  it('disabled footer is fully blank and off', () => {
    expect(disabledFooter()).toEqual({ enabled: false, left: '', center: '', right: '', styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 });
  });
});
