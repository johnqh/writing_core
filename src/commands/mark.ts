import * as Y from 'yjs';
import { z } from 'zod/v4';
import type { YDeltaOp } from '../model/ytext.js';
import { FontFamilyId, HexColor, Bcp47 } from '../schema/primitives.js';
import { elementIdsBetween, resolveRange } from './element-ops.js';
import { touchElement, writePolicy } from './marks-policy.js';
import { WireRange } from './positions.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

const TOGGLES = { b: ['b', true], i: ['i', true], u: ['u', 'single'], s: ['s', true], sc: ['sc', true], 'va:super': ['va', 'super'], 'va:sub': ['va', 'sub'] } as const;
const CLEARABLE = ['b', 'i', 'u', 's', 'sc', 'va', 'fc', 'hl', 'ff', 'fs'] as const;

interface Span { text: Y.Text; element: Y.Map<unknown>; index: number; length: number; attrs: Record<string, unknown> }

function spans(ctx: CommandContext, range: WireRange): Span[] | null {
  const resolved = resolveRange(ctx, range);
  if (!resolved) return null;
  const [from, to] = resolved;
  const out: Span[] = [];
  for (const id of elementIdsBetween(ctx, from.elementId, to.elementId)) {
    const element = ctx.doc.getMap<unknown>('elements').get(id) as Y.Map<unknown>;
    const text = element.get('text') as Y.Text;
    const start = id === from.elementId ? from.index : 0;
    const end = id === to.elementId ? to.index : text.length;
    let pos = 0;
    for (const op of text.toDelta() as YDeltaOp[]) {
      const size = typeof op.insert === 'string' ? op.insert.length : 1;
      const a = Math.max(pos, start);
      const b = Math.min(pos + size, end);
      if (a < b && typeof op.insert === 'string') out.push({ text, element, index: a, length: b - a, attrs: op.attributes ?? {} });
      pos += size;
    }
  }
  return out;
}

function applyFormat(ctx: CommandContext, list: Span[], key: string, value: unknown): CommandResult {
  const policy = writePolicy(ctx);
  for (const s of [...list].reverse()) {
    const attrs: Record<string, unknown> = { [key]: value };
    if (policy.track) attrs.fmt = { changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at, before: { [key]: s.attrs[key] ?? null } };
    s.text.format(s.index, s.length, attrs as Record<string, never>);
    touchElement(s.element, policy);
  }
  return { ok: true };
}

const spec = defineCommand;

const SetParams = z.discriminatedUnion('mark', [
  z.object({ range: WireRange, mark: z.literal('u'), value: z.enum(['single', 'double', 'word', 'dotted']).nullable() }),
  z.object({ range: WireRange, mark: z.literal('fc'), value: HexColor.nullable() }),
  z.object({ range: WireRange, mark: z.literal('hl'), value: HexColor.nullable() }),
  z.object({ range: WireRange, mark: z.literal('ff'), value: FontFamilyId.nullable() }),
  z.object({ range: WireRange, mark: z.literal('fs'), value: z.number().multipleOf(0.5).min(4).max(96).nullable() }),
  z.object({ range: WireRange, mark: z.literal('lang'), value: Bcp47.nullable() }),
  z.object({ range: WireRange, mark: z.literal('nospell'), value: z.literal(true).nullable() }),
]);

export const MARK_COMMANDS: CommandSpec<never>[] = [
  spec('mark.toggle', z.object({ range: WireRange, mark: z.enum(['b', 'i', 'u', 's', 'sc', 'va:super', 'va:sub']) }), (ctx, p) => {
    const list = spans(ctx, p.range);
    if (!list) return { ok: false, reason: 'invalidPosition' };
    if (list.length === 0) return { ok: false, reason: 'emptySelection' };
    const [key, value] = TOGGLES[p.mark];
    const allHave = list.every((s) => s.attrs[key] === value);
    return applyFormat(ctx, list, key, allHave ? null : value);
  }),
  spec('mark.set', SetParams, (ctx, p) => {
    const list = spans(ctx, p.range);
    if (!list) return { ok: false, reason: 'invalidPosition' };
    return applyFormat(ctx, list, p.mark, p.value);
  }),
  spec('mark.clear', z.object({ range: WireRange }), (ctx, p) => {
    const list = spans(ctx, p.range);
    if (!list) return { ok: false, reason: 'invalidPosition' };
    const policy = writePolicy(ctx);
    for (const s of [...list].reverse()) {
      const attrs: Record<string, unknown> = Object.fromEntries(CLEARABLE.map((k) => [k, null]));
      s.text.format(s.index, s.length, attrs as Record<string, never>);
      touchElement(s.element, policy);
    }
    return { ok: true };
  }),
];
