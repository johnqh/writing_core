// src/model/validate/references.test.ts
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../../ids/id-source.js';
import { newId } from '../../ids/ids.js';
import { screenplayStandard } from '../../templates/builtin/screenplay-standard.js';
import { createDocument } from '../create.js';
import { insertElementRecord } from '../element-record.js';
import { writeEntity } from '../json.js';
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
});
