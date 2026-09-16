// src/model/validate/references.ts
import * as Y from 'yjs';
import type { StyleId } from '../../ids/ids.js';
import { ENTITY_KINDS, SCENE_ROLES } from '../../schema/vocab.js';
import { resolveStyle } from '../../template/resolve.js';
import { dualRuns } from '../dual-runs.js';
import { decodeRelativePosition, encodeRelativePosition } from '../portable-pos.js';
import { type YMap, has, records } from './helpers.js';
import { allTexts, roleOf, scanText } from './marks.js';
import { type Invariant, type Issue, issue } from './types.js';

const I7: Invariant = {
  code: 'I7', severity: 'warning', autoRepair: true,
  check(ctx) {
    const ordered = ctx.orderedBody();
    const byId = new Map(ordered.map((el) => [String(el.get('id')), el] as const));
    const runs = dualRuns(ordered.map((el) => {
      const dual = el.get('dual') as { group?: unknown; side?: unknown } | undefined;
      const group = typeof dual?.group === 'string' ? dual.group : null;
      const side = dual?.side === 'left' || dual?.side === 'right' ? dual.side : null;
      let dualAllowed = false;
      try { dualAllowed = resolveStyle(ctx.template, el.get('style') as StyleId).dualDialogue; } catch { dualAllowed = false; }
      return { id: String(el.get('id')), group, side, role: roleOf(ctx, el), dualAllowed };
    }));
    const out: Issue[] = [];
    for (const run of runs) {
      if (run.wellFormed) continue;
      out.push(issue(I7, `malformed dual dialogue group ${run.group}`, run.ids, () => {
        for (const id of run.ids) byId.get(id)?.delete('dual');
      }));
    }
    return out;
  },
};

const I8: Invariant = {
  code: 'I8', severity: 'info', autoRepair: false,
  check(ctx) {
    return ctx.orderedBody()
      .filter((el) => el.has('scene') && !has(SCENE_ROLES, roleOf(ctx, el)))
      .map((el) => issue(I8, `scene data kept dormant on non-scene element ${String(el.get('id'))}`, [String(el.get('id'))]));
  },
};

const I9: Invariant = {
  code: 'I9', severity: 'warning', autoRepair: false,
  check(ctx) {
    const scenes = ctx.orderedBody().filter((el) => has(SCENE_ROLES, roleOf(ctx, el)));
    const lastIndex = new Map<string, number>();
    const broken = new Set<string>();
    scenes.forEach((el, i) => {
      const folder = el.get('folderId') as string | undefined;
      if (!folder) return;
      const prev = lastIndex.get(folder);
      if (prev !== undefined && prev !== i - 1) broken.add(folder);
      lastIndex.set(folder, i);
    });
    return [...broken].map((f) => issue(I9, `folder ${f} is not contiguous; use Repair folders`, [f]));
  },
};

const I10: Invariant = {
  code: 'I10', severity: 'warning', autoRepair: true,
  check(ctx) {
    const doc = ctx.doc;
    const exists = (map: string, id: unknown) => typeof id === 'string' && doc.getMap(map).has(id);
    const out: Issue[] = [];
    const push = (msg: string, id: string, repair: () => void) => out.push(issue(I10, msg, [id], repair));

    for (const [id, el] of records(ctx.bodyElements)) {
      if (el.has('folderId') && !exists('folders', el.get('folderId'))) push(`element ${id} folderId dangles`, id, () => el.delete('folderId'));
      if (el.has('shotId') && !exists('shots', el.get('shotId'))) push(`element ${id} shotId dangles`, id, () => el.delete('shotId'));
      const scene = el.get('scene');
      if (scene instanceof Y.Map) {
        const loc = scene.get('locationId');
        if (loc != null && !exists('entities', loc)) push(`scene ${id} locationId dangles`, id, () => scene.set('locationId', null));
        const lines = scene.get('storylineIds');
        if (lines instanceof Y.Map) for (const k of [...lines.keys()]) if (!exists('storylines', k)) push(`scene ${id} storyline ${k} dangles`, id, () => lines.delete(k));
      }
    }
    const misc = records(doc.getMap('tagCategories')).find(([, c]) => c.get('key') === 'miscellaneous')?.[0] ?? null;
    for (const [id, tag] of records(doc.getMap('tags'))) {
      if (!exists('tagCategories', tag.get('categoryId'))) {
        push(`tag ${id} category dangles`, id, () => (misc ? tag.set('categoryId', misc) : doc.getMap('tags').delete(id)));
      }
      if (!exists('entities', tag.get('entityId'))) push(`tag ${id} entity dangles`, id, () => doc.getMap('tags').delete(id));
    }
    const firstNoteType = [...doc.getMap('noteTypes').keys()][0];
    for (const [id, note] of records(doc.getMap('notes'))) {
      if (!exists('noteTypes', note.get('typeId')) && firstNoteType) push(`note ${id} type dangles`, id, () => note.set('typeId', firstNoteType));
      const anchor = note.get('anchor') as { kind: string; elementId?: string; beatId?: string } | undefined;
      const anchorOk = !anchor || anchor.kind === 'range' || anchor.kind === 'document'
        || (anchor.elementId !== undefined && (ctx.bodyElements.has(anchor.elementId) || !!ctx.titleElements?.has(anchor.elementId)))
        || (anchor.beatId !== undefined && exists('beats', anchor.beatId));
      if (!anchorOk) {
        push(`note ${id} anchor dangles`, id, () => {
          note.set('anchor', { kind: 'document' });
          if (anchor?.elementId) note.set('detachedFrom', anchor.elementId); // spec 01 §5.7
        });
      }
    }
    for (const [id, beat] of records(doc.getMap('beats'))) {
      const plot = beat.get('plot') as { columnId: string } | null;
      if (plot && !exists('plotColumns', plot.columnId)) push(`beat ${id} column dangles`, id, () => beat.set('plot', null));
      const lane = beat.get('lane') as { laneId: string } | null;
      if (lane && !exists('lanes', lane.laneId)) push(`beat ${id} lane dangles`, id, () => beat.set('lane', null));
      const anchor = beat.get('anchor') as { elementId: string } | null;
      if (anchor && !ctx.bodyElements.has(anchor.elementId)) push(`beat ${id} anchor dangles`, id, () => beat.set('anchor', null));
      const lines = beat.get('storylineIds');
      if (lines instanceof Y.Map) for (const k of [...lines.keys()]) if (!exists('storylines', k)) push(`beat ${id} storyline ${k} dangles`, id, () => lines.delete(k));
    }
    for (const [id, shot] of records(doc.getMap('shots'))) {
      if (!ctx.bodyElements.has(String(shot.get('sceneId')))) push(`shot ${id} scene dangles`, id, () => doc.getMap('shots').delete(id));
      const elementId = shot.get('elementId');
      if (elementId != null && !ctx.bodyElements.has(String(elementId))) push(`shot ${id} element dangles`, id, () => shot.set('elementId', null));
    }
    for (const [id, bm] of records(doc.getMap('bookmarks'))) {
      if (!ctx.bodyElements.has(String(bm.get('elementId')))) push(`bookmark ${id} element dangles`, id, () => doc.getMap('bookmarks').delete(id));
    }
    for (const [id, ent] of records(doc.getMap('entities'))) {
      if (ent.get('categoryId') != null && !exists('tagCategories', ent.get('categoryId'))) push(`entity ${id} category dangles`, id, () => ent.set('categoryId', null));
      if (ent.get('mergedInto') != null && !exists('entities', ent.get('mergedInto'))) push(`entity ${id} mergedInto dangles`, id, () => ent.set('mergedInto', null));
    }
    return out;
  },
};

function markIssues(inv: Invariant, prefix: 't:' | 'n:', records_: YMap, onMissingRecord: (key: string) => void, ctx: Parameters<Invariant['check']>[0]): Issue[] {
  const out: Issue[] = [];
  const marked = new Set<string>();
  for (const { elementId, text } of allTexts(ctx)) {
    for (const m of scanText(text).marks) {
      if (!m.key.startsWith(prefix)) continue;
      const recordId = m.key.slice(prefix.length);
      marked.add(recordId);
      if (!records_.has(recordId)) out.push(issue(inv, `${m.key} mark in ${elementId} has no record`, [elementId], () => text.format(m.index, m.length, { [m.key]: null })));
    }
  }
  for (const id of [...records_.keys()]) if (!marked.has(id)) onMissingRecord(id);
  return out;
}

const I11: Invariant = {
  code: 'I11', severity: 'warning', autoRepair: true,
  check(ctx) {
    const tags = ctx.doc.getMap<unknown>('tags');
    const out: Issue[] = [];
    out.push(...markIssues(I11, 't:', tags, (id) => out.push(issue(I11, `tag ${id} has no marked text`, [id], () => tags.delete(id))), ctx));
    return out;
  },
};

const I12: Invariant = {
  code: 'I12', severity: 'warning', autoRepair: true,
  check(ctx) {
    const notes = ctx.doc.getMap<unknown>('notes');
    const out: Issue[] = [];
    out.push(...markIssues(I12, 'n:', notes, (id) => {
      const note = notes.get(id) as YMap;
      if ((note.get('anchor') as { kind: string } | undefined)?.kind === 'range') {
        out.push(issue(I12, `range note ${id} lost its text; detaching`, [id], () => note.set('anchor', { kind: 'document' })));
      }
    }, ctx));
    return out;
  },
};

const I13: Invariant = {
  code: 'I13', severity: 'warning', autoRepair: true,
  check(ctx) {
    const sets = ctx.doc.getMap<unknown>('revisions').get('sets');
    const known = (id: unknown) => sets instanceof Y.Map && typeof id === 'string' && sets.has(id);
    const out: Issue[] = [];
    for (const { elementId, text } of allTexts(ctx)) {
      const { marks, embeds } = scanText(text);
      for (const m of marks) if (m.key === 'rev' && !known(m.value)) out.push(issue(I13, `rev mark in ${elementId} references unknown set`, [elementId], () => text.format(m.index, m.length, { rev: null })));
      // delete embeds from the end so earlier indices stay valid within one repair pass
      for (const e of [...embeds].reverse()) {
        if (e.embed.type === 'revDel' && !known(e.embed.rev)) out.push(issue(I13, `revDel embed in ${elementId} references unknown set`, [elementId], () => text.delete(e.index, 1)));
      }
    }
    return out;
  },
};

const I15: Invariant = {
  code: 'I15', severity: 'warning', autoRepair: true,
  check(ctx) {
    const locks = ctx.doc.getMap<unknown>('production').get('pageLocks');
    if (!(locks instanceof Y.Map)) return [];
    const ordered = ctx.orderedBody();
    const sorted = records(locks as YMap).sort(([, a], [, b]) => {
      const la = a.get('label') as { base: number }, lb = b.get('label') as { base: number };
      return la.base - lb.base || Number(a.get('level')) - Number(b.get('level'));
    });
    const out: Issue[] = [];
    sorted.forEach(([id, lock], i) => {
      const el = ctx.bodyElements.get(String(lock.get('startElementId')));
      let resolves = false;
      if (el instanceof Y.Map) {
        try {
          const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(String(lock.get('start'))), ctx.doc);
          resolves = !!abs && abs.type === el.get('text');
        } catch { resolves = false; }
      }
      if (resolves) return;
      out.push(issue(I15, `page lock ${id} lost its anchor; re-anchoring`, [id], () => {
        const prevAnchor = i > 0 ? String(sorted[i - 1]![1].get('startElementId')) : null;
        const prevIndex = prevAnchor ? ordered.findIndex((e) => e.get('id') === prevAnchor) : -1;
        const target = ordered[prevIndex + 1] ?? ordered[0];
        if (!target) return;
        const text = target.get('text') as Y.Text;
        lock.set('startElementId', target.get('id'));
        lock.set('start', encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0, 0)));
        lock.set('startMidElement', false);
        lock.set('reanchored', true);
      }));
    });
    return out;
  },
};

const I16: Invariant = {
  code: 'I16', severity: 'warning', autoRepair: false,
  check(ctx) {
    const seen = new Map<string, string[]>();
    for (const [id, e] of records(ctx.doc.getMap('entities'))) {
      if (e.get('mergedInto') != null) continue;
      const key = `${String(e.get('kind'))}|${String(e.get('nameKey'))}`;
      seen.set(key, [...(seen.get(key) ?? []), id]);
    }
    return [...seen.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => issue(I16, `entities share name key ${k}; offer Merge entities`, v));
  },
};

const I17: Invariant = {
  code: 'I17', severity: 'error', autoRepair: true,
  check(ctx) {
    const entities = ctx.doc.getMap<unknown>('entities');
    const reported = new Set<string>();
    const out: Issue[] = [];
    for (const [start] of records(entities)) {
      const path: string[] = [];
      let cur: string | null = start;
      while (cur && !path.includes(cur)) {
        path.push(cur);
        const next: unknown = (entities.get(cur) as YMap | undefined)?.get('mergedInto');
        cur = typeof next === 'string' && entities.has(next) ? next : null;
      }
      if (!cur) continue;
      const cycle = path.slice(path.indexOf(cur)).sort();
      const key = cycle.join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      const breakAt = cycle[cycle.length - 1]!;
      out.push(issue(I17, `mergedInto cycle ${cycle.join(' → ')}`, cycle, () => (entities.get(breakAt) as YMap).set('mergedInto', null)));
    }
    return out;
  },
};

const I21: Invariant = {
  code: 'I21', severity: 'warning', autoRepair: false,
  check(ctx) {
    const tombstones = ctx.doc.getMap<unknown>('smartType').get('entityTombstones');
    if (!(tombstones instanceof Y.Map)) return [];
    const out: Issue[] = [];
    for (const key of tombstones.keys()) {
      const sep = key.indexOf(':');
      const kind = sep < 0 ? key : key.slice(0, sep);
      if (!(ENTITY_KINDS as readonly string[]).includes(kind)) out.push(issue(I21, `entityTombstones key ${key} has unknown kind ${kind}`, [key]));
    }
    return out;
  },
};

export const REFERENCE_INVARIANTS: readonly Invariant[] = [I7, I8, I9, I10, I11, I12, I13, I15, I16, I17, I21];
