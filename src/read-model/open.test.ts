import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import type { StyleId } from '../ids/ids.js';
import { DOC_SCHEMA_VERSION } from '../migrations/index.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { writeEntity } from '../model/json.js';
import { systemOrigin } from '../model/origins.js';
import { setJSONMap } from '../model/ymap.js';
import { resolveStyle } from '../template/resolve.js';
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

  it('hashes an element whose `dual` record is malformed instead of crashing on a partner lookup', () => {
    const { doc, h, a } = setup();
    const model = openDocument(doc, deps);
    // I7's own subject: a `dual` with no group. The partner search used to treat every element
    // WITHOUT a dual as a member of the group and then dereference `e.dual.side` on null.
    a.set('dual', { side: 'left' });
    expect(() => model.elementContentHash(a.get('id') as never)).not.toThrow();
    // A well-formed pair still hashes with its partner.
    h.set('dual', { group: 'dd_01ARYZ6S410000000000000000', side: 'left' });
    const other = doc.getMap('elements');
    expect(other.size).toBeGreaterThan(0);
    expect(() => model.elementContentHash(h.get('id') as never)).not.toThrow();
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

describe('document order is pos-then-id everywhere', () => {
  it('orders title-page elements by pos then id, so two replicas agree when positions collide', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
    const tp = doc.getMap<unknown>('titlePage').get('elements') as Y.Map<unknown>;
    const model = openDocument(doc, deps);
    const styleOf = (m: Y.Map<unknown>) => m.get('style') as string;
    const existing = [...tp.values()].map((v) => v as Y.Map<unknown>)[0]!;
    const pos = String(existing.get('pos'));
    // Two concurrent inserts that landed on the same `pos`; insert the later id first so Y.Map
    // iteration order and document order disagree.
    const later = 'el_01ARYZ6S410000000000000002';
    const earlier = 'el_01ARYZ6S410000000000000001';
    doc.transact(() => {
      for (const id of [later, earlier]) {
        insertElementRecord(tp, { id: id as never, pos: pos as never, style: styleOf(existing) as never, text: { plain: id, runs: [{ text: id, attrs: {} }], embeds: [] } }, meta);
      }
    });
    const ordered = model.titlePage().elements.filter((e) => e.pos === pos).map((e) => e.id);
    expect(ordered).toEqual([earlier, later, existing.get('id') as string].sort());
  });
});

function mergeCycleDoc() {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const entities = doc.getMap<unknown>('entities');
  const a = newId('ent', ids);
  const b = newId('ent', ids);
  const base = {
    kind: 'character' as const, name: 'MAYA', nameKey: 'maya', aliases: [], color: null,
    description: { plain: '', runs: [], embeds: [] }, fields: {}, attributes: {}, categoryId: null,
    retain: false, createdBy: 'u', createdAt: 0, origin: 'manual' as const,
  };
  // A concurrent merge cycle: two replicas each independently merged the other entity into
  // itself. Neither `mergedInto` is null, so `entities()`'s `mergedInto === null` filter drops
  // BOTH — M1's own carried finding (I17).
  writeEntity(entities, { ...base, id: a, mergedInto: b });
  writeEntity(entities, { ...base, id: b, mergedInto: a });
  return { doc, entities, a, b };
}

describe('Task 16: layout read-model punch list', () => {
  it("reads the governing scene's omit record straight off a body element's view, and keeps it scoped to that scene", () => {
    const { doc, h, a, c } = setup();
    const model = openDocument(doc, deps);
    // Nothing omitted yet: warm the cache first so the later assertions exercise invalidation,
    // not just first-read computation.
    expect(model.element(a.get('id') as never)!.sceneOmit).toBeNull();
    expect(model.element(h.get('id') as never)!.sceneOmit).toBeNull();

    const scene = h.set('scene', new Y.Map<unknown>());
    const omitRecord = { at: 5, by: 'u', rev: null };
    scene.set('omit', omitRecord);
    // The heading itself is its own governing scene start, and its member `a`/`c` inherit it.
    expect(model.element(h.get('id') as never)!.sceneOmit).toEqual(omitRecord);
    expect(model.element(a.get('id') as never)!.sceneOmit).toEqual(omitRecord);
    expect(model.element(c.get('id') as never)!.sceneOmit).toEqual(omitRecord);

    // A later, unrelated scene must not inherit the first scene's omit.
    const h2 = insertElementRecord(doc.getMap('elements'), { id: newId('el', ids), pos: 'ZZ', style: 'st_scene_heading' as never, text: { plain: 'INT. OFFICE - DAY', runs: [{ text: 'INT. OFFICE - DAY', attrs: {} }], embeds: [] } }, meta);
    const a2 = insertElementRecord(doc.getMap('elements'), { id: newId('el', ids), pos: 'ZZZ', style: 'st_action' as never, text: { plain: 'Later.', runs: [{ text: 'Later.', attrs: {} }], embeds: [] } }, meta);
    expect(model.element(h2.get('id') as never)!.sceneOmit).toBeNull();
    expect(model.element(a2.get('id') as never)!.sceneOmit).toBeNull();
  });

  it('stops the governing-scene walk at an act start, and evicts only the changed scene\'s cached views', () => {
    const { doc, h, a, add } = setup();
    const model = openDocument(doc, deps);
    // Scene 1 (h, a, c) | ACT START | action (no governing scene) | scene 2 (h2, a2).
    const act = add('st_new_act', 'H', 'ACT TWO');
    const orphan = add('st_action', 'I', 'No scene governs me.');
    const h2 = add('st_scene_heading', 'J', 'INT. OFFICE - DAY');
    const a2 = add('st_action', 'K', 'Later.');
    const id = (m: Y.Map<unknown>) => m.get('id') as never;
    // Warm scene 2's views so eviction (or the lack of it) is observable by identity. `act` and
    // `orphan` are deliberately NOT warmed: their first build happens after the omit is set, so it
    // is the backward walk itself (not a stale cache) that must stop at the act start.
    const warm = new Map([h, a, h2, a2].map((m) => [m, model.element(id(m))!] as const));

    h.set('scene', new Y.Map<unknown>()).set('omit', { at: 5, by: 'u', rev: null });

    expect(model.element(id(a))!.sceneOmit).toEqual({ at: 5, by: 'u', rev: null });
    // An act start ends the scene without starting one: nothing after it inherits scene 1's omit.
    expect(model.element(id(act))!.sceneOmit).toBeNull();
    expect(model.element(id(orphan))!.sceneOmit).toBeNull();
    // Scene 2 is a different scene and keeps its own (absent) omit — and its cached views were not
    // evicted by an omit change in scene 1.
    expect(model.element(id(h2))).toBe(warm.get(h2));
    expect(model.element(id(a2))).toBe(warm.get(a2));
  });

  describe('sceneOmit stays correct when scene membership changes (warmed cache: read first, change, then assert)', () => {
    const OMIT = { at: 5, by: 'u', rev: null };
    type Ctx = ReturnType<typeof setup>;
    const idOf = (m: Y.Map<unknown>) => m.get('id') as never;
    /** Reads the view of every given element so a later stale cache entry would be observable. */
    const warm = (model: ReturnType<typeof openDocument>, ...els: Y.Map<unknown>[]) => els.map((e) => model.element(idOf(e))!.sceneOmit);
    /** h(scene, omitted) a c: an omitted scene of three elements. */
    const omittedScene = (): Ctx => {
      const ctx = setup();
      ctx.h.set('scene', new Y.Map<unknown>()).set('omit', OMIT);
      return ctx;
    };

    it('(a) a scene heading inserted mid-scene takes over the elements after it, and bumps only their attrsVersion', () => {
      const { doc, h, a, c, add } = omittedScene();
      const model = openDocument(doc, deps);
      expect(warm(model, h, a, c)).toEqual([OMIT, OMIT, OMIT]);
      const [aBefore, cBefore] = [model.attrsVersion(idOf(a)), model.attrsVersion(idOf(c))];

      doc.transact(() => { add('st_scene_heading', 'E', 'INT. HALL - DAY'); }); // between a (D) and c (F)

      expect(model.element(idOf(c))!.sceneOmit).toBeNull();
      expect(model.element(idOf(a))!.sceneOmit).toEqual(OMIT);
      expect(model.attrsVersion(idOf(c))).toBe(cBefore + 1);
      expect(model.attrsVersion(idOf(a))).toBe(aBefore);
    });

    it('(b) deleting a scene heading hands its elements back to the previous scene', () => {
      const { doc, h, a, c, add } = omittedScene();
      const h2 = add('st_scene_heading', 'E', 'INT. HALL - DAY'); // a | h2 c
      const model = openDocument(doc, deps);
      expect(warm(model, h, a, h2, c)).toEqual([OMIT, OMIT, null, null]);
      const cBefore = model.attrsVersion(idOf(c));

      doc.getMap('elements').delete(idOf(h2));

      expect(model.element(idOf(c))!.sceneOmit).toEqual(OMIT);
      expect(model.attrsVersion(idOf(c))).toBe(cBefore + 1);
    });

    it('(c) restyling a heading out of, and an action into, a scene role moves the elements it governs', () => {
      const { doc, h, a, c, add } = omittedScene();
      const h2 = add('st_scene_heading', 'E', 'INT. HALL - DAY'); // h a | h2 c
      const model = openDocument(doc, deps);
      expect(warm(model, h, a, h2, c)).toEqual([OMIT, OMIT, null, null]);
      const cBefore = model.attrsVersion(idOf(c));

      h2.set('style', 'st_action'); // out of a scene role: c rejoins the omitted scene
      expect(model.element(idOf(c))!.sceneOmit).toEqual(OMIT);
      expect(model.attrsVersion(idOf(c))).toBe(cBefore + 1);

      const c1 = model.attrsVersion(idOf(c));
      h2.set('style', 'st_scene_heading'); // and back into one
      expect(model.element(idOf(c))!.sceneOmit).toBeNull();
      expect(model.attrsVersion(idOf(c))).toBe(c1 + 1);

      const a1 = model.attrsVersion(idOf(a));
      a.set('style', 'st_scene_heading'); // an action becomes a heading: it now governs itself
      expect(model.element(idOf(a))!.sceneOmit).toBeNull();
      expect(model.attrsVersion(idOf(a))).toBe(a1 + 1);
    });

    it('(d) a scene map created with `omit` inside it, in ONE transaction (the shape fromJSON writes), reaches every member', () => {
      const { doc, h, a, c } = setup();
      const model = openDocument(doc, deps);
      expect(warm(model, h, a, c)).toEqual([null, null, null]);
      const before = [h, a, c].map((e) => model.attrsVersion(idOf(e)));

      doc.transact(() => {
        const scene = new Y.Map<unknown>();
        scene.set('omit', OMIT);
        h.set('scene', scene);
      });

      expect(warm(model, h, a, c)).toEqual([OMIT, OMIT, OMIT]);
      expect([h, a, c].map((e) => model.attrsVersion(idOf(e)))).toEqual(before.map((v) => v + 1));
    });

    it('moving a heading (a pos change) re-homes the elements on both sides of it', () => {
      const { doc, h, a, c, add } = omittedScene();
      const h2 = add('st_scene_heading', 'E', 'INT. HALL - DAY'); // h a | h2 c
      const model = openDocument(doc, deps);
      expect(warm(model, h, a, h2, c)).toEqual([OMIT, OMIT, null, null]);
      const aBefore = model.attrsVersion(idOf(a));

      h2.set('pos', 'C'); // h | h2 a c ... a now belongs to h2's (unomitted) scene, c too
      expect(model.element(idOf(a))!.sceneOmit).toBeNull();
      expect(model.element(idOf(c))!.sceneOmit).toBeNull();
      expect(model.attrsVersion(idOf(a))).toBe(aBefore + 1);
    });

    it('does not bump the elements after an ordinary (non-heading) insert, delete or restyle', () => {
      const { doc, h, a, c, add } = omittedScene();
      const model = openDocument(doc, deps);
      warm(model, h, a, c);
      const before = [h, a, c].map((e) => model.attrsVersion(idOf(e)));
      let extra!: Y.Map<unknown>;
      doc.transact(() => { extra = add('st_action', 'E', 'More.'); });
      extra.set('style', 'st_dialogue');
      doc.getMap('elements').delete(idOf(extra));
      expect([h, a, c].map((e) => model.attrsVersion(idOf(e)))).toEqual(before);
    });
  });

  it("surfaces the inactive alternates' own text on ElementView.alts, not just altCount", () => {
    const { doc, a } = setup();
    const model = openDocument(doc, deps);
    expect(model.element(a.get('id') as never)!.altCount).toBe(0);
    expect(model.element(a.get('id') as never)!.alts).toEqual([]);

    const altId = newId('alt', ids);
    const alts = a.set('alts', new Y.Map<unknown>());
    const altMap = alts.set(altId, new Y.Map<unknown>());
    altMap.set('id', altId);
    altMap.set('pos', 'A');
    const altText = new Y.Text();
    altText.insert(0, 'She waits instead.');
    altMap.set('text', altText);
    altMap.set('style', 'st_action');
    altMap.set('label', 'alt 1');
    altMap.set('createdBy', 'u');
    altMap.set('createdAt', 0);

    const view = model.element(a.get('id') as never)!;
    expect(view.altCount).toBe(1);
    expect(view.alts).toHaveLength(1);
    expect(view.alts[0]).toMatchObject({ id: altId, pos: 'A', style: 'st_action', label: 'alt 1', createdBy: 'u', createdAt: 0 });
    expect(view.alts[0]!.text.plain).toBe('She waits instead.');
  });

  it('reads document meta fresh on every call (no dedicated cache or observer needed)', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    expect(model.meta().language).toBeDefined();
    doc.getMap('meta').set('language', 'fr-FR');
    expect(model.meta().language).toBe('fr-FR');
  });

  it('exposes writers() and emits a `writers` ModelChange on a writer record change (today: none)', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    expect(model.writers()).toEqual([]);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));

    const writers = doc.getMap<unknown>('writers');
    setJSONMap(writers, 'u1', { uid: 'u1', displayName: 'Ana', initials: 'A', color: '#ff0000' });
    expect(model.writers()).toEqual([{ uid: 'u1', displayName: 'Ana', initials: 'A', color: '#ff0000' }]);
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'writers', ids: ['u1'] });

    (writers.get('u1') as Y.Map<unknown>).set('color', '#00ff00');
    expect(model.writers()[0]!.color).toBe('#00ff00');
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'writers', ids: ['u1'] });
  });

  it('resolves a title-page element via resolveStyle instead of throwing, and bumps its own text/attrs counters (title-page elements are outside the body order index)', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const tpElements = doc.getMap<unknown>('titlePage').get('elements') as Y.Map<unknown>;
    const [tpId, tpEl] = [...tpElements.entries()][0] as [string, Y.Map<unknown>];
    const style = tpEl.get('style') as StyleId;
    const ov = tpEl.get('ov') instanceof Y.Map ? ((tpEl.get('ov') as Y.Map<unknown>).toJSON() as never) : undefined;

    const tpTemplate = { ...model.template(), styles: model.template().titlePageStyles };
    expect(model.resolveStyle(tpId as never)).toEqual(resolveStyle(tpTemplate, style, ov));

    expect(model.textVersion(tpId as never)).toBe(0);
    expect(model.attrsVersion(tpId as never)).toBe(0);
    (tpEl.get('text') as Y.Text).insert(0, 'X');
    expect(model.textVersion(tpId as never)).toBe(1);
    expect(model.attrsVersion(tpId as never)).toBe(0);
    tpEl.set('style', 'st_title_left');
    expect(model.attrsVersion(tpId as never)).toBe(1);
  });

  it('bumps a title-page element\'s attrsVersion for an edit inside its nested `ov` map (not only for a top-level key)', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const tpElements = doc.getMap<unknown>('titlePage').get('elements') as Y.Map<unknown>;
    const [tpId, tpEl] = [...tpElements.entries()][0] as [string, Y.Map<unknown>];
    if (!(tpEl.get('ov') instanceof Y.Map)) tpEl.set('ov', new Y.Map<unknown>());
    const base = model.attrsVersion(tpId as never);
    const textBase = model.textVersion(tpId as never);
    (tpEl.get('ov') as Y.Map<unknown>).set('alignment', 'right');
    expect(model.attrsVersion(tpId as never)).toBe(base + 1);
    expect(model.textVersion(tpId as never)).toBe(textBase);
    expect(model.titlePage().elements.find((e) => e.id === tpId)!.ov).toMatchObject({ alignment: 'right' });
  });

  it('computes titlePage().computed.wordCount from the live body text, rounded per computed.wordCount.roundTo', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    // Body: "INT. DINER - NIGHT" (3: the "." and the lone "-" are not words) + "Maya waits." (2) + "MAYA" (1).
    expect(model.titlePage().computed.wordCount).toBe(6);

    const computed = doc.getMap<unknown>('titlePage').get('computed') as Y.Map<unknown>;
    computed.set('wordCount', { roundTo: 10 });
    expect(model.titlePage().computed.wordCount).toBe(10);
  });

  it('counts words by UAX #29 boundaries (spec 02 §6.5), not by whitespace', () => {
    const { doc, a, c, add } = setup();
    const model = openDocument(doc, deps);
    const set = (el: Y.Map<unknown>, text: string) => {
      const t = el.get('text') as Y.Text;
      t.delete(0, t.length);
      t.insert(0, text);
    };
    set(a, "Hello, world! Don't stop 3.14"); // Hello, world, Don't, stop, 3.14
    set(c, '日本語'); // no dictionary for Han: one word per ideograph
    const extra = add('st_action', 'H', '--- ...');
    set(extra, '--- ...'); // punctuation only
    // INT. DINER - NIGHT (3) + 5 + 3 + 0
    expect(model.titlePage().computed.wordCount).toBe(11);
  });

  it('keeps titlePage().computed.wordCount current across insert, edit, text replacement and removal, respecting roundTo', () => {
    const { doc, a, c, add } = setup();
    const model = openDocument(doc, deps);
    const computed = doc.getMap<unknown>('titlePage').get('computed') as Y.Map<unknown>;
    computed.set('wordCount', { roundTo: 5 });
    expect(model.titlePage().computed.wordCount).toBe(5); // 6 words rounds to 5

    (a.get('text') as Y.Text).insert(0, 'Extra extra extra extra ');
    expect(model.titlePage().computed.wordCount).toBe(10); // 10 words

    computed.delete('wordCount');
    expect(model.titlePage().computed.wordCount).toBe(10);
    // Inserted with its text in ONE transaction, so the observer sees a fresh record (not an empty
    // one followed by a later text edit).
    let insertedId = '';
    doc.transact(() => { insertedId = add('st_action', 'H', 'Four more words here').get('id') as string; });
    expect(model.titlePage().computed.wordCount).toBe(14);

    // The whole record replaced in one transaction (a map-level `update`, as an importer or a
    // materialize would do), not an edit inside the existing Y.Text.
    doc.transact(() => insertElementRecord(doc.getMap('elements'), {
      id: insertedId as never, pos: 'H', style: 'st_action' as never,
      text: { plain: 'Two words', runs: [{ text: 'Two words', attrs: {} }], embeds: [] },
    }, meta));
    expect(model.titlePage().computed.wordCount).toBe(12);
    doc.transact(() => insertElementRecord(doc.getMap('elements'), {
      id: insertedId as never, pos: 'H', style: 'st_action' as never,
      text: { plain: 'Four more words here', runs: [{ text: 'Four more words here', attrs: {} }], embeds: [] },
    }, meta));
    expect(model.titlePage().computed.wordCount).toBe(14);

    doc.transact(() => {
      const t = c.set('text', new Y.Text());
      t.insert(0, 'ONE TWO');
    });
    expect(model.titlePage().computed.wordCount).toBe(15); // MAYA (1) -> ONE TWO (2)

    doc.getMap('elements').delete(insertedId);
    expect(model.titlePage().computed.wordCount).toBe(11);
    doc.getMap('elements').delete(a.get('id') as string);
    expect(model.titlePage().computed.wordCount).toBe(5); // INT. DINER - NIGHT (3) + ONE TWO (2)
  });

  it('maintains the body word count incrementally: an edit re-reads only the edited element, never the whole body', () => {
    const { doc, a, add } = setup();
    for (let i = 0; i < 60; i++) add('st_action', `M${String(i).padStart(3, '0')}`, `Filler line number ${i}.`);
    const model = openDocument(doc, deps);
    expect(model.titlePage().computed.wordCount).toBe(3 + 2 + 1 + 60 * 4); // one initial scan
    // Force a title-page rebuild cost baseline: a title-page-only change re-reads the title page's
    // own elements but no body element.
    const tpComputed = doc.getMap<unknown>('titlePage').get('computed') as Y.Map<unknown>;
    const spy = vi.spyOn(Y.Text.prototype, 'toDelta');
    try {
      tpComputed.set('wordCount', { roundTo: 1 });
      model.titlePage();
      const titlePageCost = spy.mock.calls.length;
      spy.mockClear();

      (a.get('text') as Y.Text).insert(0, 'One more ');
      expect(model.titlePage().computed.wordCount).toBe(3 + 4 + 1 + 60 * 4);
      // The rebuild re-reads the title page's own elements (the baseline above) plus the ONE edited
      // body element — not the 60+ body elements a rescan would touch.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(titlePageCost + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it('classifies a lockedStyles change and a pageLocks change as distinguishable `production` events', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    expect(model.productionState().lockedStyles).toEqual([]); // warm the cache: it must refresh on the edits below
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const production = doc.getMap<unknown>('production');
    // The real storage shape: `lockedStyles` and `pageLocks` are nested Y.Maps, edited in place.
    (production.get('lockedStyles') as Y.Map<unknown>).set('st_action', true);
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'production', what: 'lockedStyles' });
    expect(model.productionState().lockedStyles).toEqual(['st_action']);
    (production.get('pageLocks') as Y.Map<unknown>).set('plk_01ARYZ6S410000000000000000', { id: 'plk_01ARYZ6S410000000000000000' });
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'production', what: 'pageLocks' });
    production.set('scenesLocked', true);
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'production', what: 'scenesLocked' });
    // Two categories in one transaction cannot be told apart by a single tag: 'other' (refill-safe).
    doc.transact(() => {
      (production.get('lockedStyles') as Y.Map<unknown>).set('st_dialogue', true);
      production.set('pagesLocked', true);
    });
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'production', what: 'other' });
  });

  it('classifies `revisions` changes: `sets` (content, needs a refill) vs everything else (display-only)', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const revisions = doc.getMap<unknown>('revisions');
    revisions.set('activeSetId', 'rev_01ARYZ6S410000000000000000');
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'revisions', what: 'display' });
    revisions.set('sets', new Y.Map<unknown>());
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'revisions', what: 'sets' });
  });

  it('classifies `settings` changes: `watermark` (header/footer decoration) vs everything else', () => {
    const { doc } = setup();
    const model = openDocument(doc, deps);
    const batches: ModelChangeBatch[] = [];
    model.subscribe((b) => batches.push(b));
    const settings = doc.getMap<unknown>('settings');
    settings.set('watermark', { recipient: 'DRAFT', text: null });
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'settings', what: 'watermark' });
    settings.set('outlineHidden', true);
    expect(batches.at(-1)!.changes).toContainEqual({ kind: 'settings', what: 'other' });
  });

  it("repairs a concurrent entity-merge cycle on open, as a single systemOrigin('repair') transaction, and restores both original ids to a resolvable entity", () => {
    const { doc, entities, a, b } = mergeCycleDoc();

    const unrepaired = openDocument(doc, deps, { repair: false });
    expect(unrepaired.entities({ kind: 'character' }).map((e) => e.name)).not.toContain('MAYA');
    unrepaired.dispose();

    const transactions: { origin: unknown }[] = [];
    const onTx = (tx: Y.Transaction) => transactions.push({ origin: tx.origin });
    doc.on('afterTransaction', onTx);
    const model = openDocument(doc, deps); // default: repair on
    doc.off('afterTransaction', onTx);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.origin).toBe(systemOrigin('repair'));

    // I17's repair breaks the cycle by nulling the target's own `mergedInto` (not by un-merging
    // both), so exactly one of {a, b} becomes the canonical survivor; the other still points at
    // it. Both original ids must still resolve to that survivor through `entity()`.
    const survivorId = (entities.get(a) as Y.Map<unknown>).get('mergedInto') === null ? a : b;
    expect(model.entity(a)!.id).toBe(survivorId);
    expect(model.entity(b)!.id).toBe(survivorId);
    expect(model.entities({ kind: 'character' }).filter((e) => e.name === 'MAYA')).toHaveLength(1);
  });

  it('does not repair a document newer than this build (I20: it must open read-only, and this build cannot judge what it does not understand)', () => {
    const { doc, entities, a, b } = mergeCycleDoc();
    doc.getMap('meta').set('schemaVersion', DOC_SCHEMA_VERSION + 1);
    const transactions: unknown[] = [];
    const onTx = (tx: Y.Transaction) => transactions.push(tx.origin);
    doc.on('afterTransaction', onTx);
    const model = openDocument(doc, deps);
    doc.off('afterTransaction', onTx);
    expect(transactions).toEqual([]);
    expect((entities.get(a) as Y.Map<unknown>).get('mergedInto')).toBe(b);
    expect((entities.get(b) as Y.Map<unknown>).get('mergedInto')).toBe(a);
    expect(model.entities({ kind: 'character' })).toEqual([]);
  });
});
