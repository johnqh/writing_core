// src/commands/element.test.ts
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { builtinStyleId, newDualGroupId, newId } from '../ids/ids.js';
import { documentToJSON } from '../model/json.js';
import { validateDocument } from '../model/validate/index.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
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

  // M1 final fix wave item B: `applyStyle` wrote `el.set('style', …)` before calling
  // `resolveStyle`, which can throw (e.g. a style whose chain is missing a required field).
  // element.setStyle is fastPath — no rehearsal-on-a-replica safety net — so that throw used to
  // escape mid-write, leaving the element restyled with no refusal ever returned. `st_broken`
  // passes `styleExists` (it's in the template) but has `basedOn: null` and an empty font, so it
  // is its own complete chain and resolveStyleCore's `required()` throws "incomplete root".
  //
  // `{ repair: false }` — Task 16's repair-on-open runs I6, whose auto-repair for an
  // 'incompleteRoot' style is exactly to fill in the missing required font fields (spec 01 §9).
  // With repair on, `commandHarness` would silently heal `st_broken` before this test ever ran
  // its command, so `resolveStyle` would no longer throw and the refusal-before-write behavior
  // this test exists to pin would go untested.
  it('element.setStyle leaves the document byte-identical when resolveStyle throws', () => {
    const broken = {
      ...screenplayStandard,
      styles: [
        ...screenplayStandard.styles,
        { id: builtinStyleId('broken'), name: 'Broken', nameKey: null, role: 'action' as const, basedOn: null, shortcut: null, font: {} },
      ],
    };
    const h = commandHarness(broken, 90, { repair: false });
    const [a] = h.replaceBody([['st_action', 'One']]);
    const before = snapshot(h);
    expect(() => h.run('element.setStyle', { elements: [a], style: builtinStyleId('broken') })).toThrow(/incomplete root/);
    expect(snapshot(h)).toBe(before);
  });
});

// Spec 01 §9: a command leaves the document satisfying the invariants. These all end in
// `validateDocument` reporting nothing, which is the actual contract — not just "the field I
// expected changed".
describe('commands leave the document valid', () => {
  const dualScript = (h: ReturnType<typeof commandHarness>) => {
    const ids = h.replaceBody([
      ['st_action', 'They talk over each other.'],
      ['st_character', 'MAYA'], ['st_dialogue', 'You first.'],
      ['st_character', 'JONAH'], ['st_dialogue', 'No, you.'],
      ['st_action', 'Silence.'],
    ]);
    const group = newDualGroupId(h.ids);
    const sides: ('left' | 'right')[] = ['left', 'left', 'right', 'right'];
    ids.slice(1, 5).forEach((id, i) => (h.doc.getMap('elements').get(id) as Y.Map<unknown>).set('dual', { group, side: sides[i]! }));
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
    return { ids, group };
  };
  const dualOf = (h: ReturnType<typeof commandHarness>, id: string) => (h.doc.getMap('elements').get(id) as Y.Map<unknown> | undefined)?.get('dual');

  it('element.setStyle: taking a speaker out of a dual run repairs the run instead of leaving I7 broken', () => {
    const h = commandHarness();
    const { ids } = dualScript(h);
    h.run('element.setStyle', { elements: [ids[1]], style: 'st_action' });
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
    for (const id of ids.slice(1, 5)) expect(dualOf(h, id)).toBeUndefined();
  });

  it('element.split: splitting a member keeps the run intact, and splitting it apart repairs it', () => {
    const h = commandHarness();
    const { ids, group } = dualScript(h);
    // A mid-text split keeps the current style, so the tail is as valid a member as the head.
    h.run('element.split', { at: at(ids[2]!, 4) });
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
    expect(dualOf(h, h.body()[3]!.id)).toEqual({ group, side: 'left' });
  });

  it('element.split at the end of a left-side member inserts a dual-less element and repairs the run', () => {
    const h = commandHarness();
    const { ids } = dualScript(h);
    // Enter at the end of the left dialogue inserts a fresh element between the two sides.
    h.run('element.split', { at: at(ids[2]!, 10) });
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
  });

  it('element.move: moving a member out of the run repairs it', () => {
    const h = commandHarness();
    const { ids } = dualScript(h);
    h.run('element.move', { elements: [ids[4]], to: { after: ids[5] } });
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
  });

  it('element.duplicate: copying a member does not punch a dual-less element into the run', () => {
    const h = commandHarness();
    const { ids } = dualScript(h);
    h.run('element.duplicate', { elements: [ids[2]] });
    expect(validateDocument(h.doc, { only: ['I7'] }).issues).toEqual([]);
  });

  it('deleting an element detaches its notes with detachedFrom, drops its shots and nulls its beat anchor (I10)', () => {
    const h = commandHarness();
    const [scene, a] = h.replaceBody([['st_scene_heading', 'INT. A - DAY'], ['st_action', 'Maya waits.']]);
    const noteType = [...h.doc.getMap('noteTypes').keys()][0]!;
    const noteId = newId('note', h.ids);
    const note = h.doc.getMap('notes').set(noteId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: noteId, anchor: { kind: 'element', elementId: a }, typeId: noteType, title: '', color: null, authorUid: 'u1', createdAt: 0, updatedAt: 0, resolved: null, includeInPdf: false, mentions: [] })) note.set(k, v);
    note.set('body', new Y.Text());
    note.set('replies', new Y.Array());
    const shotId = newId('shot', h.ids);
    const shot = h.doc.getMap('shots').set(shotId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: shotId, sceneId: scene, pos: 'B', elementId: a, range: null, label: '1', camera: {}, attributes: {}, createdBy: 'u1', createdAt: 0 })) shot.set(k, v);
    shot.set('description', new Y.Text());
    const beatId = newId('beat', h.ids);
    const beat = h.doc.getMap('beats').set(beatId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: beatId, color: null, imageAssetId: null, board: null, boneyard: false, plot: null, storylineIds: [], arc: {}, lane: null, anchor: { elementId: scene }, createdBy: 'u1', createdAt: 0 })) beat.set(k, v);
    for (const k of ['title', 'body']) beat.set(k, new Y.Text());

    expect(h.run('text.deleteBackward', { at: at(a!, 0), unit: 'element' })).toMatchObject({ ok: true });
    expect(note.get('anchor')).toEqual({ kind: 'document' });
    expect(note.get('detachedFrom')).toBe(a);
    expect(shot.get('elementId')).toBeNull();

    expect(h.run('text.deleteBackward', { at: at(scene!, 0), unit: 'element' })).toMatchObject({ ok: true });
    expect(h.doc.getMap('shots').has(shotId)).toBe(false);
    expect(beat.get('anchor')).toBeNull();
    expect(validateDocument(h.doc, { only: ['I10'] }).issues).toEqual([]);
  });

  it('element.split moves a note whose mark is wholly in the tail, like it already did for tags (I10/I12)', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'She runs. He waits.']]);
    const noteType = [...h.doc.getMap('noteTypes').keys()][0]!;
    const noteId = newId('note', h.ids);
    const note = h.doc.getMap('notes').set(noteId, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: noteId, anchor: { kind: 'element', elementId: a }, typeId: noteType, title: '', color: null, authorUid: 'u1', createdAt: 0, updatedAt: 0, resolved: null, includeInPdf: false, mentions: [] })) note.set(k, v);
    note.set('body', new Y.Text());
    note.set('replies', new Y.Array());
    h.textMap(a!).format(10, 2, { [`n:${noteId}`]: true });
    h.run('element.split', { at: at(a!, 10) });
    const tailId = h.body()[1]!.id;
    expect(note.get('anchor')).toEqual({ kind: 'element', elementId: tailId });
    expect(validateDocument(h.doc, { only: ['I10', 'I12'] }).issues).toEqual([]);
  });
});
