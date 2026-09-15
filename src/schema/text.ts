import { z } from 'zod/v4';
import { isId } from '../ids/ids.js';
import { Emu, JsonValue, Timestamp, idSchema } from './primitives.js';

export const FORMAT_MARKS = ['b', 'i', 'u', 's', 'sc', 'va', 'fc', 'hl', 'ff', 'fs', 'ln', 'lang', 'nospell'] as const;
export type FormatMark = (typeof FORMAT_MARKS)[number];
export const CHANGE_MARKS = ['rev', 'ins', 'del', 'fmt'] as const;
export type ChangeMark = (typeof CHANGE_MARKS)[number];
export const ANCHOR_MARK_PREFIXES = ['t:', 'n:', 's:'] as const;
const ANCHOR_ID_PREFIX = { 't:': 'tag', 'n:': 'note', 's:': 'sug' } as const;

export function isMarkKey(key: string): boolean {
  if ((FORMAT_MARKS as readonly string[]).includes(key) || (CHANGE_MARKS as readonly string[]).includes(key)) return true;
  for (const prefix of ANCHOR_MARK_PREFIXES) {
    if (key.startsWith(prefix)) return isId(ANCHOR_ID_PREFIX[prefix], key.slice(prefix.length));
  }
  return false;
}

export const TextAttrs = z
  .record(z.string(), JsonValue)
  .refine((attrs) => Object.keys(attrs).every(isMarkKey), { message: 'unknown mark attribute' });
export type TextAttrs = z.infer<typeof TextAttrs>;

export const Embed = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), assetId: idSchema('asset'), widthEmu: Emu, heightEmu: Emu, alt: z.string() }),
  z.object({ type: z.literal('revDel'), rev: idSchema('rev'), by: z.string(), at: Timestamp }),
]);
export type Embed = z.infer<typeof Embed>;

export const TextRun = z.object({ text: z.string().min(1), attrs: TextAttrs });
export type TextRun = z.infer<typeof TextRun>;

export const EmbedAt = z.object({ at: z.number().int().min(0), embed: Embed });
export type EmbedAt = z.infer<typeof EmbedAt>;

/** `embeds[].at` indexes the Y.Text (characters and embeds); `plain` and `runs` hold characters only. */
export const TextJSON = z
  .object({ plain: z.string(), runs: z.array(TextRun), embeds: z.array(EmbedAt) })
  .refine((t) => t.runs.map((r) => r.text).join('') === t.plain, { message: 'runs must concatenate to plain' })
  .refine((t) => t.embeds.every((e, i) => i === 0 || e.at > t.embeds[i - 1]!.at), { message: 'embeds must be strictly ordered' });
export type TextJSON = z.infer<typeof TextJSON>;

export function emptyTextJSON(): TextJSON {
  return { plain: '', runs: [], embeds: [] };
}

export function textJSONFromPlain(plain: string): TextJSON {
  return { plain, runs: plain ? [{ text: plain, attrs: {} }] : [], embeds: [] };
}
