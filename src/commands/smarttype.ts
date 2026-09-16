import * as Y from 'yjs';
import { z } from 'zod/v4';
import { generatePositions, positionBetween } from '../model/positions.js';
import { lastPosition } from '../model/ymap.js';
import { STORED_SMARTTYPE_LISTS } from '../schema/vocab.js';
import { harvest } from '../smarttype/harvest.js';
import { normalizeKey } from '../smarttype/normalize.js';
import { lang } from './element-ops.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandSpec } from './types.js';

type Entry = { text: string; pos: string; origin: 'seed' | 'harvested' | 'manual'; count: number };
const List = z.enum(STORED_SMARTTYPE_LISTS);
const spec = defineCommand;
const entries = (ctx: CommandContext, list: string) => ctx.doc.getMap<unknown>('smartType').get(list) as Y.Map<Entry>;
const dismissed = (ctx: CommandContext) => ctx.doc.getMap<unknown>('smartType').get('dismissed') as Y.Map<true>;

export const SMARTTYPE_COMMANDS: CommandSpec<never>[] = [
  spec('smartType.addEntry', z.object({ list: List, text: z.string().min(1) }), (ctx, p) => {
    const map = entries(ctx, p.list);
    const key = normalizeKey(p.text, { language: lang(ctx) });
    dismissed(ctx).delete(`${p.list}:${key}`);
    if (!map.has(key)) map.set(key, { text: p.text, pos: positionBetween(lastPosition(map as Y.Map<unknown>), null, ctx.ids), origin: 'manual', count: 0 });
    return { ok: true };
  }),
  spec('smartType.removeEntry', z.object({ list: List, key: z.string().min(1) }), (ctx, p) => {
    entries(ctx, p.list).delete(p.key);
    dismissed(ctx).set(`${p.list}:${p.key}`, true);
    return { ok: true };
  }),
  spec('smartType.reorder', z.object({ list: List, keys: z.array(z.string()).min(1) }), (ctx, p) => {
    const map = entries(ctx, p.list);
    if (p.keys.some((k) => !map.has(k))) return { ok: false, reason: 'notFound' };
    const rest = [...map.entries()].filter(([k]) => !p.keys.includes(k)).sort((a, b) => (a[1].pos < b[1].pos ? -1 : 1)).map(([k]) => k);
    const order = [...p.keys, ...rest];
    const positions = generatePositions(order.length, null, null, ctx.ids);
    order.forEach((k, i) => map.set(k, { ...map.get(k)!, pos: positions[i]! }));
    return { ok: true };
  }),
  spec('smartType.alphabetize', z.object({ list: List }), (ctx, p) => {
    const map = entries(ctx, p.list);
    const language = lang(ctx);
    // `new Intl.Collator` is banned by the platform-free guard; `localeCompare` with an
    // explicit locale gives the same base-sensitivity comparison (see read-model/open.ts).
    const order = [...map.entries()].sort((a, b) => a[1].text.localeCompare(b[1].text, language, { sensitivity: 'base' })).map(([k]) => k);
    const positions = generatePositions(order.length, null, null, ctx.ids);
    order.forEach((k, i) => map.set(k, { ...map.get(k)!, pos: positions[i]! }));
    return { ok: true };
  }),
  spec('smartType.rebuild', z.object({}), (ctx) => {
    harvest(ctx);
    return { ok: true };
  }),
  spec('smartType.cleanup', z.object({ list: List, merges: z.array(z.object({ from: z.array(z.string()).min(1), into: z.string() })).min(1) }), (ctx, p) => {
    const map = entries(ctx, p.list);
    for (const m of p.merges) if (!map.has(m.into) || m.from.some((k) => !map.has(k))) return { ok: false, reason: 'notFound' };
    for (const m of p.merges) {
      const target = map.get(m.into)!;
      let count = target.count;
      for (const k of m.from) {
        count += map.get(k)!.count;
        map.delete(k);
        dismissed(ctx).set(`${p.list}:${k}`, true);
      }
      map.set(m.into, { ...target, count });
    }
    return { ok: true };
  }),
];
