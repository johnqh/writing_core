import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids/ids.js';
import { validateDocument } from '../model/validate/index.js';
import { commandHarness } from './test-harness.js';

describe('entity commands', () => {
  it('creates, refuses duplicates by normalized name, and updates validated fields', () => {
    const h = commandHarness();
    const r = h.run('entity.create', { kind: 'character', name: 'Maya', fields: { age: '30' } });
    expect(r.ok).toBe(true);
    const id = h.model.resolveEntity('character', 'MAYA')!.id;
    expect(h.run('entity.create', { kind: 'character', name: 'MAYA.' })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { existingId: id } });
    expect(h.run('entity.update', { entityId: id, patch: { fields: { role: 'hero' } } })).toMatchObject({ ok: false, reason: 'invalidParams' });
    h.run('entity.update', { entityId: id, patch: { fields: { role: 'lead' }, attributes: { 'video.styleRef': 'x' }, description: 'Tall.' } });
    expect(h.model.entity(id)).toMatchObject({ fields: { age: '30', role: 'lead' }, attributes: { 'video.styleRef': 'x' }, description: { plain: 'Tall.' } });
  });

  it('merges entities, repointing tags and keeping the old name as an alias', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'The GUN fires.']]);
    h.run('entity.create', { kind: 'prop', name: 'GUN' });
    h.run('entity.create', { kind: 'prop', name: 'PISTOL' });
    const gun = h.model.resolveEntity('prop', 'GUN')!.id;
    const pistol = h.model.resolveEntity('prop', 'PISTOL')!.id;
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: tagId, categoryId: 'cat_x', entityId: gun, elementId: a, createdBy: 'u1', createdAt: 0 })) tag.set(k, v);
    h.run('entity.merge', { from: gun, into: pistol });
    expect(tag.get('entityId')).toBe(pistol);
    expect(h.model.entity(gun)!.id).toBe(pistol);
    expect(h.model.entity(pistol)!.aliases).toContain('GUN');
    expect(h.model.resolveEntity('prop', 'gun')!.id).toBe(pistol);
    expect(h.run('entity.merge', { from: pistol, into: pistol })).toMatchObject({ ok: false, reason: 'notApplicable' });
    // The fixture's tag uses a placeholder categoryId and is never marked into the element's
    // text (unlike the delete test below), so I10/I11 are pre-existing fixture warnings, not a
    // regression from entity.merge; I17 (mergedInto cycles) is what this sequence must keep clean.
    expect(validateDocument(h.doc, { only: ['I17'] }).issues).toEqual([]);
  });

  it('refuses to merge into an entity that has itself already been merged away, so no cycle can ever form', () => {
    const h = commandHarness();
    h.run('entity.create', { kind: 'prop', name: 'GUN' });
    h.run('entity.create', { kind: 'prop', name: 'PISTOL' });
    h.run('entity.create', { kind: 'prop', name: 'REVOLVER' });
    const gun = h.model.resolveEntity('prop', 'GUN')!.id;
    const pistol = h.model.resolveEntity('prop', 'PISTOL')!.id;
    const revolver = h.model.resolveEntity('prop', 'REVOLVER')!.id;
    expect(h.run('entity.merge', { from: gun, into: pistol })).toMatchObject({ ok: true });
    // pistol is now a merge target with mergedInto === null still (it's the survivor); gun.mergedInto === pistol.
    // Merging revolver "into" gun — an entity that has itself been merged away — must refuse, since
    // allowing it would let a later merge of pistol "into" revolver close the loop into a cycle.
    expect(h.run('entity.merge', { from: revolver, into: gun })).toMatchObject({ ok: false, reason: 'notApplicable' });
    expect(h.model.entity(revolver)!.id).toBe(revolver);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('refuses to delete a tagged entity unless forced, then removes tags and marks', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'GUN']]);
    h.run('entity.create', { kind: 'prop', name: 'GUN' });
    const gun = h.model.resolveEntity('prop', 'GUN')!.id;
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: tagId, categoryId: 'cat_x', entityId: gun, elementId: a, createdBy: 'u1', createdAt: 0 })) tag.set(k, v);
    h.textMap(a!).format(0, 3, { [`t:${tagId}`]: true });
    expect(h.run('entity.delete', { entityId: gun })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { tagIds: [tagId] } });
    h.run('entity.delete', { entityId: gun, force: true });
    expect(h.doc.getMap('entities').has(gun)).toBe(false);
    expect(h.doc.getMap('tags').size).toBe(0);
    expect(h.delta(a!)).toEqual([{ insert: 'GUN' }]);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('adds and removes aliases', () => {
    const h = commandHarness();
    h.run('entity.create', { kind: 'character', name: 'ROBERT' });
    const bob = h.model.resolveEntity('character', 'ROBERT')!.id;
    h.run('entity.addAlias', { entityId: bob, alias: 'BOB' });
    expect(h.model.resolveEntity('character', 'bob')!.id).toBe(bob);
    h.run('entity.removeAlias', { entityId: bob, alias: 'bob' });
    expect(h.model.resolveEntity('character', 'bob')).toBeUndefined();
  });

  it('renaming an entity keeps the old name resolving to it, so existing occurrences stay attached (review finding B)', () => {
    const h = commandHarness();
    h.replaceBody([['st_character', 'MAYA'], ['st_dialogue', 'Hi.']]);
    h.run('smartType.rebuild', {});
    const maya = h.model.resolveEntity('character', 'MAYA')!.id;
    // Harvested + not retained: hidden flips true the moment it has zero occurrences, which is
    // exactly the symptom the probe found after a rename that didn't alias the old name.
    expect(h.model.entity(maya)).toMatchObject({ hidden: false, origin: 'harvested' });
    expect(h.model.occurrences(maya).length).toBeGreaterThan(0);
    h.run('entity.update', { entityId: maya, patch: { name: 'MAYA SMITH' } });
    expect(h.model.resolveEntity('character', 'MAYA')!.id).toBe(maya);
    expect(h.model.entity(maya)!.aliases).toContain('MAYA');
    expect(h.model.occurrences(maya).length).toBeGreaterThan(0);
    expect(h.model.entity(maya)!.hidden).toBe(false);
    // Renaming to the same key again (e.g. touching casing/punctuation only) must not pile up
    // duplicate aliases.
    h.run('entity.update', { entityId: maya, patch: { name: 'Maya Smith' } });
    expect(h.model.entity(maya)!.aliases.filter((a) => a === 'MAYA')).toHaveLength(1);
  });

  it('refuses to delete a location referenced only by scene.locationId unless forced, then clears the field (review finding C)', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_scene_heading', 'INT. DINER - NIGHT']]);
    h.run('entity.create', { kind: 'location', name: 'DINER' });
    const diner = h.model.resolveEntity('location', 'DINER')!.id;
    const scene = (h.doc.getMap('elements').get(a!) as Y.Map<unknown>).set('scene', new Y.Map<unknown>());
    scene.set('locationId', diner);
    expect(h.run('entity.delete', { entityId: diner })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { locationElementIds: [a] } });
    expect(h.doc.getMap('entities').has(diner)).toBe(true);
    h.run('entity.delete', { entityId: diner, force: true });
    expect(h.doc.getMap('entities').has(diner)).toBe(false);
    expect(scene.get('locationId')).toBeNull();
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('routes tag-mark removal through the write policy under Track Changes, recording a fmt mark and touching the element (review finding D)', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'GUN']]);
    h.run('entity.create', { kind: 'prop', name: 'GUN' });
    const gun = h.model.resolveEntity('prop', 'GUN')!.id;
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: tagId, categoryId: 'cat_x', entityId: gun, elementId: a, createdBy: 'u1', createdAt: 0 })) tag.set(k, v);
    h.textMap(a!).format(0, 3, { [`t:${tagId}`]: true });
    h.doc.getMap('trackChanges').set('enabled', true);
    h.tick(20_000); // past the edit-throttle window, so touchElement's meta bump is observable
    h.run('entity.delete', { entityId: gun, force: true });
    const attrs = (h.delta(a!)[0] as { attributes?: Record<string, unknown> }).attributes;
    expect(attrs?.[`t:${tagId}`]).toBeUndefined();
    expect(attrs?.fmt).toMatchObject({ before: { [`t:${tagId}`]: true } });
    const meta = (h.doc.getMap('elements').get(a!) as Y.Map<unknown>).get('meta') as { editedAt: number; editedBy: string };
    expect(meta.editedAt).toBe(h.now());
  });

  // Fix round 2 (M1 Task 28 re-review), item 2: a document created before entityTombstones
  // existed (or by an older build) has no such key. entity.create and entity.delete both write
  // to it, so — unlike harvest.ts's read-only defensiveness — they must lazily create the map
  // rather than throw on a plain `.set`/`.delete` against `undefined`.
  it('entity.create and entity.delete lazily create smartType.entityTombstones when it is missing entirely', () => {
    const h = commandHarness();
    h.doc.getMap('smartType').delete('entityTombstones');
    expect(h.run('entity.create', { kind: 'character', name: 'MAYA' })).toMatchObject({ ok: true });
    const maya = h.model.resolveEntity('character', 'MAYA')!.id;
    expect(h.doc.getMap('smartType').has('entityTombstones')).toBe(true);
    expect(h.run('entity.delete', { entityId: maya })).toMatchObject({ ok: true });
    expect((h.doc.getMap('smartType').get('entityTombstones') as Y.Map<unknown>).has('character:maya')).toBe(true);
  });
});

describe('SmartType list commands', () => {
  it('adds, dismisses, reorders and alphabetizes entries', () => {
    const h = commandHarness();
    h.run('smartType.addEntry', { list: 'times', text: 'DUSK' });
    expect(h.model.smartTypeSuggestions('times', 'du').map((s) => s.text)).toEqual(['DUSK']);
    h.run('smartType.removeEntry', { list: 'times', key: 'dusk' });
    expect(h.model.smartTypeSuggestions('times', 'du')).toEqual([]);
    h.run('smartType.addEntry', { list: 'times', text: 'DUSK' });
    expect(h.model.smartTypeSuggestions('times', 'du').map((s) => s.text)).toEqual(['DUSK']);
    h.doc.getMap('smartType').set('sortMode', 'custom');
    h.run('smartType.reorder', { list: 'extensions', keys: ['(subtitle)', '(v.o.)', '(o.s.)', '(o.c.)'] });
    expect(h.model.smartTypeSuggestions('extensions', '').map((s) => s.text)).toEqual(['(SUBTITLE)', '(V.O.)', '(O.S.)', '(O.C.)']);
    h.run('smartType.alphabetize', { list: 'extensions' });
    expect(h.model.smartTypeSuggestions('extensions', '').map((s) => s.text)).toEqual(['(O.C.)', '(O.S.)', '(SUBTITLE)', '(V.O.)']);
  });
  it('reorder refuses an unknown key and otherwise appends untouched entries after the reordered ones, in their existing position order', () => {
    const h = commandHarness();
    h.doc.getMap('smartType').set('sortMode', 'custom');
    expect(h.run('smartType.reorder', { list: 'extensions', keys: ['(v.o.)', 'nope'] })).toMatchObject({ ok: false, reason: 'notFound' });
    // '(subtitle)' is left out of the reorder call, so it must keep coming last: it was already
    // the greatest `pos` among the seeded extensions, and the sort of the untouched ("rest")
    // entries must use position order (comparePositions), not text or key order.
    h.run('smartType.reorder', { list: 'extensions', keys: ['(o.c.)', '(o.s.)', '(v.o.)'] });
    expect(h.model.smartTypeSuggestions('extensions', '').map((s) => s.text)).toEqual(['(O.C.)', '(O.S.)', '(V.O.)', '(SUBTITLE)']);
  });
  it('orders untouched reorder entries by comparePositions, not localeCompare (`M` sorts before `m` in code-unit order but after it under en collation)', () => {
    const h = commandHarness();
    const sc = h.doc.getMap('smartType').get('soundCues') as Y.Map<{ text: string; pos: string; origin: string; count: number }>;
    sc.set('keym', { text: 'lower', pos: 'm', origin: 'manual', count: 0 });
    sc.set('keyM', { text: 'upper', pos: 'M', origin: 'manual', count: 0 });
    sc.set('first', { text: 'FIRST', pos: '0', origin: 'manual', count: 0 });
    h.doc.getMap('smartType').set('sortMode', 'custom');
    h.run('smartType.reorder', { list: 'soundCues', keys: ['first'] });
    expect(h.model.smartTypeSuggestions('soundCues', '').map((s) => s.text)).toEqual(['FIRST', 'upper', 'lower']);
  });
  it('merges cleanup candidates into one entry', () => {
    const h = commandHarness();
    const times = h.doc.getMap('smartType').get('times') as Y.Map<unknown>;
    times.set('dawn', { text: 'DAWN', pos: 'x', origin: 'harvested', count: 2 });
    times.set('dawn!', { text: 'Dawn!', pos: 'y', origin: 'harvested', count: 1 });
    h.run('smartType.cleanup', { list: 'times', merges: [{ from: ['dawn!'], into: 'dawn' }] });
    expect(times.has('dawn!')).toBe(false);
    expect(times.get('dawn')).toMatchObject({ text: 'DAWN', count: 3 });
  });
});
