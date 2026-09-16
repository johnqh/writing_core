// src/commands/element.ts
import * as Y from 'yjs';
import { z } from 'zod/v4';
import { type ElementId, type StyleId, newId } from '../ids/ids.js';
import { generatePositions } from '../model/positions.js';
import { setJSONMap } from '../model/ymap.js';
import type { YDeltaOp } from '../model/ytext.js';
import { idSchema, StyleIdSchema } from '../schema/primitives.js';
import { ElementOverrides } from '../schema/template.js';
import { SPEAKER_ROLES, SPEECH_MEMBER_ROLES } from '../schema/vocab.js';
import { enterAction, shiftTabAction, tabAction } from '../template/flow.js';
import { resolveStyle } from '../template/resolve.js';
import { bodyElements, createElement, dualGroupOf, repairDualRuns } from './element-ops.js';
import { insertAttributes, touchElement, writePolicy } from './marks-policy.js';
import { WireDocPos, resolveWirePos } from './positions.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;
const ElementIdParam = idSchema('el');

const spec = defineCommand;

/**
 * Opts a command out of `executeBatch`'s throwaway-replica rehearsal (see `CommandSpec.fastPath`
 * and execute.ts). Rehearsal clones the whole document, so it costs O(document size) per
 * invocation — about 46 ms at 3000 elements against spec 08 §15's 24 ms keystroke budget on a
 * slower device. The three commands marked here are the keyboard hot path alongside text.ts's
 * four (Enter → `element.split`, Tab / Shift-Tab → `element.cycleStyle`, the style shortcuts and
 * the style menu → `element.setStyle`), and each provably refuses before its first write:
 *
 * - `element.setStyle` — both refusals (`styleNotInTemplate`, `notFound`) are checked over every
 *   requested element up front; the `applyStyle` loop that follows cannot refuse (it returns void).
 * - `element.cycleStyle` — the `notFound` refusal is first; after that `tabAction`/`shiftTabAction`
 *   are pure, and the trailing `notApplicable` is reached only on the paths where neither the
 *   `convert` nor the `insertAfter` branch ran, i.e. with nothing written.
 * - `element.split` — `invalidPosition` is first; `enterAction` is pure, and its `openPicker`,
 *   `none` and default refusals all return straight out of the switch before any branch writes.
 *
 * `src/commands/element.test.ts` pins that contract with refusal-leaves-nothing-behind tests, and
 * `src/commands/builtin.test.ts` pins the allowlist itself.
 */
const fast = <P>(s: CommandSpec<P>): CommandSpec<P> => ({ ...s, fastPath: true });

const styleExists = (ctx: CommandContext, style: string) => ctx.model.template().styles.some((s) => s.id === style);
const record = (ctx: CommandContext, id: string) => bodyElements(ctx.doc).get(id) as YMap | undefined;

function applyStyle(ctx: CommandContext, id: ElementId, style: StyleId): void {
  const el = record(ctx, id)!;
  const from = el.get('style') as StyleId;
  if (from === style) return;
  const policy = writePolicy(ctx);
  el.set('style', style);
  const role = resolveStyle(ctx.model.template(), style).role;
  const speechRoles: readonly string[] = [...SPEAKER_ROLES, ...SPEECH_MEMBER_ROLES];
  if (el.has('dual') && !speechRoles.includes(role)) el.delete('dual');
  if (policy.track) el.set('tc', { kind: 'style', changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at, fromStyle: from });
  if (policy.revisionSetId) {
    const text = el.get('text') as Y.Text;
    if (text.length > 0) text.format(0, text.length, { rev: policy.revisionSetId });
  }
  touchElement(el, policy);
}

function neighboursExcluding(ctx: CommandContext, moving: ReadonlySet<string>, to: { after?: ElementId | null; before?: ElementId }): { after: string | null; before: string | null } | null {
  const order = ctx.model.elements().map((e) => e.id as string).filter((id) => !moving.has(id));
  if (to.before !== undefined) {
    if (moving.has(to.before)) return null;
    const i = order.indexOf(to.before);
    if (i < 0) return null;
    return { after: order[i - 1] ?? null, before: to.before };
  }
  if (to.after === null || to.after === undefined) return { after: order[order.length - 1] ?? null, before: null };
  if (moving.has(to.after)) return null;
  const i = order.indexOf(to.after);
  if (i < 0) return null;
  return { after: to.after, before: order[i + 1] ?? null };
}

function moveIds(ctx: CommandContext, ids: ElementId[], to: { after?: ElementId | null; before?: ElementId }): CommandResult {
  const ordered = [...new Set(ids)].sort((a, b) => ctx.model.indexOf(a) - ctx.model.indexOf(b));
  if (ordered.some((id) => ctx.model.indexOf(id) < 0)) return { ok: false, reason: 'notFound' };
  const n = neighboursExcluding(ctx, new Set(ordered), to);
  if (!n) return { ok: false, reason: 'notApplicable' };
  const pos = (id: string | null) => (id ? String(record(ctx, id)!.get('pos')) : null);
  const keys = generatePositions(ordered.length, pos(n.after), pos(n.before), ctx.ids);
  // Moving part of a dual-dialogue run out of it (or into the middle of another one) breaks I7,
  // so remember the groups involved before the positions change (spec 01 §5.3.4).
  const groups = ordered.map((id) => dualGroupOf(record(ctx, id))).filter((g): g is string => g !== null);
  ordered.forEach((id, i) => record(ctx, id)!.set('pos', keys[i]!));
  repairDualRuns(ctx, groups);
  return { ok: true };
}

const MoveTarget = z.union([z.object({ after: ElementIdParam.nullable() }), z.object({ before: ElementIdParam })]);

const OverrideParams = z.object({
  elements: z.array(ElementIdParam).min(1),
  key: z.enum(['align', 'indentLeft', 'indentRight', 'indentFirstLine', 'spaceBefore', 'lineSpacing', 'keepWithNext', 'pageBreakBefore', 'column', 'leadingAdjust', 'direction']),
  value: z.unknown(),
}).superRefine((p, ctx) => {
  if (p.value === null) return;
  const r = (ElementOverrides.shape[p.key] as z.ZodType).safeParse(p.value);
  if (!r.success) ctx.addIssue({ code: 'custom', message: `invalid value for ${p.key}`, path: ['value'] });
});

export const ELEMENT_COMMANDS: CommandSpec<never>[] = [
  spec('element.insert', z.object({ after: ElementIdParam.nullable().optional(), before: ElementIdParam.optional(), style: StyleIdSchema, text: z.string().optional(), ov: ElementOverrides.optional() }), (ctx, p) => {
    if (!styleExists(ctx, p.style)) return { ok: false, reason: 'styleNotInTemplate' };
    let after: ElementId | null;
    if (p.before !== undefined) {
      if (ctx.model.indexOf(p.before) < 0) return { ok: false, reason: 'notFound' };
      after = ctx.model.previous(p.before)?.id ?? null;
    } else if (p.after) {
      if (ctx.model.indexOf(p.after) < 0) return { ok: false, reason: 'notFound' };
      after = p.after;
    } else {
      const count = ctx.model.elementCount();
      after = count > 0 ? ctx.model.elementAt(count - 1).id : null;
    }
    const id = createElement(ctx, { after, style: p.style, text: p.text ? { plain: p.text, runs: [{ text: p.text, attrs: {} }], embeds: [] } : undefined, ov: p.ov });
    return { ok: true, effects: [{ kind: 'elementCreated', id }] };
  }),

  fast(spec('element.split', z.object({ at: WireDocPos }), (ctx, p) => {
    const r = resolveWirePos(ctx.doc, p.at);
    if (!r) return { ok: false, reason: 'invalidPosition' };
    const style = r.element.get('style') as StyleId;
    const template = ctx.model.template();
    const enterOnBlank = ctx.model.settings().enterOnBlank;
    const action = enterAction(template, style, { empty: r.text.length === 0, caretAtEnd: r.index === r.text.length, enterOnBlank });
    const dualRecord = r.element.get('dual') as { group: string; side: 'left' | 'right' } | undefined;
    const dualGroup = dualGroupOf(r.element);
    switch (action.kind) {
      case 'openPicker':
        return { ok: false, reason: 'notApplicable', detail: { action: 'openPicker' } };
      case 'none':
        return { ok: false, reason: 'notApplicable' };
      case 'convert':
        applyStyle(ctx, r.elementId, action.style);
        repairDualRuns(ctx, dualGroup ? [dualGroup] : []);
        return { ok: true };
      case 'insertAfter': {
        const id = createElement(ctx, { after: r.elementId, style: action.style });
        repairDualRuns(ctx, dualGroup ? [dualGroup] : []);
        return { ok: true, effects: [{ kind: 'elementCreated', id }], selection: { anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: 0 } } };
      }
      case 'split': {
        const tail: YDeltaOp[] = [];
        let pos = 0;
        for (const op of r.text.toDelta() as YDeltaOp[]) {
          const size = typeof op.insert === 'string' ? op.insert.length : 1;
          if (pos + size > r.index) {
            const insert = typeof op.insert === 'string' ? op.insert.slice(Math.max(0, r.index - pos)) : op.insert;
            tail.push(op.attributes ? { insert, attributes: op.attributes } : { insert });
          }
          pos += size;
        }
        // Which `t:` tag and `n:` note marks end up wholly in the tail: those records' anchors
        // have to follow their marks to the new element. (`n:` was missed — the marks travelled
        // with the delta but the `notes` record kept pointing at the head.)
        const tailAnchors = new Set<string>();
        const headAnchors = new Set<string>();
        pos = 0;
        for (const op of r.text.toDelta() as YDeltaOp[]) {
          const size = typeof op.insert === 'string' ? op.insert.length : 1;
          for (const key of Object.keys(op.attributes ?? {})) {
            if (!key.startsWith('t:') && !key.startsWith('n:')) continue;
            if (pos < r.index) headAnchors.add(key);
            if (pos + size > r.index) tailAnchors.add(key);
          }
          pos += size;
        }
        const movesToTail = (key: string) => tailAnchors.has(key) && !headAnchors.has(key);
        const id = createElement(ctx, { after: r.elementId, style: action.style });
        const newRecord = record(ctx, id)!;
        // enterAction's `split` keeps the current style, so the tail is as valid a member of the
        // dual run as the head was; carrying `dual` over keeps the run intact (spec 01 §5.3.4)
        // instead of punching a dual-less element into the middle of it.
        if (dualRecord) newRecord.set('dual', { ...dualRecord });
        const newText = newRecord.get('text') as Y.Text;
        newText.applyDelta(tail);
        r.text.delete(r.index, r.text.length - r.index);
        for (const v of ctx.doc.getMap('tags').values()) {
          const tag = v as YMap;
          if (tag.get('elementId') === r.elementId && movesToTail(`t:${String(tag.get('id'))}`)) tag.set('elementId', id);
        }
        for (const v of ctx.doc.getMap('notes').values()) {
          const note = v as YMap;
          const anchor = note.get('anchor') as { kind: string; elementId?: string } | undefined;
          if (!anchor || anchor.elementId !== r.elementId) continue;
          if (movesToTail(`n:${String(note.get('id'))}`)) note.set('anchor', { ...anchor, elementId: id });
        }
        touchElement(r.element, writePolicy(ctx));
        repairDualRuns(ctx, dualGroup ? [dualGroup] : []);
        return { ok: true, effects: [{ kind: 'elementCreated', id }], selection: { anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: 0 } } };
      }
      default:
        return { ok: false, reason: 'notApplicable' };
    }
  })),

  fast(spec('element.setStyle', z.object({ elements: z.array(ElementIdParam).min(1), style: StyleIdSchema }), (ctx, p) => {
    if (!styleExists(ctx, p.style)) return { ok: false, reason: 'styleNotInTemplate' };
    if (p.elements.some((id) => !record(ctx, id))) return { ok: false, reason: 'notFound' };
    const groups = p.elements.map((id) => dualGroupOf(record(ctx, id))).filter((g): g is string => g !== null);
    for (const id of p.elements) applyStyle(ctx, id, p.style);
    repairDualRuns(ctx, groups);
    return { ok: true };
  })),

  fast(spec('element.cycleStyle', z.object({ element: ElementIdParam, direction: z.enum(['tabForward', 'tabBack']), caretAtEnd: z.boolean() }), (ctx, p) => {
    const el = record(ctx, p.element);
    if (!el) return { ok: false, reason: 'notFound' };
    const style = el.get('style') as StyleId;
    const empty = (el.get('text') as Y.Text).length === 0;
    const template = ctx.model.template();
    const action = p.direction === 'tabForward' ? tabAction(template, style, { empty, caretAtEnd: p.caretAtEnd }) : shiftTabAction(template, style, { empty });
    const group = dualGroupOf(el);
    if (action.kind === 'convert') {
      applyStyle(ctx, p.element, action.style);
      repairDualRuns(ctx, group ? [group] : []);
      return { ok: true };
    }
    if (action.kind === 'insertAfter') {
      const id = createElement(ctx, { after: p.element, style: action.style });
      repairDualRuns(ctx, group ? [group] : []);
      return { ok: true, effects: [{ kind: 'elementCreated', id }] };
    }
    return { ok: false, reason: 'notApplicable', detail: { action: action.kind, ...('list' in action ? { list: action.list } : {}) } };
  })),

  spec('element.move', z.object({ elements: z.array(ElementIdParam).min(1), to: MoveTarget }), (ctx, p) => moveIds(ctx, p.elements, p.to)),

  spec('scene.move', z.object({ scenes: z.array(ElementIdParam).min(1), to: MoveTarget }), (ctx, p) => {
    const ids: ElementId[] = [];
    for (const sceneId of p.scenes) {
      const scene = ctx.model.scene(sceneId);
      if (!scene) return { ok: false, reason: 'notFound' };
      ids.push(...scene.elementIds);
    }
    let to = p.to;
    if ('after' in to && to.after) {
      const target = ctx.model.scene(to.after);
      if (target) to = { after: target.elementIds[target.elementIds.length - 1]! };
    }
    return moveIds(ctx, ids, to);
  }, { scope: 'structure' }),

  spec('element.duplicate', z.object({ elements: z.array(ElementIdParam).min(1) }), (ctx, p) => {
    const ordered = [...p.elements].sort((a, b) => ctx.model.indexOf(a) - ctx.model.indexOf(b));
    if (ordered.some((id) => ctx.model.indexOf(id) < 0)) return { ok: false, reason: 'notFound' };
    const container = bodyElements(ctx.doc);
    const tags = ctx.doc.getMap<unknown>('tags');
    const policy = writePolicy(ctx);
    let after: ElementId = ordered[ordered.length - 1]!;
    const effects: { kind: 'elementCreated'; id: string }[] = [];
    for (const sourceId of ordered) {
      const source = container.get(sourceId) as YMap;
      const ov = source.get('ov') instanceof Y.Map ? ((source.get('ov') as YMap).toJSON() as ElementOverrides) : undefined;
      const id = createElement(ctx, { after, style: source.get('style') as StyleId, ov });
      const tagMap = new Map<string, string>();
      const delta: YDeltaOp[] = [];
      for (const op of (source.get('text') as Y.Text).toDelta() as YDeltaOp[]) {
        // Text the source has marked pending-delete is content it no longer has; a duplicate
        // reproduces what the element reads now, so those runs are not copied at all.
        if (op.attributes?.del !== undefined) continue;
        const attributes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.attributes ?? {})) {
          if (k.startsWith('n:') || k.startsWith('s:')) continue;
          if (k.startsWith('t:')) {
            const oldTag = k.slice(2);
            if (!tagMap.has(oldTag)) tagMap.set(oldTag, newId('tag', ctx.ids));
            attributes[`t:${tagMap.get(oldTag)}`] = v;
          } else attributes[k] = v;
        }
        // The copied text is THIS edit: `insertAttributes` drops the source's rev/ins/del/fmt
        // records (which belong to somebody else's changeId) and stamps the current write policy's
        // revision set and Track Changes insertion instead (spec 08 §3.3 item 3).
        const withPolicy = insertAttributes(policy, attributes);
        delta.push(Object.keys(withPolicy).length > 0 ? { insert: op.insert, attributes: withPolicy } : { insert: op.insert });
      }
      ((container.get(id) as YMap).get('text') as Y.Text).applyDelta(delta);
      for (const [oldTag, newTag] of tagMap) {
        const old = tags.get(oldTag) as YMap | undefined;
        if (!old) continue;
        setJSONMap(tags, newTag, { ...(old.toJSON() as Record<string, unknown>), id: newTag, elementId: id, createdBy: ctx.actor.userId, createdAt: ctx.clock() });
      }
      effects.push({ kind: 'elementCreated', id });
      after = id;
    }
    // The copy has no `dual`, so duplicating a member lands a dual-less element in the middle of
    // the run (spec 01 §5.3.4 / I7).
    repairDualRuns(ctx, ordered.map((id) => dualGroupOf(container.get(id) as YMap | undefined)).filter((g): g is string => g !== null));
    return { ok: true, effects };
  }),

  spec('element.setOverride', OverrideParams, (ctx, p) => {
    if (p.elements.some((id) => !record(ctx, id))) return { ok: false, reason: 'notFound' };
    const policy = writePolicy(ctx);
    for (const id of p.elements) {
      const el = record(ctx, id)!;
      let ov = el.get('ov') as YMap | undefined;
      if (p.value === null) {
        ov?.delete(p.key);
        if (ov && ov.size === 0) el.delete('ov');
      } else {
        if (!ov) ov = el.set('ov', new Y.Map<unknown>());
        ov.set(p.key, p.value);
      }
      touchElement(el, policy);
    }
    return { ok: true };
  }),

  spec('element.revertOverrides', z.object({ elements: z.array(ElementIdParam).min(1) }), (ctx, p) => {
    for (const id of p.elements) record(ctx, id)?.delete('ov');
    return { ok: true };
  }),
];
