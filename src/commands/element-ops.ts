import * as Y from 'yjs';
import { type ElementId, type StyleId, newId } from '../ids/ids.js';
import { dualRuns } from '../model/dual-runs.js';
import { insertElementRecord } from '../model/element-record.js';
import { decodeRelativePosition, encodeRelativePosition } from '../model/portable-pos.js';
import { positionBetween } from '../model/positions.js';
import { orderElements } from '../model/ymap.js';
import type { YDeltaOp } from '../model/ytext.js';
import type { ElementOverrides } from '../schema/template.js';
import { FORMAT_MARKS, type TextJSON } from '../schema/text.js';
import { type ResolvedStyle, resolveStyle } from '../template/resolve.js';
import { touchElement, writePolicy } from './marks-policy.js';
import { type ResolvedPos, type WireRange, orderRange, resolveWirePos } from './positions.js';
import type { CommandContext } from './types.js';

type YMap = Y.Map<unknown>;

export const bodyElements = (doc: Y.Doc): YMap => doc.getMap<unknown>('elements');

/** The document's script language (`meta.language`), for case mapping, collation and normalization. */
export const documentLanguage = (doc: Y.Doc): string => String(doc.getMap('meta').get('language') ?? 'en');

/** `documentLanguage(ctx.doc)`, shared so command modules don't each redefine the same one-liner. */
export const lang = (ctx: Pick<CommandContext, 'doc'>): string => documentLanguage(ctx.doc);

// M2 task 34: a sorted-position index per container, cached across calls so the successor lookup is a binary
// search (O(log n)) rather than the O(n) linear scan the previous version did over every element. The cache is
// invalidated by `container.size`: any structural change from elsewhere (a real-time peer update, an undo) makes
// the next call rebuild once (O(n log n)) and resume answering from the fresh sorted snapshot; the common case —
// this same function called again after its own result was inserted, growing `size` by exactly one — updates the
// cached array in place (a sorted-array insert, not a full rebuild) so repeated sequential inserts stay O(log n)
// for the search itself, without keeping a second persisted structure the model does not already have.
interface PosIndex { size: number; sorted: { id: string; pos: string }[] }
const posIndexCache = new WeakMap<YMap, PosIndex>();

function buildPosIndex(container: YMap): PosIndex {
  const sorted: { id: string; pos: string }[] = [];
  for (const [id, v] of container.entries()) sorted.push({ id, pos: String((v as YMap).get('pos')) });
  sorted.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
  return { size: container.size, sorted };
}

/** First index `i` with `sorted[i].pos > afterPos` (afterPos `null` means "smallest overall", i.e. index 0). */
function upperBound(sorted: readonly { pos: string }[], afterPos: string | null): number {
  if (afterPos === null) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.pos <= afterPos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function positionAfter(container: YMap, afterId: string | null, ctx: Pick<CommandContext, 'ids'>): string {
  const afterPos = afterId ? String((container.get(afterId) as YMap).get('pos')) : null;
  let index = posIndexCache.get(container);
  if (!index || index.size !== container.size) index = buildPosIndex(container);
  const i = upperBound(index.sorted, afterPos);
  const next = index.sorted[i]?.pos ?? null;
  const result = positionBetween(afterPos, next, ctx.ids);
  // Keep the cache valid for the very next call, which (in the real command flow) inserts an element at
  // `result` and grows `container.size` by exactly one: insert it here too, at the same sorted position.
  index.sorted.splice(i, 0, { id: '', pos: result });
  posIndexCache.set(container, { size: container.size + 1, sorted: index.sorted });
  return result;
}

/**
 * `size` alone cannot detect an EXISTING record's `pos` being reassigned in place (e.g. `dual.swapSides`
 * reordering a group without adding or removing anything): that would leave the cached sorted array holding
 * stale `pos` values with the count still matching. Anything that writes a `pos` field directly, rather than
 * inserting a brand new record through `createElement`, must call this afterward.
 */
export function invalidatePositionCache(container: YMap): void {
  posIndexCache.delete(container);
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

/**
 * Moves everything anchored to `fromId` onto `toId`, or — when `toId` is null, i.e. the element is
 * being deleted outright — detaches it the way invariant I10's repair would, so a command never
 * leaves the document in a state validateDocument has to clean up after it.
 */
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
    if (anchor?.elementId !== fromId) continue;
    if (toId) {
      note.set('anchor', { ...anchor, elementId: toId });
      continue;
    }
    // Spec 01 §5.7: a detached note remembers the element it came from, so the UI can offer to
    // re-attach it. I10's repair records it; so must the command that detaches it.
    note.set('anchor', { kind: 'document' });
    note.set('detachedFrom', fromId);
  }
  for (const [key, v] of [...doc.getMap('shots').entries()]) {
    const shot = v as YMap;
    if (shot.get('elementId') === fromId) shot.set('elementId', toId);
    if (shot.get('sceneId') !== fromId) continue;
    // A shot belongs to its scene; with the scene element gone there is nothing to belong to.
    // I10's repair for a dangling `shot.sceneId` is to delete the shot, and this used to leave it
    // dangling instead (the `&& toId` guard silently skipped the delete case).
    if (toId) shot.set('sceneId', toId);
    else doc.getMap('shots').delete(key);
  }
  // Beat anchors were never walked at all (I10 `beat … anchor dangles`).
  for (const v of doc.getMap('beats').values()) {
    const beat = v as YMap;
    const anchor = beat.get('anchor') as { elementId: string } | null;
    if (!anchor || anchor.elementId !== fromId) continue;
    beat.set('anchor', toId ? { ...anchor, elementId: toId } : null);
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
  const policy = writePolicy(ctx);
  // Under revision mode the text arriving in the survivor is part of this revision and has to
  // carry `rev`; everything else the moved runs already carry (including `ins`/`del`/`fmt` from an
  // earlier tracked session) is preserved, because merging moves text, it does not author it.
  // `mergeElements` is only reached with Track Changes off — under it, text.ts leaves both elements
  // in place with a `tc.mergeInto` record instead.
  const merged = (attrs: Record<string, unknown> | undefined): Record<string, never> => {
    const out: Record<string, unknown> = { ...(attrs ?? {}) };
    if (policy.revisionSetId) out.rev = policy.revisionSetId;
    return out as Record<string, never>;
  };
  let index = shift;
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      sText.insert(index, op.insert, merged(op.attributes));
      index += op.insert.length;
    } else {
      sText.insertEmbed(index, op.insert, merged(op.attributes));
      index += 1;
    }
  }
  container.delete(laterId);
  touchElement(survivor, policy);
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

/** `dual.group` of an element record, or null when it carries no (or a malformed) dual. */
export function dualGroupOf(element: YMap | undefined): string | null {
  const dual = element?.get('dual') as { group?: unknown } | undefined;
  return typeof dual?.group === 'string' ? dual.group : null;
}

/**
 * Spec 01 §5.3.4 / invariant I7. A structural edit — changing a member's style, splitting a member
 * in two, moving one out of the run, duplicating one into the middle of it — can leave a dual
 * dialogue group malformed, or split one group across two runs. The commands that can do that call
 * this afterwards with the groups they touched, and it applies I7's own repair (drop `dual` from
 * every member of a run that is no longer well formed) to those groups only, so a pre-existing
 * problem elsewhere in the document is still left for validateDocument to report.
 */
export function repairDualRuns(ctx: CommandContext, groups: Iterable<string>): void {
  const touched = new Set(groups);
  if (touched.size === 0) return;
  const template = ctx.model.template();
  // Read the Y.Doc, NOT `ctx.model`: a command runs inside `doc.transact`, and the read model's
  // order index and element views are only refreshed by its observers when the transaction ends.
  // Mid-transaction the model still describes the document as it was before this command's writes
  // — it would not even list an element the command just created.
  const ordered = orderElements(bodyElements(ctx.doc));
  const runs = dualRuns(ordered.map((el) => {
    const dual = el.get('dual') as { group?: unknown; side?: unknown } | undefined;
    const style = el.get('style') as StyleId;
    let resolved: ResolvedStyle | null = null;
    try { resolved = resolveStyle(template, style); } catch { resolved = null; }
    return {
      id: String(el.get('id')),
      group: typeof dual?.group === 'string' ? dual.group : null,
      side: dual?.side === 'left' || dual?.side === 'right' ? dual.side : null,
      role: resolved?.role ?? null,
      dualAllowed: resolved?.dualDialogue ?? false,
    };
  }));
  const byId = new Map(ordered.map((el) => [String(el.get('id')), el] as const));
  for (const run of runs) {
    if (run.wellFormed || !touched.has(run.group)) continue;
    for (const id of run.ids) byId.get(id)?.delete('dual');
  }
}
