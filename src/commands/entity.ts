import * as Y from 'yjs';
import { z } from 'zod/v4';
import { newId } from '../ids/ids.js';
import { writeEntity } from '../model/json.js';
import { scanText, writeTextJSON } from '../model/ytext.js';
import { ENTITY_FIELD_SCHEMAS, EntityAttributes } from '../schema/entities.js';
import { HexColor, idSchema } from '../schema/primitives.js';
import { textJSONFromPlain } from '../schema/text.js';
import { ENTITY_KINDS } from '../schema/vocab.js';
import { harvest } from '../smarttype/harvest.js';
import { normalizeKey } from '../smarttype/normalize.js';
import { lang } from './element-ops.js';
import { touchElement, writePolicy } from './marks-policy.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;
const spec = <P>(id: string, params: z.ZodType<P>, run: (ctx: CommandContext, p: P) => CommandResult) => defineCommand(id, params, run, { scope: 'entities' });
const entityMap = (ctx: CommandContext, id: string) => ctx.doc.getMap<unknown>('entities').get(id) as YMap | undefined;
const TEXT_FIELDS = new Set(['bio', 'physicalDescription', 'personality', 'arc', 'setDescription']);
/** Entity-kind tombstones (spec 01 §5.20): `kind:nameKey` pairs the user explicitly deleted. */
const tombstones = (ctx: CommandContext) => ctx.doc.getMap<unknown>('smartType').get('entityTombstones') as Y.Map<true>;
const tombstoneKey = (kind: string, nameKey: string) => `${kind}:${nameKey}`;

function findByKey(ctx: CommandContext, kind: string, key: string): string | null {
  for (const v of ctx.doc.getMap('entities').values()) {
    const e = v as YMap;
    if (e.get('kind') === kind && e.get('mergedInto') === null && e.get('nameKey') === key) return String(e.get('id'));
  }
  return null;
}

export const ENTITY_COMMANDS: CommandSpec<never>[] = [
  spec('entity.create', z.object({
    kind: z.enum(ENTITY_KINDS), name: z.string().min(1), aliases: z.array(z.string()).optional(), color: HexColor.nullable().optional(),
    fields: z.record(z.string(), z.unknown()).optional(), attributes: EntityAttributes.optional(),
  }).superRefine((p, c) => {
    const r = ENTITY_FIELD_SCHEMAS[p.kind].safeParse(p.fields ?? {});
    if (!r.success) c.addIssue({ code: 'custom', message: 'invalid fields', path: ['fields'] });
  }), (ctx, p) => {
    const key = normalizeKey(p.name, { language: lang(ctx) });
    const existingId = findByKey(ctx, p.kind, key);
    if (existingId) return { ok: false, reason: 'notApplicable', detail: { existingId } };
    // Explicitly (re-)creating this name clears any tombstone left by a previous entity.delete
    // (spec 01 §5.20), so harvesting is free to touch it again.
    tombstones(ctx).delete(tombstoneKey(p.kind, key));
    const id = newId('ent', ctx.ids);
    writeEntity(ctx.doc.getMap('entities'), {
      id, kind: p.kind, name: p.name.trim(),
      nameKey: key, aliases: p.aliases ?? [], color: p.color ?? null, description: textJSONFromPlain(''),
      fields: p.fields ?? {}, attributes: p.attributes ?? {}, categoryId: null, retain: true, mergedInto: null,
      createdBy: ctx.actor.userId, createdAt: ctx.clock(), origin: 'manual',
    });
    return { ok: true, effects: [{ kind: 'entityCreated', id }] };
  }),

  spec('entity.update', z.object({
    entityId: idSchema('ent'),
    patch: z.object({
      name: z.string().min(1).optional(), color: HexColor.nullable().optional(), retain: z.boolean().optional(),
      categoryId: idSchema('cat').nullable().optional(), description: z.string().optional(),
      fields: z.record(z.string(), z.unknown()).optional(), attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  }), (ctx, p) => {
    const e = entityMap(ctx, p.entityId);
    if (!e) return { ok: false, reason: 'notFound' };
    const kind = e.get('kind') as (typeof ENTITY_KINDS)[number];
    const fieldsMap = e.get('fields') as YMap;
    if (p.patch.fields) {
      const merged: Record<string, unknown> = {};
      for (const [k, v] of fieldsMap.entries()) merged[k] = v instanceof Y.Text ? textJSONFromPlain(v.toString()) : v instanceof Y.Map ? v.toJSON() : v;
      Object.assign(merged, p.patch.fields);
      // A null in the patch removes the field; every entity field is optional.
      for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
      const checked = ENTITY_FIELD_SCHEMAS[kind].safeParse(merged);
      if (!checked.success) return { ok: false, reason: 'invalidParams', detail: { issues: checked.error.issues } };
    }
    if (p.patch.attributes) {
      const next = { ...(e.get('attributes') as YMap).toJSON(), ...p.patch.attributes };
      for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
      if (!EntityAttributes.safeParse(next).success) return { ok: false, reason: 'invalidParams' };
    }
    if (p.patch.name !== undefined) {
      const key = normalizeKey(p.patch.name, { language: lang(ctx) });
      const clash = findByKey(ctx, kind, key);
      if (clash && clash !== p.entityId) return { ok: false, reason: 'notApplicable', detail: { existingId: clash } };
      const oldName = String(e.get('name'));
      const oldKey = String(e.get('nameKey'));
      if (oldKey !== key) {
        // Keep the old name resolving to this entity (mirrors what entity.merge does for the
        // merged-away name), so cues and occurrences written under the old name still resolve.
        const aliases = e.get('aliases') as Y.Array<string>;
        const existing = new Set(aliases.toArray().map((a) => normalizeKey(a, { language: lang(ctx) })));
        if (!existing.has(oldKey)) aliases.push([oldName]);
      }
      e.set('name', p.patch.name);
      e.set('nameKey', key);
    }
    if (p.patch.color !== undefined) e.set('color', p.patch.color);
    if (p.patch.retain !== undefined) e.set('retain', p.patch.retain);
    if (p.patch.categoryId !== undefined) e.set('categoryId', p.patch.categoryId);
    if (p.patch.description !== undefined) {
      const text = e.set('description', new Y.Text());
      writeTextJSON(text, textJSONFromPlain(p.patch.description));
    }
    if (p.patch.fields) {
      for (const [k, v] of Object.entries(p.patch.fields)) {
        if (v === null) fieldsMap.delete(k);
        else if (TEXT_FIELDS.has(k)) writeTextJSON(fieldsMap.set(k, new Y.Text()), typeof v === 'string' ? textJSONFromPlain(v) : (v as never));
        else if (k === 'traits') {
          const traits = fieldsMap.set('traits', new Y.Map<unknown>());
          for (const [tk, tv] of Object.entries(v as Record<string, unknown>)) traits.set(tk, tv);
        } else fieldsMap.set(k, v);
      }
    }
    if (p.patch.attributes) {
      const attrs = e.get('attributes') as YMap;
      for (const [k, v] of Object.entries(p.patch.attributes)) {
        if (v === null) attrs.delete(k);
        else attrs.set(k, v);
      }
    }
    return { ok: true };
  }),

  spec('entity.merge', z.object({ from: idSchema('ent'), into: idSchema('ent') }), (ctx, p) => {
    const from = entityMap(ctx, p.from);
    const into = entityMap(ctx, p.into);
    if (!from || !into) return { ok: false, reason: 'notFound' };
    if (p.from === p.into || from.get('kind') !== into.get('kind') || into.get('mergedInto') !== null) return { ok: false, reason: 'notApplicable' };
    from.set('mergedInto', p.into);
    const aliases = into.get('aliases') as Y.Array<string>;
    const existing = new Set(aliases.toArray().map((a) => normalizeKey(a, { language: lang(ctx) })));
    for (const name of [String(from.get('name')), ...(from.get('aliases') as Y.Array<string>).toArray()]) {
      const key = normalizeKey(name, { language: lang(ctx) });
      if (!existing.has(key) && key !== into.get('nameKey')) {
        aliases.push([name]);
        existing.add(key);
      }
    }
    for (const v of ctx.doc.getMap('tags').values()) if ((v as YMap).get('entityId') === p.from) (v as YMap).set('entityId', p.into);
    for (const v of ctx.doc.getMap('elements').values()) {
      const scene = (v as YMap).get('scene');
      if (scene instanceof Y.Map && scene.get('locationId') === p.from) scene.set('locationId', p.into);
    }
    return { ok: true };
  }),

  spec('entity.delete', z.object({ entityId: idSchema('ent'), force: z.boolean().optional() }), (ctx, p) => {
    const entity = entityMap(ctx, p.entityId);
    if (!entity) return { ok: false, reason: 'notFound' };
    const tags = ctx.doc.getMap<unknown>('tags');
    const tagIds = [...tags.entries()].filter(([, v]) => (v as YMap).get('entityId') === p.entityId).map(([k]) => k);
    // Mirror entity.merge: a location referenced by elements[*].scene.locationId is a live
    // reference too (I10), not just tags.
    const locationElementIds = [...ctx.doc.getMap('elements').entries()]
      .filter(([, v]) => {
        const scene = (v as YMap).get('scene');
        return scene instanceof Y.Map && scene.get('locationId') === p.entityId;
      })
      .map(([k]) => k);
    if ((tagIds.length > 0 || locationElementIds.length > 0) && !p.force) {
      return { ok: false, reason: 'notApplicable', detail: { tagIds, locationElementIds } };
    }
    const policy = writePolicy(ctx);
    for (const tagId of tagIds) {
      const elementId = String((tags.get(tagId) as YMap).get('elementId'));
      const element = ctx.doc.getMap<unknown>('elements').get(elementId) as YMap | undefined;
      const text = element?.get('text');
      if (text instanceof Y.Text) {
        const key = `t:${tagId}`;
        for (const m of scanText(text).marks.filter((mk) => mk.key === key).reverse()) {
          // Route through the write policy exactly like mark.clear's applyFormat, so clearing
          // the tag mark under Track Changes leaves a fmt marker instead of a silent edit.
          const attrs: Record<string, unknown> = { [key]: null };
          if (policy.track) attrs.fmt = { changeId: policy.track.changeId, by: policy.track.by, at: policy.track.at, before: { [key]: m.value ?? null } };
          text.format(m.index, m.length, attrs as Record<string, never>);
        }
        if (element) touchElement(element, policy);
      }
      tags.delete(tagId);
    }
    for (const elementId of locationElementIds) {
      const scene = (ctx.doc.getMap<unknown>('elements').get(elementId) as YMap).get('scene') as Y.Map<unknown>;
      scene.set('locationId', null);
    }
    for (const v of ctx.doc.getMap('entities').values()) if ((v as YMap).get('mergedInto') === p.entityId) (v as YMap).set('mergedInto', null);
    // Tombstone the (kind, nameKey) so a later harvest doesn't silently recreate what the user
    // just deleted (spec 01 §5.20); entity.create clears it on explicit re-creation.
    tombstones(ctx).set(tombstoneKey(String(entity.get('kind')), String(entity.get('nameKey'))), true);
    ctx.doc.getMap('entities').delete(p.entityId);
    return { ok: true };
  }),

  spec('entity.addAlias', z.object({ entityId: idSchema('ent'), alias: z.string().min(1) }), (ctx, p) => {
    const e = entityMap(ctx, p.entityId);
    if (!e) return { ok: false, reason: 'notFound' };
    const aliases = e.get('aliases') as Y.Array<string>;
    const key = normalizeKey(p.alias, { language: lang(ctx) });
    if (key === e.get('nameKey') || aliases.toArray().some((a) => normalizeKey(a, { language: lang(ctx) }) === key)) return { ok: true };
    aliases.push([p.alias]);
    return { ok: true };
  }),

  spec('entity.removeAlias', z.object({ entityId: idSchema('ent'), alias: z.string().min(1) }), (ctx, p) => {
    const e = entityMap(ctx, p.entityId);
    if (!e) return { ok: false, reason: 'notFound' };
    const aliases = e.get('aliases') as Y.Array<string>;
    const key = normalizeKey(p.alias, { language: lang(ctx) });
    const list = aliases.toArray();
    for (let i = list.length - 1; i >= 0; i--) if (normalizeKey(list[i]!, { language: lang(ctx) }) === key) aliases.delete(i, 1);
    return { ok: true };
  }),

  spec('entity.rebuild', z.object({ kinds: z.array(z.enum(['character', 'location'])).optional() }), (ctx, p) => {
    harvest(ctx, { kinds: p.kinds, lists: false });
    return { ok: true };
  }),
];
