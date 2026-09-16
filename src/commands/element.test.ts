// src/commands/element.test.ts
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids/ids.js';
import { documentToJSON } from '../model/json.js';
import { commandHarness } from './test-harness.js';

const at = (elementId: string, offset: number) => ({ elementId, offset });

describe('element.split', () => {
  it('inserts the onEnter style at the end of text', () => {
    const h = commandHarness();
    const [c] = h.replaceBody([['st_character', 'MAYA']]);
    const r = h.run('element.split', { at: at(c!, 4) });
    expect(r).toMatchObject({ ok: true, effects: { inserted: [expect.any(String)] } });
    expect(h.body().map((e) => [e.style, e.text])).toEqual([['st_character', 'MAYA'], ['st_dialogue', '']]);
  });
  it('splits mid-text keeping the current style, marks and wholly-moved tags', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'She runs. He waits.']]);
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    tag.set('id', tagId);
    tag.set('elementId', a);
    h.textMap(a!).format(10, 2, { [`t:${tagId}`]: true, b: true });
    h.run('element.split', { at: at(a!, 10) });
    const body = h.body();
    expect(body.map((e) => [e.style, e.text])).toEqual([['st_action', 'She runs. '], ['st_action', 'He waits.']]);
    expect(tag.get('elementId')).toBe(body[1]!.id);
    expect(h.delta(body[1]!.id)).toEqual([{ insert: 'He', attributes: { [`t:${tagId}`]: true, b: true } }, { insert: ' waits.' }]);
  });
  it('asks for the picker on an empty element', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    expect(h.run('element.split', { at: at(a!, 0) })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { action: 'openPicker' } });
  });
});

describe('element.insert, setStyle and cycleStyle', () => {
  it('inserts after or before an element and validates styles', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'A'], ['st_action', 'C']]);
    h.run('element.insert', { after: a, style: 'st_character', text: 'B' });
    h.run('element.insert', { before: a, style: 'st_scene_heading', text: 'INT. X - DAY' });
    expect(h.body().map((e) => e.text)).toEqual(['INT. X - DAY', 'A', 'B', 'C']);
    expect(h.run('element.insert', { after: b, style: 'st_nope' })).toMatchObject({ ok: false, reason: 'styleNotInTemplate' });
  });
  it('changes style, drops incompatible dual and records track changes', () => {
    const h = commandHarness();
    const [c] = h.replaceBody([['st_character', 'MAYA']]);
    (h.doc.getMap('elements').get(c!) as Y.Map<unknown>).set('dual', { group: 'dd_01ARYZ6S410000000000000000', side: 'left' });
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('element.setStyle', { elements: [c], style: 'st_action' });
    const record = h.doc.getMap('elements').get(c!) as Y.Map<unknown>;
    expect(record.get('style')).toBe('st_action');
    expect(record.has('dual')).toBe(false);
    expect(record.get('tc')).toMatchObject({ kind: 'style', fromStyle: 'st_character', by: 'u1' });
  });
  it('cycles with Tab: converts an empty action to character and inserts a parenthetical after dialogue text', () => {
    const h = commandHarness();
    const [a, d] = h.replaceBody([['st_action', ''], ['st_dialogue', 'Hello.']]);
    h.run('element.cycleStyle', { element: a, direction: 'tabForward', caretAtEnd: true });
    expect(h.body()[0]!.style).toBe('st_character');
    h.run('element.cycleStyle', { element: d, direction: 'tabForward', caretAtEnd: true });
    expect(h.body().map((e) => e.style)).toEqual(['st_character', 'st_dialogue', 'st_parenthetical']);
  });
});

describe('moving, duplicating and overrides', () => {
  it('moves elements and whole scenes by rewriting positions only', () => {
    const h = commandHarness();
    const [h1, a1, h2, a2] = h.replaceBody([['st_scene_heading', 'INT. ONE - DAY'], ['st_action', 'one'], ['st_scene_heading', 'INT. TWO - DAY'], ['st_action', 'two']]);
    h.run('scene.move', { scenes: [h2], to: { before: h1 } });
    expect(h.body().map((e) => e.text)).toEqual(['INT. TWO - DAY', 'two', 'INT. ONE - DAY', 'one']);
    h.run('element.move', { elements: [a1], to: { after: h2 } });
    expect(h.body().map((e) => e.id)).toEqual([h2, a1, a2, h1]);
    expect(h.run('element.move', { elements: [a1], to: { after: a1 } })).toMatchObject({ ok: false, reason: 'notApplicable' });
  });
  it('duplicates with new ids, new tags and without note marks', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Gun here']]);
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: tagId, categoryId: 'cat_x', entityId: 'ent_x', elementId: a, createdBy: 'u1', createdAt: 0 })) tag.set(k, v);
    h.textMap(a!).format(0, 3, { [`t:${tagId}`]: true, 'n:note_01ARYZ6S410000000000000000': true });
    h.run('element.duplicate', { elements: [a] });
    const [, copy] = h.body();
    expect(copy!.text).toBe('Gun here');
    expect(copy!.id).not.toBe(a);
    const tags = [...h.doc.getMap('tags').values()].map((t) => (t as Y.Map<unknown>).toJSON());
    expect(tags).toHaveLength(2);
    const copyTag = tags.find((t) => t.elementId === copy!.id)!;
    expect(h.delta(copy!.id)).toEqual([{ insert: 'Gun', attributes: { [`t:${copyTag.id}`]: true } }, { insert: ' here' }]);
  });
  it('duplicates through the write policy: the copy is this edit, not a clone of somebody else’s change marks', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Keep gone rest']]);
    const foreign = { changeId: 'chg_01ARYZ6S410000000000000000', by: 'u2', at: 1 };
    h.textMap(a!).format(0, 5, { ins: foreign });
    h.textMap(a!).format(5, 5, { del: foreign });
    h.textMap(a!).format(10, 4, { fmt: { ...foreign, before: { b: null } }, b: true });
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('element.duplicate', { elements: [a] });
    const copy = h.body()[1]!;
    // Pending-delete text is content the source has deleted; it is not part of what gets copied.
    expect(copy.text).toBe('Keep rest');
    const ops = h.delta(copy.id) as { insert: string; attributes?: Record<string, unknown> }[];
    for (const op of ops) {
      const ins = op.attributes?.ins as { by?: string; changeId?: string } | undefined;
      expect(ins?.by).toBe('u1');
      expect(ins?.changeId).not.toBe(foreign.changeId);
      expect(op.attributes?.del).toBeUndefined();
      expect(op.attributes?.fmt).toBeUndefined();
    }
    // Formatting the source carried is still copied.
    expect(ops.find((o) => o.insert.includes('rest'))!.attributes!.b).toBe(true);
  });
  it('duplicates under revision mode with the active revision set, not the source’s', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Line']]);
    h.textMap(a!).format(0, 4, { rev: 'rev_01ARYZ6S410000000000000000' });
    const setId = h.model.revisionState().sets[1]!.id;
    h.doc.getMap('revisions').set('mode', true);
    h.doc.getMap('revisions').set('activeSetId', setId);
    h.run('element.duplicate', { elements: [a] });
    const copy = h.body()[1]!;
    expect((h.delta(copy.id) as { attributes?: Record<string, unknown> }[])[0]!.attributes!.rev).toBe(setId);
  });
  it('sets and reverts overrides with validation', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'x']]);
    h.run('element.setOverride', { elements: [a], key: 'align', value: 'center' });
    h.run('element.setOverride', { elements: [a], key: 'spaceBefore', value: 3 });
    expect(h.model.element(a!)!.ov).toEqual({ align: 'center', spaceBefore: 3 });
    expect(h.run('element.setOverride', { elements: [a], key: 'spaceBefore', value: 0.3 })).toMatchObject({ ok: false, reason: 'invalidParams' });
    h.run('element.setOverride', { elements: [a], key: 'align', value: null });
    expect(h.model.element(a!)!.ov).toEqual({ spaceBefore: 3 });
    h.run('element.revertOverrides', { elements: [a] });
    expect(h.model.element(a!)!.ov).toEqual({});
  });
});

// `fastPath: true` (see the `fast()` doc comment in element.ts) removes executeBatch's
// rehearsal-on-a-replica safety net, so each of these three must be able to refuse with the
// document untouched. `documentToJSON` before/after is the strongest available statement of that.
describe('the fastPath element commands refuse without writing', () => {
  const snapshot = (h: ReturnType<typeof commandHarness>) => JSON.stringify(documentToJSON(h.doc));

  it('element.setStyle refuses an unknown style and an unknown element, writing nothing for either', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'One'], ['st_action', 'Two']]);
    const before = snapshot(h);
    expect(h.run('element.setStyle', { elements: [a, b], style: 'st_01ARYZ6S410000000000000000' })).toMatchObject({ ok: false, reason: 'styleNotInTemplate' });
    expect(snapshot(h)).toBe(before);
    // b is valid and would be written first if the check were per-element rather than up front.
    expect(h.run('element.setStyle', { elements: [b, 'el_01ARYZ6S410000000000000000'], style: 'st_shot' })).toMatchObject({ ok: false, reason: 'notFound' });
    expect(snapshot(h)).toBe(before);
  });

  it('element.cycleStyle refuses an unknown element and a style with nowhere to go', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_cast_list', 'MAYA, JONAH']]);
    const before = snapshot(h);
    expect(h.run('element.cycleStyle', { element: 'el_01ARYZ6S410000000000000000', direction: 'tabForward', caretAtEnd: true })).toMatchObject({ ok: false, reason: 'notFound' });
    expect(snapshot(h)).toBe(before);
    // Cast List has onTabText: null, so tabAction returns `none`.
    expect(h.run('element.cycleStyle', { element: a, direction: 'tabForward', caretAtEnd: true })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { action: 'none' } });
    expect(snapshot(h)).toBe(before);
  });

  it('element.split refuses an invalid position and an empty element whose style opens the picker', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const before = snapshot(h);
    expect(h.run('element.split', { at: at('el_01ARYZ6S410000000000000000', 0) })).toMatchObject({ ok: false, reason: 'invalidPosition' });
    expect(snapshot(h)).toBe(before);
    expect(h.run('element.split', { at: at(a!, 0) })).toMatchObject({ ok: false, reason: 'notApplicable', detail: { action: 'openPicker' } });
    expect(snapshot(h)).toBe(before);
  });
});
