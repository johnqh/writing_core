/**
 * Spec 02 §9.2: pagination categories. Every element maps to exactly one, taken from the role of
 * the style that governs pagination (`ResolvedStyle.paginationRole`) — the `paginateAs` target's
 * role when set, otherwise the element's own role (spec 01 §3.4.2 rule 5). Every paginator rule in
 * this milestone keys off the category, not the raw `StyleRole`.
 */

import type { ResolvedStyle } from '../template/resolve.js';
import { PAGINATION_CATEGORIES, type PaginationCategory, type StyleRole } from '../schema/vocab.js';
import type { LayoutDiagnostic } from './types.js';

// `PAGINATION_CATEGORIES` is declared once, with every other closed vocabulary, in
// `schema/vocab.ts`; re-exported here so a consumer of this module does not also need to import
// from `schema/vocab.js` for it.
export { PAGINATION_CATEGORIES };
export type { PaginationCategory };

/**
 * Spec 02 §9.2 table columns.
 * - `keepsWithNext`: `'always'` forces the keep regardless of the resolved style, `false` forbids
 *   it, `'style'` defers to the resolved style's own `keepWithNext` ("style value" in the table).
 * - `dialogueBlock`: `'start'` opens a dialogue block (character cue), `'member'` is a block member
 *   (parenthetical/dialogue), `false` is not part of one.
 */
export interface CategoryRule {
  splittable: boolean;
  keepsWithNext: 'always' | 'style' | false;
  keepsWithPrevious: boolean;
  dialogueBlock: 'start' | 'member' | false;
  sceneBoundary: boolean;
}

/** Spec 02 §9.2, transcribed row for row. */
export const CATEGORY_RULES: Record<PaginationCategory, CategoryRule> = {
  general: { splittable: true, keepsWithNext: 'style', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: false },
  sceneHeading: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: true },
  action: { splittable: true, keepsWithNext: 'style', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: false },
  character: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: 'start', sceneBoundary: false },
  parenthetical: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: 'member', sceneBoundary: false },
  dialogue: { splittable: true, keepsWithNext: 'style', keepsWithPrevious: false, dialogueBlock: 'member', sceneBoundary: false },
  transition: { splittable: false, keepsWithNext: false, keepsWithPrevious: true, dialogueBlock: false, sceneBoundary: false },
  shot: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: false },
  actBreak: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: true },
  pageHeading: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: true },
  panelHeading: { splittable: false, keepsWithNext: 'always', keepsWithPrevious: false, dialogueBlock: false, sceneBoundary: false },
};

/** Spec 02 §9.2 table, "Roles" column, inverted: every `StyleRole` maps to exactly one category. */
const ROLE_TO_CATEGORY: Record<StyleRole, PaginationCategory> = {
  normal: 'general', castList: 'general', synopsis: 'general', note: 'general', notation: 'general',
  paragraph: 'general', quotation: 'general', blockText: 'general', titleText: 'general', outline: 'general',
  sceneHeading: 'sceneHeading', chapter: 'sceneHeading',
  action: 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue', lyrics: 'dialogue',
  transition: 'transition', actEnd: 'transition', chapterEnd: 'transition',
  shot: 'shot', soundCue: 'shot', subheading: 'shot', sequence: 'shot',
  actStart: 'actBreak',
  page: 'pageHeading',
  panel: 'panelHeading',
};

/**
 * Spec 02 §9.2: the category of `style`. `style.paginationRole` already reflects the cycle-safe
 * `paginateAs` walk `resolveStyle` performs (M1's punch-list item); this function only maps it to
 * a category and — since `resolveStyle` is memoized and frozen with no per-call sink of its own —
 * reports a cycle that walk hit through `onDiagnostic` as spec 02 §9.1's `styleCycle` diagnostic.
 *
 * `actBreak: true` on the element's own style forces the `actBreak` category regardless of role
 * (§9.2 table: "`actStart`, and any style with `actBreak: true`"); spec 01 §3.4.2 rule 5 excludes
 * `actBreak` from what `paginateAs` borrows, so this reads the resolved style's own value, not the
 * governing style's.
 */
export function categoryOf(style: ResolvedStyle, onDiagnostic?: (diagnostic: LayoutDiagnostic) => void): PaginationCategory {
  if (style.paginationRoleCycle && onDiagnostic) {
    onDiagnostic({ code: 'styleCycle', elementId: null, pageIndex: null, detail: { styleId: style.id } });
  }
  if (style.actBreak) return 'actBreak';
  return ROLE_TO_CATEGORY[style.paginationRole];
}
