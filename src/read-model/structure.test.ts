import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import type { ElementId, StyleId } from '../ids/ids.js';
import { newDualGroupId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { writeEntity } from '../model/json.js';
import type { StyleRole } from '../schema/vocab.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { textOutline } from '../templates/builtin/text-outline.js';
import { formatNumberLabel } from './number-label.js';
import { computeOutlineTree, computeScenes, type StructureInput } from './structure.js';
import { openDocument } from './open.js';
import type { ElementView } from './views.js';

const ids = createSeededIdSource(41);
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };

/**
 * Builds a document body from `rows` but inserts the element records into the Yjs
 * map in *reverse* of document order. Scenes/dialogue-blocks/outline must be derived
 * from `pos` (via comparePositions / OrderIndex), never from Y.Map insertion order —
 * a regression that falls back to insertion order would still pass if the fixture
 * happened to be pre-sorted, so we deliberately scramble it here.
 */
function script(rows: [string, string][], template = screenplayStandard) {
  const doc = createDocument({ template, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const seeds = rows.map(([style, text], i) => ({
    id: newId('el', ids),
    pos: `A${String(i).padStart(3, '0')}1`,
    style: style as never,
    text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] },
  }));
  const made: Y.Map<unknown>[] = new Array(seeds.length);
  for (let i = seeds.length - 1; i >= 0; i--) made[i] = insertElementRecord(elements, seeds[i]!, meta);
  const idOf = (i: number) => made[i]!.get('id') as string;
  return { doc, made, idOf, model: openDocument(doc, { ids, clock: () => 0, locale: 'en' }) };
}

function makeFolder(doc: Y.Doc, folder: { id: string; kind: 'act' | 'sequence' | 'folder'; title: string; parentId: string | null; pos: string }) {
  const f = doc.getMap('folders').set(folder.id, new Y.Map<unknown>());
  for (const [k, v] of Object.entries({ ...folder, color: null, collapsed: false, pageBudget: null })) f.set(k, v);
  f.set('synopsis', new Y.Text());
  return f;
}

describe('scenes', () => {
  it('derives scenes from headings up to the next boundary', () => {
    const { model, idOf, doc } = script([
      ['st_action', 'FADE IN:'],
      ['st_new_act', 'ACT ONE'],
      ['st_scene_heading', 'INT. DINER - NIGHT'],
      ['st_action', 'Maya waits.'],
      ['st_character', 'MAYA (V.O.)'],
      ['st_dialogue', 'Late again.'],
      ['st_scene_heading', 'EXT. STREET - DAY'],
      ['st_end_of_act', 'END OF ACT ONE'],
    ]);
    writeEntity(doc.getMap('entities'), { id: newId('ent', ids), kind: 'character', name: 'MAYA', nameKey: 'maya', aliases: [], color: null, description: { plain: '', runs: [], embeds: [] }, fields: {}, attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual' });
    const scenes = model.scenes();
    expect(scenes.map((s) => s.id)).toEqual([idOf(2), idOf(6)]);
    expect(scenes[0]).toMatchObject({ index: 0, headingText: 'INT. DINER - NIGHT', actId: idOf(1), omitted: false });
    expect(scenes[0]!.elementIds).toEqual([idOf(2), idOf(3), idOf(4), idOf(5)]);
    expect(scenes[0]!.heading.location).toBe('DINER');
    expect(scenes[0]!.characterIds).toHaveLength(1);
    expect(scenes[1]!.elementIds).toEqual([idOf(6), idOf(7)]);
    expect(model.sceneOf(idOf(5) as never)!.id).toBe(idOf(2));
    expect(model.sceneOf(idOf(0) as never)).toBeUndefined();
    expect(model.scene(idOf(6) as never)!.index).toBe(1);
  });

  it('reports omitted scenes, locked numbers and updates after edits', () => {
    const { model, made, idOf } = script([['st_scene_heading', 'INT. A - DAY'], ['st_scene_heading', 'INT. B - DAY']]);
    const scene = made[0]!.set('scene', new Y.Map<unknown>());
    scene.set('omit', { at: 1, by: 'u', rev: null });
    const num = made[1]!.set('num', new Y.Map<unknown>());
    num.set('label', { base: 12, prefix: [], suffix: [{ kind: 'letters', value: [1] }] });
    num.set('locked', true);
    num.set('manual', false);
    const scenes = model.scenes();
    expect(scenes.map((s) => [s.omitted, s.index, s.number])).toEqual([[true, -1, null], [false, 0, '12A']]);
    (made[1]!.get('text') as Y.Text).insert(8, 'X');
    expect(model.scene(idOf(1) as never)!.headingText).toBe('INT. B -X DAY');
  });

  it('returns no scenes for a document with no heading element', () => {
    const { model, idOf } = script([['st_action', 'FADE IN:'], ['st_action', 'Nothing happens yet.']]);
    expect(model.scenes()).toEqual([]);
    expect(model.sceneOf(idOf(0) as never)).toBeUndefined();
    expect(model.sceneOf(idOf(1) as never)).toBeUndefined();
    expect(model.outlineTree().children).toEqual([]);
  });

  it('keeps a scene heading with no following elements as a one-element scene', () => {
    const { model, idOf } = script([['st_action', 'Cold open.'], ['st_scene_heading', 'INT. LAB - DAY']]);
    const scenes = model.scenes();
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: idOf(1), index: 0, headingText: 'INT. LAB - DAY' });
    expect(scenes[0]!.elementIds).toEqual([idOf(1)]);
  });

  it('closes a scene with zero body elements when an act break follows immediately', () => {
    const { model, idOf } = script([
      ['st_scene_heading', 'INT. LOBBY - DAY'],
      ['st_new_act', 'ACT TWO'],
      ['st_scene_heading', 'INT. HALL - DAY'],
    ]);
    const scenes = model.scenes();
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ id: idOf(0), headingText: 'INT. LOBBY - DAY' });
    expect(scenes[0]!.elementIds).toEqual([idOf(0)]);
    expect(scenes[1]!.actId).toBe(idOf(1));
  });

  it('produces no scenes, blocks or outline for a completely empty document', () => {
    const { model } = script([]);
    expect(model.scenes()).toEqual([]);
    expect(model.dialogueBlocks()).toEqual([]);
    expect(model.outlineTree()).toMatchObject({ kind: 'root', title: '', children: [] });
  });
});

describe('chapter-role scene starts', () => {
  // `chapter` is a valid SCENE_ROLES member (spec 01), but no built-in template currently
  // assigns it to a style, so this exercises `computeScenes`/`computeOutlineTree` directly
  // against a hand-built StructureInput rather than through `openDocument`.
  function ev(role: StyleRole | null, text: string, extra: Partial<ElementView> = {}): ElementView {
    return {
      id: newId('el', ids) as ElementId,
      pos: 'A',
      style: 'st_test' as StyleId,
      role,
      text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] },
      ov: {},
      num: null,
      hasScene: false,
      dual: null,
      altCount: 0,
      label: null,
      outlineLevel: null,
      shotId: null,
      folderId: null,
      lineAdjust: null,
      tc: null,
      omit: null,
      meta: { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 },
      field: null,
      ...extra,
    };
  }
  const baseInput = (elements: ElementView[]): StructureInput => ({
    elements,
    sceneMap: () => undefined,
    folders: [],
    vocab: { sceneIntros: [], times: [], introSeparator: ' ', timeSeparator: ' - ' },
    resolveEntity: () => null,
    castTagsByElement: new Map(),
  });

  it('treats a `chapter`-role element as a scene start, same as `sceneHeading`', () => {
    const heading = ev('chapter', 'CHAPTER ONE');
    const body = ev(null, 'It was a dark and stormy night.');
    const input = baseInput([heading, body]);
    const scenes = computeScenes(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: heading.id, headingText: 'CHAPTER ONE', index: 0 });
    expect(scenes[0]!.elementIds).toEqual([heading.id, body.id]);
    const tree = computeOutlineTree(input, scenes);
    expect(tree.children).toEqual([{ kind: 'scene', id: heading.id, title: 'CHAPTER ONE', level: 0, elementId: heading.id, children: [] }]);
  });
});

describe('dialogue blocks and outline', () => {
  it('groups speakers with their speech members', () => {
    const { model, idOf } = script([
      ['st_scene_heading', 'INT. DINER - NIGHT'],
      ['st_character', 'MAYA'],
      ['st_parenthetical', '(quietly)'],
      ['st_dialogue', 'Hi.'],
      ['st_action', 'Beat.'],
      ['st_character', 'JO (O.S.)'],
      ['st_dialogue', 'Hey.'],
    ]);
    expect(model.dialogueBlocks().map((b) => [b.name, b.extension, b.elementIds.length, b.sceneId])).toEqual([
      ['MAYA', null, 3, idOf(0)],
      ['JO', '(O.S.)', 2, idOf(0)],
    ]);
    expect(model.dialogueBlocks()[0]!.dualGroup).toBeNull();
  });

  it('carries the shared dual.group onto both speakers of a dual-dialogue pair', () => {
    const { model, made } = script([
      ['st_scene_heading', 'INT. DINER - NIGHT'],
      ['st_character', 'MAYA'],
      ['st_dialogue', 'Left side.'],
      ['st_character', 'JO'],
      ['st_dialogue', 'Right side.'],
    ]);
    const group = newDualGroupId(ids);
    made[1]!.set('dual', { group, side: 'left' });
    made[3]!.set('dual', { group, side: 'right' });
    const blocks = model.dialogueBlocks();
    expect(blocks.map((b) => [b.name, b.dualGroup])).toEqual([
      ['MAYA', group],
      ['JO', group],
    ]);
  });

  it('builds acts, sequences, outline levels, nested folders and scenes', () => {
    const { model, made, idOf, doc } = script([
      ['st_new_act', 'ACT ONE'],
      ['st_sequence', 'THE HEIST'],
      ['st_outline_1', 'SETUP'],
      ['st_scene_heading', 'INT. BANK - DAY'],
      ['st_scene_heading', 'EXT. BANK - DAY'],
      ['st_new_act', 'ACT TWO'],
      ['st_scene_heading', 'INT. CAR - NIGHT'],
    ]);
    const folder = newId('fld', ids);
    const f = doc.getMap('folders').set(folder, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: folder, kind: 'folder', title: 'Getaway', color: null, parentId: null, pos: 'V', collapsed: false, pageBudget: null })) f.set(k, v);
    f.set('synopsis', new Y.Text());
    // A folder nested inside the first one: the outline tree and each scene's folderPath must both walk the full chain.
    const subFolder = newId('fld', ids);
    const sf = doc.getMap('folders').set(subFolder, new Y.Map<unknown>());
    for (const [k, v] of Object.entries({ id: subFolder, kind: 'folder', title: 'Car Chase', color: null, parentId: folder, pos: 'W', collapsed: false, pageBudget: null })) sf.set(k, v);
    sf.set('synopsis', new Y.Text());
    made[6]!.set('folderId', subFolder);
    const tree = model.outlineTree();
    const shape = (n: typeof tree): unknown => [n.kind, n.title, n.children.map(shape)];
    expect(shape(tree)).toEqual(['root', '', [
      ['act', 'ACT ONE', [['sequence', 'THE HEIST', [['outline', 'SETUP', [['scene', 'INT. BANK - DAY', []], ['scene', 'EXT. BANK - DAY', []]]]]]]],
      ['act', 'ACT TWO', [['folder', 'Getaway', [['folder', 'Car Chase', [['scene', 'INT. CAR - NIGHT', []]]]]]]],
    ]]);
    expect(tree.children[0]!.elementId).toBe(idOf(0));
    expect(model.scene(idOf(6) as never)!.folderPath).toEqual([folder, subFolder]);
  });

  it('renders empty folders in the outline tree, ordered by pos, after the container’s positioned children', () => {
    const { model, doc } = script([
      ['st_new_act', 'ACT ONE'],
      ['st_scene_heading', 'INT. A - DAY'],
    ]);
    // Inserted out of pos order (Zeta before Alpha) to prove the sort is by `pos`, not insertion order.
    makeFolder(doc, { id: newId('fld', ids), kind: 'folder', title: 'Zeta', parentId: null, pos: 'M' });
    makeFolder(doc, { id: newId('fld', ids), kind: 'folder', title: 'Alpha', parentId: null, pos: 'A' });
    const tree = model.outlineTree();
    const shape = (n: typeof tree): unknown => [n.kind, n.title, n.children.map(shape)];
    expect(shape(tree)).toEqual(['root', '', [
      ['act', 'ACT ONE', [['scene', 'INT. A - DAY', []]]],
      ['folder', 'Alpha', []],
      ['folder', 'Zeta', []],
    ]]);
  });

  it('nests an empty folder inside another empty folder, both attached under root', () => {
    const { model, doc } = script([]);
    const parent = newId('fld', ids);
    makeFolder(doc, { id: parent, kind: 'folder', title: 'Outer', parentId: null, pos: 'B' });
    const child = newId('fld', ids);
    makeFolder(doc, { id: child, kind: 'folder', title: 'Inner', parentId: parent, pos: 'C' });
    const tree = model.outlineTree();
    const shape = (n: typeof tree): unknown => [n.kind, n.title, n.children.map(shape)];
    expect(shape(tree)).toEqual(['root', '', [['folder', 'Outer', [['folder', 'Inner', []]]]]]);
  });

  it('attaches an empty folder to its non-empty parent, after the parent’s existing (scene) children', () => {
    const { model, made, doc } = script([
      ['st_new_act', 'ACT ONE'],
      ['st_scene_heading', 'INT. BANK - DAY'],
    ]);
    const parent = newId('fld', ids);
    makeFolder(doc, { id: parent, kind: 'folder', title: 'Heist', parentId: null, pos: 'B' });
    made[1]!.set('folderId', parent);
    const emptyChild = newId('fld', ids);
    makeFolder(doc, { id: emptyChild, kind: 'folder', title: 'Deleted Scenes', parentId: parent, pos: 'A' });
    const tree = model.outlineTree();
    const shape = (n: typeof tree): unknown => [n.kind, n.title, n.children.map(shape)];
    expect(shape(tree)).toEqual(['root', '', [
      ['act', 'ACT ONE', [['folder', 'Heist', [['scene', 'INT. BANK - DAY', []], ['folder', 'Deleted Scenes', []]]]]],
    ]]);
  });

  it('exposes the title page fields', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
    const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
    const tp = model.titlePage();
    expect(tp.elements).toHaveLength(6);
    expect(tp.fields.title!.text).toBe('UNTITLED');
    expect(tp.fields.credit!.text).toBe('Written by');
  });

  it('formats number labels', () => {
    expect(formatNumberLabel({ base: 10, prefix: [], suffix: [{ kind: 'letters', value: [1, 2] }] })).toBe('10AB');
    expect(formatNumberLabel({ base: 2, prefix: [{ kind: 'letters', value: [2] }], suffix: [] })).toBe('B2');
    expect(formatNumberLabel({ base: 10, prefix: [], suffix: [{ kind: 'letters', value: [1] }, { kind: 'digits', value: 3 }] })).toBe('10A3');
    expect(formatNumberLabel({ base: 1, prefix: [], suffix: [], custom: '1-X' })).toBe('1-X');
  });
});

describe('content hashes on the model', () => {
  it('changes when text changes and is stable otherwise', () => {
    const { model, made, idOf } = script([['st_scene_heading', 'INT. A - DAY'], ['st_action', 'Go.']]);
    const before = model.sceneContentHash(idOf(0) as never);
    expect(model.sceneContentHash(idOf(0) as never)).toBe(before);
    (made[1]!.get('text') as Y.Text).format(0, 3, { hl: '#FFFF00' });
    expect(model.sceneContentHash(idOf(0) as never)).toBe(before);
    (made[1]!.get('text') as Y.Text).insert(3, ' Now.');
    expect(model.sceneContentHash(idOf(0) as never)).not.toBe(before);
  });

  it('covers an outline scene body, whose styles are printable outline/synopsis roles', () => {
    // Spec 11 §4.2: the scene hash excludes elements whose STYLE is printable:false. In
    // text-outline the outline/summary styles are the printed body (only `note` is
    // printable:false), so deleting them must change the scene hash.
    const { model, doc, idOf } = script([
      ['st_scene_heading', 'INT. DINER - NIGHT'],
      ['st_outline_1', 'ACT ONE'],
      ['st_summary', 'Maya waits for the call.'],
      ['st_note', 'check this'],
    ], textOutline);
    const withBody = model.sceneContentHash(idOf(0) as never);
    doc.transact(() => {
      doc.getMap('elements').delete(idOf(1));
      doc.getMap('elements').delete(idOf(2));
    });
    expect(model.elements()).toHaveLength(2);
    expect(model.sceneContentHash(idOf(0) as never)).not.toBe(withBody);
  });

  it('still ignores a printable:false note in an outline scene', () => {
    const { model, doc, idOf } = script([
      ['st_scene_heading', 'INT. DINER - NIGHT'],
      ['st_summary', 'Maya waits for the call.'],
      ['st_note', 'check this'],
    ], textOutline);
    const before = model.sceneContentHash(idOf(0) as never);
    doc.transact(() => doc.getMap('elements').delete(idOf(2)));
    expect(model.sceneContentHash(idOf(0) as never)).toBe(before);
  });
});
