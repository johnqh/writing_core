import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../../ids/id-source.js';
import { screenplayStandard } from '../../templates/builtin/screenplay-standard.js';
import { createDocument } from '../create.js';
import { documentToJSON } from '../json.js';
import { validateDocument } from './index.js';

const fresh = () => createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(4) });
const codes = (doc: Y.Doc) => validateDocument(doc).issues.map((i) => i.code);
const firstElement = (doc: Y.Doc) => [...doc.getMap('elements').values()][0] as Y.Map<unknown>;

describe('structural invariants', () => {
  it('finds nothing wrong with a new document', () => {
    expect(validateDocument(fresh()).issues).toEqual([]);
  });

  it('I1 reports unknown top-level keys without repairing', () => {
    const doc = fresh();
    doc.getMap('mystery').set('a', 1);
    const issue = validateDocument(doc).issues.find((i) => i.code === 'I1')!;
    expect(issue).toMatchObject({ severity: 'error', autoRepair: false });
  });

  it('I2 rewrites a record id to its map key', () => {
    const doc = fresh();
    const el = firstElement(doc);
    el.set('id', 'el_01ARYZ6S41ZZZZZZZZZZZZZZZZ');
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I2']);
    v.repair();
    expect(codes(doc)).toEqual([]);
  });

  it('I4 fills a missing style and meta, I5 remaps an unknown built-in style by role', () => {
    const doc = fresh();
    const el = firstElement(doc);
    el.delete('meta');
    el.set('style', 'st_dialogue_missing');
    const second = new Y.Map<unknown>();
    doc.getMap('elements').set('el_01ARYZ6S410000000000000099', second);
    second.set('id', 'el_01ARYZ6S410000000000000099');
    second.set('pos', 'z');
    second.set('text', new Y.Text());
    second.set('meta', { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 });
    second.set('style', 'st_lyrics_x');
    const third = new Y.Map<unknown>();
    doc.getMap('elements').set('el_01ARYZ6S410000000000000098', third);
    third.set('id', 'el_01ARYZ6S410000000000000098');
    third.set('pos', 'y');
    third.set('text', new Y.Text());
    third.set('meta', { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 });
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code).sort()).toEqual(['I4', 'I4', 'I5', 'I5']);
    v.repair();
    expect(codes(doc)).toEqual([]);
    expect(el.get('style')).toBe(screenplayStandard.defaults.pasteFallback);
    expect(third.get('style')).toBe(screenplayStandard.defaults.pasteFallback);
  });

  it('I6 breaks a basedOn cycle', () => {
    const doc = fresh();
    const styles = (doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>);
    styles.get('st_action')!.set('basedOn', 'st_dialogue');
    styles.get('st_dialogue')!.set('basedOn', 'st_action');
    const v = validateDocument(doc);
    expect(v.issues.some((i) => i.code === 'I6' && i.autoRepair)).toBe(true);
    v.repair();
    expect(codes(doc)).toEqual([]);
  });

  it('I3 re-ids a title page element that duplicates a body id', () => {
    const doc = fresh();
    const bodyId = firstElement(doc).get('id') as string;
    const tpElements = doc.getMap('titlePage').get('elements') as Y.Map<Y.Map<unknown>>;
    const [tpId, tpEl] = [...tpElements.entries()][0]!;
    const json = documentToJSON(doc).titlePage.elements.find((e) => e.id === tpId)!;
    // Read before deleting: a deleted Y.Map's entries are deleted in the same transaction.
    const tpPos = tpEl.get('pos');
    doc.transact(() => {
      tpElements.delete(tpId);
      const copy = new Y.Map<unknown>();
      tpElements.set(bodyId, copy);
      copy.set('id', bodyId);
      copy.set('pos', tpPos);
      copy.set('style', json.style);
      copy.set('text', new Y.Text(json.text.plain));
      copy.set('meta', json.meta);
      (doc.getMap('titlePage').get('fields') as Y.Map<string>).set('title', bodyId);
    });
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I3']);
    v.repair();
    expect(codes(doc)).toEqual([]);
    const newTitleId = (doc.getMap('titlePage').get('fields') as Y.Map<string>).get('title');
    expect(newTitleId).not.toBe(bodyId);
    expect(tpElements.has(newTitleId!)).toBe(true);
  });

  it('I18 normalizes text to NFC and I19 rebalances long positions', () => {
    const doc = fresh();
    const el = firstElement(doc);
    (el.get('text') as Y.Text).insert(0, 'Café', { b: true });
    el.set('pos', 'V'.repeat(80));
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code).sort()).toEqual(['I18', 'I19']);
    v.repair();
    expect((el.get('text') as Y.Text).toString()).toBe('Café');
    expect((el.get('text') as Y.Text).toDelta()).toEqual([{ insert: 'Café', attributes: { b: true } }]);
    expect((el.get('pos') as string).length).toBeLessThanOrEqual(64);
  });

  it('I20 flags a document newer than the code', () => {
    const doc = fresh();
    doc.getMap('meta').set('schemaVersion', 99);
    expect(validateDocument(doc).issues.find((i) => i.code === 'I20')).toMatchObject({ severity: 'error', autoRepair: false });
  });
});
