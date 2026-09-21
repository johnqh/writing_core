/**
 * Spec 02 §24 (page locking, A pages, deleted page ranges), speed-mode version.
 *
 * Every lock record anchors a page start at an element. The paginator works in blocks, so an anchor
 * resolves to the START OF THE BLOCK that contains its element (a dialogue block, a dual block or a
 * single paragraph): a page that began mid-paragraph or mid-dialogue is snapped to the block start.
 * That gives the spec's "hard break" for free: `flags.pageBreakBefore` on the first paragraph of each
 * live anchor block. Text never flows back across a locked boundary (underflow leaves a short page)
 * and a segment that needs more than one page overflows onto A pages labelled from `childSeq`.
 *
 * Deleted pages: two anchors that resolve to the same block leave the earlier segment empty, so its
 * page is deleted; `combineDeletedRanges` then renders the surviving page before it as `2-3`.
 */
import type { ElementId } from '../ids/ids.js';
import { childSeq } from '../numbering/modes.js';
import { compareLabels, formatNumberLabel } from '../read-model/number-label.js';
import type { PageLockJSON } from '../schema/document.js';
import type { NumberLabel } from '../schema/template.js';
import type { NumberMode } from '../schema/vocab.js';
import { firstPara, type Block, type BlockPara } from './blocks.js';
import type { FilledPage } from './paginate.js';

export interface LockedPageInfo {
  /** Display label, ranges included (`12A`, `2-3`). */
  label: string;
  /** The structural label of THIS page (before range combining). */
  numberLabel: NumberLabel;
  /** The lock record that starts this page, or null for an unlocked overflow (A) page. */
  lockId: string | null;
  /** 0 for a locked page, k for the k-th overflow page after it. */
  overflow: number;
}

function parasOf(b: Block): BlockPara[] {
  switch (b.kind) {
    case 'single':
    case 'omittedScene': return [b.para];
    case 'dialogue': return [b.cue, ...b.members];
    case 'dual': return [b.left.cue, ...b.left.members, b.right.cue, ...b.right.members];
    case 'columnRows': return b.paras;
  }
}

export interface ResolvedLocks {
  /** Live anchors: lock and the global block index its page starts at (increasing). */
  live: { lock: PageLockJSON; block: number }[];
  /** Locks whose segment is empty; `before` is the index in `live` of the page that follows them. */
  deleted: { lock: PageLockJSON; before: number | null }[];
}

/** Resolves lock records to block anchors, in label order; collapsed anchors become deleted pages. */
export function resolveLocks(
  locks: readonly PageLockJSON[], blocks: readonly Block[], order: ReadonlyMap<ElementId, number>, mode: NumberMode,
): ResolvedLocks {
  const blockOf = new Map<ElementId, number>();
  const firstIndex: number[] = [];
  blocks.forEach((b, bi) => {
    const ps = parasOf(b);
    firstIndex.push(order.get(ps[0]!.layout.elementId) ?? Number.MAX_SAFE_INTEGER);
    for (const p of ps) blockOf.set(p.layout.elementId, bi);
  });
  const resolveBlock = (id: ElementId): number => {
    const direct = blockOf.get(id);
    if (direct !== undefined) return direct;
    // Hidden or omitted element: the last block that starts before it (an omitted scene's own block).
    const at = order.get(id);
    if (at === undefined) return -1;
    let found = 0;
    for (let i = 0; i < firstIndex.length; i++) if ((firstIndex[i] as number) <= at) found = i;
    return found;
  };
  const sorted = [...locks].sort((a, b) => compareLabels(a.label, b.label, mode) || a.level - b.level);
  const resolved: { lock: PageLockJSON; block: number }[] = [];
  for (const lock of sorted) {
    let b = resolveBlock(lock.startElementId as ElementId);
    const prev = resolved[resolved.length - 1];
    if (b < 0) b = prev ? prev.block : 0; // anchor gone: collapse onto the previous one
    if (prev && b < prev.block) b = prev.block; // out of order: clamp
    resolved.push({ lock, block: b });
  }
  const live: ResolvedLocks['live'] = [];
  const deleted: ResolvedLocks['deleted'] = [];
  let pending: ResolvedLocks['deleted'] = [];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i] as { lock: PageLockJSON; block: number };
    const next = resolved[i + 1];
    if (next && next.block === r.block) {
      const d = { lock: r.lock, before: null as number | null };
      deleted.push(d);
      pending.push(d);
    } else {
      live.push({ ...r });
      for (const d of pending) d.before = live.length - 1;
      pending = [];
    }
  }
  // The first live page always starts at the top of the document (spec 02 §24.2).
  if (live.length > 0) (live[0] as { block: number }).block = 0;
  return { live, deleted };
}

/** Sets `pageBreakBefore` on the first paragraph of every live anchor block except the first. */
export function forceBreaks(blocks: readonly Block[], live: ResolvedLocks['live']): void {
  for (let i = 1; i < live.length; i++) {
    const b = blocks[(live[i] as { block: number }).block];
    if (!b) continue;
    const p = firstPara(b);
    p.flags = { ...p.flags, pageBreakBefore: true };
  }
}

/** Labels for every body page given the resolved locks (each live page starts at `pageBreakBefore`). */
export function labelPages(
  pages: readonly FilledPage[], resolved: ResolvedLocks, mode: NumberMode, skipIO: boolean, combine: boolean,
): LockedPageInfo[] {
  const fmt = (l: NumberLabel) => formatNumberLabel(l, { skipIO, mode });
  const out: LockedPageInfo[] = [];
  let li = -1;
  let seq: Iterator<NumberLabel> | null = null;
  let overflow = 0;
  for (const pg of pages) {
    const next = resolved.live[li + 1];
    if (next && pg.startState.blockIndex >= next.block) {
      li++;
      overflow = 0;
      seq = null;
      out.push({ label: fmt(next.lock.label), numberLabel: next.lock.label, lockId: next.lock.id, overflow: 0 });
      continue;
    }
    const cur = resolved.live[Math.max(li, 0)];
    if (!cur) {
      out.push({ label: '', numberLabel: { base: 0, prefix: [], suffix: [] }, lockId: null, overflow: 0 });
      continue;
    }
    seq ??= childSeq(cur.lock.label, mode, skipIO)[Symbol.iterator]();
    overflow++;
    const label = seq.next().value as NumberLabel;
    out.push({ label: fmt(label), numberLabel: label, lockId: null, overflow });
  }
  if (combine) {
    const firstDeleted = new Map<number, PageLockJSON>();
    for (const d of resolved.deleted) {
      if (d.before === null) continue;
      const liveLock = (resolved.live[d.before] as { lock: PageLockJSON }).lock;
      const pj = out.findIndex((p) => p.lockId === liveLock.id);
      if (pj < 0) continue;
      if (pj === 0) {
        if (!firstDeleted.has(pj)) firstDeleted.set(pj, d.lock);
        (out[0] as LockedPageInfo).label = `${fmt((firstDeleted.get(pj) as PageLockJSON).label)}-${fmt((out[0] as LockedPageInfo).numberLabel)}`;
      } else {
        const t = out[pj - 1] as LockedPageInfo;
        t.label = `${fmt(t.numberLabel)}-${fmt(d.lock.label)}`;
      }
    }
  }
  return out;
}
