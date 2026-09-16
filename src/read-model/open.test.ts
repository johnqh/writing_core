import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { openDocument } from './open.js';
import type { ModelChangeBatch } from './views.js';

const ids = createSeededIdSource(31);
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };
const deps = { ids, clock: () => 0, locale: 'en' };

function setup() {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const add = (style: string, pos: string, text: string) =>
    insertElementRecord(elements, { id: newId('el', ids), pos, style: style as never, text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  const h = add('st_scene_heading', 'B', 'INT. DINER - NIGHT');
  const a = add('st_action', 'D', 'Maya waits.');
  const c = add('st_character', 'F', 'MAYA');
  return { doc, h, a, c, add };
}

describe('openDocument elements', () => {
  it('lists elements in document order with immutable views', () => {
    const { doc, h, a, c } = setup();
    const model = openDocument(doc, deps);
    expect(model.elements().map((e) => e.id)).toEqual([h.get('id'), a.get('id'), c.get('id')]);
    const view = model.element(a.get('id') as never)!;
    expect(view).toMatchObject({ role: 'action', text: { plain: 'Maya waits.' }, hasScene: false });
    expect(Object.isFrozen(view)).toBe(true);
    expect(model.element(a.get('id') as never)).toBe(view);
    expect(model.indexOf(c.get('id') as never)).toBe(2);
    expect(model.elementAt(0).id).toBe(h.get('id'));
    expect(model.next(h.get('id') as never, (e) => e.role === 'character')!.id).toBe(c.get('id'));
    expect(model.previous(c.get('id') as never)!.id).toBe(a.get('id'));
    expect(model.elements({ from: 1, to: 2 }).map((e) => e.id)).toEqual([a.get('id')]);
    expect(model.resolveStyle(c.get('id') as never).indentLeft).toBe(1_828_800);
    expect(model.stylesByRole('outline').map((s) => s.id)).toEqual(['st_outline_1', 'st_outline_2', 'st_outline_3']);
    expect(model.toJSON().elements.map((e) => e.id)).toEqual([h.get('id'), a.get('id'), c.get('id')]);
  });

  it('replaces only changed views and bumps text/attrs versions separately', () => {
    const { doc, h, a } = setup();
    const model = openDocument(doc, deps);
    const hView = model.element(h.get('id') as never);
    const aView = model.element(a.get('id') as never);
    (a.get('text') as Y.Text).insert(0, 'Still, ');
    expect(model.element(a.get('id') as never)).not.toBe(aView);
    expect(model.element(h.get('id') as never)).toBe(hView);
    expect(model.textVersion(a.get('id') as never)).toBe(1);
    expect(model.attrsVersion(a.get('id') as never)).toBe(0);
    a.set('style', 'st_shot');
    expect(model.attrsVersion(a.get('id') as never)).toBe(1);
    expect(model.element(a.get('id') as never)!.role).toBe('shot');
  });

  it('bumps textVersion when the whole `text` key is replaced, not only when the Y.Text is edited', () => {
    const { doc, a } = setup();
    const model = openDocument(doc, deps);
    const id = a.get('id') as never;
    expect(model.textVersion(id)).toBe(0);
    doc.transact(() => {
      const t = a.set('text', new Y.Text());
      t.insert(0, 'Replaced.');
    });
    expect(model.element(id)!.text.plain).toBe('Replaced.');
    expect(model.textVersion(id)).toBeGreaterThan(0);
  });

  it('bumps attrsVersion for element-level `omit` (a one-line placeholder is a layout change)', () => {
    const { doc, a } = setup();
    const model = openDocument(doc, deps);
    const id = a.get('id') as never;
    const before = model.attrsVersion(id);
    a.set('omit', { at: 1, by: 'u', rev: null });
    expect(model.attrsVersion(id)).toBe(before + 1);
  });

  it('bumps attrsVersion for scene.omit only, not for any other scene field (spec 02 §31.2)', () => {
    const { doc, h } = setup();
    const model = openDocument(doc, deps);
    const id = h.get('id') as never;
    const scene = h.set('scene', new Y.Map<unknown>());
    const before = model.attrsVersion(id);
    scene.set('locationId', 'ent_01ARYZ6S410000000000000000');
    expect(model.attrsVersion(id)).toBe(before);
    scene.set('omit', { at: 1, by: 'u', rev: null });
    expect(model.attrsVersion(id)).toBe(before + 1);
  });

  it('never reuses the counters or the hash memo of an element that was deleted and recreated with the same id', () => {
    const { doc, a } = setup();
    const model = openDocument(doc, deps);
    const id = a.get('id') as string;
    const firstHash = model.elementContentHash(id as never);
    const textV = model.textVersion(id as never);
    const attrsV = model.attrsVersion(id as never);
    const pos = String(a.get('pos'));
    doc.transact(() => doc.getMap('elements').delete(id));
    doc.transact(() => insertElementRecord(doc.getMap('elements'), {
      id: id as never, pos, style: 'st_action' as never,
      text: { plain: 'Something else entirely.', runs: [{ text: 'Something else entirely.', attrs: {} }], embeds: [] },
    }, meta));
    expect(model.element(id as never)!.text.plain).toBe('Something else entirely.');
    expect(model.elementContentHash(id as never)).not.toBe(firstHash);
    expect(model.textVersion(id as never)).toBeGreaterThan(textV);
    expect(model.attrsVersion(id as never)).toBeGreaterThan(attrsV);
  });

  it('delivers one batch per transaction with origin and locality', () => {
    const { doc, h, a, add } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const origin = { kind: 'test' };
    let inserted = '';
    doc.transact(() => {
      (h.get('text') as Y.Text).insert(0, 'EXT. ');
      a.set('pos', 'Z');
      inserted = add('st_action', 'C', 'New.').get('id') as string;
    }, origin);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.origin).toBe(origin);
    expect(batches[0]!.local).toBe(true);
    const el = batches[0]!.changes.find((c) => c.kind === 'elements')!;
    expect(el).toEqual({ kind: 'elements', inserted: [inserted], removed: [], changed: [h.get('id'), a.get('id')].sort(), reordered: true });
    expect(model.elements().map((e) => e.id)).toEqual([h.get('id'), inserted, expect.any(String), a.get('id')]);
  });

  it('reports remote transactions as not local and template edits as template changes', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    ((remote.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>).get('st_action')!).set('spaceBefore', 2);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.local).toBe(false);
    expect(batches[0]!.changes).toContainEqual({ kind: 'template', styleIds: ['st_action'] });
    expect(model.template().styles.find((s) => s.id === 'st_action')!.spaceBefore).toBe(2);
    model.dispose();
  });

  it('removes an element from the index, views and change batch', () => {
    const { doc, h, a, c } = setup();
    const model = openDocument(doc, deps);
    // Warm the view cache so the removal branch also has to evict it.
    model.elements();
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const removedId = a.get('id') as string;

    doc.getMap('elements').delete(removedId);

    expect(model.elementCount()).toBe(2);
    expect(model.indexOf(removedId as never)).toBe(-1);
    expect(model.elements().map((e) => e.id)).toEqual([h.get('id'), c.get('id')]);
    expect(model.element(removedId as never)).toBeUndefined();
    expect(model.next(h.get('id') as never)!.id).toBe(c.get('id'));
    expect(model.previous(c.get('id') as never)!.id).toBe(h.get('id'));

    expect(batches).toHaveLength(1);
    const el = batches[0]!.changes.find((ch) => ch.kind === 'elements')!;
    expect(el).toEqual({ kind: 'elements', inserted: [], removed: [removedId], changed: [], reordered: true });
  });

  it('applies a remote transaction that inserts, moves and removes elements', () => {
    const { doc, h, a, c } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const remoteElements = remote.getMap('elements');
    const insertedId = insertElementRecord(
      remoteElements,
      { id: newId('el', ids), pos: 'A', style: 'st_action' as never, text: { plain: 'New first.', runs: [{ text: 'New first.', attrs: {} }], embeds: [] } },
      meta,
    ).get('id') as string;
    (remoteElements.get(h.get('id') as string) as Y.Map<unknown>).set('pos', 'ZZ'); // move heading after everything else
    remoteElements.delete(a.get('id') as string); // remove the action
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));

    expect(batches).toHaveLength(1);
    expect(batches[0]!.local).toBe(false);
    expect(model.elementCount()).toBe(3);
    expect(model.elements().map((e) => e.id)).toEqual([insertedId, c.get('id'), h.get('id')]);
    expect(model.indexOf(a.get('id') as never)).toBe(-1);
  });

  it('stops delivering batches once unsubscribed', () => {
    const { doc, h } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    const unsubscribe = model.subscribe((b) => batches.push(b));

    doc.transact(() => (h.get('text') as Y.Text).insert(0, 'A '));
    expect(batches).toHaveLength(1);

    unsubscribe();
    doc.transact(() => (h.get('text') as Y.Text).insert(0, 'B '));
    expect(batches).toHaveLength(1);
  });

  it('delivers no further batches after dispose and detaches its observers', () => {
    const { doc, h } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));

    model.dispose();
    doc.transact(() => (h.get('text') as Y.Text).insert(0, 'C '));
    expect(batches).toHaveLength(0);
    // Not just an empty listener set: the element observer itself must be detached, or
    // textVersion would still advance even with nobody subscribed to hear about it.
    expect(model.textVersion(h.get('id') as never)).toBe(0);
  });

  it('resolves role to null for an unknown style without throwing', () => {
    const { doc, add } = setup();
    const model = openDocument(doc, deps);
    const bogus = add('st_does_not_exist', 'Q', 'Mystery line.');
    expect(model.element(bogus.get('id') as never)!.role).toBeNull();
  });

  it('lets a genuine resolveStyle failure propagate instead of being swallowed', () => {
    const { doc, h } = setup();
    const model = openDocument(doc, deps);
    const rootStyle = (doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>).get('st_normal')!;
    rootStyle.delete('align'); // no style in h's chain overrides align, so its resolution has no value left to inherit
    expect(() => model.element(h.get('id') as never)).toThrow(/no value for align/);
  });

  it('resolves title page role to null for an unknown style without throwing', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const tpElements = doc.getMap('titlePage').get('elements') as Y.Map<unknown>;
    const bogus = insertElementRecord(
      tpElements,
      { id: newId('el', ids), pos: 'ZZ', style: 'st_does_not_exist' as never, text: { plain: 'Ghost line.', runs: [{ text: 'Ghost line.', attrs: {} }], embeds: [] } },
      meta,
    );
    const tp = model.titlePage();
    expect(tp.elements.find((e) => e.id === bogus.get('id'))!.role).toBeNull();
  });

  it('lets a genuine resolveStyle failure propagate from titlePage instead of being swallowed', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const titleCenter = (doc.getMap('template').get('titlePageStyles') as Y.Map<Y.Map<unknown>>).get('st_title_center')!;
    titleCenter.delete('align'); // st_title_center is the root of the title-page chain; st_title inherits align from it
    expect(() => model.titlePage()).toThrow(/no value for align/);
  });
});
