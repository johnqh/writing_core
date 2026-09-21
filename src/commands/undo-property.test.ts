import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { type ElementId, newDualGroupId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { documentToJSON } from '../model/json.js';
import { generatePositions } from '../model/positions.js';
import { setJSONMap } from '../model/ymap.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { createSessionUndo } from '../undo/undo-manager.js';
import { registerBuiltinCommands } from './builtin.js';
import { executeCommand } from './execute.js';
import { createSessionOrigins } from './origin.js';
import { listCommands } from './registry.js';
import { TEST_ACTOR } from './test-harness.js';

/**
 * Spec 08 §7, last bullet: "an 'every mutating command undoes to a byte-identical document state
 * and redoes back' property test, run against random documents."
 *
 * The random documents come from a seeded PRNG rather than fast-check: the property needs
 * *structurally valid* documents (a style from the template, a dual run that is well formed, tags
 * whose marks exist), which is a generator we would have to write by hand under fast-check anyway,
 * and a fixed seed list makes a failure reproducible from the test name alone without pulling in a
 * dependency and its shrinking machinery.
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];
const STYLES = ['st_scene_heading', 'st_action', 'st_character', 'st_parenthetical', 'st_dialogue', 'st_transition', 'st_shot', 'st_lyrics'] as const;
const WORDS = ['Maya', 'waits', 'in', 'the', 'diner', 'Jonah', 'is', 'late', 'again', 'tonight'];

/** mulberry32 — small, deterministic, no dependency. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandomDoc {
  doc: Y.Doc;
  model: ReturnType<typeof openDocument>;
  ids: ReturnType<typeof createSeededIdSource>;
  elementIds: ElementId[];
  entityIds: string[];
  tagIds: string[];
  listKeys: string[];
}

function randomDocument(seed: number): RandomDoc {
  const r = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const ids = createSeededIdSource(seed + 500);
  const doc = createDocument({ template: screenplayStandard, uid: TEST_ACTOR.userId, ids, clock: () => 1_000 });
  const elements = doc.getMap<unknown>('elements');
  const meta = { createdBy: TEST_ACTOR.userId, createdAt: 1_000, editedBy: TEST_ACTOR.userId, editedAt: 1_000 };
  const elementIds: ElementId[] = [];
  const entityIds: string[] = [];
  const tagIds: string[] = [];

  doc.transact(() => {
    for (const k of [...elements.keys()]) elements.delete(k);
    const count = 6 + Math.floor(r() * 10);
    const positions = generatePositions(count, null, null, null);
    for (let i = 0; i < count; i++) {
      const id = newId('el', ids);
      const words = 2 + Math.floor(r() * 6);
      const plain = Array.from({ length: words }, () => pick(WORDS)).join(' ');
      const record = insertElementRecord(elements, { id, pos: positions[i]!, style: pick(STYLES) as never, text: { plain, runs: [{ text: plain, attrs: {} }], embeds: [] } }, meta);
      const text = record.get('text') as Y.Text;
      // A sprinkling of formatting, so mark commands have something to toggle off as well as on.
      if (r() < 0.4 && plain.length > 3) text.format(0, 1 + Math.floor(r() * 3), r() < 0.5 ? { b: true } : { i: true, hl: '#FFFF00' });
      if (r() < 0.25) record.set('ov', new Y.Map<unknown>()).set('spaceBefore', 1 + Math.floor(r() * 3));
      elementIds.push(id);
    }

    // A well-formed dual-dialogue run, when the shape allows one, so the dual paths are exercised.
    if (r() < 0.5 && elementIds.length >= 8) {
      const start = 2;
      const group = newDualGroupId(ids);
      const sides: ('left' | 'right')[] = ['left', 'left', 'right', 'right'];
      (['st_character', 'st_dialogue', 'st_character', 'st_dialogue'] as const).forEach((style, i) => {
        const record = elements.get(elementIds[start + i]!) as Y.Map<unknown>;
        record.set('style', style);
        record.set('dual', { group, side: sides[i]! });
      });
    }

    const entityCount = 1 + Math.floor(r() * 3);
    for (let i = 0; i < entityCount; i++) {
      const id = newId('ent', ids);
      const name = `${pick(WORDS).toUpperCase()}${i}`;
      const e = doc.getMap<unknown>('entities').set(id, new Y.Map<unknown>());
      for (const [k, v] of Object.entries({
        id, kind: 'character', name, nameKey: name.toLowerCase(), color: null, fields: {}, attributes: {},
        categoryId: null, retain: true, mergedInto: null, createdBy: TEST_ACTOR.userId, createdAt: 1_000, origin: 'manual',
      })) e.set(k, v);
      // One pre-existing alias so entity.removeAlias has something to remove (entity.addAlias
      // adds a different one, so both are real mutations).
      e.set('aliases', Y.Array.from(['OLD NAME']));
      e.set('description', new Y.Text());
      e.set('fields', new Y.Map<unknown>());
      e.set('attributes', new Y.Map<unknown>());
      entityIds.push(id);
    }

    // A tag with a real mark, so entity.delete and mark.clear have anchors to walk.
    if (entityIds.length > 0) {
      const categoryId = [...doc.getMap('tagCategories').keys()][0]!;
      const elementId = elementIds[Math.floor(r() * elementIds.length)]!;
      const text = (elements.get(elementId) as Y.Map<unknown>).get('text') as Y.Text;
      if (text.length >= 2) {
        const tagId = newId('tag', ids);
        setJSONMap(doc.getMap<unknown>('tags'), tagId, { id: tagId, categoryId, entityId: entityIds[0]!, elementId, createdBy: TEST_ACTOR.userId, createdAt: 1_000 });
        text.format(0, 2, { [`t:${tagId}`]: true });
        tagIds.push(tagId);
      }
    }
  });

  const listKeys = [...((doc.getMap<unknown>('smartType').get('transitions') as Y.Map<unknown>).keys())];
  return { doc, model: openDocument(doc, { ids, clock: () => 1_000, locale: 'en' }), ids, elementIds, entityIds, tagIds, listKeys };
}

/** Scene numbering is off in the seed templates; the lock commands need it on. */
function pre(d: RandomDoc, id: string, params: unknown): void {
  executeCommand({ doc: d.doc, model: d.model, ids: d.ids, actor: TEST_ACTOR, origin: createSessionOrigins(TEST_ACTOR).make('local-command', { commandId: id }), capabilities: new Set(['write'] as const), clock: () => 1_000, command: { id, params } });
}
function enableNumbering(d: RandomDoc): void {
  pre(d, 'template.setSceneNumbering', { mode: 'both' });
}

/** Valid parameters for each mutating command against a given random document, or null to skip. */
const PARAMS: Record<string, (d: RandomDoc, r: () => number) => unknown | null> = {
  'text.insert': (d) => ({ at: { elementId: d.elementIds[1], offset: 1 }, text: 'zz' }),
  'text.insertSoftReturn': (d) => ({ at: { elementId: d.elementIds[1], offset: 1 } }),
  'text.insertSpecial': (d) => ({ at: { elementId: d.elementIds[1], offset: 1 }, char: 'emdash' }),
  'text.deleteBackward': (d) => ({ at: { elementId: d.elementIds[2], offset: 2 }, unit: 'word' }),
  'text.deleteForward': (d) => ({ at: { elementId: d.elementIds[2], offset: 0 }, unit: 'char' }),
  'text.deleteRange': (d) => ({ range: { anchor: { elementId: d.elementIds[1], offset: 1 }, head: { elementId: d.elementIds[3], offset: 2 } } }),
  'text.replaceRange': (d) => ({ range: { anchor: { elementId: d.elementIds[1], offset: 1 }, head: { elementId: d.elementIds[2], offset: 2 } }, text: 'new text' }),
  'text.transformCase': (d) => ({ range: { anchor: { elementId: d.elementIds[1], offset: 0 }, head: { elementId: d.elementIds[1], offset: 4 } }, to: 'upper' }),
  'mark.toggle': (d) => ({ range: { anchor: { elementId: d.elementIds[1], offset: 0 }, head: { elementId: d.elementIds[2], offset: 2 } }, mark: 'b' }),
  'mark.set': (d) => ({ range: { anchor: { elementId: d.elementIds[1], offset: 0 }, head: { elementId: d.elementIds[1], offset: 3 } }, mark: 'hl', value: '#00FF00' }),
  'mark.clear': (d) => ({ range: { anchor: { elementId: d.elementIds[0], offset: 0 }, head: { elementId: d.elementIds[4], offset: 1 } } }),
  'element.insert': (d) => ({ after: d.elementIds[2], style: 'st_action', text: 'inserted' }),
  'element.split': (d) => ({ at: { elementId: d.elementIds[1], offset: 2 } }),
  'element.setStyle': (d) => ({ elements: [d.elementIds[2], d.elementIds[3]], style: 'st_shot' }),
  'element.cycleStyle': (d) => ({ element: d.elementIds[1], direction: 'tabForward', caretAtEnd: true }),
  'element.move': (d) => ({ elements: [d.elementIds[1]], to: { after: d.elementIds[4] } }),
  'scene.move': (d) => {
    const scenes = d.model.scenes();
    if (scenes.length < 2) return null;
    return { scenes: [scenes[0]!.id], to: { after: scenes[1]!.elementIds[scenes[1]!.elementIds.length - 1] } };
  },
  'scene.setSynopsis': (d) => {
    const scene = d.model.scenes()[0];
    return scene ? { scene: scene.id, value: 'A synopsis' } : null;
  },
  'scene.setOmitted': (d) => {
    const scene = d.model.scenes()[0];
    return scene ? { scene: scene.id, omitted: true } : null;
  },
  'scene.lockNumbers': (d) => { enableNumbering(d); return {}; },
  'scene.unlockNumbers': (d) => { enableNumbering(d); pre(d, 'scene.lockNumbers', {}); return {}; },
  'page.lock': () => ({}),
  'page.unlock': (d) => { pre(d, 'page.lock', {}); return {}; },
  'title.setField': () => ({ field: 'author', text: 'A. Writer' }),
  'template.setHeaderFooter': () => ({ which: 'footer', patch: { enabled: true, center: '{title}' } }),
  'template.setSceneNumbering': () => ({ mode: 'left' }),
  'template.setContinueds': () => ({ sceneTop: true, sceneBottom: true, moreAtBottom: false }),
  'dual.make': (d) => {
    if (d.elementIds.length < 8) return null;
    const els = d.doc.getMap<Y.Map<unknown>>('elements');
    const four = d.elementIds.slice(2, 6).map((id) => els.get(id)!);
    if (four.some((rec) => rec.has('dual'))) return null;
    (['st_character', 'st_dialogue', 'st_character', 'st_dialogue'] as const).forEach((style, i) => four[i]!.set('style', style));
    return { element: d.elementIds[4] };
  },
  'dual.clear': (d) => ({ element: d.elementIds[2] }),
  'element.duplicate': (d) => ({ elements: [d.elementIds[2]] }),
  'element.setOverride': (d) => ({ elements: [d.elementIds[1]], key: 'align', value: 'center' }),
  'element.revertOverrides': (d) => ({ elements: d.elementIds.slice(0, 4) }),
  'entity.create': () => ({ kind: 'prop', name: 'A BRAND NEW GUN' }),
  'entity.update': (d) => (d.entityIds.length > 0 ? { entityId: d.entityIds[0], patch: { name: 'RENAMED ONE', color: '#123456' } } : null),
  'entity.merge': (d) => (d.entityIds.length >= 2 ? { from: d.entityIds[0], into: d.entityIds[1] } : null),
  'entity.delete': (d) => (d.entityIds.length > 0 ? { entityId: d.entityIds[d.entityIds.length - 1], force: true } : null),
  'entity.addAlias': (d) => (d.entityIds.length > 0 ? { entityId: d.entityIds[0], alias: 'NICKNAME' } : null),
  'entity.removeAlias': (d) => (d.entityIds.length > 0 ? { entityId: d.entityIds[0], alias: 'OLD NAME' } : null),
  'entity.rebuild': () => ({}),
  'smartType.addEntry': () => ({ list: 'soundCues', text: 'A DOOR SLAMS' }),
  'smartType.removeEntry': (d) => (d.listKeys.length > 0 ? { list: 'transitions', key: d.listKeys[0] } : null),
  'smartType.reorder': (d) => (d.listKeys.length >= 2 ? { list: 'transitions', keys: [d.listKeys[1], d.listKeys[0]] } : null),
  'smartType.alphabetize': () => ({ list: 'transitions' }),
  'smartType.rebuild': () => ({}),
  'smartType.cleanup': (d) => (d.listKeys.length >= 2 ? { list: 'transitions', merges: [{ from: [d.listKeys[1]], into: d.listKeys[0] }] } : null),
};

describe('spec 08 §7: every mutating command undoes and redoes byte-identically', () => {
  registerBuiltinCommands();
  const mutating = listCommands().filter((c) => c.mutates).map((c) => c.id).sort();

  it('has a parameter generator for every registered mutating command', () => {
    expect(mutating.filter((id) => !(id in PARAMS))).toEqual([]);
  });

  for (const commandId of listCommands().filter((c) => c.mutates).map((c) => c.id).sort()) {
    it(`${commandId} round-trips through undo and redo`, () => {
      let mutatedAtLeastOnce = false;
      for (const seed of SEEDS) {
        const d = randomDocument(seed);
        const params = PARAMS[commandId]!(d, rng(seed + 900));
        if (params === null) continue;
        const origins = createSessionOrigins(TEST_ACTOR);
        const undo = createSessionUndo(d.doc, origins, { clock: () => 1_000 });
        const before = JSON.stringify(documentToJSON(d.doc));
        const result = executeCommand({
          doc: d.doc, model: d.model, ids: d.ids, actor: TEST_ACTOR,
          origin: origins.make('local-command', { commandId }),
          capabilities: new Set(['write', 'comment', 'lockAdmin', 'revisionAdmin'] as const),
          clock: () => 1_000, command: { id: commandId, params },
        });
        if (!result.ok) {
          undo.destroy();
          continue;
        }
        const after = JSON.stringify(documentToJSON(d.doc));
        if (after !== before) mutatedAtLeastOnce = true;
        expect(undo.canUndo(), `${commandId} seed ${seed}: nothing on the undo stack`).toBe(after !== before);
        if (after !== before) {
          expect(undo.undo(), `${commandId} seed ${seed}: undo refused`).toBe(true);
          expect(JSON.stringify(documentToJSON(d.doc)), `${commandId} seed ${seed}: undo is not byte-identical`).toBe(before);
          expect(undo.redo(), `${commandId} seed ${seed}: redo refused`).toBe(true);
          expect(JSON.stringify(documentToJSON(d.doc)), `${commandId} seed ${seed}: redo is not byte-identical`).toBe(after);
        }
        undo.destroy();
        d.model.dispose();
      }
      expect(mutatedAtLeastOnce, `${commandId} never actually changed a document — the generator produces no-ops`).toBe(true);
    });
  }
});
