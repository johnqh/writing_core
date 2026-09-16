import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { writeEntity } from '../model/json.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { formatNumberLabel } from './number-label.js';
import { openDocument } from './open.js';

const ids = createSeededIdSource(41);
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };

/**
 * Builds a document body from `rows` but inserts the element records into the Yjs
 * map in *reverse* of document order. Scenes/dialogue-blocks/outline must be derived
 * from `pos` (via comparePositions / OrderIndex), never from Y.Map insertion order —
 * a regression that falls back to insertion order would still pass if the fixture
 * happened to be pre-sorted, so we deliberately scramble it here.
 */
function script(rows: [string, string][]) {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
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
