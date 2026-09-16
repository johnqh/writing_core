export const TEMPLATE_CATEGORIES = [
  'screenplay', 'television', 'stagePlay', 'radio', 'audioVisual', 'multimedia', 'graphicNovel',
  'prose', 'treatment', 'outline', 'letter', 'verticalDrama', 'custom',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const LAYOUT_MODES = ['flow', 'panels'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const TEXT_DIRECTIONS = ['ltr', 'rtl'] as const;
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

export const STYLE_ROLES = [
  'normal', 'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot',
  'lyrics', 'castList', 'actStart', 'actEnd', 'sequence', 'outline', 'synopsis', 'note', 'notation',
  'soundCue', 'page', 'panel', 'chapter', 'paragraph', 'subheading', 'quotation', 'blockText',
  'chapterEnd', 'titleText',
] as const;
export type StyleRole = (typeof STYLE_ROLES)[number];

/**
 * Spec 01 §3.4.1 role table columns. A scene is an element of a SCENE_ROLE up to the next boundary.
 * `actStart` ends the previous scene without starting one; `actEnd` ends the derived act, not the scene.
 */
export const SCENE_ROLES = ['sceneHeading', 'chapter'] as const satisfies readonly StyleRole[];
export const SCENE_BOUNDARY_ROLES = ['sceneHeading', 'chapter', 'actStart'] as const satisfies readonly StyleRole[];
export const SPEAKER_ROLES = ['character'] as const satisfies readonly StyleRole[];
export const SPEECH_MEMBER_ROLES = ['parenthetical', 'dialogue', 'lyrics'] as const satisfies readonly StyleRole[];
export const NON_PRINTING_ROLES = ['outline', 'synopsis', 'note'] as const satisfies readonly StyleRole[];

export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/**
 * Spec 01 §3.4: a style's column in a two-column (AV / multimedia) template — `0` for the single
 * flowing column, `1` for the left column, `2` for the right. Declared once here, like every other
 * vocabulary, instead of being re-spelled as `0 | 1 | 2` in each schema and resolver.
 */
export const COLUMNS = [0, 1, 2] as const;
export type Column = (typeof COLUMNS)[number];

export const SPLIT_RULES = ['lines', 'sentences', 'never'] as const;
export type SplitRule = (typeof SPLIT_RULES)[number];

export const UNDERLINE_KINDS = ['single', 'double', 'word', 'dotted'] as const;
export type UnderlineKind = (typeof UNDERLINE_KINDS)[number];

export const NUMBER_MODES = ['1AB', '1A2', 'AB2', 'BA2', 'romanUpper', 'romanLower'] as const;
export type NumberMode = (typeof NUMBER_MODES)[number];

export const NUMBER_POSITIONS = ['left', 'right', 'both', 'inline'] as const;
export type NumberPosition = (typeof NUMBER_POSITIONS)[number];

export const SMARTTYPE_LISTS = [
  'characters', 'extensions', 'sceneIntros', 'locations', 'times', 'transitions', 'soundCues',
] as const;
export type SmartTypeList = (typeof SMARTTYPE_LISTS)[number];

/** Non-entity lists stored in the document's `smartType` map (spec 01 §5.20). */
export const STORED_SMARTTYPE_LISTS = ['sceneIntros', 'times', 'extensions', 'transitions', 'soundCues'] as const;
export type StoredSmartTypeList = (typeof STORED_SMARTTYPE_LISTS)[number];

export const ENTITY_KINDS = [
  'character', 'location', 'prop', 'wardrobe', 'makeupHair', 'vehicle', 'animal', 'setDressing',
  'greenery', 'specialEffect', 'visualEffect', 'mechanicalEffect', 'stunt', 'sound', 'music', 'camera',
  'specialEquipment', 'backgroundActor', 'security', 'additionalLabor', 'animalHandler',
  'artDepartment', 'unit', 'scriptDay', 'sequence', 'misc',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const DOCUMENT_KINDS = ['script', 'bible', 'treatment', 'outline', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const TITLE_FIELDS = [
  'title', 'subtitle', 'credit', 'author', 'source', 'basedOn', 'draftDate', 'revision', 'contact',
  'copyright', 'wga', 'notes', 'wordCount', 'series', 'episode',
] as const;
export type TitleField = (typeof TITLE_FIELDS)[number];

export const LOGICAL_FONT_FAMILIES = [
  'courier-screenplay', 'courier-new', 'times', 'arial', 'calibri', 'cambria', 'georgia', 'serif', 'sans', 'mono',
] as const;
export type LogicalFontFamily = (typeof LOGICAL_FONT_FAMILIES)[number];

export const PAPER_SIZES = ['letter', 'a4', 'legal', 'a5', 'b5', 'custom'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const LINE_SPACING_PRESETS = ['veryTight', 'tight', 'normal', 'loose'] as const;
export type LineSpacingPreset = (typeof LINE_SPACING_PRESETS)[number];
export const LINE_SPACING_FACTORS: Record<LineSpacingPreset, number> = {
  veryTight: 0.94, tight: 0.97, normal: 1, loose: 1.03,
};

export const ENTER_ON_BLANK = ['template', 'picker', 'flow'] as const;
export type EnterOnBlank = (typeof ENTER_ON_BLANK)[number];

export const REVISION_DISPLAYS = ['none', 'active', 'collated', 'all', 'sinceLastFull', 'selected'] as const;
export type RevisionDisplay = (typeof REVISION_DISPLAYS)[number];

export const TRACK_CHANGE_VIEWS = ['markup', 'simple', 'final', 'original'] as const;
export type TrackChangeView = (typeof TRACK_CHANGE_VIEWS)[number];

/**
 * Spec 02 §20.2 (registry R30): the closed vocabulary of `TokenString` names — the
 * `Name` production of the grammar `{'{' Name (':' Arg)* ('|' Filter)* '}'}`. Matching
 * is case-insensitive (`{Title}` === `{title}`); this table holds the canonical casing
 * as §20.2 writes it. `scene.heading`/`scene.number`, `revision.name`/`.color`/`.date`/
 * `.mark`, `page.revision`, `revision.active`/`.collated` and `watermark.recipient` are
 * single dotted identifiers, not a name plus a `:`-arg — the dot is part of `Name`.
 */
export const TOKEN_NAMES = [
  'page', 'pages', 'date', 'lastRevised', 'title', 'field', 'draft', 'filename', 'project', 'snapshot',
  'scene.heading', 'scene.number', 'style', 'label', 'revision.name', 'revision.color', 'revision.date',
  'revision.mark', 'page.revision', 'revision.active', 'revision.collated', 'watermark.recipient', 'n', 'count',
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

/** Spec 02 §35: the closed vocabulary of layout diagnostic codes. */
export const DIAGNOSTIC_CODES = [
  'keepViolated', 'forcedSplit', 'lockedBreakOverride', 'fontSubstituted',
  'glyphMissing', 'overlongUnbreakable', 'columnOverlap', 'styleCycle',
  'titlePageOverflow', 'headerTruncated', 'numberGapExhausted',
  'duplicateNumber', 'anchorOutOfOrder', 'markupForcesSpeedView',
  'approximateShaping', 'unknownToken',
] as const;
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
