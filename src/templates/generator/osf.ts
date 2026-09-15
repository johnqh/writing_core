import { XMLParser } from 'fast-xml-parser';
import { type StyleId, builtinStyleId, deterministicId } from '../../ids/ids.js';
import type {
  ElementSeed, FontSpec, NumberingSpec, SmartTypeSeed, StyleDef, StyleFlow, TemplateJSON,
} from '../../schema/template.js';
import type { Alignment, LogicalFontFamily, StyleRole } from '../../schema/vocab.js';
import { osfToEmu, snapToHundredthInch } from '../../units.js';
import { builtinStyleSlug, camelKey, roleForImportedStyle } from '../role-table.js';
import {
  DEFAULT_PAGE_NUMBERING, ENGLISH_CONTINUEDS, NOTE_TYPE_SEEDS, REVISION_COLOR_SEEDS, ROOT_STYLE_DEFAULTS,
  SCREENPLAY_MACRO_SEEDS, TAG_CATEGORY_SEEDS, TITLE_PAGE_STYLES, TRAIT_DEF_SEEDS, defaultPagination,
  disabledFooter, sceneHeadingNumbering, standardTitlePageSeeds,
} from '../shared.js';
import type { BuiltinSource } from './sources.js';

type Attrs = Record<string, string | undefined>;

const FONT_ALIASES: Record<string, LogicalFontFamily> = {
  'courier screenplay': 'courier-screenplay', 'courier final draft': 'courier-screenplay', 'courier prime': 'courier-screenplay',
  courier: 'courier-screenplay', 'courier new': 'courier-new', 'times new roman': 'times', times: 'times',
  arial: 'arial', helvetica: 'arial', calibri: 'calibri', cambria: 'cambria', georgia: 'georgia',
};

const AV_INSTRUCTIONS =
  'Sequential Action elements stack in the left (VIDEO) column. Character, Parenthetical and Dialogue sit in the right (AUDIO) column beside the immediately preceding Action run. An Action after dialogue starts a new row below, in the left column. Show Invisibles outlines each column block.';

const bool = (v: string | undefined) => v === '1' || v === 'true';
const lengthEmu = (v: string) => snapToHundredthInch(osfToEmu(Number(v)));
const lines = (v: string) => Math.round(Number(v) * 4) / 4;

function parse(xml: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    isArray: (name) => ['style', 'scene_intro', 'scene_time', 'extension', 'transition', 'character'].includes(name),
  });
  return parser.parse(xml).document as {
    settings: Attrs;
    styles: { style: Attrs[] };
    lists?: {
      scene_intros?: { scene_intro?: Attrs[] };
      scene_times?: { scene_time?: Attrs[] };
      extensions?: { extension?: Attrs[] };
      transitions?: { transition?: Attrs[] };
      characters?: { character?: Attrs[] };
    };
  };
}

function convertStyle(a: Attrs, roles: Map<string, StyleRole>, isRoot: boolean): StyleDef {
  const name = a.name!;
  const role = roles.get(name)!;
  const idOf = (n: string) => builtinStyleId(builtinStyleSlug(n));
  const font: Partial<FontSpec> = {};
  if (a.font) font.family = FONT_ALIASES[a.font.toLowerCase()] ?? 'courier-screenplay';
  if (a.size) font.size = Number(a.size);
  if (a.bold !== undefined) font.bold = bool(a.bold);
  if (a.italic !== undefined) font.italic = bool(a.italic);
  if (a.underline !== undefined) font.underline = bool(a.underline) ? 'single' : null;
  if (a.color) font.color = a.color.toUpperCase();

  const flow: Partial<StyleFlow> = {};
  if (a.style_enter) flow.onEnter = idOf(a.style_enter);
  if (a.style_tab_before) flow.onTabEmpty = idOf(a.style_tab_before);
  if (a.style_tab_after) flow.onTabText = idOf(a.style_tab_after);

  const slug = builtinStyleSlug(name);
  const def: StyleDef = {
    id: builtinStyleId(slug),
    name,
    nameKey: `template.style.${camelKey(name)}`,
    role,
    basedOn: isRoot ? null : idOf(a.basestylename ?? 'Normal Text'),
    shortcut: a.builtin_index !== undefined && Number(a.builtin_index) > 0 ? Number(a.builtin_index) : null,
    font: isRoot ? { ...ROOT_STYLE_DEFAULTS.font, ...font } : font,
  };
  if (isRoot) Object.assign(def, { ...ROOT_STYLE_DEFAULTS, font: def.font, id: def.id, name, nameKey: def.nameKey, role, basedOn: null, shortcut: null });
  if (a.allcaps !== undefined) def.allCaps = bool(a.allcaps);
  if (a.align) def.align = a.align as Alignment;
  if (a.leftindent !== undefined) def.indentLeft = lengthEmu(a.leftindent);
  if (a.rightindent !== undefined) def.indentRight = lengthEmu(a.rightindent);
  if (a.firstlineindent !== undefined) def.indentFirstLine = lengthEmu(a.firstlineindent);
  if (a.spacebefore !== undefined) def.spaceBefore = lines(a.spacebefore);
  if (a.linespacing !== undefined) def.lineSpacing = Number(a.linespacing);
  if (a.column !== undefined) def.column = Number(a.column) as 0 | 1 | 2;
  if (a.keepwithnext !== undefined) def.keepWithNext = bool(a.keepwithnext);
  if (a.pagebreakbefore !== undefined) def.pageBreakBefore = bool(a.pagebreakbefore);
  if (a.actbreak !== undefined) def.actBreak = bool(a.actbreak);
  if (Object.keys(flow).length > 0) def.flow = isRoot ? { ...ROOT_STYLE_DEFAULTS.flow, ...flow } : flow;
  if (role === 'sceneHeading') def.smartTypeList = 'locations';
  if (role === 'character') def.smartTypeList = 'characters';
  if (role === 'transition') def.smartTypeList = 'transitions';
  if (role === 'soundCue') def.smartTypeList = 'soundCues';
  if (role === 'outline') def.outlineLevel = roleForImportedStyle({ name, builtinIndex: null, actBreak: false, baseRole: null }).outlineLevel ?? 1;
  return def;
}

function normalizeTransition(t: string): string {
  return t === 'FADE OUT' || t === 'FADE TO BLACK' ? `${t}.` : t;
}

const names = (items: Attrs[] | undefined) => (items ?? []).map((i) => i.name!).filter(Boolean);

export function osfTemplateToJSON(xml: string, source: BuiltinSource): TemplateJSON {
  const doc = parse(xml);
  const s = doc.settings;
  const rawStyles = doc.styles.style;

  // Roles in document order so a style's base role is known before the style itself.
  const roles = new Map<string, StyleRole>();
  for (const a of rawStyles) {
    const base = a.basestylename ? roles.get(a.basestylename) ?? null : null;
    roles.set(a.name!, roleForImportedStyle({
      name: a.name!,
      builtinIndex: a.builtin_index !== undefined ? Number(a.builtin_index) : null,
      actBreak: bool(a.actbreak),
      baseRole: base,
    }).role);
  }
  const styles = rawStyles.map((a, i) => convertStyle(a, roles, i === 0));
  const byRole = (role: StyleRole): StyleId | null => styles.find((st) => st.role === role)?.id ?? null;

  const position = ({ '1': 'left', '2': 'right', '3': 'both' } as const)[(s.scenenumber_position ?? '3') as '1' | '2' | '3'] ?? 'both';
  for (const st of styles) {
    if (st.role === 'sceneHeading') {
      const numbering: NumberingSpec = {
        ...sceneHeadingNumbering(position),
        start: Number(s.scenenumber_start ?? '1'),
        suffixMode: (s.scenenumber_mode ?? '1AB') as NumberingSpec['suffixMode'],
        skipIO: bool(s.scenenumber_skip_io),
        autoOmit: bool(s.auto_omit_scenes),
      };
      st.numbering = numbering;
    }
  }

  // Spec 01 §4.8 difference 1: graphic novel auto-numbering.
  if (source.layoutMode === 'panels') {
    for (const st of styles) {
      if (st.role === 'page') {
        st.numbering = { ...sceneHeadingNumbering('both'), enabled: true, format: 'PAGE {n:WORDS} ({count:st_panel:WORDS} PANELS)', position: 'inline' };
      }
      if (st.role === 'panel') {
        st.numbering = { ...sceneHeadingNumbering('both'), enabled: true, format: 'Panel {n}.', position: 'inline', resetAfterStyle: builtinStyleId('page') };
      }
    }
  }

  const rawWidth = osfToEmu(Number(s.page_width));
  const rawHeight = osfToEmu(Number(s.page_height));
  // Fade In stores A4 as 210 × 296.9 mm; within 0.1 mm store the canonical A4 size (spec 01 §3.2).
  const isA4 = Math.abs(rawWidth - 7_560_000) <= 3_600 && Math.abs(rawHeight - 10_692_000) <= 3_600;
  const paper = rawWidth === 7_772_400 && rawHeight === 10_058_400 ? 'letter' : isA4 ? 'a4' : 'custom';
  const width = isA4 ? 7_560_000 : paper === 'letter' ? rawWidth : snapToHundredthInch(rawWidth);
  const height = isA4 ? 10_692_000 : paper === 'letter' ? rawHeight : snapToHundredthInch(rawHeight);
  const slot = ({ '1': 'left', '2': 'center', '3': 'right' } as const)[(s.header_alignment ?? '3') as '1' | '2' | '3'] ?? 'right';
  const headerText = source.key === 'novel-manuscript'
    ? '{field:author} / {field:title} / {page}'
    : (s.page_header ?? '').replace(/#/g, '{page}');

  const lists = doc.lists ?? {};
  const smartType: SmartTypeSeed = {
    sceneIntros: names(lists.scene_intros?.scene_intro),
    times: names(lists.scene_times?.scene_time),
    extensions: names(lists.extensions?.extension),
    transitions: names(lists.transitions?.transition).map(normalizeTransition),
    characters: names(lists.characters?.character),
    locations: [],
    introSeparator: ' ',
    timeSeparator: s.scene_time_separator ?? ' - ',
    sortMode: 'alphabetical',
  };

  const firstStyle =
    source.layoutMode === 'panels' ? builtinStyleId('page')
    : source.category === 'prose' ? builtinStyleId('chapter')
    : builtinStyleId('scene_heading');
  const body: ElementSeed[] = [{ styleKey: firstStyle, text: '' }];
  const screenplayLike = source.category === 'screenplay' || source.category === 'television';
  const dialogueBreaks = bool(s.dialogue_pagebreaks);

  return {
    schemaVersion: 1,
    id: deterministicId('tpl', ['builtin', source.key]),
    key: source.key,
    version: 1,
    name: source.name,
    nameKey: `template.builtin.${camelKey(source.key)}.name`,
    description: '',
    category: source.category,
    locale: 'en',
    direction: 'ltr',
    layoutMode: source.layoutMode,
    page: {
      paper, width, height, orientation: 'portrait',
      margins: {
        top: lengthEmu(s.margin_top!), bottom: lengthEmu(s.margin_bottom!),
        left: lengthEmu(s.margin_left!), right: lengthEmu(s.margin_right!),
      },
      headerOffset: 457_200, footerOffset: 457_200,
      linesPerInch: Number(s.normal_linesperinch ?? '6'), elementSpacing: Number(s.element_spacing ?? '1'),
      lineSpacingPreset: 'normal', bindingGutter: 0,
    },
    header: {
      enabled: headerText !== '',
      left: slot === 'left' ? headerText : '',
      center: slot === 'center' ? headerText : '',
      right: slot === 'right' ? headerText : '',
      styleId: null,
      showOnFirstPage: bool(s.header_first_page), showOnTitlePage: false, startAtPage: 1,
    },
    footer: disabledFooter(),
    styles,
    titlePageStyles: [...TITLE_PAGE_STYLES],
    titlePageLayout: { centerTop: 3_200_400 },
    defaults: {
      root: styles[0]!.id,
      firstElement: firstStyle,
      pasteFallback: byRole('action') ?? byRole('paragraph') ?? styles[0]!.id,
      sceneHeading: byRole('sceneHeading'), character: byRole('character'), dialogue: byRole('dialogue'),
      parenthetical: byRole('parenthetical'), action: byRole('action'), transition: byRole('transition'),
      titleDefault: builtinStyleId('title_center'),
    },
    pagination: defaultPagination({
      breakOnSentences: bool(s.break_on_sentences),
      dialogue: { allowBreaks: dialogueBreaks, minLinesBeforeBreak: 2, minLinesAfterBreak: 2, moreAtBottom: dialogueBreaks, contAtTop: dialogueBreaks },
      automaticContinueds: { enabled: bool(s.dialogue_continues), scope: 'scene' },
      sceneContinueds: { bottom: bool(s.scenes_continue), top: bool(s.scenes_continue), numbered: bool(s.number_continued), topBlankLines: 1, bottomBlankLines: 1 },
      dualDialogue: { enabled: screenplayLike, columnGap: 228_600, stackWhileEditing: false, geometry: null },
    }),
    pageNumbering: DEFAULT_PAGE_NUMBERING,
    sceneNumbering: { styleId: byRole('sceneHeading') ?? firstStyle },
    continueds: { ...ENGLISH_CONTINUEDS, more: s.more_text ?? ENGLISH_CONTINUEDS.more, omitted: s.omitted_text ?? ENGLISH_CONTINUEDS.omitted },
    smartType,
    revisionColors: [...REVISION_COLOR_SEEDS],
    tagCategories: [...TAG_CATEGORY_SEEDS],
    noteTypes: [...NOTE_TYPE_SEEDS],
    traitDefs: [...TRAIT_DEF_SEEDS],
    macros: screenplayLike ? [...SCREENPLAY_MACRO_SEEDS] : [],
    // Spec 01 §4.8 difference 3: the novel's title page carries a computed word count.
    titlePage: source.key === 'novel-manuscript'
      ? [...standardTitlePageSeeds(), { styleKey: 'st_title_left', text: '', overrides: { anchor: 'bottom' }, titleField: 'wordCount' }]
      : standardTitlePageSeeds(),
    body,
    instructions: source.key === 'av-two-column' ? AV_INSTRUCTIONS : null,
    importMeta: null,
  };
}
