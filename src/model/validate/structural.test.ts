import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../../ids/id-source.js';
import { screenplayStandard } from '../../templates/builtin/screenplay-standard.js';
import { ROOT_STYLE_DEFAULTS } from '../../templates/shared.js';
import { createDocument } from '../create.js';
import { documentToJSON } from '../json.js';
import { UNIMPLEMENTED_INVARIANTS, validateDocument } from './index.js';
import { INVARIANT_CODES } from './types.js';

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

  it('I1 reports a missing meta.docId without repairing', () => {
    const doc = fresh();
    doc.getMap('meta').delete('docId');
    const issue = validateDocument(doc).issues.find((i) => i.code === 'I1' && i.message.includes('docId'))!;
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

  it('I4 fills a missing pos via positionBetween, leaving other fields untouched', () => {
    const doc = fresh();
    const noPos = new Y.Map<unknown>();
    doc.getMap('elements').set('el_01ARYZ6S410000000000000096', noPos);
    noPos.set('id', 'el_01ARYZ6S410000000000000096');
    noPos.set('text', new Y.Text());
    noPos.set('meta', { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 });
    noPos.set('style', screenplayStandard.defaults.pasteFallback);
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I4']);
    expect(v.issues[0]).toMatchObject({ ids: ['el_01ARYZ6S410000000000000096'] });
    v.repair();
    expect(typeof noPos.get('pos')).toBe('string');
    expect((noPos.get('pos') as string).length).toBeGreaterThan(0);
    expect(codes(doc)).toEqual([]);
  });

  it('I4 fills a missing text with an empty Y.Text', () => {
    const doc = fresh();
    const noText = new Y.Map<unknown>();
    doc.getMap('elements').set('el_01ARYZ6S410000000000000095', noText);
    noText.set('id', 'el_01ARYZ6S410000000000000095');
    noText.set('pos', 'zz');
    noText.set('meta', { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 });
    noText.set('style', screenplayStandard.defaults.pasteFallback);
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I4']);
    v.repair();
    expect(noText.get('text')).toBeInstanceOf(Y.Text);
    expect(codes(doc)).toEqual([]);
  });

  it('I5 remaps an unknown style to another template’s same-role style, not the paste fallback', () => {
    const doc = fresh();
    const el = firstElement(doc);
    // 'st_act_heading' is a real built-in style id (from the stage-play template) with role
    // 'actStart', a role screenplayStandard also has (as 'st_new_act'); it is unknown to
    // screenplayStandard itself, so I5 must fire, but BUILTIN_STYLE_ROLES knows its role.
    el.set('style', 'st_act_heading');
    const v = validateDocument(doc);
    expect(v.issues.map((i) => i.code)).toEqual(['I5']);
    v.repair();
    expect(el.get('style')).toBe('st_new_act');
    expect(el.get('style')).not.toBe(screenplayStandard.defaults.pasteFallback);
    expect(codes(doc)).toEqual([]);
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

  it('I6 repairs a style based on a missing parent by rebasing it to the template root', () => {
    const doc = fresh();
    const styles = doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>;
    styles.get('st_parenthetical')!.set('basedOn', 'st_ghost_parent');
    const v = validateDocument(doc);
    const i6 = v.issues.filter((i) => i.code === 'I6');
    expect(i6).toHaveLength(1);
    expect(i6[0]).toMatchObject({ autoRepair: true });
    v.repair();
    expect(styles.get('st_parenthetical')!.get('basedOn')).toBe(screenplayStandard.defaults.root);
    expect(codes(doc)).toEqual([]);
  });

  it('I6 rebases an extra root (multipleRoots) onto the template root', () => {
    const doc = fresh();
    const styles = doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>;
    styles.get('st_parenthetical')!.set('basedOn', null);
    const v = validateDocument(doc);
    const i6 = v.issues.filter((i) => i.code === 'I6');
    expect(i6).toHaveLength(1);
    expect(i6[0]).toMatchObject({ autoRepair: true });
    v.repair();
    expect(styles.get('st_parenthetical')!.get('basedOn')).toBe(screenplayStandard.defaults.root);
    expect(codes(doc)).toEqual([]);
  });

  it('I6 reports noRoot and rootMismatch, neither auto-repaired, when the root gets a parent', () => {
    const doc = fresh();
    const styles = doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>;
    const rootId = screenplayStandard.defaults.root;
    // Giving the root style itself a (nonexistent) parent removes the template's only
    // basedOn:null style (noRoot) and gives the root a parent (rootMismatch) in one move;
    // neither TemplateIssue has a repair branch in I6 (unlike basedOnCycle/missingParent),
    // so both must be reported for manual resolution.
    styles.get(rootId)!.set('basedOn', 'st_ghost_root_parent');
    const v = validateDocument(doc);
    const i6 = v.issues.filter((i) => i.code === 'I6');
    expect(i6.some((i) => i.message === 'no root style')).toBe(true);
    expect(i6.some((i) => i.message === 'defaults.root has a parent')).toBe(true);
    expect(i6.every((i) => i.autoRepair === false)).toBe(true);
  });

  it('I6 fills an incomplete root style field', () => {
    const doc = fresh();
    const styles = doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>;
    const rootId = screenplayStandard.defaults.root;
    const root = styles.get(rootId)!;
    root.delete('align');
    const v = validateDocument(doc);
    const i6 = v.issues.filter((i) => i.code === 'I6' && i.message === 'root style lacks align');
    expect(i6).toHaveLength(1);
    expect(i6[0]).toMatchObject({ autoRepair: true });
    v.repair();
    expect(root.get('align')).toBe(ROOT_STYLE_DEFAULTS.align);
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

describe('codes with no implementation in this build', () => {
  it('answers `only: ["I14"]` honestly instead of reporting a clean document', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(77) });
    const issues = validateDocument(doc, { only: ['I14'] }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'I14', severity: 'info', autoRepair: false });
    expect(issues[0]!.message).toContain('not implemented in this build');
    expect(UNIMPLEMENTED_INVARIANTS.I14).toContain('M2');
  });

  it('stays silent in a full pass, so a healthy document still reports nothing', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(78) });
    expect(validateDocument(doc).issues).toEqual([]);
  });

  it('every other spec 01 §9 code IS implemented', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(79) });
    const unimplemented = INVARIANT_CODES.filter((code) => validateDocument(doc, { only: [code] }).issues.some((i) => i.message.includes('not implemented in this build')));
    expect(unimplemented).toEqual(Object.keys(UNIMPLEMENTED_INVARIANTS));
  });
});
