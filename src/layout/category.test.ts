import { describe, expect, it } from 'vitest';
import type { StyleId } from '../ids/ids.js';
import { STYLE_ROLES, type StyleRole } from '../schema/vocab.js';
import { minimalTemplate } from '../test-fixtures/minimal-template.js';
import { type ResolvedStyle, resolveStyle } from '../template/resolve.js';
import { CATEGORY_RULES, type CategoryRule, PAGINATION_CATEGORIES, type PaginationCategory, categoryOf } from './category.js';
import type { LayoutDiagnostic } from './types.js';

const S = (s: string) => s as StyleId;

/** A minimal, otherwise-neutral `ResolvedStyle` for `role`, standing in for a full template resolution. */
function styleWithRole(role: StyleRole, overrides: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return {
    id: S(`st_${role}`), name: role, nameKey: null, role, paginationRole: role, paginationRoleCycle: false,
    basedOn: null, shortcut: null,
    font: { family: 'courier-screenplay', size: 12, bold: false, italic: false, underline: null, strike: false, smallCaps: false, color: '#000000' },
    allCaps: false, align: 'left', indentLeft: 0, indentRight: 0, indentFirstLine: 0, spaceBefore: 0, lineSpacing: 1,
    column: 0, keepWithNext: false, keepTogether: false, splitRule: 'lines', pageBreakBefore: false, actBreak: false,
    paginateAs: null, hiddenInScript: false, printable: true, outlineLevel: 0,
    flow: { onEnter: null, onEnterEmpty: 'picker', onTabEmpty: null, onTabText: null, onShiftTabEmpty: null },
    numbering: null, prefix: '', suffix: '', smartTypeList: null, dualDialogue: false,
    leadingAdjust: 0, direction: 'auto', anchor: 'flow',
    ...overrides,
  };
}

describe('categoryOf', () => {
  it('defaults paginationRole to the style\'s own role when paginateAs is unset', () => {
    // Exercises resolveStyle's default-path initialization directly (no paginateAs hop rewrites
    // it), unlike styleWithRole()'s hand-built fixtures below, which set paginationRole themselves
    // and so cannot catch a bug in that default.
    const t = minimalTemplate();
    const resolved = resolveStyle(t, S('st_action'));
    expect(resolved.paginateAs).toBeNull();
    expect(resolved.role).toBe('action');
    expect(resolved.paginationRole).toBe('action');
    expect(categoryOf(resolved)).toBe('action');
  });

  it('follows paginateAs to the governing role, not the leaf role', () => {
    const t = minimalTemplate();
    const styles = [
      ...t.styles,
      { id: S('st_lyrics'), name: 'Lyrics', nameKey: null, role: 'lyrics' as const, basedOn: S('st_dialogue'), shortcut: null, font: { italic: true }, paginateAs: S('st_dialogue') },
    ];
    // Lyrics styled as dialogue: paginationRole is 'dialogue', role stays 'lyrics'.
    const resolved = resolveStyle({ ...t, styles }, S('st_lyrics'));
    expect(resolved.role).toBe('lyrics');
    expect(resolved.paginationRole).toBe('dialogue');
    expect(categoryOf(resolved)).toBe('dialogue');
  });

  it('uses the governing role for the category, not the leaf role, when they map to different categories', () => {
    // A shot paginated as a scene heading (role 'shot', category 'shot' on its own) must categorize
    // as sceneHeading — this is the case a categoryOf that reads `.role` instead of
    // `.paginationRole` cannot distinguish from correct behaviour in the lyrics/dialogue case above,
    // because lyrics's own role already maps to the 'dialogue' category.
    const t = minimalTemplate();
    const styles = [
      ...t.styles,
      { id: S('st_shot_as_heading'), name: 'Shot as heading', nameKey: null, role: 'shot' as const, basedOn: S('st_normal'), shortcut: null, font: {}, paginateAs: S('st_scene_heading') },
    ];
    const resolved = resolveStyle({ ...t, styles }, S('st_shot_as_heading'));
    expect(resolved.role).toBe('shot');
    expect(resolved.paginationRole).toBe('sceneHeading');
    expect(categoryOf(resolved)).toBe('sceneHeading');
  });

  it('terminates on a paginateAs cycle, keeps the last resolved values and reports styleCycle', () => {
    // A→B→A must not recurse (M1 fixed this in resolveStyle; the category must inherit it).
    const t = minimalTemplate();
    const styles = t.styles.map((s) =>
      s.id === S('st_action') ? { ...s, paginateAs: S('st_character') } : s.id === S('st_character') ? { ...s, paginateAs: S('st_action') } : s,
    );
    const cyclic = resolveStyle({ ...t, styles }, S('st_character'));
    expect(cyclic.paginationRoleCycle).toBe(true);
    const seen: LayoutDiagnostic[] = [];
    expect(() => categoryOf(cyclic, (d) => seen.push(d))).not.toThrow();
    expect(categoryOf(cyclic)).toBe('action'); // the role at the break point
    expect(seen.map((d) => d.code)).toEqual(['styleCycle']);
  });

  it('does not report styleCycle for an ordinary (non-cyclic) paginateAs chain', () => {
    const t = minimalTemplate();
    const styles = t.styles.map((s) => (s.id === S('st_action') ? { ...s, paginateAs: S('st_scene_heading') } : s));
    const resolved = resolveStyle({ ...t, styles }, S('st_action'));
    expect(resolved.paginationRoleCycle).toBe(false);
    const seen: LayoutDiagnostic[] = [];
    categoryOf(resolved, (d) => seen.push(d));
    expect(seen).toEqual([]);
  });

  it('forces the actBreak category for any style with actBreak: true, regardless of role', () => {
    expect(categoryOf(styleWithRole('action', { actBreak: true }))).toBe('actBreak');
    expect(categoryOf(styleWithRole('dialogue', { actBreak: true }))).toBe('actBreak');
  });

  // `toBeDefined()` over a function that returns a string can never fail, and a Set
  // size tells us nothing about WHICH category each role got. Pin the whole map.
  it('maps every StyleRole to the §9.2 category', () => {
    const EXPECTED: Record<StyleRole, PaginationCategory> = {
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
    expect(STYLE_ROLES.length).toBe(27); // all 27 are accounted for
    for (const role of STYLE_ROLES) expect(categoryOf(styleWithRole(role)), role).toBe(EXPECTED[role]);
  });

  it('gives each category the §9.2 rules', () => {
    expect(CATEGORY_RULES.sceneHeading).toMatchObject({ splittable: false, keepsWithNext: 'always', sceneBoundary: true });
    expect(CATEGORY_RULES.transition).toMatchObject({ keepsWithPrevious: true, keepsWithNext: false });
    expect(CATEGORY_RULES.character).toMatchObject({ dialogueBlock: 'start', splittable: false });
  });

  it('gives every category exactly the §9.2 table', () => {
    const EXPECTED: Record<PaginationCategory, CategoryRule> = {
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
    expect(PAGINATION_CATEGORIES.length).toBe(11);
    for (const category of PAGINATION_CATEGORIES) expect(CATEGORY_RULES[category], category).toEqual(EXPECTED[category]);
  });
});
