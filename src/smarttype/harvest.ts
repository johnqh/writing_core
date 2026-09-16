import type * as Y from 'yjs';
import { documentLanguage } from '../commands/element-ops.js';
import type { CommandContext } from '../commands/types.js';
import { type EntityId, newId } from '../ids/ids.js';
import { writeEntity } from '../model/json.js';
import { positionBetween } from '../model/positions.js';
import { lastPosition } from '../model/ymap.js';
import type { StoredSmartTypeList } from '../schema/vocab.js';
import { normalizeKey, stripExtension } from './normalize.js';

export type HarvestKind = 'character' | 'location';

export interface HarvestOptions {
  /** Entity kinds that may be created; default both. */
  kinds?: readonly HarvestKind[];
  /** Also harvest the non-entity SmartType lists; default true. */
  lists?: boolean;
}

export interface HarvestReport {
  createdEntities: EntityId[];
  listCounts: Partial<Record<StoredSmartTypeList, number>>;
}

type YMap = Y.Map<unknown>;

export function harvest(ctx: CommandContext, options: HarvestOptions = {}): HarvestReport {
  const { doc, model } = ctx;
  const kinds = options.kinds ?? ['character', 'location'];
  const language = documentLanguage(doc);
  const st = doc.getMap<unknown>('smartType');
  const dismissed = st.get('dismissed') as YMap;
  const tombstones = st.get('entityTombstones') as YMap;
  const report: HarvestReport = { createdEntities: [], listCounts: {} };
  const counts: Record<StoredSmartTypeList, Map<string, { text: string; count: number }>> = {
    sceneIntros: new Map(), times: new Map(), extensions: new Map(), transitions: new Map(), soundCues: new Map(),
  };
  const bump = (list: StoredSmartTypeList, text: string) => {
    const key = normalizeKey(text, { language });
    if (!key) return;
    const entry = counts[list].get(key) ?? { text, count: 0 };
    entry.count += 1;
    counts[list].set(key, entry);
  };
  /** Finds or creates the entity; returns its id, or null when blank or its kind is not being harvested. */
  const ensureEntity = (kind: HarvestKind, name: string, parentId: EntityId | null): EntityId | null => {
    const clean = name.trim();
    if (!clean) return null;
    const resolved = model.resolveEntity(kind, clean);
    if (resolved) return resolved.id;
    const key = normalizeKey(clean, { language, speaker: kind === 'character' });
    for (const v of doc.getMap('entities').values()) {
      const e = v as YMap;
      if (e.get('kind') === kind && e.get('nameKey') === key) return e.get('id') as EntityId;
    }
    if (!kinds.includes(kind)) return null;
    // The user explicitly deleted this (kind, nameKey) — don't let a later debounced harvest
    // silently mint it back (spec 01 §5.20 entityTombstones); entity.create clears the tombstone.
    if (tombstones.has(`${kind}:${key}`)) return null;
    const id = newId('ent', ctx.ids);
    const displayName = kind === 'character' ? stripExtension(clean).name.replace(/[.,:;]+$/, '').toLocaleUpperCase(language) : clean;
    writeEntity(doc.getMap('entities'), {
      id, kind, name: displayName, nameKey: key, aliases: [], color: null, description: { plain: '', runs: [], embeds: [] },
      fields: kind === 'location' && parentId ? { parentId } : {}, attributes: {}, categoryId: null, retain: false, mergedInto: null,
      createdBy: ctx.actor.userId, createdAt: ctx.clock(), origin: 'harvested',
    });
    report.createdEntities.push(id);
    return id;
  };

  for (const block of model.dialogueBlocks()) {
    ensureEntity('character', block.name, null);
    if (block.extension) bump('extensions', block.extension);
  }
  for (const scene of model.scenes()) {
    const h = scene.heading;
    if (h.intro) bump('sceneIntros', h.intro);
    if (h.time) bump('times', h.time);
    // Spec 01 §7.2: HOUSE - KITCHEN - DAY → HOUSE ⊃ KITCHEN (child entities carry parentId).
    let parent: EntityId | null = null;
    for (const name of h.subLocations.length > 0 ? h.subLocations : [h.location]) parent = ensureEntity('location', name, parent) ?? parent;
  }
  for (const el of model.elements()) {
    if (el.role === 'transition' && el.text.plain.trim()) bump('transitions', el.text.plain.trim());
    if (el.role === 'soundCue' && el.text.plain.trim()) bump('soundCues', el.text.plain.trim());
  }

  if (options.lists === false) return report;
  for (const list of Object.keys(counts) as StoredSmartTypeList[]) {
    const entries = st.get(list) as YMap;
    let last = lastPosition(entries);
    for (const [key, { text, count }] of counts[list]) {
      if (dismissed.has(`${list}:${key}`)) continue;
      const existing = entries.get(key) as { text: string; pos: string; origin: string; count: number } | undefined;
      if (existing) {
        if (existing.count !== count) entries.set(key, { ...existing, count });
      } else {
        const pos = positionBetween(last, null, ctx.ids);
        entries.set(key, { text, pos, origin: 'harvested', count });
        last = pos;
      }
    }
    report.listCounts[list] = counts[list].size;
  }
  return report;
}
