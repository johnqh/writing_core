import * as Y from 'yjs';
import { type ElementId, type StyleId, newId } from '../ids/ids.js';
import { insertElementRecord } from '../model/element-record.js';
import { decodeRelativePosition, encodeRelativePosition } from '../model/portable-pos.js';
import { positionBetween } from '../model/positions.js';
import type { YDeltaOp } from '../model/ytext.js';
import type { ElementOverrides } from '../schema/template.js';
import { FORMAT_MARKS, type TextJSON } from '../schema/text.js';
import { writePolicy } from './marks-policy.js';
import { type ResolvedPos, type WireRange, orderRange, resolveWirePos } from './positions.js';
import type { CommandContext } from './types.js';

type YMap = Y.Map<unknown>;

export const bodyElements = (doc: Y.Doc): YMap => doc.getMap<unknown>('elements');

/** The document's script language (`meta.language`), for case mapping, collation and normalization. */
export const documentLanguage = (doc: Y.Doc): string => String(doc.getMap('meta').get('language') ?? 'en');

/** `documentLanguage(ctx.doc)`, shared so command modules don't each redefine the same one-liner. */
export const lang = (ctx: Pick<CommandContext, 'doc'>): string => documentLanguage(ctx.doc);

export function positionAfter(container: YMap, afterId: string | null, ctx: Pick<CommandContext, 'ids'>): string {
  const afterPos = afterId ? String((container.get(afterId) as YMap).get('pos')) : null;
  let next: string | null = null;
  for (const v of container.values()) {
    const p = String((v as YMap).get('pos'));
    if ((afterPos === null || p > afterPos) && (next === null || p < next)) next = p;
  }
  return positionBetween(afterPos, next, ctx.ids);
}

export function createElement(ctx: CommandContext, input: { after: ElementId | null; style: StyleId; text?: TextJSON; ov?: ElementOverrides }): ElementId {
  const container = bodyElements(ctx.doc);
  const id = newId('el', ctx.ids);
  const policy = writePolicy(ctx);
  const meta = { createdBy: ctx.actor.userId, createdAt: policy.now, editedBy: ctx.actor.userId, editedAt: policy.now };
  const record = insertElementRecord(container, { id, pos: positionAfter(container, input.after, ctx), style: input.style, text: input.text, ov: input.ov }, meta);
  if (policy.track) record.set('tc', { kind: 'insert', changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at });
  return id;
}

function repointAnchors(ctx: CommandContext, fromId: ElementId, toId: ElementId | null, offsetShift: number, fromText: Y.Text | null, toText: Y.Text | null): void {
  const doc = ctx.doc;
  for (const v of doc.getMap('tags').values()) {
    const tag = v as YMap;
    if (tag.get('elementId') === fromId) {
      if (toId) tag.set('elementId', toId);
    }
  }
  for (const v of doc.getMap('notes').values()) {
    const note = v as YMap;
    const anchor = note.get('anchor') as { kind: string; elementId?: string } | undefined;
    if (anchor?.elementId === fromId) note.set('anchor', toId ? { ...anchor, elementId: toId } : { kind: 'document' });
  }
  for (const v of doc.getMap('shots').values()) {
    const shot = v as YMap;
    if (shot.get('elementId') === fromId) shot.set('elementId', toId);
    if (shot.get('sceneId') === fromId && toId) shot.set('sceneId', toId);
  }
  for (const [key, v] of [...doc.getMap('bookmarks').entries()]) {
    const bm = v as YMap;
    if (bm.get('elementId') !== fromId) continue;
    if (!toId || !toText || !fromText) {
      doc.getMap('bookmarks').delete(key);
      continue;
    }
    let offset = 0;
    const at = bm.get('at');
    if (typeof at === 'string') {
      const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(at), doc);
      offset = abs && abs.type === fromText ? abs.index : 0;
    }
    bm.set('elementId', toId);
    bm.set('at', encodeRelativePosition(Y.createRelativePositionFromTypeIndex(toText, Math.min(offsetShift + offset, toText.length), 0)));
  }
}

/**
 * Removes an element, or — under Track Changes — marks it pending-delete instead (spec 08 §3.3
 * item 3). `mergeInto` records that this tracked delete stands in for a merge (spec 01 §5.10.3/
 * §5.10.4): a future accept folds the element's text into `mergeInto` rather than discarding it.
 * Omit `mergeInto` for a genuine whole-element deletion, where accept simply removes the element.
 */
export function removeElement(ctx: CommandContext, id: ElementId, opts?: { mergeInto: ElementId }): void {
  const container = bodyElements(ctx.doc);
  const record = container.get(id) as YMap | undefined;
  if (!record) return;
  const policy = writePolicy(ctx);
  if (policy.track) {
    const tc: Record<string, unknown> = { kind: 'delete', changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at };
    if (opts?.mergeInto) tc.mergeInto = opts.mergeInto;
    record.set('tc', tc);
    return;
  }
  for (const [key, v] of [...ctx.doc.getMap('tags').entries()]) if ((v as YMap).get('elementId') === id) ctx.doc.getMap('tags').delete(key);
  repointAnchors(ctx, id, null, 0, null, null);
  container.delete(id);
}

/** Spec 01 §2.3: the earlier element survives; the later one's anchors move to it. */
export function mergeElements(ctx: CommandContext, survivorId: ElementId, laterId: ElementId): void {
  const container = bodyElements(ctx.doc);
  const survivor = container.get(survivorId) as YMap;
  const later = container.get(laterId) as YMap;
  const sText = survivor.get('text') as Y.Text;
  const lText = later.get('text') as Y.Text;
  const shift = sText.length;
  // Read everything that references the later text before its items are deleted.
  const delta = lText.toDelta() as YDeltaOp[];
  repointAnchors(ctx, laterId, survivorId, shift, lText, sText);
  let index = shift;
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      sText.insert(index, op.insert, (op.attributes ?? {}) as Record<string, never>);
      index += op.insert.length;
    } else {
      sText.insertEmbed(index, op.insert, (op.attributes ?? {}) as Record<string, never>);
      index += 1;
    }
  }
  container.delete(laterId);
}

export function inheritedAttributes(text: Y.Text, index: number): Record<string, unknown> {
  let pos = 0;
  let before: Record<string, unknown> | undefined;
  let after: Record<string, unknown> | undefined;
  for (const op of text.toDelta() as YDeltaOp[]) {
    const size = typeof op.insert === 'string' ? op.insert.length : 1;
    if (typeof op.insert === 'string') {
      if (pos < index) before = op.attributes ?? {};
      if (pos >= index && after === undefined) after = op.attributes ?? {};
      if (pos < index && pos + size > index) after = op.attributes ?? {};
    }
    pos += size;
  }
  const source = before ?? after ?? {};
  const out: Record<string, unknown> = {};
  for (const k of FORMAT_MARKS) if (source[k] !== undefined) out[k] = source[k];
  return out;
}

export function resolveRange(ctx: CommandContext, range: WireRange): [ResolvedPos, ResolvedPos] | null {
  const a = resolveWirePos(ctx.doc, range.anchor);
  const b = resolveWirePos(ctx.doc, range.head);
  if (!a || !b) return null;
  if (ctx.model.indexOf(a.elementId) < 0 || ctx.model.indexOf(b.elementId) < 0) return null;
  return orderRange(ctx.model, a, b);
}

export function elementIdsBetween(ctx: CommandContext, fromId: ElementId, toId: ElementId): ElementId[] {
  const from = ctx.model.indexOf(fromId);
  const to = ctx.model.indexOf(toId);
  return ctx.model.elements({ from, to: to + 1 }).map((e) => e.id);
}
