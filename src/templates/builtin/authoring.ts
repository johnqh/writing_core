import { type StyleId, builtinStyleId, deterministicId } from '../../ids/ids.js';
import type { SmartTypeSeed, StyleDef, TemplateJSON } from '../../schema/template.js';
import type { StyleRole } from '../../schema/vocab.js';
import { camelKey } from '../role-table.js';
import { LOCALE_SCRIPT_WORDS } from '../script-words.js';
import {
  DEFAULT_PAGE_NUMBERING, ENGLISH_CONTINUEDS, NOTE_TYPE_SEEDS, REVISION_COLOR_SEEDS, ROOT_STYLE_DEFAULTS,
  TAG_CATEGORY_SEEDS, TITLE_PAGE_STYLES, TRAIT_DEF_SEEDS, defaultPagination, disabledFooter, standardTitlePageSeeds,
} from '../shared.js';

const S = (slug: string | null) => (slug === null ? null : builtinStyleId(slug));

export function styleDef(slug: string, name: string, role: StyleRole, basedOn: string | null, fields: Partial<StyleDef> = {}): StyleDef {
  return { id: builtinStyleId(slug), name, nameKey: `template.style.${camelKey(name)}`, role, basedOn: S(basedOn), shortcut: null, font: {}, ...fields };
}

/** `undefined` leaves the key inherited; `null` means "same style" / "nothing". */
export function flowTo(enter: string | null | undefined, tabEmpty?: string | null, tabText?: string | null): StyleDef['flow'] {
  const flow: NonNullable<StyleDef['flow']> = {};
  if (enter !== undefined) flow.onEnter = S(enter);
  if (tabEmpty !== undefined) flow.onTabEmpty = S(tabEmpty);
  if (tabText !== undefined) flow.onTabText = S(tabText);
  return flow;
}

export function rootStyle(overrides: Partial<StyleDef> = {}): StyleDef {
  return {
    ...ROOT_STYLE_DEFAULTS,
    id: builtinStyleId('normal'), name: 'Normal Text', nameKey: 'template.style.normalText', role: 'normal',
    basedOn: null, shortcut: null, ...overrides,
    font: { ...ROOT_STYLE_DEFAULTS.font, ...(overrides.font ?? {}) },
  };
}

const EN = LOCALE_SCRIPT_WORDS.en;

/** Derived from spec 01 §3.9 (registry R30); never restated. */
export const ENGLISH_SMARTTYPE: SmartTypeSeed = {
  sceneIntros: [...EN.sceneIntros],
  times: [...EN.times],
  extensions: [...EN.extensions],
  transitions: [...EN.transitions],
  characters: [],
  locations: [],
  introSeparator: EN.introSeparator,
  timeSeparator: EN.timeSeparator,
  sortMode: 'alphabetical',
};

export const EMPTY_SMARTTYPE: SmartTypeSeed = { ...ENGLISH_SMARTTYPE, sceneIntros: [], times: [], extensions: [], transitions: [] };

export interface AuthoredTemplateInput extends Pick<TemplateJSON, 'name' | 'category' | 'page' | 'header' | 'styles'> {
  key: string;
  defaults: Partial<TemplateJSON['defaults']> & { firstElement: StyleId };
  pagination?: TemplateJSON['pagination'];
  smartType?: TemplateJSON['smartType'];
  macros?: TemplateJSON['macros'];
  body?: TemplateJSON['body'];
  instructions?: string | null;
}

export function authoredTemplate(input: AuthoredTemplateInput): TemplateJSON {
  const byRole = (role: StyleRole) => input.styles.find((s) => s.role === role)?.id ?? null;
  return {
    schemaVersion: 1,
    id: deterministicId('tpl', ['builtin', input.key]),
    key: input.key,
    version: 1,
    name: input.name,
    nameKey: `template.builtin.${camelKey(input.key)}.name`,
    description: '',
    category: input.category,
    locale: 'en',
    direction: 'ltr',
    layoutMode: 'flow',
    page: input.page,
    header: input.header,
    footer: disabledFooter(),
    styles: input.styles,
    titlePageStyles: [...TITLE_PAGE_STYLES],
    titlePageLayout: { centerTop: 3_200_400 },
    defaults: {
      root: builtinStyleId('normal'),
      pasteFallback: byRole('action') ?? byRole('paragraph') ?? builtinStyleId('normal'),
      sceneHeading: byRole('sceneHeading'), character: byRole('character'), dialogue: byRole('dialogue'),
      parenthetical: byRole('parenthetical'), action: byRole('action'), transition: byRole('transition'),
      titleDefault: builtinStyleId('title_center'),
      ...input.defaults,
    },
    pagination: input.pagination ?? defaultPagination(),
    pageNumbering: DEFAULT_PAGE_NUMBERING,
    sceneNumbering: { styleId: byRole('sceneHeading') ?? input.defaults.firstElement },
    continueds: ENGLISH_CONTINUEDS,
    smartType: input.smartType ?? ENGLISH_SMARTTYPE,
    revisionColors: [...REVISION_COLOR_SEEDS],
    tagCategories: [...TAG_CATEGORY_SEEDS],
    noteTypes: [...NOTE_TYPE_SEEDS],
    traitDefs: [...TRAIT_DEF_SEEDS],
    macros: input.macros ?? [],
    titlePage: standardTitlePageSeeds(),
    body: input.body ?? [{ styleKey: input.defaults.firstElement, text: '' }],
    instructions: input.instructions ?? null,
    importMeta: null,
  };
}
