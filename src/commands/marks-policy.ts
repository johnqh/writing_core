import * as Y from 'yjs';
import type { ChangeId, RevisionSetId } from '../ids/ids.js';
import type { YDeltaOp } from '../model/ytext.js';
import type { CommandContext } from './types.js';

/** Spec 08 §3.3: every other origin kind, including `system`, writes revision and Track Changes marks. */
export const UNMARKED_ORIGIN_KINDS = ['remote', 'undo', 'redo', 'import', 'snapshot-open', 'normalizer'] as const;
const EDIT_THROTTLE_MS = 10_000;

export interface WritePolicy {
  revisionSetId: RevisionSetId | null;
  track: { changeId: ChangeId; by: string; at: number } | null;
  actorId: string;
  now: number;
}

export interface DeleteOutcome {
  removed: number;
  revDelInserted: boolean;
}

export function writePolicy(ctx: CommandContext): WritePolicy {
  const now = ctx.clock();
  const actorId = ctx.actor.userId;
  if ((UNMARKED_ORIGIN_KINDS as readonly string[]).includes(ctx.origin.kind)) return { revisionSetId: null, track: null, actorId, now };
  const rev = ctx.doc.getMap<unknown>('revisions');
  const revisionSetId = rev.get('mode') === true ? ((rev.get('activeSetId') as RevisionSetId | null) ?? null) : null;
  const track = ctx.doc.getMap<unknown>('trackChanges').get('enabled') === true ? { changeId: ctx.changeId, by: actorId, at: now } : null;
  return { revisionSetId, track, actorId, now };
}

export function insertAttributes(policy: WritePolicy, base: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...base };
  delete attrs.rev;
  delete attrs.ins;
  delete attrs.del;
  delete attrs.fmt;
  if (policy.revisionSetId) attrs.rev = policy.revisionSetId;
  if (policy.track) attrs.ins = { ...policy.track };
  return attrs;
}

export function policyInsert(policy: WritePolicy, text: Y.Text, index: number, content: string, base: Record<string, unknown>): void {
  if (content === '') return;
  const attrs = insertAttributes(policy, base);
  // Explicit nulls stop Yjs from extending neighbouring formatting into the inserted run.
  const withNulls: Record<string, unknown> = { ...attrs };
  for (const op of text.toDelta() as YDeltaOp[]) for (const k of Object.keys(op.attributes ?? {})) if (!(k in withNulls)) withNulls[k] = null;
  text.insert(index, content.normalize('NFC'), withNulls as Record<string, never>);
}

interface Segment { index: number; length: number; attrs: Record<string, unknown>; embed: boolean }

function segments(text: Y.Text, index: number, length: number): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  const end = index + length;
  for (const op of text.toDelta() as YDeltaOp[]) {
    const size = typeof op.insert === 'string' ? op.insert.length : 1;
    const from = Math.max(pos, index);
    const to = Math.min(pos + size, end);
    if (from < to) out.push({ index: from, length: to - from, attrs: op.attributes ?? {}, embed: typeof op.insert !== 'string' });
    pos += size;
    if (pos >= end) break;
  }
  return out;
}

export function policyDelete(policy: WritePolicy, text: Y.Text, index: number, length: number): DeleteOutcome {
  if (length <= 0) return { removed: 0, revDelInserted: false };
  const segs = segments(text, index, length);
  let removed = 0;
  // Walk from the end so indices of earlier segments stay valid.
  for (const seg of [...segs].reverse()) {
    if (policy.track) {
      const ins = seg.attrs.ins as { by?: string } | undefined;
      if (seg.embed || (ins && ins.by === policy.actorId)) {
        text.delete(seg.index, seg.length);
        removed += seg.length;
      } else if (seg.attrs.del === undefined) {
        text.format(seg.index, seg.length, { del: { ...policy.track } });
      }
      continue;
    }
    text.delete(seg.index, seg.length);
    removed += seg.length;
  }
  let revDelInserted = false;
  if (!policy.track && policy.revisionSetId) {
    const onlyOwnRevision = segs.every((s) => !s.embed && s.attrs.rev === policy.revisionSetId);
    if (!onlyOwnRevision) {
      text.insertEmbed(index, { type: 'revDel', rev: policy.revisionSetId, by: policy.actorId, at: policy.now });
      revDelInserted = true;
    }
  }
  return { removed, revDelInserted };
}

export function touchElement(element: Y.Map<unknown>, policy: WritePolicy): void {
  const meta = element.get('meta') as { createdBy: string; createdAt: number; editedBy: string; editedAt: number } | undefined;
  if (!meta) return;
  if (meta.editedBy === policy.actorId && policy.now - meta.editedAt < EDIT_THROTTLE_MS) return;
  element.set('meta', { ...meta, editedBy: policy.actorId, editedAt: policy.now });
}
