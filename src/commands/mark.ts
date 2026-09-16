import * as Y from 'yjs';
import { z } from 'zod/v4';
import type { YDeltaOp } from '../model/ytext.js';
import { FontFamilyId, HexColor, Bcp47 } from '../schema/primitives.js';
import { FORMAT_MARKS } from '../schema/text.js';
import { elementIdsBetween, resolveRange } from './element-ops.js';
import { touchElement, writePolicy } from './marks-policy.js';
import { WireRange } from './positions.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

const TOGGLES = { b: ['b', true], i: ['i', true], u: ['u', 'single'], s: ['s', true], sc: ['sc', true], 'va:super': ['va', 'super'], 'va:sub': ['va', 'sub'] } as const;
/**
 * "Clear formatting" clears exactly the formatting marks (spec 01 §5.5) — derived from
 * `FORMAT_MARKS` rather than re-listed, so a mark added to the vocabulary can never be silently
 * left behind (the hand-written copy had already fallen behind on `ln`, `lang` and `nospell`).
 * Change marks (`rev`/`ins`/`del`/`fmt`) and anchor marks (`t:`/`n:`/`s:`) are not formatting and
 * are never touched.
 */
const CLEARABLE: readonly string[] = FORMAT_MARKS;

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

/**
 * The one place a formatting mark is written. `changes` maps mark key → new value (`null` clears).
 * Under Track Changes it also records the `fmt` marker with each key's previous value, so every
 * formatting edit stays reviewable — spec 08 §3.3 item 3.
 */
function applyFormat(ctx: CommandContext, list: Span[], changes: Record<string, unknown>): CommandResult {
  const policy = writePolicy(ctx);
  const keys = Object.keys(changes);
  if (keys.length === 0) return { ok: true };
  for (const s of [...list].reverse()) {
    const attrs: Record<string, unknown> = { ...changes };
    if (policy.track) {
      const before: Record<string, unknown> = {};
      for (const k of keys) before[k] = s.attrs[k] ?? null;
      attrs.fmt = { changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at, before };
    }
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
    return applyFormat(ctx, list, { [key]: allHave ? null : value });
  }),
  spec('mark.set', SetParams, (ctx, p) => {
    const list = spans(ctx, p.range);
    if (!list) return { ok: false, reason: 'invalidPosition' };
    return applyFormat(ctx, list, { [p.mark]: p.value });
  }),
  spec('mark.clear', z.object({ range: WireRange }), (ctx, p) => {
    const list = spans(ctx, p.range);
    if (!list) return { ok: false, reason: 'invalidPosition' };
    // Per span, clear only the marks that span actually carries: writing 13 explicit nulls is a
    // no-op in Yjs either way, but it would make the Track Changes `fmt.before` record a wall of
    // nulls instead of what was really cleared.
    for (const s of list) {
      const changes: Record<string, unknown> = {};
      for (const k of CLEARABLE) if (s.attrs[k] !== undefined) changes[k] = null;
      const r = applyFormat(ctx, [s], changes);
      if (!r.ok) return r;
    }
    return { ok: true };
  }),
];
