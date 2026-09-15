import type { StyleId, TemplateId } from '../ids/ids.js';
import type { TemplateJSON } from '../schema/template.js';
import { inchesToEmu } from '../units.js';

const S = (s: string) => s as StyleId;

/** Smallest valid template: root + scene heading + action + character + dialogue. */
export function minimalTemplate(): TemplateJSON {
  const flowNone = { onEnter: null, onEnterEmpty: 'picker' as const, onTabEmpty: null, onTabText: null, onShiftTabEmpty: null };
  return {
    schemaVersion: 1,
    id: 'tpl_01ARYZ6S410000000000000000' as TemplateId,
    key: 'test-minimal',
    version: 1,
    name: 'Minimal',
    nameKey: null,
    description: '',
    category: 'screenplay',
    locale: 'en',
    direction: 'ltr',
    layoutMode: 'flow',
    page: {
      paper: 'letter', width: inchesToEmu(8.5), height: inchesToEmu(11), orientation: 'portrait',
      margins: { top: inchesToEmu(1), bottom: inchesToEmu(1), left: inchesToEmu(1.5), right: inchesToEmu(1) },
      headerOffset: inchesToEmu(0.5), footerOffset: inchesToEmu(0.5), linesPerInch: 6, elementSpacing: 1,
      lineSpacingPreset: 'normal', bindingGutter: 0,
    },
    header: { enabled: true, left: '', center: '', right: '{page}.', styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 },
    footer: { enabled: false, left: '', center: '', right: '', styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 },
    styles: [
      {
        id: S('st_normal'), name: 'Normal Text', nameKey: null, role: 'normal', basedOn: null, shortcut: null,
        font: { family: 'courier-screenplay', size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
        allCaps: false, align: 'left', indentLeft: 0, indentRight: 0, indentFirstLine: 0, spaceBefore: 0, lineSpacing: 1,
        column: 0, keepWithNext: false, keepTogether: false, splitRule: 'lines', pageBreakBefore: false, actBreak: false,
        paginateAs: null, hiddenInScript: false, printable: true, outlineLevel: 0, flow: flowNone, numbering: null,
        prefix: '', suffix: '', smartTypeList: null, dualDialogue: false,
      },
      { id: S('st_scene_heading'), name: 'Scene Heading', nameKey: null, role: 'sceneHeading', basedOn: S('st_normal'), shortcut: 1, font: {}, allCaps: true, spaceBefore: 2, keepWithNext: true, flow: { onEnter: S('st_action') }, smartTypeList: 'locations' },
      { id: S('st_action'), name: 'Action', nameKey: null, role: 'action', basedOn: S('st_normal'), shortcut: 2, font: {}, spaceBefore: 1, flow: { onTabEmpty: S('st_character'), onTabText: S('st_character') } },
      { id: S('st_character'), name: 'Character', nameKey: null, role: 'character', basedOn: S('st_normal'), shortcut: 3, font: {}, allCaps: true, indentLeft: inchesToEmu(2), spaceBefore: 1, keepWithNext: true, flow: { onEnter: S('st_dialogue') }, smartTypeList: 'characters', dualDialogue: true },
      { id: S('st_dialogue'), name: 'Dialogue', nameKey: null, role: 'dialogue', basedOn: S('st_normal'), shortcut: 4, font: {}, indentLeft: inchesToEmu(1), indentRight: inchesToEmu(1.5), flow: { onEnter: S('st_action') }, dualDialogue: true },
    ],
    titlePageStyles: [
      { id: S('st_title_center'), name: 'Title Center', nameKey: null, role: 'titleText', basedOn: null, shortcut: null,
        font: { family: 'courier-screenplay', size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
        allCaps: false, align: 'center', indentLeft: 0, indentRight: 0, indentFirstLine: 0, spaceBefore: 0, lineSpacing: 1,
        column: 0, keepWithNext: false, keepTogether: false, splitRule: 'lines', pageBreakBefore: false, actBreak: false,
        paginateAs: null, hiddenInScript: false, printable: true, outlineLevel: 0, flow: flowNone, numbering: null,
        prefix: '', suffix: '', smartTypeList: null, dualDialogue: false },
    ],
    titlePageLayout: { centerTop: 3_200_400 },
    defaults: {
      root: S('st_normal'), firstElement: S('st_scene_heading'), pasteFallback: S('st_action'),
      sceneHeading: S('st_scene_heading'), character: S('st_character'), dialogue: S('st_dialogue'),
      parenthetical: null, action: S('st_action'), transition: null, titleDefault: S('st_title_center'),
    },
    pagination: {
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
    },
    pageNumbering: { start: 1, format: '{n}.', suffixMode: '1AB', skipIO: false, combineDeletedRanges: true, titlePage: 'none' },
    sceneNumbering: { styleId: S('st_scene_heading') },
    continueds: { more: '(MORE)', cont: "(CONT'D)", joiner: ' ', sceneBottom: '(CONTINUED)', sceneTop: 'CONTINUED:', sceneTopNumbered: 'CONTINUED: (#)', omitted: 'OMITTED', styleId: null },
    smartType: { sceneIntros: ['INT.', 'EXT.'], times: ['DAY', 'NIGHT'], extensions: ['(V.O.)'], transitions: ['CUT TO:'], characters: [], locations: [], introSeparator: ' ', timeSeparator: ' - ', sortMode: 'alphabetical' },
    revisionColors: [{ key: 'white', nameKey: 'template.revision.white', color: '#FFFFFF', pageColor: '#FFFFFF', mark: '' }],
    tagCategories: [],
    noteTypes: [{ key: 'general', nameKey: 'template.noteType.general', color: '#FFD700', marker: '' }],
    traitDefs: [],
    macros: [],
    titlePage: [{ styleKey: 'st_title_center', text: 'UNTITLED', titleField: 'title' }],
    body: [{ styleKey: 'st_scene_heading', text: '' }],
    instructions: null,
    importMeta: null,
  };
}
