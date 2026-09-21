// Minimal dual-dialogue commands (spec 01 §5.3.4). Task 34 owns the full `dual.*` set; this is the pair the editor needs.
import type * as Y from 'yjs';
import { z } from 'zod/v4';
import { type StyleId, newDualGroupId } from '../ids/ids.js';
import { orderElements } from '../model/ymap.js';
import { idSchema } from '../schema/primitives.js';
import { SPEAKER_ROLES, SPEECH_MEMBER_ROLES } from '../schema/vocab.js';
import { resolveStyle } from '../template/resolve.js';
import { bodyElements, dualGroupOf, repairDualRuns } from './element-ops.js';
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
];
