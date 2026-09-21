// ─── Version ────────────────────────────────────────────────────────────────
export { WRITING_CORE_VERSION } from './version.js';

// ─── Units ──────────────────────────────────────────────────────────────────
// (import-format unit conversions — osfToEmu, snapToHundredthInch, fdx*ToEmu — are in ./internal.js)
export {
  EMU_PER_INCH, EMU_PER_CM, EMU_PER_POINT, EMU_PER_OSF_UNIT, EMU_PER_HUNDREDTH_INCH, inchesToEmu, emuToInches, pointsToEmu,
} from './units.js';

// ─── Hash ───────────────────────────────────────────────────────────────────
export * from './hash/canonical-json.js';
export * from './hash/sha256.js';
export * from './hash/content.js';

// ─── IDs ────────────────────────────────────────────────────────────────────
// (ULID/base32 encoding internals are in ./internal.js)
export * from './ids/id-source.js';
export * from './ids/ids.js';

// ─── Model ──────────────────────────────────────────────────────────────────
export { POSITION_DIGITS, MAX_POSITION_LENGTH, comparePositions, positionBetween } from './model/positions.js';
export { type Actor, SYSTEM_ACTOR, type SystemOriginName, type SystemOrigin } from './model/origins.js';
export {
  type YDeltaOp, textJSONToDelta, deltaToTextJSON, readTextJSON, type MarkRange, type EmbedHit, scanText,
} from './model/ytext.js';
export * from './model/create.js';
export { applyTemplate, exportTemplate } from './model/apply-template.js';
export * from './model/portable-pos.js';
export * from './model/remap-ids.js';
export { documentToJSON, documentFromJSON, materializeDocument } from './model/json.js';
export { INVARIANT_CODES, type InvariantCode, type Severity, type Issue, type Invariant } from './model/validate/types.js';
export { UNIMPLEMENTED_INVARIANTS, registerInvariants, validateDocument } from './model/validate/index.js';
export * from './smarttype/normalize.js';
export * from './smarttype/harvest.js';

// ─── Migrations ─────────────────────────────────────────────────────────────
export * from './migrations/index.js';

// ─── Commands ───────────────────────────────────────────────────────────────
// (write-policy, element-ops and wire-position resolution internals used by command
// implementations themselves — not by a caller of executeBatch/executeCommand — are in ./internal.js)
export * from './commands/origin.js';
export * from './commands/types.js';
export * from './commands/registry.js';
export { WireDocPos, WireRange } from './commands/positions.js';
export * from './commands/execute.js';
export { TEXT_COMMANDS } from './commands/text.js';
export { MARK_COMMANDS } from './commands/mark.js';
export { ELEMENT_COMMANDS } from './commands/element.js';
export { ENTITY_COMMANDS } from './commands/entity.js';
export { SMARTTYPE_COMMANDS } from './commands/smarttype.js';
export { PAGE_SETUP_COMMANDS } from './commands/page-setup.js';
export { REVISION_COMMANDS } from './commands/revisions.js';
export * from './commands/builtin.js';

// ─── Schema ─────────────────────────────────────────────────────────────────
export * from './schema/vocab.js';
export * from './schema/primitives.js';
export * from './schema/template.js';
export * from './schema/text.js';
export * from './schema/entities.js';
export * from './schema/document.js';

// ─── Template ───────────────────────────────────────────────────────────────
// (styleChain, the style-inheritance walk resolveStyle is built on, is in ./internal.js)
export { type ResolvedStyle, ROOT_REQUIRED_KEYS, FONT_KEYS, FLOW_KEYS, ROLE_DEFAULT_SPLIT, resolveStyle } from './template/resolve.js';
export * from './template/validate.js';
export * from './template/flow.js';
export * from './template/tokens.js';
export * from './template/locale-data.js';

// ─── Read model ─────────────────────────────────────────────────────────────
// (raw structure computation behind `openDocument` — readCollection, OrderIndex, computeScenes/
// computeDialogueBlocks/computeOutlineTree, matchesPrefix/rankSuggestions — is in ./internal.js;
// consumers use the `DocumentModel` returned by `openDocument` instead)
export * from './read-model/views.js';
export * from './read-model/open.js';
export * from './read-model/scene-heading.js';
export * from './read-model/number-label.js';

// ─── Numbering (insertion-mode generation, spec 02 §22.3; assignment, §21) ──
export * from './numbering/modes.js';
export * from './numbering/assign.js';

// ─── Templates (seeds) ──────────────────────────────────────────────────────
// (camelKey, a string-casing helper for role-table generation, is in ./internal.js)
export { BUILTIN_SLOT_ROLES, roleForImportedStyle, builtinStyleSlug } from './templates/role-table.js';
export * from './templates/script-words.js';
export * from './templates/shared.js';

// ─── Templates (built-in) ──────────────────────────────────────────────────
export { GENERATED_TEMPLATES } from './templates/builtin/generated/index.js';
export * from './templates/builtin/authoring.js';
export { screenplayStandard } from './templates/builtin/screenplay-standard.js';
export { treatment } from './templates/builtin/treatment.js';
export { textOutline } from './templates/builtin/text-outline.js';
export { queryLetter } from './templates/builtin/query-letter.js';
export { verticalDrama } from './templates/builtin/vertical-drama.js';
export * from './templates/locale.js';
export * from './templates/catalogue.js';

// ─── Undo ───────────────────────────────────────────────────────────────────
export * from './undo/undo-manager.js';

// ─── Layout ─────────────────────────────────────────────────────────────────
export { LAYOUT_ENGINE_VERSION, roundHalfEven, emuFromFontUnits, sizeEmuFromPoints } from './layout/round.js';
export * from './layout/types.js';
export { itemize, iso15924, type Item, type AttrRun, type ItemTier, type BaselineShift } from './layout/itemize.js';
export { layoutAdvance, isCourierFamily, measureItem, type MeasuredItem } from './layout/measure.js';
export { type CategoryRule, CATEGORY_RULES, categoryOf } from './layout/category.js';
export {
  layoutParagraph, makeDisplayText, basePitchOf, spaceBeforeOf,
  type ParaLine, type ParagraphLayout, type ParagraphInput, type DisplayText, type DisplayTextFn,
} from './layout/paragraph.js';
export {
  formBlocks, keepChains, paraFlags, firstPara, lastPara,
  type Block, type BlockPara, type ParaFlags, type SingleBlock, type DialogueBlock, type DualBlock, type ColumnRowsBlock,
  type OmittedSceneBlock, type Chain, type FormBlocksOptions,
} from './layout/blocks.js';
export {
  paginate, pageGeometryOf, DEFAULT_PAGINATE_DEPS,
  type PageGeometry, type PaginationParams, type PaginateDeps, type FillState, type FilledPage, type PlacedLine, type LockSegment,
  type BlockLineCursor, type SplitChoice, type DualSplit, type RowSplit,
} from './layout/paginate.js';
export {
  moreLine, synthesizedCue, cueDisplayText, contdCueLine, sceneContinuedTop, sceneContinuedBottom, bottomReserve, makeContinueds,
  dialogueRows, rowsHeight, legalDialogueSplit, splitDialogue, minLegalHead,
  type DecoLine, type DecoBlock, type ContinuedsHooks, type ContinuedsEnv, type DlgRow, type SplitRules,
} from './layout/continueds.js';
export {
  formRows, layoutRow, layoutRows, legalSideSplit, splitSide, splitRowSides, rowMinHead,
  type ColumnRow, type RowLayout, type RowRules, type RowSplitChoice, type SideRow,
} from './layout/columns.js';
export { panelHeadings, pageContdLine, type PanelText } from './layout/panels.js';
export { dualGeometry, dualSideBox, layoutDual, splitDual, dualMinHead, type DualLayout, type DualSplitChoice, type DualCategory } from './layout/dual.js';
export { layoutDocument, type LayoutDocumentOptions, type DocLayout, type DocPage, type DocLine, type DocDecoration } from './layout/layout-document.js';
export {
  sceneEighths, distributeEighths, formatEighths, runningTime, formatRunningTime,
  type SceneEighths, type SceneRunningTime, type RunningTime,
} from './layout/eighths.js';
export {
  autoAdjustLines, clampDeltaRight, LINE_ADJUST_MIN, LINE_ADJUST_MAX,
  type AutoAdjustOptions, type AutoAdjustResult, type LineAdjustment,
} from './layout/adjust.js';
export {
  applyRevisionDisplay, revisionReport, revisionLabel, revisionShortName, formatRevisionDate, elementRevisionMarks,
  type LineRevisionMark, type RevisedPageRef, type RevisionReportSet,
} from './layout/revisions.js';
export { contextPass, type ElementContext, type SpeakerKey, type ContextPassResult, type ContextPassDeps } from './layout/context.js';

// ─── Text (shaping) ─────────────────────────────────────────────────────────
export { nullShaper } from './text/shaper.js';
export { HARFBUZZ_CORE_VERSION, createHarfBuzzShaper, type HarfBuzzDeps, type HbModule } from './text/harfbuzz.js';

// ─── Text (segmentation — UCD tables, UAX #29 grapheme clusters, UAX #14 line breaking) ──
export {
  UNICODE_VERSION,
  graphemeBreakProperty, lineBreakClass, bidiClass, script, generalCategory, wordBreakProperty, sentenceBreakProperty,
  eastAsianWidth,
  type GraphemeBreakClass, type LineBreakClass, type BidiClass, type ScriptCode, type GeneralCategory,
  type WordBreakClass, type SentenceBreakClass, type EastAsianWidth,
} from './text/ucd.generated.js';
export { graphemeClusters, nextCluster, previousCluster } from './text/grapheme.js';
export { breakOpportunities, type DictionarySegmenter, type BreakOptions, type LineBreakProfile } from './text/linebreak.js';
export { resolveParagraphLevel, bidiLevels, reorderVisual, mirrorChar } from './text/bidi.js';
export { wordBoundaries } from './text/words.js';
export { sentenceBoundaries, sentenceEnds, ABBREVIATIONS, MAY_END_ABBREVIATIONS } from './text/sentences.js';
export { loadDictionary } from './text/dict.js';
export { upperCaseWithMap } from './text/casing.js';
export { smallCapsRuns, type SmallCapsRun } from './text/smallcaps.js';
export { TAB_STOP_EMU, tabAdvance, specialCharWidth, embedWidth, type TabStops, type EmbedSize } from './text/special.js';

// ─── Fonts ──────────────────────────────────────────────────────────────────
// (`FaceId`/`FontFaceMetrics` are already exported above from `./layout/types.js`; this
// module implements them rather than redeclaring them, so they are not re-exported here.)
export {
  FWM_MAGIC, FWM_FORMAT_VERSION, encodeFwm, decodeFwm, advanceTableFor,
  type FwmInput, type FwmRange, type AdvanceTable,
} from './fonts/fwm.js';
export { FONT_ALIASES, aliasFor } from './fonts/aliases.js';
export { createFontRegistry, type FontRegistryHandle, type CreateFontRegistryOptions } from './fonts/registry.js';
export { fallbackChain, tofuFace, scriptOf, cjkRegion, type FallbackScript } from './fonts/fallback.js';
