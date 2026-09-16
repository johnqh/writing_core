import { describe, expect, it } from 'vitest';
import * as api from '../index.js';
import * as internalApi from '../internal.js';

// Sorted, committed snapshot of every value `../index.js` exports (349 total minus the 68 that
// moved to `../internal.js` — see `ROOT_INTERNAL_SPLIT` below). This is the consumer-facing
// contract: a name appearing here that isn't deliberately added is a leak (a raw document
// mutator or framework internal that bypasses capability checks, the write policy, rehearsal or
// undo-origin tracking), and a name silently disappearing is a breaking change. Regenerate with
// `bun -e "console.log(JSON.stringify(Object.keys(await import('./dist/index.js')).sort()))"`
// after `bun run build`, and diff by hand before committing — this array must change on purpose.
const ROOT_EXPORTS = [
  'ALIGNMENTS', 'ANCHOR_MARK_PREFIXES', 'ATTRIBUTE_KEY_RE', 'AltJSON', 'AnimalFields', 'BUILTIN_SLOT_ROLES',
  'BUILTIN_STYLE_RE', 'BUILTIN_TEMPLATES', 'BackgroundActorFields', 'Bcp47', 'BeatJSON', 'BeatLinkJSON',
  'BinItemJSON', 'BookmarkJSON', 'CAPABILITIES', 'CHANGE_MARKS', 'COMMAND_ID_RE', 'CharacterFields',
  'ContinuedTexts', 'DEFAULT_PAGE_NUMBERING', 'DEFAULT_SETTINGS', 'DEFAULT_TABLE_READ', 'DEFAULT_TEMPLATE_KEY',
  'DIAGNOSTIC_CODES', 'DOCUMENT_KINDS', 'DOC_SCHEMA_VERSION', 'DOC_TOP_LEVEL_KEYS', 'DocumentImportMetaJSON', 'DocumentJSON',
  'DocumentMeta', 'DualDialogueGeometry', 'ELEMENT_COMMANDS', 'EMPTY_SMARTTYPE', 'EMU_PER_CM',
  'EMU_PER_HUNDREDTH_INCH', 'EMU_PER_INCH', 'EMU_PER_OSF_UNIT', 'EMU_PER_POINT', 'ENGLISH_CONTINUEDS',
  'ENGLISH_SMARTTYPE', 'ENTER_ON_BLANK', 'ENTITY_COMMANDS', 'ENTITY_FIELD_SCHEMAS', 'ENTITY_KINDS',
  'ElementJSON', 'ElementMeta', 'ElementNumbering', 'ElementOverrides', 'ElementSeed', 'Embed', 'EmbedAt',
  'EmbeddedTemplateJSON', 'Emu', 'EmuSigned', 'EntityAttributes', 'EntityJSON', 'FLOW_KEYS', 'FONT_ALIASES', 'FONT_KEYS',
  'FORMAT_MARKS', 'FWM_FORMAT_VERSION', 'FWM_MAGIC', 'FolderJSON', 'FontFamilyId', 'FontSpec', 'GENERATED_TEMPLATES', 'HASH_VERSION',
  'HeaderFooterSpec', 'HexColor', 'I18nKey', 'ID_PREFIXES', 'INTRO_VARIANTS', 'INVARIANT_CODES', 'ImportMeta',
  'JsonValue', 'LAYOUT_ENGINE_VERSION', 'LAYOUT_MODES', 'LINE_SPACING_FACTORS', 'LINE_SPACING_PRESETS', 'LOCALE_SCRIPT_WORDS',
  'LOCALIZED_TEMPLATE_KEYS', 'LOGICAL_FONT_FAMILIES', 'LabelSegment', 'LaneJSON', 'Lines', 'LocationFields',
  'COLUMNS', 'MARK_COMMANDS', 'MAX_POSITION_LENGTH', 'MIGRATION_STEPS', 'MacroAlias', 'MacroRecord', 'MacroSeed',
  'NON_PRINTING_ROLES', 'NOTE_TYPE_SEEDS', 'NUMBER_MODES', 'NUMBER_POSITIONS', 'NoteAnchor', 'NoteJSON',
  'NoteReplyJSON', 'NoteTypeJSON', 'NoteTypeSeed', 'NumberLabel', 'NumberingSpec', 'ORIGIN_KINDS', 'OmitRecord',
  'PAPER_SIZES', 'POSITION_DIGITS', 'PageLockJSON', 'PageNumberingRule', 'PageSpec', 'PaginationRules',
  'PlotColumnJSON', 'ProductionItemFields', 'ProductionJSON', 'REASON_CODES', 'REASON_LABEL_KEYS',
  'REMAPPED_PREFIXES', 'REVISION_COLOR_SEEDS', 'REVISION_DISPLAYS', 'ROLE_DEFAULT_SPLIT', 'ROOT_REQUIRED_KEYS',
  'ROOT_STYLE_DEFAULTS', 'RevisionColorSeed', 'RevisionSetJSON', 'RevisionsJSON', 'SCENE_BOUNDARY_ROLES',
  'SCENE_ROLES', 'SCREENPLAY_MACRO_SEEDS', 'SCRIPT_LOCALES', 'SMARTTYPE_COMMANDS', 'SMARTTYPE_LISTS',
  'SPEAKER_ROLES', 'SPEECH_MEMBER_ROLES', 'SPLIT_RULES', 'STORED_SMARTTYPE_LISTS', 'STYLE_ROLES', 'SYSTEM_ACTOR',
  'SceneJSON', 'SceneNumberingDisplay', 'SceneVersionJSON', 'SettingsJSON', 'ShotJSON', 'SmartTypeEntryJSON',
  'SmartTypeJSON', 'SmartTypeSeed', 'SoundMusicFields', 'SpellingJSON', 'StorylineJSON', 'StyleDef',
  'StyleDefaults', 'StyleFlow', 'StyleIdSchema', 'SuggestionItemJSON', 'SuggestionSetJSON', 'TAG_CATEGORY_SEEDS',
  'TEMPLATE_CATEGORIES', 'TEMPLATE_ISSUE_CODES', 'TEMPLATE_SCHEMA_VERSION', 'TEMPLATE_SEED_KEYS',
  'TEXT_COMMANDS', 'TEXT_DIRECTIONS', 'TITLE_FIELDS', 'TITLE_PAGE_STYLES', 'TRACKED_ORIGIN_KINDS',
  'TRACK_CHANGE_VIEWS', 'TRAIT_DEF_SEEDS', 'UNIMPLEMENTED_INVARIANTS', 'TableReadJSON', 'TagCategoryJSON', 'TagCategorySeed', 'TagJSON',
  'TagTextStyle', 'TemplateJSON', 'TextAttrs', 'TextJSON', 'TextRun', 'Timestamp', 'TitlePageJSON',
  'TitlePageLayout', 'TokenString', 'TrackChangeRecord', 'TrackChangesJSON', 'TraitDefJSON', 'TraitDefSeed',
  'TransactionOrigin', 'UNDERLINE_KINDS', 'UNDO_CLEAR_REASONS', 'VehicleFields', 'VoiceJSON',
  'WRITING_CORE_VERSION', 'WardrobeFields', 'WireDocPos', 'WireRange', 'WriterJSON', 'addBuiltinCommands',
  'applyTemplate', 'authoredTemplate', 'builtinStyleId', 'builtinStyleSlug', 'canonicalElementText',
  'canonicalJSON', 'comparePositions', 'computeHashVector', 'createDocument', 'createSeededIdSource',
  'advanceTableFor', 'aliasFor', 'cjkRegion', 'createFontRegistry', 'createSessionOrigins', 'createSessionUndo', 'cryptoIdSource', 'decodeFwm', 'decodeRelativePosition', 'defaultPagination',
  'defineCommand', 'deltaToTextJSON', 'deterministicId', 'disabledFooter', 'documentFromJSON', 'documentToJSON',
  'elementContentHash', 'emptyTextJSON', 'emuFromFontUnits', 'emuToInches', 'encodeFwm', 'encodeRelativePosition', 'enterAction',
  'entityContentHash', 'entityNameKey', 'executeBatch', 'executeCommand', 'exportTemplate', 'fallbackChain', 'flowTo', 'formatNumberLabel',
  'fromPortablePos', 'getBuiltinTemplate', 'getCommand', 'harvest', 'idKind', 'idSchema', 'inchesToEmu', 'isId',
  'isMarkKey', 'isNewerThanCode', 'isPortablePos', 'isStyleId', 'letterPage', 'letters', 'listBuiltinTemplates',
  'listCommands', 'localizeTemplate', 'materializeDocument', 'migrateDocument', 'mirrorTemplate',
  'newDualGroupId', 'newId', 'normalizeKey', 'openDocument', 'packetHash', 'parseSceneHeading', 'pointsToEmu',
  'positionBetween', 'queryLetter', 'readTextJSON', 'registerBuiltinCommands', 'registerCommand',
  'registerInvariants', 'remapDocumentIds', 'resolveStyle', 'roleForImportedStyle', 'rootStyle', 'roundHalfEven', 'scanText',
  'sceneContentHash', 'sceneHeadingNumbering', 'screenplayStandard', 'scriptOf', 'sha256Bytes', 'sha256Hex',
  'shiftTabAction', 'shotContentHash', 'sizeEmuFromPoints', 'sliceTextJSON', 'standardHeader', 'standardTitlePageSeeds',
  'stripExtension', 'styleDef', 'tabAction', 'templateHash', 'textJSONFromPlain', 'textJSONToDelta', 'textOutline',
  'titleFromKey', 'tofuFace', 'toPortablePos', 'treatment', 'validateDocument', 'validateTemplate', 'verticalDrama',
].sort();

// Sorted, committed snapshot of every value `../internal.js` exports. Regenerate the same way,
// against `./dist/internal.js`. A consumer imports from here only when it is itself extending the
// command framework (a new command, a new invariant, an importer writing raw document records) —
// see the file header comment in `src/internal.ts`.
const INTERNAL_EXPORTS = [
  'BUILTIN_STYLE_ROLES', 'CROCKFORD_ALPHABET', 'OrderIndex', 'STYLE_NESTED_KEYS', 'TEMPLATE_JSON_MAP_KEYS',
  'TEMPLATE_SCALAR_KEYS', 'UNMARKED_ORIGIN_KINDS', 'allTexts', 'bodyElements', 'camelKey', 'childMap',
  'computeDialogueBlocks', 'computeOutlineTree', 'computeScenes', 'createElement', 'createValidationContext',
  'documentLanguage', 'dualGroupOf', 'dualRuns', 'elementIdsBetween', 'embedTemplate', 'encodeBase32Bytes', 'encodeUlidBody',
  'fdxLeftIndentToEmu', 'fdxRightIndentToEmu', 'fdxSpaceBeforeToLines', 'generatePositions', 'getMap',
  'inheritedAttributes', 'insertAttributes', 'insertElementRecord', 'issue', 'lang', 'lastPosition', 'mapStyle',
  'matchesPrefix', 'mergeElements', 'nextBoundary', 'orderElements', 'orderRange', 'osfToEmu', 'policyDelete',
  'policyInsert', 'positionAfter', 'previousBoundary', 'rankSuggestions', 'readCollection', 'readElementRecord',
  'readEmbeddedTemplate', 'readEntity', 'readJSONMap', 'readNote', 'readStyle', 'readTextKeyed',
  'rebalancePositions', 'relPos', 'removeElement', 'repairDualRuns', 'resolveRange', 'resolveWirePos', 'setJSONMap',
  'snapToHundredthInch', 'sortedRecords', 'styleChain', 'systemOrigin', 'touchElement', 'writeElementRecord',
  'writeEntity', 'writePolicy', 'writeStyle', 'writeTextJSON',
].sort();

describe('public API', () => {
  it('exports the M1 entry points', () => {
    for (const name of [
      'inchesToEmu', 'canonicalJSON', 'sha256Hex', 'newId', 'deterministicId', 'positionBetween', 'TemplateJSON', 'DocumentJSON',
      'resolveStyle', 'validateTemplate', 'enterAction', 'BUILTIN_TEMPLATES', 'getBuiltinTemplate', 'localizeTemplate', 'createDocument',
      'documentToJSON', 'materializeDocument', 'applyTemplate', 'exportTemplate', 'migrateDocument', 'DOC_SCHEMA_VERSION', 'validateDocument',
      'openDocument', 'parseSceneHeading', 'elementContentHash', 'sceneContentHash', 'registerBuiltinCommands', 'executeBatch',
      'executeCommand', 'createSessionOrigins', 'createSessionUndo', 'harvest', 'normalizeKey',
    ]) expect(api, name).toHaveProperty(name);
  });

  it('declares each closed vocabulary once', () => {
    expect(api.ENTITY_KINDS).toHaveLength(26);
    expect(api.STYLE_ROLES).toHaveLength(27);
    expect(api.DOC_TOP_LEVEL_KEYS).toHaveLength(30);
    expect(api.NUMBER_MODES).toEqual(['1AB', '1A2', 'AB2', 'BA2', 'romanUpper', 'romanLower']);
  });

  it('pins the root package surface exactly — any addition or removal must be deliberate', () => {
    expect(Object.keys(api).sort()).toEqual(ROOT_EXPORTS);
  });

  it('pins the ./internal surface exactly — any addition or removal must be deliberate', () => {
    expect(Object.keys(internalApi).sort()).toEqual(INTERNAL_EXPORTS);
  });

  it('never exports a name on both the root and the internal surface', () => {
    const overlap = ROOT_EXPORTS.filter((name) => INTERNAL_EXPORTS.includes(name));
    expect(overlap).toEqual([]);
  });

  it('keeps raw document mutators and framework internals off the root surface', () => {
    // The names Task 29/30 review flagged as leaking (raw mutators that bypass capability
    // checks/write policy/rehearsal/undo tracking, plus low-level Yjs plumbing): these must be
    // reachable only via `../internal.js`, never `../index.js`.
    for (const name of [
      'createElement', 'removeElement', 'mergeElements', 'writeElementRecord', 'insertElementRecord',
      'writePolicy', 'touchElement', 'positionAfter', 'styleChain', 'childMap', 'getMap', 'setJSONMap',
      'readJSONMap', 'issue', 'lang', 'encodeUlidBody', 'camelKey', 'snapToHundredthInch', 'systemOrigin',
    ]) {
      expect(api, name).not.toHaveProperty(name);
      expect(internalApi, name).toHaveProperty(name);
    }
  });
});
