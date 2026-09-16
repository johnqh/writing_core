import { describe, expect, it } from 'vitest';
import { DocumentJSON } from '../schema/document.js';
import { documentToJSON, materializeDocument } from '../model/json.js';
import { validateDocument } from '../model/validate/index.js';
import { openDocument } from './open.js';
import { scaleDocument } from '../test-fixtures/scale-document.js';

/**
 * Everything M2 will consume, exercised once on a document big enough that an O(n²) walk, an
 * order-index bug or a JSON round-trip that drops a field shows up as a failure rather than as a
 * shrug. 300 elements is roughly a 15-page sequence: small enough to stay a fast unit test, large
 * enough that the repeating scene/action/character/parenthetical/dialogue cycle produces ~60 real
 * scenes, dialogue blocks, entities and SmartType entries.
 */
const SIZE = 300;
const CYCLE = 5;

describe(`a ${SIZE}-element document`, () => {
  it('opens with every element in document order and an index that agrees with it', () => {
    const { model, elementIds } = scaleDocument(SIZE);
    expect(model.elementCount()).toBe(SIZE);
    const listed = model.elements();
    expect(listed.map((e) => e.id)).toEqual(elementIds);
    // indexOf / elementAt / next / previous must all agree with that one order.
    for (let i = 0; i < SIZE; i += 37) {
      const id = elementIds[i]!;
      expect(model.indexOf(id)).toBe(i);
      expect(model.elementAt(i).id).toBe(id);
      expect(model.previous(id)?.id).toBe(i === 0 ? undefined : elementIds[i - 1]);
      expect(model.next(id)?.id).toBe(i === SIZE - 1 ? undefined : elementIds[i + 1]);
    }
    expect(model.elements({ from: 10, to: 13 }).map((e) => e.id)).toEqual(elementIds.slice(10, 13));
    model.dispose();
  });

  it('derives one scene per heading, each covering its own body, with dialogue blocks and entities', () => {
    const { model, elementIds } = scaleDocument(SIZE);
    const scenes = model.scenes();
    expect(scenes).toHaveLength(SIZE / CYCLE);
    expect(scenes.map((s) => s.index)).toEqual(scenes.map((_, i) => i));
    // The scenes partition the body exactly: every element in exactly one scene, in order.
    expect(scenes.flatMap((s) => [...s.elementIds])).toEqual(elementIds);
    expect(scenes[0]!.heading.location).toBe('ROOM 0');
    expect(model.sceneOf(elementIds[7]!)!.id).toBe(scenes[1]!.id);
    // One character block per scene, alternating MAYA / JONAH.
    const blocks = model.dialogueBlocks();
    expect(blocks).toHaveLength(SIZE / CYCLE);
    expect(new Set(blocks.map((b) => b.name))).toEqual(new Set(['MAYA', 'JONAH']));
    expect(model.dialogueBlocks(scenes[3]!.id)).toHaveLength(1);
    expect(model.outlineTree().children).toHaveLength(SIZE / CYCLE);
    model.dispose();
  });

  it('round-trips through documentToJSON and back without losing anything', () => {
    const { doc, model, ids } = scaleDocument(SIZE);
    const json = documentToJSON(doc);
    expect(DocumentJSON.safeParse(json).error?.issues ?? []).toEqual([]);
    expect(json.elements).toHaveLength(SIZE);
    const rebuilt = materializeDocument(json, { preserveIds: true, ids });
    expect(JSON.stringify(documentToJSON(rebuilt))).toBe(JSON.stringify(json));
    // And the rebuilt document reads the same through the model, not just as bytes.
    const reopened = openDocument(rebuilt, { ids, clock: () => 1_000, locale: 'en' });
    expect(reopened.elements().map((e) => [e.id, e.style, e.text.plain])).toEqual(model.elements().map((e) => [e.id, e.style, e.text.plain]));
    expect(reopened.scenes().map((s) => s.headingText)).toEqual(model.scenes().map((s) => s.headingText));
    reopened.dispose();
    model.dispose();
  });

  it('satisfies every invariant, and each scene hash is stable and covers only its own scene', () => {
    const { doc, model } = scaleDocument(SIZE);
    expect(validateDocument(doc).issues).toEqual([]);
    const scenes = model.scenes();
    const hashes = scenes.map((s) => model.sceneContentHash(s.id));
    expect(new Set(hashes).size).toBe(scenes.length);
    expect(scenes.map((s) => model.sceneContentHash(s.id))).toEqual(hashes);
    // Editing inside one scene changes that hash and no other.
    const edited = scenes[4]!;
    doc.transact(() => {
      const text = (doc.getMap('elements').get(edited.elementIds[1]!) as { get(k: string): { insert(i: number, s: string): void } }).get('text');
      text.insert(0, 'Changed. ');
    });
    const after = model.scenes().map((s) => model.sceneContentHash(s.id));
    expect(after[4]).not.toBe(hashes[4]);
    expect(after.filter((h, i) => h !== hashes[i])).toHaveLength(1);
    model.dispose();
  });
});
