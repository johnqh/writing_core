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
export { registerInvariants, validateDocument } from './model/validate/index.js';
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

// ─── Read model ─────────────────────────────────────────────────────────────
// (raw structure computation behind `openDocument` — readCollection, OrderIndex, computeScenes/
// computeDialogueBlocks/computeOutlineTree, matchesPrefix/rankSuggestions — is in ./internal.js;
// consumers use the `DocumentModel` returned by `openDocument` instead)
export * from './read-model/views.js';
export * from './read-model/open.js';
export * from './read-model/scene-heading.js';
export * from './read-model/number-label.js';

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
