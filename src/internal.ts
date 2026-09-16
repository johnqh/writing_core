// ─── writing_core internal surface ─────────────────────────────────────────
//
// Everything here bypasses at least one guarantee the command framework
// (`./index.js`) gives a consumer for free: capability checks, the write
// policy, rehearsal-before-commit, or undo-origin tracking. It is not part
// of the package's consumer-facing contract — importing from
// `@sudobility/writing_core/internal` is an explicit, deliberate opt-out for
// code that is itself extending the framework (a new command, a new
// invariant, an importer writing raw document records), not for editor or
// application code, which should only ever need `./index.js`.
//
// `src/__guards/public-api.test.ts` pins this file's exact export surface;
// adding a name here (or moving one from `./index.ts`) must be deliberate.

// ─── IDs (ULID/base32 encoding internals) ──────────────────────────────────
export * from './ids/crockford.js';

// ─── Units (import-format conversions, no consumer of M1-M6 needs these
//     directly; kept for a future importer package) ────────────────────────
export {
  osfToEmu, snapToHundredthInch, fdxLeftIndentToEmu, fdxRightIndentToEmu, fdxSpaceBeforeToLines,
} from './units.js';

// ─── Model: raw Y.Doc / Y.Map / Y.Text record access ───────────────────────
export * from './model/ymap.js';
export * from './model/embed-template.js';
export * from './model/element-record.js';
export { type DualMember, type DualRun, dualRuns } from './model/dual-runs.js';
export { systemOrigin } from './model/origins.js';
export { writeTextJSON } from './model/ytext.js';
export {
  readElementRecord, writeElementRecord, readEntity, writeEntity, readNote, readTextKeyed,
} from './model/json.js';
export { mapStyle } from './model/apply-template.js';
export { generatePositions, rebalancePositions } from './model/positions.js';

// ─── Model: validation authoring helpers (for registering new Invariants) ──
export { issue } from './model/validate/types.js';
export { allTexts, createValidationContext, BUILTIN_STYLE_ROLES } from './model/validate/context.js';

// ─── Templates: string-casing helper for role-table generation ────────────
export { camelKey } from './templates/role-table.js';

// ─── Template resolution internals ─────────────────────────────────────────
export { styleChain } from './template/resolve.js';

// ─── Commands: framework machinery for command authors ────────────────────
export * from './commands/element-ops.js';
export * from './commands/marks-policy.js';
export { type ResolvedPos, resolveWirePos, relPos, orderRange } from './commands/positions.js';
export * from './commands/segment.js';

// ─── Read model: raw structure computation (consumers use `DocumentModel`
//     from `openDocument` instead) ──────────────────────────────────────────
export * from './read-model/collections.js';
export * from './read-model/order-index.js';
export * from './read-model/structure.js';
export * from './read-model/suggestions.js';
