import { type StyleId, builtinStyleId } from '../ids/ids.js';
import { generatePositions } from '../model/positions.js';
import type {
  ContinuedTexts, ElementSeed, HeaderFooterSpec, MacroSeed, NoteTypeSeed, NumberingSpec, PageNumberingRule,
  PageSpec, PaginationRules, RevisionColorSeed, StyleDef, TagCategorySeed, TraitDefSeed,
} from '../schema/template.js';
import type { EntityKind } from '../schema/vocab.js';
import { inchesToEmu } from '../units.js';
import { LOCALE_SCRIPT_WORDS } from './script-words.js';

const S = builtinStyleId;

/** Spec 01 §4.2 root style "Normal Text": every field defined. */
export const ROOT_STYLE_DEFAULTS = {
  font: { family: 'courier-screenplay', size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
  allCaps: false, align: 'left', indentLeft: 0, indentRight: 0, indentFirstLine: 0, spaceBefore: 0, lineSpacing: 1,
  column: 0, keepWithNext: false, keepTogether: false, splitRule: 'lines', pageBreakBefore: false, actBreak: false,
  paginateAs: null, hiddenInScript: false, printable: true, outlineLevel: 0,
  flow: { onEnter: null, onEnterEmpty: 'picker', onTabEmpty: null, onTabText: null, onShiftTabEmpty: null },
  numbering: null, prefix: '', suffix: '', smartTypeList: null, dualDialogue: false,
} as const satisfies Omit<StyleDef, 'id' | 'name' | 'nameKey' | 'role' | 'basedOn' | 'shortcut'>;

const REV: [key: string, color: string, page: string][] = [
  ['white', '#FFFFFF', '#FFFFFF'], ['blue', '#0000FF', '#C6EDFE'], ['pink', '#FF00FF', '#FBD3E9'],
  ['yellow', '#A0A000', '#FFF7B0'], ['green', '#008000', '#CDEFC6'], ['goldenrod', '#CC7F32', '#F2D08C'],
  ['buff', '#8E6B23', '#F0DC82'], ['salmon', '#A74242', '#FAB8A0'], ['cherry', '#D5236B', '#F5A5C0'],
  ['tan', '#DB9370', '#E6CBA8'],
];

export const REVISION_COLOR_SEEDS: readonly RevisionColorSeed[] = [
  ...REV.map(([key, color, pageColor], i) => ({ key, nameKey: `template.revision.${key}`, color, pageColor, mark: i === 0 ? '' : '*' })),
  ...REV.map(([key, color, pageColor]) => {
    const k = `double${key[0]!.toUpperCase()}${key.slice(1)}`;
    return { key: k, nameKey: `template.revision.${k}`, color, pageColor, mark: '**' };
  }),
];

const TAGS: [key: string, color: string, kind: EntityKind, fdxGuid: string][] = [
  ['cast', '#0000FF', 'character', '01fc9642-84ff-4366-b37c-a3068dee57e8'],
  ['backgroundActors', '#00BFFF', 'backgroundActor', '028a4e2b-b507-4d09-88ab-90e3edae9071'],
  ['stunts', '#FFA500', 'stunt', '0377dbe6-77a3-41af-bda8-86eb2468fdbf'],
  ['vehicles', '#8B0000', 'vehicle', '04721a56-f54b-49c8-80ad-d53887d6b851'],
  ['props', '#FF0000', 'prop', '05c556eb-6bc1-4a3a-b09f-f8b5ba1b6afa'],
  ['camera', '#CCFF00', 'camera', '47b02ff1-5161-4137-b736-f36eebba7643'],
  ['specialEffects', '#1E90FF', 'specialEffect', '069e18b8-2109-4f3d-94e7-d802027a60a8'],
  ['wardrobe', '#800080', 'wardrobe', '0726fa85-1e65-4ab8-87de-bf21d09b01f0'],
  ['makeupHair', '#9370DB', 'makeupHair', '08ae1eef-32ce-415f-9a9b-0982d2453ec4'],
  ['animals', '#CD853F', 'animal', '09cb0d1c-ce01-4f22-bb64-b5f2e6c491c6'],
  ['animalHandler', '#8B4513', 'animalHandler', '0ae40617-cc7c-48e6-ae2b-5aaecc09986f'],
  ['music', '#20B2AA', 'music', '0b0b44c9-aa4b-4c40-88b1-d94472ad7a26'],
  ['sound', '#008080', 'sound', '0ce7d308-096d-4603-8fe8-349f72cd89ff'],
  ['setDressing', '#BA55D3', 'setDressing', '0debb71b-5743-4c53-80cc-e17e841ce645'],
  ['greenery', '#008000', 'greenery', '0e7a8fc5-5441-4bad-a9bf-5ddd3fe51c69'],
  ['specialEquipment', '#BDB76B', 'specialEquipment', '0ff5cda4-4d43-4cfe-940f-91380c46fdad'],
  ['security', '#DAA520', 'security', '109d0eaa-0334-4823-ac0c-b44d3f209dc4'],
  ['additionalLabor', '#B8860B', 'additionalLabor', '1179a4b1-70ee-4011-b4a2-809a0af09e92'],
  ['visualEffects', '#32CD32', 'visualEffect', '12ab0932-e3b9-4b4a-bcd0-3da1b4e61d5e'],
  ['mechanicalEffects', '#B22222', 'mechanicalEffect', '135cc9d1-c4d5-4d00-83d9-571f584ea9cd'],
  ['miscellaneous', '#708090', 'misc', 'ce04f547-f7ee-40c9-ab66-d95a0c98034e'],
  ['notes', '#FFD700', 'misc', '15b6f4fd-4e74-4ad8-9971-b239d88c2997'],
  ['artDepartment', '#C71585', 'artDepartment', 'c86eae40-3b01-41c3-a7de-6859e6ec971d'],
  ['scriptDay', '#4682B4', 'scriptDay', '63c140da-ef2b-491a-b416-b46f461abb89'],
  ['unit', '#6A5ACD', 'unit', '849f1ebf-5507-4f33-bff6-3a5b4d73be14'],
  ['sequence', '#2E8B57', 'sequence', '70877d87-30ef-45b6-be46-c6fa94b83a71'],
  ['location', '#A0522D', 'location', 'c5e89e4d-f83e-4c28-950c-92a63f1b5f26'],
  ['comments', '#696969', 'misc', '216f33fd-fc42-4269-be01-b05b18f815a0'],
  ['synopsis', '#556B2F', 'misc', '8e5e75c2-713b-47df-a75f-f12648b98ded'],
];

/** OSF UUIDs are null: the extracted Fade In templates carry no category UUIDs (verified 2026-09-15). */
export const TAG_CATEGORY_SEEDS: readonly TagCategorySeed[] = TAGS.map(([key, color, entityKind, fdxGuid]) => ({
  key, nameKey: `template.tagCategory.${key}`, color, entityKind, fdxGuid, osfUuid: null,
  textStyle: { bold: true, underline: false, highlight: false }, visible: true,
}));

export const NOTE_TYPE_SEEDS: readonly NoteTypeSeed[] = [
  ['general', '#FFD700'], ['research', '#1E90FF'], ['polish', '#32CD32'],
  ['continuity', '#FF8C00'], ['question', '#9370DB'], ['production', '#B22222'],
].map(([key, color]) => ({ key: key!, nameKey: `template.noteType.${key}`, color: color!, marker: '' }));

export const TRAIT_DEF_SEEDS: readonly TraitDefSeed[] = [
  { key: 'role', nameKey: 'template.trait.role', type: 'choice', options: ['Lead', 'Supporting', 'Featured', 'Background'] },
  ...['gender', 'age', 'ethnicity', 'orientation', 'disability', 'occupation'].map((key) => ({
    key, nameKey: `template.trait.${key}`, type: 'text' as const, options: [],
  })),
];

const MACROS: [shortcut: string, text: string, style: StyleId | null, next: StyleId | null][] = [
  ['Mod+Alt+1', 'INT. ', S('scene_heading'), null],
  ['Mod+Alt+2', 'EXT. ', S('scene_heading'), null],
  ['Mod+Alt+3', 'INT./EXT. ', S('scene_heading'), null],
  ['Mod+Alt+4', ' - DAY', null, S('action')],
  ['Mod+Alt+5', ' - NIGHT', null, S('action')],
  ['Mod+Alt+6', ' - CONTINUOUS', null, S('action')],
  ['Mod+Alt+7', ' - LATER', null, S('action')],
  ['Mod+Alt+8', ' - MOMENTS LATER', null, S('action')],
  ['Mod+Alt+9', 'CUT TO:', S('transition'), S('scene_heading')],
  ['Mod+Alt+0', 'DISSOLVE TO:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F1', 'FADE IN:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F2', 'FADE OUT.', S('transition'), null],
  ['Mod+Alt+F3', 'SMASH CUT TO:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F4', 'MATCH CUT TO:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F5', 'BACK TO:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F6', 'INTERCUT WITH:', S('transition'), S('scene_heading')],
  ['Mod+Alt+F7', ' (V.O.)', null, S('dialogue')],
  ['Mod+Alt+F8', ' (O.S.)', null, S('dialogue')],
  ['Mod+Alt+F9', 'SUPER: ', S('action'), S('action')],
  ['Mod+Alt+F10', 'FLASHBACK:', S('action'), S('scene_heading')],
];
const MACRO_POS = generatePositions(MACROS.length, null, null, null);

/** Spec 09 Appendix A.4; screenplay, television and vertical drama templates only. */
export const SCREENPLAY_MACRO_SEEDS: readonly MacroSeed[] = MACROS.map(([shortcut, text, styleId, nextStyleId], i) => ({
  pos: MACRO_POS[i]!, name: text.trim(), text, styleId, nextStyleId, shortcut, alias: null,
}));

const titleStyle = (slug: string, name: string, overrides: Partial<StyleDef>): StyleDef => ({
  id: S(slug), name, nameKey: `template.style.${slug.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`,
  role: 'titleText', basedOn: S('title_center'), shortcut: null, font: {}, ...overrides,
});

/**
 * Title page styles. `st_title` (underlined, caps) is added beside spec 01 §4.2's three
 * alignment styles because ElementSeed carries no inline marks.
 */
export const TITLE_PAGE_STYLES: readonly StyleDef[] = [
  { ...ROOT_STYLE_DEFAULTS, id: S('title_center'), name: 'Title Page Centered', nameKey: 'template.style.titleCenter', role: 'titleText', basedOn: null, shortcut: null, align: 'center' },
  titleStyle('title_left', 'Title Page Left', { align: 'left' }),
  titleStyle('title_right', 'Title Page Right', { align: 'right' }),
  titleStyle('title', 'Title', { allCaps: true, font: { underline: 'single' } }),
];

const EN = LOCALE_SCRIPT_WORDS.en;

export function standardTitlePageSeeds(): ElementSeed[] {
  return [
    { styleKey: 'st_title', text: 'UNTITLED', overrides: { spaceBefore: 20 }, titleField: 'title' },
    { styleKey: 'st_title_center', text: EN.credit, overrides: { spaceBefore: 1 }, titleField: 'credit' },
    { styleKey: 'st_title_center', text: '', overrides: { spaceBefore: 1 }, titleField: 'author' },
    { styleKey: 'st_title_left', text: '', overrides: { anchor: 'bottom' }, titleField: 'copyright' },
    { styleKey: 'st_title_left', text: '', overrides: { anchor: 'bottom' }, titleField: 'draftDate' },
    { styleKey: 'st_title_left', text: '', overrides: { anchor: 'bottom' }, titleField: 'contact' },
  ];
}

export const ENGLISH_CONTINUEDS: ContinuedTexts = {
  more: EN.more, cont: EN.cont, joiner: ' ', sceneBottom: EN.sceneBottom, sceneTop: EN.sceneTop,
  sceneTopNumbered: `${EN.sceneTop} (#)`, omitted: EN.omitted, styleId: null,
};

export function defaultPagination(overrides: Partial<PaginationRules> = {}): PaginationRules {
  return {
    breakOnSentences: true,
    dialogue: { allowBreaks: true, minLinesBeforeBreak: 2, minLinesAfterBreak: 2, moreAtBottom: true, contAtTop: true },
    automaticContinueds: { enabled: true, scope: 'scene' },
    sceneContinueds: { bottom: false, top: false, numbered: false, topBlankLines: 1, bottomBlankLines: 1 },
    widowOrphan: { minLinesAtPageBottom: 2, minLinesAtPageTop: 2 },
    keepWithNextMinLines: 2,
    headingsNeverOrphaned: true,
    dualDialogue: { enabled: true, columnGap: inchesToEmu(0.25), stackWhileEditing: false, geometry: null },
    columnBlocks: { gap: inchesToEmu(0.25), breakBlocks: true },
    actBreakStartsPage: false,
    combineConsecutiveOmitted: false,
    runningTime: { method: 'pages', wordsPerMinute: 150, soundCueSeconds: 3 },
    panels: { autoHeadingText: true },
    ...overrides,
  };
}

export function sceneHeadingNumbering(position: 'left' | 'right' | 'both'): NumberingSpec {
  return {
    enabled: false, counter: 'own', start: 1, format: '{n}', position, leftOffset: 685_800, rightOffset: 6_748_272,
    hideRightOnOverlap: true, resetAfterStyle: null, resetEvery: 0, suffixMode: '1AB', skipIO: false,
    autoOmit: false, omittedText: null, numberFont: null,
  };
}

export const DEFAULT_PAGE_NUMBERING: PageNumberingRule = {
  start: 1, format: '{n}.', suffixMode: '1AB', skipIO: false, combineDeletedRanges: true, titlePage: 'none',
};

export function letterPage(margins: { top: number; bottom: number; left: number; right: number }): PageSpec {
  return {
    paper: 'letter', width: inchesToEmu(8.5), height: inchesToEmu(11), orientation: 'portrait', margins,
    headerOffset: inchesToEmu(0.5), footerOffset: inchesToEmu(0.5), linesPerInch: 6, elementSpacing: 1,
    lineSpacingPreset: 'normal', bindingGutter: 0,
  };
}

export function standardHeader(right = '{page}.'): HeaderFooterSpec {
  return { enabled: true, left: '', center: '', right, styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 };
}

export function disabledFooter(): HeaderFooterSpec {
  return { enabled: false, left: '', center: '', right: '', styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 };
}
