// ─── Version ────────────────────────────────────────────────────────────────
export { WRITING_CORE_VERSION } from './version.js';

// ─── Units ──────────────────────────────────────────────────────────────────
export * from './units.js';

// ─── Hash ───────────────────────────────────────────────────────────────────
export * from './hash/canonical-json.js';
export * from './hash/sha256.js';

// ─── IDs ────────────────────────────────────────────────────────────────────
export * from './ids/crockford.js';
export * from './ids/id-source.js';
export * from './ids/ids.js';

// ─── Model ──────────────────────────────────────────────────────────────────
export * from './model/positions.js';
export * from './model/origins.js';
export * from './model/ytext.js';
export * from './model/ymap.js';
export * from './model/embed-template.js';
export * from './model/element-record.js';
export * from './model/create.js';
export * from './model/apply-template.js';
export * from './model/portable-pos.js';
export * from './model/remap-ids.js';
export * from './model/json.js';
export * from './model/validate/index.js';
export * from './smarttype/normalize.js';

// ─── Migrations ─────────────────────────────────────────────────────────────
export * from './migrations/index.js';

// ─── Schema ─────────────────────────────────────────────────────────────────
export * from './schema/vocab.js';
export * from './schema/primitives.js';
export * from './schema/template.js';
export * from './schema/text.js';
export * from './schema/entities.js';
export * from './schema/document.js';

// ─── Template ───────────────────────────────────────────────────────────────
export * from './template/resolve.js';
export * from './template/validate.js';
export * from './template/flow.js';

// ─── Templates (seeds) ──────────────────────────────────────────────────────
export * from './templates/role-table.js';
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
