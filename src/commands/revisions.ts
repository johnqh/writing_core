// Revision commands (spec 01 §5.10, spec 09 F-REV-001..003, F-REV-005), speed-mode subset:
// `revision.setCurrent` (Set Revision / start the next set), `revision.mode` (Revision Mode on/off),
// `revision.clear` (Clear Revision Marks for one set or all), `revision.markElements` (Mark / Clear Revised on a
// selection) and `revision.setDisplay` (which marks and page colours are shown).
//
// Automatic marking is NOT here: `writePolicy` (marks-policy.ts) already stamps `rev` on inserted text, leaves
// `revDel` embeds on deletes and marks the whole text on a style change whenever `revisions.mode` is on, inside the
// same transaction as the edit, so undo removes edit and mark together.
import * as Y from 'yjs';
import { z } from 'zod/v4';
import type { YDeltaOp } from '../model/ytext.js';
import { REVISION_DISPLAYS } from '../schema/vocab.js';
import { idSchema } from '../schema/primitives.js';
import { bodyElements, elementIdsBetween, resolveRange } from './element-ops.js';
import { WireRange } from './positions.js';
import { defineCommand } from './registry.js';
import type { CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;
const revisions = (doc: Y.Doc): YMap => doc.getMap<unknown>('revisions');
const setRecord = (doc: Y.Doc, id: string): YMap | undefined => {
  const sets = revisions(doc).get('sets');
  const rec = sets instanceof Y.Map ? sets.get(id) : undefined;
  return rec instanceof Y.Map ? (rec as YMap) : undefined;
};

/** Remove `rev` marks (and `revDel` embeds) of `setId` (any set when null) from one element's text. */
function clearText(text: Y.Text, setId: string | null): void {
  let pos = 0;
  const formats: { at: number; length: number }[] = [];
  const embeds: number[] = [];
  for (const op of text.toDelta() as YDeltaOp[]) {
    if (typeof op.insert === 'string') {
      const rev = op.attributes?.rev;
      if (typeof rev === 'string' && (setId === null || rev === setId)) formats.push({ at: pos, length: op.insert.length });
      pos += op.insert.length;
    } else {
      const e = op.insert as { type?: string; rev?: string };
      if (e.type === 'revDel' && (setId === null || e.rev === setId)) embeds.push(pos);
      pos += 1;
    }
  }
  for (const f of formats) text.format(f.at, f.length, { rev: null } as unknown as Record<string, never>);
  for (const at of embeds.reverse()) text.delete(at, 1);
}

const SetCurrentParams = z.object({
  /** Explicit set to make current; default: the next set after the active one. */
  setId: idSchema('rev').optional(),
  /** Revision date, epoch ms (UTC midnight of the calendar date); default now. */
  date: z.number().nullable().optional(),
  fullDraft: z.boolean().optional(),
});

export const REVISION_COMMANDS: CommandSpec<never>[] = [
  // Make a set current: by default the next colour after the active one (Blue, Pink, Yellow, ...; the first ever
  // is Blue, White being the original draft). It also gets today's date, becomes the header ("document") revision, and
  // turns marks on-screen when they were off, since a revision nobody can see is not what anyone wants.
  defineCommand('revision.setCurrent', SetCurrentParams, (ctx, p): CommandResult => {
    const state = ctx.model.revisionState();
    const sets = state.sets;
    let target = p.setId ? sets.find((s) => s.id === p.setId) : undefined;
    if (p.setId && !target) return { ok: false, reason: 'notFound' };
    if (!target) {
      const at = state.activeSetId ? sets.findIndex((s) => s.id === state.activeSetId) : -1;
      const first = sets[0] && sets[0].mark === '' ? 1 : 0;
      target = sets[at >= 0 ? at + 1 : first];
      if (!target) return { ok: false, reason: 'notApplicable', detail: { why: 'noNextSet' } };
    }
    const rec = setRecord(ctx.doc, target.id);
    if (!rec) return { ok: false, reason: 'notFound' };
    const date = p.date === undefined ? ctx.clock() : p.date;
    rec.set('date', date);
    if (p.fullDraft !== undefined) rec.set('fullDraft', p.fullDraft);
    const rev = revisions(ctx.doc);
    rev.set('activeSetId', target.id);
    rev.set('headerSetId', target.id);
    if (rev.get('display') === 'none') rev.set('display', 'all');
    if (rev.get('showPageColor') !== true) rev.set('showPageColor', true);
    return { ok: true };
  }),

  defineCommand('revision.mode', z.object({ on: z.boolean() }), (ctx, p): CommandResult => {
    const rev = revisions(ctx.doc);
    if (p.on && !rev.get('activeSetId')) return { ok: false, reason: 'notApplicable', detail: { why: 'noActiveSet' } };
    if (rev.get('mode') !== p.on) rev.set('mode', p.on);
    return { ok: true };
  }),

  // Clear Revision Marks: `rev` runs and `revDel` embeds of one set (or every set) in the body. Text is unchanged.
  defineCommand('revision.clear', z.object({ setId: idSchema('rev').optional() }), (ctx, p): CommandResult => {
    if (p.setId && !setRecord(ctx.doc, p.setId)) return { ok: false, reason: 'notFound' };
    for (const rec of bodyElements(ctx.doc).values()) {
      const text = (rec as YMap).get('text');
      if (text instanceof Y.Text) clearText(text, p.setId ?? null);
    }
    return { ok: true };
  }),

  // Mark Revised / Clear Revised on a selection (Mod+] / Mod+[): the selected text gets the active set, or loses every mark.
  defineCommand('revision.markElements', z.object({ range: WireRange, marked: z.boolean() }), (ctx, p): CommandResult => {
    const resolved = resolveRange(ctx, p.range);
    if (!resolved) return { ok: false, reason: 'invalidPosition' };
    const activeSetId = revisions(ctx.doc).get('activeSetId');
    if (p.marked && typeof activeSetId !== 'string') return { ok: false, reason: 'notApplicable', detail: { why: 'noActiveSet' } };
    const [from, to] = resolved;
    let any = false;
    for (const id of elementIdsBetween(ctx, from.elementId, to.elementId)) {
      const text = (bodyElements(ctx.doc).get(id) as YMap).get('text') as Y.Text;
      const start = id === from.elementId ? from.index : 0;
      const end = id === to.elementId ? to.index : text.length;
      if (end <= start) continue;
      any = true;
      if (p.marked) text.format(start, end - start, { rev: activeSetId } as unknown as Record<string, never>);
      else {
        // Clear inside the range only: unformat it, and drop revDel embeds that sit in it.
        text.format(start, end - start, { rev: null } as unknown as Record<string, never>);
        let pos = 0;
        const dead: number[] = [];
        for (const op of text.toDelta() as YDeltaOp[]) {
          if (typeof op.insert === 'string') pos += op.insert.length;
          else {
            if ((op.insert as { type?: string }).type === 'revDel' && pos >= start && pos < end) dead.push(pos);
            pos += 1;
          }
        }
        for (const at of dead.reverse()) text.delete(at, 1);
      }
    }
    return any ? { ok: true } : { ok: false, reason: 'emptySelection' };
  }),

  defineCommand('revision.setDisplay', z.object({
    display: z.enum(REVISION_DISPLAYS).optional(),
    selectedSetIds: z.array(idSchema('rev')).optional(),
    showPageColor: z.boolean().optional(),
    colorRevisedText: z.boolean().optional(),
  }), (ctx, p): CommandResult => {
    const rev = revisions(ctx.doc);
    if (p.display !== undefined && rev.get('display') !== p.display) rev.set('display', p.display);
    if (p.selectedSetIds !== undefined) rev.set('selectedSetIds', p.selectedSetIds);
    if (p.showPageColor !== undefined && rev.get('showPageColor') !== p.showPageColor) rev.set('showPageColor', p.showPageColor);
    if (p.colorRevisedText !== undefined && rev.get('colorRevisedText') !== p.colorRevisedText) rev.set('colorRevisedText', p.colorRevisedText);
    return { ok: true };
  }),
];
