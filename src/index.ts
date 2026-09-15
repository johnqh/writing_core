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

// ─── Schema ─────────────────────────────────────────────────────────────────
export * from './schema/vocab.js';
export * from './schema/primitives.js';
export * from './schema/template.js';

// ─── Template ───────────────────────────────────────────────────────────────
export * from './template/resolve.js';
export * from './template/validate.js';
export * from './template/flow.js';

// ─── Templates (seeds) ──────────────────────────────────────────────────────
export * from './templates/role-table.js';
export * from './templates/shared.js';

// ─── Templates (built-in) ──────────────────────────────────────────────────
export { GENERATED_TEMPLATES } from './templates/builtin/generated/index.js';
