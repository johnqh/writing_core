import { z } from 'zod/v4';
import {
  Bcp47, Emu, EmuSigned, FontFamilyId, HexColor, I18nKey, JsonValue, Lines, StyleIdSchema, TokenString, idSchema,
} from './primitives.js';
import {
  ALIGNMENTS, ENTITY_KINDS, LAYOUT_MODES, LINE_SPACING_PRESETS, NUMBER_MODES, NUMBER_POSITIONS, PAPER_SIZES,
  SMARTTYPE_LISTS, SPLIT_RULES, STYLE_ROLES, TEMPLATE_CATEGORIES, TEXT_DIRECTIONS, TITLE_FIELDS, UNDERLINE_KINDS,
} from './vocab.js';

export const TEMPLATE_SCHEMA_VERSION = 1;

export const FontSpec = z.object({
  family: FontFamilyId,
  size: z.number().multipleOf(0.5).min(4).max(96),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.enum(UNDERLINE_KINDS).nullable(),
  strike: z.boolean(),
  smallCaps: z.boolean(),
  color: HexColor,
});
export type FontSpec = z.infer<typeof FontSpec>;

export const StyleFlow = z.object({
  onEnter: StyleIdSchema.nullable(),
  onEnterEmpty: z.union([z.literal('picker'), z.literal('flow'), StyleIdSchema]),
  onTabEmpty: StyleIdSchema.nullable(),
  onTabText: StyleIdSchema.nullable(),
  onShiftTabEmpty: StyleIdSchema.nullable(),
});
export type StyleFlow = z.infer<typeof StyleFlow>;

export const LabelSegment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('letters'), value: z.array(z.number().int().min(1)).min(1) }),
  z.object({ kind: z.literal('digits'), value: z.number().int().min(0) }),
]);
export type LabelSegment = z.infer<typeof LabelSegment>;

export const NumberLabel = z.object({
  base: z.number().int().min(0),
  prefix: z.array(LabelSegment),
  suffix: z.array(LabelSegment),
  custom: z.string().optional(),
});
export type NumberLabel = z.infer<typeof NumberLabel>;

export const NumberingSpec = z.object({
  enabled: z.boolean(),
  counter: z.enum(['own', 'base']),
  start: z.number().int(),
  format: TokenString,
  position: z.enum(NUMBER_POSITIONS),
  leftOffset: Emu,
  rightOffset: Emu,
  hideRightOnOverlap: z.boolean(),
  resetAfterStyle: StyleIdSchema.nullable(),
  resetEvery: z.number().int().min(0),
  suffixMode: z.enum(NUMBER_MODES),
  skipIO: z.boolean(),
  autoOmit: z.boolean(),
  omittedText: z.string().nullable(),
  numberFont: z
    .object({ family: FontFamilyId.optional(), size: z.number().optional(), bold: z.boolean().optional(), italic: z.boolean().optional() })
    .nullable(),
});
export type NumberingSpec = z.infer<typeof NumberingSpec>;

/** Spec 01 §5.3.2 — the only per-element override keys. */
export const ElementOverrides = z.object({
  align: z.enum(ALIGNMENTS).optional(),
  indentLeft: Emu.optional(),
  indentRight: Emu.optional(),
  indentFirstLine: EmuSigned.optional(),
  spaceBefore: Lines.optional(),
  lineSpacing: z.number().min(0.5).max(4).optional(),
  keepWithNext: z.boolean().optional(),
  pageBreakBefore: z.boolean().optional(),
  column: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  leadingAdjust: z.number().int().min(-25_400).max(50_800).optional(),
  direction: z.enum(['auto', 'ltr', 'rtl']).optional(),
  anchor: z.enum(['flow', 'bottom']).optional(),
});
export type ElementOverrides = z.infer<typeof ElementOverrides>;

export const StyleDef = z.object({
  id: StyleIdSchema,
  name: z.string().min(1).max(60),
  nameKey: I18nKey.nullable(),
  role: z.enum(STYLE_ROLES),
  basedOn: StyleIdSchema.nullable(),
  shortcut: z.number().int().min(0).max(9).nullable(),
  font: FontSpec.partial(),
  allCaps: z.boolean().optional(),
  align: z.enum(ALIGNMENTS).optional(),
  indentLeft: Emu.optional(),
  indentRight: Emu.optional(),
  indentFirstLine: EmuSigned.optional(),
  spaceBefore: Lines.optional(),
  lineSpacing: z.number().min(0.5).max(4).optional(),
  column: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  keepWithNext: z.boolean().optional(),
  keepTogether: z.boolean().optional(),
  splitRule: z.enum(SPLIT_RULES).optional(),
  pageBreakBefore: z.boolean().optional(),
  actBreak: z.boolean().optional(),
  paginateAs: StyleIdSchema.nullable().optional(),
  hiddenInScript: z.boolean().optional(),
  printable: z.boolean().optional(),
  outlineLevel: z.number().int().min(0).max(7).optional(),
  flow: StyleFlow.partial().optional(),
  numbering: NumberingSpec.nullable().optional(),
  prefix: TokenString.optional(),
  suffix: TokenString.optional(),
  smartTypeList: z.enum(SMARTTYPE_LISTS).nullable().optional(),
  dualDialogue: z.boolean().optional(),
});
export type StyleDef = z.infer<typeof StyleDef>;

export const PageSpec = z.object({
  paper: z.enum(PAPER_SIZES),
  width: Emu,
  height: Emu,
  orientation: z.enum(['portrait', 'landscape']),
  margins: z.object({ top: Emu, bottom: Emu, left: Emu, right: Emu }),
  headerOffset: Emu,
  footerOffset: Emu,
  linesPerInch: z.number().positive(),
  elementSpacing: z.number().positive(),
  lineSpacingPreset: z.enum(LINE_SPACING_PRESETS),
  bindingGutter: Emu,
});
export type PageSpec = z.infer<typeof PageSpec>;

export const HeaderFooterSpec = z.object({
  enabled: z.boolean(),
  left: TokenString,
  center: TokenString,
  right: TokenString,
  styleId: StyleIdSchema.nullable(),
  showOnFirstPage: z.boolean(),
  showOnTitlePage: z.boolean(),
  startAtPage: z.number().int().min(1),
});
export type HeaderFooterSpec = z.infer<typeof HeaderFooterSpec>;

const DualSideEdges = z.object({ left: Emu, right: Emu });
const DualSides = z.object({ leftSide: DualSideEdges, rightSide: DualSideEdges });
export const DualDialogueGeometry = z.object({ character: DualSides, parenthetical: DualSides, dialogue: DualSides });
export type DualDialogueGeometry = z.infer<typeof DualDialogueGeometry>;

export const PaginationRules = z.object({
  breakOnSentences: z.boolean(),
  dialogue: z.object({
    allowBreaks: z.boolean(),
    minLinesBeforeBreak: z.number().int().min(1),
    minLinesAfterBreak: z.number().int().min(1),
    moreAtBottom: z.boolean(),
    contAtTop: z.boolean(),
  }),
  automaticContinueds: z.object({ enabled: z.boolean(), scope: z.enum(['scene']) }),
  sceneContinueds: z.object({
    bottom: z.boolean(),
    top: z.boolean(),
    numbered: z.boolean(),
    topBlankLines: z.number().int().min(0),
    bottomBlankLines: z.number().int().min(0),
  }),
  widowOrphan: z.object({ minLinesAtPageBottom: z.number().int().min(1), minLinesAtPageTop: z.number().int().min(1) }),
  keepWithNextMinLines: z.number().int().min(1),
  headingsNeverOrphaned: z.boolean(),
  dualDialogue: z.object({
    enabled: z.boolean(),
    columnGap: Emu,
    stackWhileEditing: z.boolean(),
    geometry: DualDialogueGeometry.nullable(),
  }),
  columnBlocks: z.object({ gap: Emu, breakBlocks: z.boolean() }),
  actBreakStartsPage: z.boolean(),
  combineConsecutiveOmitted: z.boolean(),
  runningTime: z.object({
    method: z.enum(['pages', 'words']),
    wordsPerMinute: z.number().int().positive(),
    soundCueSeconds: z.number().min(0),
  }),
  panels: z.object({ autoHeadingText: z.boolean() }),
});
export type PaginationRules = z.infer<typeof PaginationRules>;

export const TitlePageLayout = z.object({ centerTop: Emu });
export type TitlePageLayout = z.infer<typeof TitlePageLayout>;

export const ContinuedTexts = z.object({
  more: z.string(),
  cont: z.string(),
  joiner: z.string(),
  sceneBottom: z.string(),
  sceneTop: z.string(),
  sceneTopNumbered: TokenString,
  omitted: z.string(),
  styleId: StyleIdSchema.nullable(),
});
export type ContinuedTexts = z.infer<typeof ContinuedTexts>;

export const PageNumberingRule = z.object({
  start: z.number().int(),
  format: TokenString,
  suffixMode: z.enum(NUMBER_MODES),
  skipIO: z.boolean(),
  combineDeletedRanges: z.boolean(),
  titlePage: z.enum(['none', 'romanLower']),
});
export type PageNumberingRule = z.infer<typeof PageNumberingRule>;

export const SceneNumberingDisplay = z.object({ styleId: StyleIdSchema });
export type SceneNumberingDisplay = z.infer<typeof SceneNumberingDisplay>;

export const StyleDefaults = z.object({
  root: StyleIdSchema,
  firstElement: StyleIdSchema,
  pasteFallback: StyleIdSchema,
  sceneHeading: StyleIdSchema.nullable(),
  character: StyleIdSchema.nullable(),
  dialogue: StyleIdSchema.nullable(),
  parenthetical: StyleIdSchema.nullable(),
  action: StyleIdSchema.nullable(),
  transition: StyleIdSchema.nullable(),
  titleDefault: StyleIdSchema,
});
export type StyleDefaults = z.infer<typeof StyleDefaults>;

export const SmartTypeSeed = z.object({
  sceneIntros: z.array(z.string()),
  times: z.array(z.string()),
  extensions: z.array(z.string()),
  transitions: z.array(z.string()),
  characters: z.array(z.string()),
  locations: z.array(z.string()),
  introSeparator: z.string(),
  timeSeparator: z.string(),
  sortMode: z.enum(['alphabetical', 'custom', 'frequency']),
});
export type SmartTypeSeed = z.infer<typeof SmartTypeSeed>;

export const RevisionColorSeed = z.object({
  key: z.string(), nameKey: I18nKey, color: HexColor, pageColor: HexColor, mark: z.string().max(2),
});
export type RevisionColorSeed = z.infer<typeof RevisionColorSeed>;

export const TagTextStyle = z.object({ bold: z.boolean(), underline: z.boolean(), highlight: z.boolean() });
export type TagTextStyle = z.infer<typeof TagTextStyle>;

export const TagCategorySeed = z.object({
  key: z.string(),
  nameKey: I18nKey,
  color: HexColor,
  entityKind: z.enum(ENTITY_KINDS),
  fdxGuid: z.string().nullable(),
  osfUuid: z.string().nullable(),
  textStyle: TagTextStyle,
  visible: z.boolean(),
});
export type TagCategorySeed = z.infer<typeof TagCategorySeed>;

export const NoteTypeSeed = z.object({ key: z.string(), nameKey: I18nKey, color: HexColor, marker: z.string().max(2) });
export type NoteTypeSeed = z.infer<typeof NoteTypeSeed>;

export const TraitDefSeed = z.object({
  key: z.string(), nameKey: I18nKey, type: z.enum(['text', 'choice', 'number']), options: z.array(z.string()),
});
export type TraitDefSeed = z.infer<typeof TraitDefSeed>;

export const MacroAlias = z.object({
  text: z.string().min(1),
  confirm: z.boolean(),
  matchCase: z.boolean(),
  smartReplace: z.boolean(),
  wordOnly: z.boolean(),
  activeIn: z.array(StyleIdSchema),
});
export type MacroAlias = z.infer<typeof MacroAlias>;

export const MacroRecord = z.object({
  id: idSchema('mac'),
  pos: z.string(),
  name: z.string().min(1).max(60),
  text: z.string(),
  styleId: StyleIdSchema.nullable(),
  nextStyleId: StyleIdSchema.nullable(),
  shortcut: z.string().nullable(),
  alias: MacroAlias.nullable(),
});
export type MacroRecord = z.infer<typeof MacroRecord>;

export const MacroSeed = MacroRecord.omit({ id: true });
export type MacroSeed = z.infer<typeof MacroSeed>;

export const ElementSeed = z.object({
  styleKey: z.string(),
  text: z.string(),
  overrides: ElementOverrides.optional(),
  titleField: z.enum(TITLE_FIELDS).optional(),
});
export type ElementSeed = z.infer<typeof ElementSeed>;

export const ImportMeta = z.record(z.string(), JsonValue);
export type ImportMeta = z.infer<typeof ImportMeta>;

export const TemplateJSON = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: idSchema('tpl'),
  key: z.string().regex(/^[a-z0-9-]+$/).nullable(),
  version: z.number().int().min(1),
  name: z.string().min(1).max(120),
  nameKey: I18nKey.nullable(),
  description: z.string().max(2000),
  category: z.enum(TEMPLATE_CATEGORIES),
  locale: Bcp47,
  direction: z.enum(TEXT_DIRECTIONS),
  layoutMode: z.enum(LAYOUT_MODES),
  page: PageSpec,
  header: HeaderFooterSpec,
  footer: HeaderFooterSpec,
  styles: z.array(StyleDef).min(1),
  titlePageStyles: z.array(StyleDef).min(1),
  titlePageLayout: TitlePageLayout,
  defaults: StyleDefaults,
  pagination: PaginationRules,
  pageNumbering: PageNumberingRule,
  sceneNumbering: SceneNumberingDisplay,
  continueds: ContinuedTexts,
  smartType: SmartTypeSeed,
  revisionColors: z.array(RevisionColorSeed).min(1),
  tagCategories: z.array(TagCategorySeed),
  noteTypes: z.array(NoteTypeSeed),
  traitDefs: z.array(TraitDefSeed),
  macros: z.array(MacroSeed),
  titlePage: z.array(ElementSeed),
  body: z.array(ElementSeed),
  instructions: z.string().max(20_000).nullable(),
  importMeta: ImportMeta.nullable(),
});
export type TemplateJSON = z.infer<typeof TemplateJSON>;
