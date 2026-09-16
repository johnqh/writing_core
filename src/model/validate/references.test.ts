// src/model/validate/references.test.ts
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../../ids/id-source.js';
import { newId } from '../../ids/ids.js';
import { screenplayStandard } from '../../templates/builtin/screenplay-standard.js';
import { createDocument } from '../create.js';
import { insertElementRecord } from '../element-record.js';
import { writeEntity } from '../json.js';
import { encodeRelativePosition } from '../portable-pos.js';
import { validateDocument } from './index.js';

const ids = createSeededIdSource(21);
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };

function docWith(styles: string[]) {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const made = styles.map((style, i) =>
    insertElementRecord(elements, { id: newId('el', ids), pos: String.fromCharCode(65 + i), style: style as never, text: { plain: 'x', runs: [{ text: 'x', attrs: {} }], embeds: [] } }, meta),
  );
  return { doc, made };
}
const codes = (doc: Y.Doc) => validateDocument(doc).issues.map((i) => i.code).sort();

describe('reference invariants', () => {
  it('I7 dissolves a malformed dual-dialogue run', () => {
    const { doc, made } = docWith(['st_character', 'st_dialogue', 'st_action']);
    made[0]!.set('dual', { group: 'dd_01ARYZ6S410000000000000000', side: 'left' });
    made[1]!.set('dual', { group: 'dd_01ARYZ6S410000000000000000', side: 'left' });
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I7']);
    v.repair();
    expect(made[0]!.has('dual')).toBe(false);
    expect(codes(doc)).toEqual([]);
  });

  it('I7 accepts a well-formed run', () => {
    const { doc, made } = docWith(['st_character', 'st_dialogue', 'st_character', 'st_dialogue']);
    made.forEach((m, i) => m.set('dual', { group: 'dd_01ARYZ6S410000000000000000', side: i < 2 ? 'left' : 'right' }));
    expect(codes(doc)).toEqual([]);
  });

  it('I8 notes scene data on a non-scene element without repairing', () => {
    const { doc, made } = docWith(['st_action']);
    made[0]!.set('scene', new Y.Map());
    expect(validateDocument(doc).issues).toMatchObject([{ code: 'I8', autoRepair: false }]);
  });

  it('I9 reports a non-contiguous folder', () => {
    const { doc, made } = docWith(['st_scene_heading', 'st_scene_heading', 'st_scene_heading']);
    const folder = newId('fld', ids);
    const f = new Y.Map<unknown>();
    doc.getMap('folders').set(folder, f);
    for (const [k, v] of Object.entries({ id: folder, kind: 'folder', title: 'A', color: null, parentId: null, pos: 'V', collapsed: false, pageBudget: null })) f.set(k, v);
    f.set('synopsis', new Y.Text());
    made[0]!.set('folderId', folder);
    made[2]!.set('folderId', folder);
    expect(codes(doc)).toEqual(['I9']);
  });

  it('I10 nulls dangling references', () => {
    const { doc, made } = docWith(['st_scene_heading']);
    made[0]!.set('folderId', 'fld_01ARYZ6S410000000000000000');
    const scene = made[0]!.set('scene', new Y.Map<unknown>());
    scene.set('locationId', 'ent_01ARYZ6S410000000000000000');
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I10', 'I10']);
    v.repair();
    expect(made[0]!.has('folderId')).toBe(false);
    expect(scene.get('locationId')).toBeNull();
  });

  it('I11 removes orphan tag marks and tag records without marks', () => {
    const { doc, made } = docWith(['st_action']);
    const text = made[0]!.get('text') as Y.Text;
    text.format(0, 1, { 't:tag_01ARYZ6S410000000000000000': true });
    const cat = [...doc.getMap('tagCategories').keys()][0]!;
    const entity = newId('ent', ids);
    writeEntity(doc.getMap('entities'), { id: entity, kind: 'prop', name: 'GUN', nameKey: 'gun', aliases: [], color: null, description: { plain: '', runs: [], embeds: [] }, fields: {}, attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual' });
    const tagId = newId('tag', ids);
    const tag = new Y.Map<unknown>();
    doc.getMap('tags').set(tagId, tag);
    for (const [k, v] of Object.entries({ id: tagId, categoryId: cat, entityId: entity, elementId: made[0]!.get('id'), createdBy: 'u', createdAt: 0 })) tag.set(k, v);
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I11', 'I11']);
    v.repair();
    expect(text.toDelta()).toEqual([{ insert: 'x' }]);
    expect(doc.getMap('tags').size).toBe(0);
  });

  it('I12 detaches a range-anchored note when its only n: mark is removed', () => {
    const { doc, made } = docWith(['st_action']);
    const text = made[0]!.get('text') as Y.Text;
    const noteTypeId = [...doc.getMap('noteTypes').keys()][0]!;
    const notes = doc.getMap('notes');
    const noteId = newId('note', ids);
    const note = new Y.Map<unknown>();
    notes.set(noteId, note);
    note.set('id', noteId);
    note.set('typeId', noteTypeId);
    note.set('anchor', { kind: 'range' });
    text.format(0, 1, { [`n:${noteId}`]: true });
    // The mark is present, so the range note is still attached; nothing should fire yet.
    expect(codes(doc)).toEqual([]);
    text.format(0, 1, { [`n:${noteId}`]: null });
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I12']);
    v.repair();
    expect(note.get('anchor')).toEqual({ kind: 'document' });
    expect(codes(doc)).toEqual([]);
  });

  it('I12 does not fire for a document/element/beat-anchored note with no mark', () => {
    const { doc, made } = docWith(['st_action']);
    const notes = doc.getMap('notes');
    const noteTypeId = [...doc.getMap('noteTypes').keys()][0]!;
    const elementId = made[0]!.get('id') as string;
    const anchors = [
      { kind: 'document' as const },
      { kind: 'element' as const, elementId },
      { kind: 'beat' as const, beatId: newId('beat', ids) },
    ];
    for (const anchor of anchors) {
      const noteId = newId('note', ids);
      const note = new Y.Map<unknown>();
      notes.set(noteId, note);
      note.set('id', noteId);
      note.set('typeId', noteTypeId);
      note.set('anchor', anchor);
    }
    // None of these notes has an 'n:<id>' mark anywhere, and none is range-anchored, so I12
    // (unlike I10, which would separately flag e.g. a dangling beat anchor) must stay silent.
    expect(validateDocument(doc).issues.some((i) => i.code === 'I12')).toBe(false);
  });

  it('I13 removes marks for unknown revision sets', () => {
    const { doc, made } = docWith(['st_action']);
    const text = made[0]!.get('text') as Y.Text;
    text.format(0, 1, { rev: 'rev_01ARYZ6S410000000000000000' });
    text.insertEmbed(1, { type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000', by: 'u', at: 0 });
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I13', 'I13']);
    v.repair();
    expect(text.toDelta()).toEqual([{ insert: 'x' }]);
  });

  it('I15 re-anchors a page lock whose start no longer resolves, marking it reanchored', () => {
    const { doc, made } = docWith(['st_action', 'st_action']);
    const firstId = String(made[0]!.get('id'));
    const firstText = made[0]!.get('text') as Y.Text;
    const locks = doc.getMap('production').get('pageLocks') as Y.Map<unknown>;
    const lockId = newId('plk', ids);
    const lock = new Y.Map<unknown>();
    locks.set(lockId, lock);
    lock.set('id', lockId);
    lock.set('label', { base: 0, prefix: [], suffix: [] });
    lock.set('level', 0);
    lock.set('startElementId', firstId);
    lock.set('start', encodeRelativePosition(Y.createRelativePositionFromTypeIndex(firstText, 0, 0)));
    lock.set('startMidElement', false);
    lock.set('revisionSetId', null);
    lock.set('lockedAt', 0);
    lock.set('lockedBy', 'u');
    expect(codes(doc)).toEqual([]);
    // Delete the anchoring element: the lock's relative position can no longer resolve.
    doc.getMap('elements').delete(firstId);
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I15']);
    v.repair();
    expect(lock.get('startElementId')).toBe(made[1]!.get('id'));
    expect(lock.get('reanchored')).toBe(true);
    expect(codes(doc)).toEqual([]);
  });

  it('I16 flags duplicate entity name keys and I17 breaks merge cycles', () => {
    const { doc } = docWith(['st_action']);
    const a = newId('ent', ids);
    const b = newId('ent', ids);
    const base = { kind: 'character' as const, name: 'MAYA', nameKey: 'maya', aliases: [], color: null, description: { plain: '', runs: [], embeds: [] }, fields: {}, attributes: {}, categoryId: null, retain: false, createdBy: 'u', createdAt: 0, origin: 'manual' as const };
    writeEntity(doc.getMap('entities'), { ...base, id: a, mergedInto: null });
    writeEntity(doc.getMap('entities'), { ...base, id: b, mergedInto: null });
    expect(codes(doc)).toEqual(['I16']);
    (doc.getMap('entities').get(a) as Y.Map<unknown>).set('mergedInto', b);
    (doc.getMap('entities').get(b) as Y.Map<unknown>).set('mergedInto', a);
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I17']);
    v.repair();
    expect((doc.getMap('entities').get(b) as Y.Map<unknown>).get('mergedInto')).toBeNull();
    expect(codes(doc)).toEqual([]);
  });

  // Fix round 2 (M1 Task 28 re-review), item 5: validateDocument had no check for a stale
  // entityTombstones entry. Reported only, never auto-repaired — see the fix-round-2 report for why.
  it('I21 flags an entityTombstones key with an unrecognized kind, without repairing it', () => {
    const { doc } = docWith(['st_action']);
    const st = doc.getMap<unknown>('smartType').get('entityTombstones') as Y.Map<true>;
    st.set('character:maya', true);
    st.set('notAnEntityKind:whatever', true);
    const v = validateDocument(doc, { only: ['I21'] });
    expect(v.issues).toMatchObject([{ code: 'I21', severity: 'warning', autoRepair: false, ids: ['notAnEntityKind:whatever'] }]);
    expect(v.repair()).toBe(0);
    expect(st.has('notAnEntityKind:whatever')).toBe(true);
  });
});
