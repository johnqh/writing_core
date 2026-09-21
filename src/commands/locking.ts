// Scene number locking (spec 02 §23.1) and page locking (spec 02 §24.3, spec 01 §5.11), speed-mode subset:
// `scene.lockNumbers` (also Relock), `scene.unlockNumbers`, `page.lock` (locks every page that is not yet locked,
// so a second run is "Lock A pages") and `page.unlock` (Unlock All Pages). Capability is plain `write`, not `lockAdmin`,
// because the app's sessions do not grant `lockAdmin` yet.
import * as Y from 'yjs';
import { z } from 'zod/v4';
import { type ElementId, type StyleId, newId } from '../ids/ids.js';
import { layoutDocument } from '../layout/layout-document.js';
import { encodeRelativePosition } from '../model/portable-pos.js';
import { childMap } from '../model/ymap.js';
import { assignNumbers } from '../numbering/assign.js';
import type { NumberLabel } from '../schema/template.js';
import { resolveStyle } from '../template/resolve.js';
import { bodyElements } from './element-ops.js';
import { defineCommand } from './registry.js';
import type { CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;

const production = (doc: Y.Doc): YMap => doc.getMap<unknown>('production');

export const LOCKING_COMMANDS: CommandSpec<never>[] = [
  // Lock Numbers, or Relock when already locked: every numbered scene heading without a stored label gets its
  // current (provisional) label written, so A-numbers become permanent.
  defineCommand('scene.lockNumbers', z.object({}), (ctx): CommandResult => {
    const template = ctx.model.template();
    const styleId = template.sceneNumbering.styleId as StyleId;
    if (!template.styles.some((s) => s.id === styleId)) return { ok: false, reason: 'notFound' };
    if (!resolveStyle(template, styleId).numbering?.enabled) return { ok: false, reason: 'notApplicable', detail: { why: 'numberingOff' } };
    let labels;
    try {
      labels = assignNumbers(ctx.model).labels;
    } catch (e) {
      return { ok: false, reason: 'notApplicable', detail: { why: 'numbersInconsistent', message: e instanceof Error ? e.message : String(e) } };
    }
    const plan: { id: ElementId; label: NumberLabel }[] = [];
    for (const [id, a] of labels) {
      const view = ctx.model.element(id);
      if (view && view.role === 'sceneHeading') plan.push({ id, label: a.label });
    }
    // Unnumbered (custom '') manual headings are not in `labels`; they lock too.
    const blank = ctx.model.elements().filter((e) => e.role === 'sceneHeading' && e.num?.manual === true && e.num.label.custom === '' && !e.num.locked).map((e) => e.id);
    const els = bodyElements(ctx.doc);
    for (const { id, label } of plan) {
      const rec = els.get(id) as YMap | undefined;
      if (!rec) continue;
      const num = rec.get('num');
      if (num instanceof Y.Map) {
        if (num.get('locked') === true) continue;
        num.set('locked', true);
        if (num.get('manual') !== true) num.set('label', label);
      } else {
        const m = new Y.Map<unknown>();
        m.set('label', label);
        m.set('locked', true);
        m.set('manual', false);
        rec.set('num', m);
      }
    }
    for (const id of blank) {
      const num = (els.get(id) as YMap | undefined)?.get('num');
      if (num instanceof Y.Map) num.set('locked', true);
    }
    const prod = production(ctx.doc);
    childMap(prod, 'lockedStyles').set(styleId, true);
    if (prod.get('scenesLocked') !== true) {
      prod.set('scenesLocked', true);
      prod.set('scenesLockedAt', ctx.clock());
    }
    return { ok: true };
  }, { scope: 'structure' }),

  // Unlock: stored labels are deleted (manual ones stay, unlocked) and sequential numbering resumes.
  defineCommand('scene.unlockNumbers', z.object({}), (ctx): CommandResult => {
    const template = ctx.model.template();
    const styleId = template.sceneNumbering.styleId as StyleId;
    const els = bodyElements(ctx.doc);
    for (const view of ctx.model.elements()) {
      if (view.role !== 'sceneHeading' || !view.num) continue;
      const rec = els.get(view.id) as YMap | undefined;
      if (!rec) continue;
      if (view.num.manual) (rec.get('num') as YMap).set('locked', false);
      else rec.delete('num');
    }
    const prod = production(ctx.doc);
    childMap(prod, 'lockedStyles').delete(styleId);
    if (prod.get('scenesLocked') !== false) prod.set('scenesLocked', false);
    if (prod.get('scenesLockedAt') !== null) prod.set('scenesLockedAt', null);
    return { ok: true };
  }, { scope: 'structure' }),

  // Lock Pages: one record per page that has none yet (first run: every page; later runs: the A pages).
  defineCommand('page.lock', z.object({}), (ctx): CommandResult => {
    const layout = layoutDocument(ctx.model);
    const start = ctx.model.template().pageNumbering.start;
    const els = bodyElements(ctx.doc);
    const records: { label: NumberLabel; elementId: ElementId; mid: boolean }[] = [];
    for (const page of layout.pages) {
      if (page.lockId) continue;
      const first = page.lines.find((l) => l.kind === 'text');
      if (!first || !(els.get(first.elementId) instanceof Y.Map)) continue;
      records.push({ label: page.numberLabel ?? { base: start + page.index, prefix: [], suffix: [] }, elementId: first.elementId, mid: first.lineIndexInElement > 0 });
    }
    if (records.length === 0) return { ok: false, reason: 'notApplicable', detail: { why: 'nothingToLock' } };
    const prod = production(ctx.doc);
    const locks = childMap(prod, 'pageLocks');
    const now = ctx.clock();
    for (const r of records) {
      const rec = els.get(r.elementId) as YMap;
      const text = rec.get('text') as Y.Text;
      const id = newId('plk', ctx.ids);
      const m = new Y.Map<unknown>();
      locks.set(id, m);
      m.set('id', id);
      m.set('label', r.label);
      m.set('level', r.label.prefix.length + r.label.suffix.length);
      m.set('start', encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0, 0)));
      m.set('startElementId', r.elementId);
      m.set('startMidElement', r.mid);
      m.set('posHint', String(rec.get('pos')));
      m.set('revisionSetId', null);
      m.set('lockedAt', now);
      m.set('lockedBy', ctx.actor.userId);
    }
    if (prod.get('pagesLocked') !== true) {
      prod.set('pagesLocked', true);
      prod.set('pagesLockedAt', now);
    }
    return { ok: true };
  }),

  // Unlock All Pages: removes every record; sequential numbering resumes.
  defineCommand('page.unlock', z.object({}), (ctx): CommandResult => {
    const prod = production(ctx.doc);
    const locks = childMap(prod, 'pageLocks');
    for (const k of [...locks.keys()]) locks.delete(k);
    if (prod.get('pagesLocked') !== false) prod.set('pagesLocked', false);
    if (prod.get('pagesLockedAt') !== null) prod.set('pagesLockedAt', null);
    return { ok: true };
  }),
];
