import type { StyleRole } from '../schema/vocab.js';

export const BUILTIN_SLOT_ROLES: readonly StyleRole[] = [
  'normal', 'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot',
];

/** Spec 01 §7.5, keys lower-cased. */
const NAME_ROLES: Record<string, StyleRole> = {
  page: 'page', panel: 'panel',
  'new act': 'actStart', 'act break': 'actStart', 'act heading': 'actStart', teaser: 'actStart',
  'teaser/act one': 'actStart', 'cold open': 'actStart', part: 'actStart', episode: 'actStart',
  'end of act': 'actEnd', 'end of teaser': 'actEnd',
  sequence: 'sequence',
  'outline 1': 'outline', 'outline 2': 'outline', 'outline 3': 'outline', section: 'outline',
  summary: 'synopsis', synopsis: 'synopsis',
  note: 'note', notes: 'note',
  notations: 'notation', 'stage direction': 'notation', setting: 'notation',
  'sound effects/music': 'soundCue', sfx: 'soundCue', music: 'soundCue', 'sound cue': 'soundCue',
  lyrics: 'lyrics', singing: 'lyrics',
  'cast list': 'castList',
  'chapter heading': 'chapter', chapter: 'chapter',
  paragraph: 'paragraph', body: 'paragraph',
  subheading: 'subheading',
  quotation: 'quotation', quote: 'quotation',
  'chapter end': 'chapterEnd',
  'block text': 'blockText',
  general: 'normal',
};

const NOT_INHERITED: ReadonlySet<StyleRole> = new Set(['sceneHeading', 'character']);

export function roleForImportedStyle(input: {
  name: string;
  builtinIndex: number | null;
  actBreak: boolean;
  baseRole: StyleRole | null;
}): { role: StyleRole; outlineLevel: number | null } {
  const name = input.name.trim().toLowerCase();
  const named = NAME_ROLES[name];
  if (named) {
    const level = named === 'outline' ? Number(/(\d)$/.exec(name)?.[1] ?? '1') : null;
    return { role: named, outlineLevel: level };
  }
  if (input.builtinIndex !== null && BUILTIN_SLOT_ROLES[input.builtinIndex]) {
    return { role: BUILTIN_SLOT_ROLES[input.builtinIndex]!, outlineLevel: null };
  }
  if (input.actBreak) return { role: 'actStart', outlineLevel: null };
  if (input.baseRole && !NOT_INHERITED.has(input.baseRole)) return { role: input.baseRole, outlineLevel: null };
  return { role: 'normal', outlineLevel: null };
}

const SLUG_OVERRIDES: Record<string, string> = { 'Normal Text': 'normal', 'Chapter Heading': 'chapter' };

export function builtinStyleSlug(name: string): string {
  return SLUG_OVERRIDES[name] ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function camelKey(text: string): string {
  const words = text.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('');
}
