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
import { bodyElements, createElement } from './element-ops.js';
import { insertAttributes, touchElement, writePolicy } from './marks-policy.js';
import { WireDocPos, resolveWirePos } from './positions.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;
const ElementIdParam = idSchema('el');

const spec = defineCommand;

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
  ordered.forEach((id, i) => record(ctx, id)!.set('pos', keys[i]!));
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

  spec('element.split', z.object({ at: WireDocPos }), (ctx, p) => {
    const r = resolveWirePos(ctx.doc, p.at);
    if (!r) return { ok: false, reason: 'invalidPosition' };
    const style = r.element.get('style') as StyleId;
    const template = ctx.model.template();
    const enterOnBlank = ctx.model.settings().enterOnBlank;
    const action = enterAction(template, style, { empty: r.text.length === 0, caretAtEnd: r.index === r.text.length, enterOnBlank });
    switch (action.kind) {
      case 'openPicker':
        return { ok: false, reason: 'notApplicable', detail: { action: 'openPicker' } };
      case 'none':
        return { ok: false, reason: 'notApplicable' };
      case 'convert':
        applyStyle(ctx, r.elementId, action.style);
        return { ok: true };
      case 'insertAfter': {
        const id = createElement(ctx, { after: r.elementId, style: action.style });
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
        const tailTagIds = new Set<string>();
        const headTagIds = new Set<string>();
        pos = 0;
        for (const op of r.text.toDelta() as YDeltaOp[]) {
          const size = typeof op.insert === 'string' ? op.insert.length : 1;
          for (const key of Object.keys(op.attributes ?? {})) {
            if (!key.startsWith('t:')) continue;
            if (pos < r.index) headTagIds.add(key.slice(2));
            if (pos + size > r.index) tailTagIds.add(key.slice(2));
          }
          pos += size;
        }
        const id = createElement(ctx, { after: r.elementId, style: action.style });
        const newText = record(ctx, id)!.get('text') as Y.Text;
        newText.applyDelta(tail);
        r.text.delete(r.index, r.text.length - r.index);
        for (const v of ctx.doc.getMap('tags').values()) {
          const tag = v as YMap;
          const tagId = String(tag.get('id'));
          if (tag.get('elementId') === r.elementId && tailTagIds.has(tagId) && !headTagIds.has(tagId)) tag.set('elementId', id);
        }
        touchElement(r.element, writePolicy(ctx));
        return { ok: true, effects: [{ kind: 'elementCreated', id }], selection: { anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: 0 } } };
      }
      default:
        return { ok: false, reason: 'notApplicable' };
    }
  }),

  spec('element.setStyle', z.object({ elements: z.array(ElementIdParam).min(1), style: StyleIdSchema }), (ctx, p) => {
    if (!styleExists(ctx, p.style)) return { ok: false, reason: 'styleNotInTemplate' };
    if (p.elements.some((id) => !record(ctx, id))) return { ok: false, reason: 'notFound' };
    for (const id of p.elements) applyStyle(ctx, id, p.style);
    return { ok: true };
  }),

  spec('element.cycleStyle', z.object({ element: ElementIdParam, direction: z.enum(['tabForward', 'tabBack']), caretAtEnd: z.boolean() }), (ctx, p) => {
    const el = record(ctx, p.element);
    if (!el) return { ok: false, reason: 'notFound' };
    const style = el.get('style') as StyleId;
    const empty = (el.get('text') as Y.Text).length === 0;
    const template = ctx.model.template();
    const action = p.direction === 'tabForward' ? tabAction(template, style, { empty, caretAtEnd: p.caretAtEnd }) : shiftTabAction(template, style, { empty });
    if (action.kind === 'convert') {
      applyStyle(ctx, p.element, action.style);
      return { ok: true };
    }
    if (action.kind === 'insertAfter') {
      const id = createElement(ctx, { after: p.element, style: action.style });
      return { ok: true, effects: [{ kind: 'elementCreated', id }] };
    }
    return { ok: false, reason: 'notApplicable', detail: { action: action.kind, ...('list' in action ? { list: action.list } : {}) } };
  }),

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
