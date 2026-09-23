// Minimal dual-dialogue commands (spec 01 §5.3.4). Task 34 owns the full `dual.*` set; this is the pair the editor needs.
import type * as Y from 'yjs';
import { z } from 'zod/v4';
import { type ElementId, type StyleId, newDualGroupId } from '../ids/ids.js';
import { positionBetween } from '../model/positions.js';
import { orderElements } from '../model/ymap.js';
import { idSchema } from '../schema/primitives.js';
import { SPEAKER_ROLES, SPEECH_MEMBER_ROLES } from '../schema/vocab.js';
import { resolveStyle } from '../template/resolve.js';
import { bodyElements, createElement, dualGroupOf, invalidatePositionCache, repairDualRuns } from './element-ops.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;

interface Slot { rec: YMap; id: string; speaker: boolean; member: boolean; dualAllowed: boolean }

function slots(ctx: CommandContext): Slot[] {
  const template = ctx.model.template();
  return orderElements(bodyElements(ctx.doc)).map((rec) => {
    let role: string | null = null;
    let dualAllowed = false;
    try {
      const r = resolveStyle(template, rec.get('style') as StyleId);
      role = r.role;
      dualAllowed = r.dualDialogue;
    } catch { /* unresolvable style: not a dialogue element */ }
    return {
      rec, id: String(rec.get('id')), dualAllowed,
      speaker: role !== null && (SPEAKER_ROLES as readonly string[]).includes(role),
      member: role !== null && (SPEECH_MEMBER_ROLES as readonly string[]).includes(role),
    };
  });
}

/** The dialogue block (cue plus following speech members) containing element index `i`, as [from, to). */
function blockAt(all: readonly Slot[], i: number): [number, number] | null {
  let from = i;
  while (from >= 0 && !(all[from] as Slot).speaker) {
    if (!(all[from] as Slot).member) return null;
    from--;
  }
  if (from < 0) return null;
  let to = from + 1;
  while (to < all.length && (all[to] as Slot).member) to++;
  return [from, to];
}

export const DUAL_COMMANDS: CommandSpec<never>[] = [
  // Turns the dialogue block containing `element` and the dialogue block immediately before it into a dual pair.
  defineCommand('dual.make', z.object({ element: idSchema('el') }), (ctx, p): CommandResult => {
    const all = slots(ctx);
    const i = all.findIndex((s) => s.id === p.element);
    if (i < 0) return { ok: false, reason: 'notFound' };
    const right = blockAt(all, i);
    if (!right || right[0] === 0) return { ok: false, reason: 'notApplicable', detail: { why: 'noPreviousDialogue' } };
    const left = blockAt(all, right[0] - 1);
    if (!left || left[1] !== right[0]) return { ok: false, reason: 'notApplicable', detail: { why: 'noPreviousDialogue' } };
    const members = all.slice(left[0], right[1]);
    if (members.some((s) => !s.dualAllowed)) return { ok: false, reason: 'notApplicable', detail: { why: 'styleNotDual' } };
    if (members.some((s) => s.rec.has('dual'))) return { ok: false, reason: 'notApplicable', detail: { why: 'alreadyDual' } };
    const group = newDualGroupId(ctx.ids);
    all.slice(left[0], left[1]).forEach((s) => s.rec.set('dual', { group, side: 'left' }));
    all.slice(right[0], right[1]).forEach((s) => s.rec.set('dual', { group, side: 'right' }));
    repairDualRuns(ctx, [group]);
    return { ok: true };
  }),

  // Removes dual dialogue from the pair `element` belongs to.
  defineCommand('dual.clear', z.object({ element: idSchema('el') }), (ctx, p): CommandResult => {
    const rec = bodyElements(ctx.doc).get(p.element) as YMap | undefined;
    if (!rec) return { ok: false, reason: 'notFound' };
    const group = dualGroupOf(rec);
    if (group === null) return { ok: true };
    for (const el of orderElements(bodyElements(ctx.doc))) if (dualGroupOf(el) === group) el.delete('dual');
    return { ok: true };
  }),

  // Spec 08 §3 "Dual dialogue and column blocks": from the Character cue at/above the caret, pairs its
  // speech (cue + parentheticals + dialogue) with the NEXT speech, the reverse direction from `dual.make`
  // (which pairs with the PREVIOUS one). `character` names the cue directly because this command layer has
  // no caret of its own (see `scene.setSynopsis`'s `scene?` for the same convention) — a caller with no
  // selection must name it, so omitting it refuses `notApplicable` rather than guessing.
  defineCommand('dual.create', z.object({ character: idSchema('el').optional() }), (ctx, p): CommandResult => {
    if (!p.character) return { ok: false, reason: 'notApplicable' };
    const all = slots(ctx);
    const i = all.findIndex((s) => s.id === p.character);
    if (i < 0) return { ok: false, reason: 'notFound' };
    if (!(all[i] as Slot).speaker) return { ok: false, reason: 'notApplicable', detail: { why: 'notACharacterCue' } };
    const left = blockAt(all, i);
    if (!left) return { ok: false, reason: 'notApplicable', detail: { why: 'notACharacterCue' } };
    const leftMembers = all.slice(left[0], left[1]);
    if (leftMembers.some((s) => !s.dualAllowed)) return { ok: false, reason: 'notApplicable', detail: { why: 'styleNotDual' } };
    if (leftMembers.some((s) => s.rec.has('dual'))) return { ok: false, reason: 'notApplicable', detail: { why: 'alreadyDual' } };

    const to = left[1];
    const candidate = to < all.length ? blockAt(all, to) : null;
    const right = candidate && candidate[0] === to ? candidate : null;

    let rightIds: string[];
    let created: string | null = null;
    if (right) {
      const rightMembers = all.slice(right[0], right[1]);
      if (rightMembers.some((s) => !s.dualAllowed)) return { ok: false, reason: 'notApplicable', detail: { why: 'styleNotDual' } };
      if (rightMembers.some((s) => s.rec.has('dual'))) return { ok: false, reason: 'notApplicable', detail: { why: 'alreadyDual' } };
      rightIds = rightMembers.map((s) => s.id);
    } else {
      // No following speech: insert an empty right-side Character cue right after the left block.
      const template = ctx.model.template();
      const charStyle = (template.defaults.character ?? template.defaults.dialogue ?? template.defaults.root) as StyleId;
      created = createElement(ctx, { after: (leftMembers[leftMembers.length - 1] as Slot).id as ElementId, style: charStyle });
      rightIds = [created];
    }

    const group = newDualGroupId(ctx.ids);
    const container = bodyElements(ctx.doc);
    for (const s of leftMembers) s.rec.set('dual', { group, side: 'left' });
    for (const id of rightIds) (container.get(id) as YMap).set('dual', { group, side: 'right' });
    repairDualRuns(ctx, [group]);
    return created ? { ok: true, effects: [{ kind: 'elementCreated', id: created }] } : { ok: true };
  }),

  // Exchanges `dual.side` of the two speeches and physically reorders them so document order still
  // matches the side label (spec 01 §5.3.4): `dual.make`/`dual.create` only ever build a group as a
  // contiguous [left block][right block] span, so swapping means renumbering `pos` for the whole span
  // with the (now-relabelled) left members first.
  defineCommand('dual.swapSides', z.object({ group: z.string().regex(/^dd_/) }), (ctx, p): CommandResult => {
    const container = bodyElements(ctx.doc);
    const ordered = orderElements(container);
    const hits = ordered.map((el, idx) => ({ el, idx })).filter(({ el }) => dualGroupOf(el) === p.group);
    if (hits.length === 0) return { ok: false, reason: 'notFound' };
    const from = (hits[0] as { idx: number }).idx;
    const to = (hits[hits.length - 1] as { idx: number }).idx + 1;
    if (to - from !== hits.length) return { ok: false, reason: 'notApplicable', detail: { why: 'notContiguous' } };

    const members = hits.map(({ el }) => el);
    const leftMembers = members.filter((el) => (el.get('dual') as { side?: string }).side === 'left');
    const rightMembers = members.filter((el) => (el.get('dual') as { side?: string }).side === 'right');
    if (leftMembers.length === 0 || rightMembers.length === 0) return { ok: false, reason: 'notApplicable', detail: { why: 'incompleteGroup' } };

    const beforePos = from > 0 ? String((ordered[from - 1] as YMap).get('pos')) : null;
    const afterPos = to < ordered.length ? String((ordered[to] as YMap).get('pos')) : null;
    let anchor = beforePos;
    for (const el of [...rightMembers, ...leftMembers]) {
      const pos = positionBetween(anchor, afterPos, ctx.ids);
      el.set('pos', pos);
      anchor = pos;
    }
    for (const el of rightMembers) el.set('dual', { group: p.group, side: 'left' });
    for (const el of leftMembers) el.set('dual', { group: p.group, side: 'right' });
    invalidatePositionCache(container);
    return { ok: true };
  }),

  // Deletes `dual` from every member of `group`, keyed by the group id directly rather than an element
  // in it (unlike `dual.clear`) — the natural key once the caller already has the group (e.g. from the
  // dual dialogue badge the UI shows next to it).
  defineCommand('dual.dissolve', z.object({ group: z.string().regex(/^dd_/) }), (ctx, p): CommandResult => {
    let found = false;
    for (const el of orderElements(bodyElements(ctx.doc))) {
      if (dualGroupOf(el) !== p.group) continue;
      el.delete('dual');
      found = true;
    }
    return found ? { ok: true } : { ok: false, reason: 'notFound' };
  }),
];
