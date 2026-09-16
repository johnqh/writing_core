import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import type { ElementId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { documentToJSON } from '../model/json.js';
import { rebalancePositions } from '../model/positions.js';
import { type InvariantCode, validateDocument } from '../model/validate/index.js';
import { orderElements } from '../model/ymap.js';
import { type DocumentModel, openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { registerBuiltinCommands } from './builtin.js';
import { executeCommand } from './execute.js';
import { createSessionOrigins } from './origin.js';

/**
 * Fadewright's document is a CRDT (spec 01 §2): two writers edit offline and both replicas must
 * end up byte-identical AND valid once they exchange updates. Yjs guarantees convergence of the
 * *bytes*; what these tests check is that our data model on top of it converges too — that
 * concurrent edits cannot produce two different `documentToJSON`s, or one that violates spec 01
 * §9's invariants (a dual run split across replicas, an entity merged two ways, a rebalance run
 * independently on both sides while one also inserts).
 *
 * Note on scope: no scenario here manufactures two elements landing on the literal same `pos`
 * string and checks the (pos, id) tie-break directly — that ordering rule is exercised by
 * `orderElements`'s own callers/tests, not proven here. And where a scenario's comment describes
 * *why* a mechanism (rebalance jitter-freedom, an auto-repair's specific tie-break) must be
 * deterministic, that comment is explaining the mechanism, not claiming this suite pins it: `expect
 * jsonB === jsonA` after `converge()` passes for ANY deterministic rule, not only the one the
 * mechanism happens to use — see the per-test notes below.
 */

const ACTOR_A = { userId: 'ua', displayName: 'A', color: '#224466', kind: 'human' as const };
const ACTOR_B = { userId: 'ub', displayName: 'B', color: '#664422', kind: 'human' as const };

interface Replica {
  doc: Y.Doc;
  model: DocumentModel;
  ids: ReturnType<typeof createSeededIdSource>;
  run(id: string, params: unknown): ReturnType<typeof executeCommand>;
  elementIds(): ElementId[];
}

function replicaOf(doc: Y.Doc, actor: typeof ACTOR_A, seed: number): Replica {
  registerBuiltinCommands();
  const ids = createSeededIdSource(seed);
  const model = openDocument(doc, { ids, clock: () => 1_000, locale: 'en' });
  const origins = createSessionOrigins(actor);
  return {
    doc, model, ids,
    run: (id, params) => executeCommand({
      doc, model, ids, actor, origin: origins.make('local-command', { commandId: id }),
      capabilities: new Set(['write', 'comment', 'lockAdmin', 'revisionAdmin'] as const), clock: () => 1_000, command: { id, params },
    }),
    elementIds: () => orderElements(doc.getMap<unknown>('elements')).map((e) => e.get('id') as ElementId),
  };
}

/** One shared starting document, then two independent replicas of it. */
function pair(body: [style: string, text: string][]): { a: Replica; b: Replica } {
  const seedIds = createSeededIdSource(11);
  const doc = createDocument({ template: screenplayStandard, uid: 'ua', ids: seedIds, clock: () => 1_000 });
  const a = replicaOf(doc, ACTOR_A, 21);
  a.doc.transact(() => {
    for (const k of [...doc.getMap('elements').keys()]) doc.getMap('elements').delete(k);
  });
  let after: ElementId | null = null;
  for (const [style, text] of body) {
    const r = a.run('element.insert', { after, style, ...(text ? { text } : {}) });
    expect(r, `seeding ${style}`).toMatchObject({ ok: true });
    after = a.elementIds()[a.elementIds().length - 1]!;
  }
  const copy = new Y.Doc({ gc: false });
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return { a, b: replicaOf(copy, ACTOR_B, 31) };
}

/**
 * Exchanges updates in both directions, then asserts the two replicas are indistinguishable:
 * identical `documentToJSON`, and identical (by default empty) invariant reports. `allow` names
 * codes a particular scenario is expected to raise — it still requires both replicas to raise
 * exactly the same ones, which is the convergence property; it only permits the document to end
 * in a state spec 01 §9 describes as a warning for the user to resolve.
 */
function converge(a: Replica, b: Replica, allow: readonly InvariantCode[] = []): void {
  const fromA = Y.encodeStateAsUpdate(a.doc);
  const fromB = Y.encodeStateAsUpdate(b.doc);
  Y.applyUpdate(b.doc, fromA);
  Y.applyUpdate(a.doc, fromB);
  const jsonA = JSON.stringify(documentToJSON(a.doc));
  const jsonB = JSON.stringify(documentToJSON(b.doc));
  expect(jsonB).toBe(jsonA);
  const report = (r: Replica) => validateDocument(r.doc).issues.map((i) => `${i.code} ${i.message}`);
  expect(report(b)).toEqual(report(a));
  expect(report(a).filter((line) => !allow.some((code) => line.startsWith(`${code} `)))).toEqual([]);
}

const SCRIPT: [string, string][] = [
  ['st_scene_heading', 'INT. DINER - NIGHT'],
  ['st_action', 'Maya waits. Jonah is late.'],
  ['st_character', 'MAYA'],
  ['st_dialogue', 'You said eight.'],
  ['st_character', 'JONAH'],
  ['st_dialogue', 'I said eightish.'],
  ['st_action', 'Silence.'],
];

describe('CRDT convergence', () => {
  it('converges when both replicas split the same element at the same offset', () => {
    const { a, b } = pair(SCRIPT);
    const target = a.elementIds()[1]!;
    expect(a.run('element.split', { at: { elementId: target, offset: 12 } })).toMatchObject({ ok: true });
    expect(b.run('element.split', { at: { elementId: target, offset: 12 } })).toMatchObject({ ok: true });
    converge(a, b);
    // Both writers' new elements survive — a split is an insert, not a last-writer-wins field.
    expect(a.elementIds().length).toBe(SCRIPT.length + 2);
  });

  it('converges when both replicas type into the same element at the same offset', () => {
    const { a, b } = pair(SCRIPT);
    const target = a.elementIds()[1]!;
    expect(a.run('text.insert', { at: { elementId: target, offset: 5 }, text: 'AAA' })).toMatchObject({ ok: true });
    expect(b.run('text.insert', { at: { elementId: target, offset: 5 }, text: 'BBB' })).toMatchObject({ ok: true });
    converge(a, b);
    const text = a.model.element(target)!.text.plain;
    expect(text).toContain('AAA');
    expect(text).toContain('BBB');
  });

  it('converges when both replicas merge the same two entities in opposite directions', () => {
    const { a, b } = pair(SCRIPT);
    // Harvest on one side and share the result first, so this test is about the concurrent merge
    // and not about harvesting minting ids twice (covered separately below).
    expect(a.run('smartType.rebuild', {})).toMatchObject({ ok: true });
    converge(a, b);
    const maya = a.model.resolveEntity('character', 'MAYA')!.id;
    const jonah = a.model.resolveEntity('character', 'JONAH')!.id;
    expect(a.run('entity.merge', { from: maya, into: jonah })).toMatchObject({ ok: true });
    expect(b.run('entity.merge', { from: jonah, into: maya })).toMatchObject({ ok: true });
    // FINDING, recorded rather than papered over: entity.merge's cycle guard
    // (`into.mergedInto !== null` refuses) only stops a cycle forming SEQUENTIALLY. Two replicas
    // merging the same pair in opposite directions offline each write one half of a two-link
    // cycle, and neither can see the other's write. Nothing is lost and the replicas do not
    // diverge; the cycle is exactly what invariant I17 exists for — severity `error`, auto-repair
    // "break the cycle at the most recently merged link" (spec 01 §9).
    converge(a, b, ['I17']);
    const cycles = validateDocument(a.doc, { only: ['I17'] }).issues;
    expect(cycles).toHaveLength(1);
    // The repair has to be deterministic, or repairing on each replica independently would
    // re-diverge them. I17's implementation (`references.ts`) breaks at the sorted-last id in the
    // cycle — but this test only proves the repair converges when run independently on both
    // replicas; it does not pin *which* link gets broken (it asserts convergence and issue counts,
    // not e.g. which entity ends up with `mergedInto: null`), so it would stay green for any other
    // deterministic tie-break rule too.
    for (const r of [a, b]) expect(validateDocument(r.doc, { only: ['I17'] }).repair()).toBe(1);
    converge(a, b);
    expect(a.model.entity(maya)!.id).toBe(b.model.entity(maya)!.id);
    expect(a.model.entity(jonah)!.id).toBe(b.model.entity(jonah)!.id);
  });


  it('two replicas harvesting the same cues offline produce duplicate entities, and agree about it', () => {
    // Spec 01 §7.2 runs the harvester "on the editing client only", but two clients editing
    // offline both qualify, and each mints its own ULID for MAYA. Yjs converges the bytes, and the
    // duplicate surfaces as exactly what spec 01 §9 says it should: an I16 warning offering
    // "Merge entities". What matters here is that BOTH replicas report the same thing — the
    // duplicate is a user-resolvable state, not a divergence.
    const { a, b } = pair(SCRIPT);
    for (const r of [a, b]) expect(r.run('smartType.rebuild', {})).toMatchObject({ ok: true });
    converge(a, b, ['I16']);
    const duplicates = validateDocument(a.doc, { only: ['I16'] }).issues;
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates.every((i) => i.severity === 'warning')).toBe(true);
    // And merging them afterwards converges to one entity per name.
    for (const issue of duplicates) {
      const [survivor, ...rest] = [...issue.ids].sort();
      for (const from of rest) expect(a.run('entity.merge', { from, into: survivor })).toMatchObject({ ok: true });
    }
    converge(a, b);
  });

  it('converges when one replica deletes across an element seam and the other edits inside it', () => {
    const { a, b } = pair(SCRIPT);
    const ids = a.elementIds();
    expect(a.run('text.deleteRange', {
      range: { anchor: { elementId: ids[1]!, offset: 10 }, head: { elementId: ids[3]!, offset: 4 } },
    })).toMatchObject({ ok: true });
    expect(b.run('text.insert', { at: { elementId: ids[2]!, offset: 4 }, text: ' (V.O.)' })).toMatchObject({ ok: true });
    converge(a, b);
  });

  it('converges when both replicas delete across the same element seam', () => {
    const { a, b } = pair(SCRIPT);
    const ids = a.elementIds();
    const range = { anchor: { elementId: ids[1]!, offset: 5 }, head: { elementId: ids[2]!, offset: 2 } };
    expect(a.run('text.deleteRange', { range })).toMatchObject({ ok: true });
    expect(b.run('text.deleteRange', { range })).toMatchObject({ ok: true });
    converge(a, b);
  });

  it('converges when both replicas rebalance positions while one also inserts', () => {
    const { a, b } = pair(SCRIPT);
    // `pos` is last-writer-wins per element, so a rebalance MUST be deterministic (no jitter) or
    // the two replicas would compute different keys for the same elements. `rebalancePositions`'s
    // own determinism (no jitter) is unit-tested directly in `positions.test.ts` ("rebalances
    // deterministically"); this test only checks that running it independently on both replicas,
    // concurrently with an edit, still converges — `converge()`'s `jsonB === jsonA` would pass
    // here even if rebalancing were non-deterministic, because Yjs's own LWW conflict resolution
    // trivially converges any single last-writer-wins field regardless of what each side wrote.
    const rebalance = (r: Replica) => r.doc.transact(() => {
      const ordered = orderElements(r.doc.getMap<unknown>('elements'));
      const keys = rebalancePositions(ordered.length);
      ordered.forEach((e, i) => e.set('pos', keys[i]!));
    });
    rebalance(a);
    rebalance(b);
    expect(b.run('text.insert', { at: { elementId: b.elementIds()[6]!, offset: 0 }, text: 'Long ' })).toMatchObject({ ok: true });
    converge(a, b);
    expect(a.model.elements().map((e) => e.text.plain)).toEqual(b.model.elements().map((e) => e.text.plain));
  });

  it('converges when each replica restyles the same element differently', () => {
    const { a, b } = pair(SCRIPT);
    const target = a.elementIds()[6]!;
    expect(a.run('element.setStyle', { elements: [target], style: 'st_shot' })).toMatchObject({ ok: true });
    expect(b.run('element.setStyle', { elements: [target], style: 'st_transition' })).toMatchObject({ ok: true });
    converge(a, b);
    expect(['st_shot', 'st_transition']).toContain(a.model.element(target)!.style);
  });

  it('converges when one replica deletes an element the other is still editing', () => {
    const { a, b } = pair(SCRIPT);
    const target = a.elementIds()[6]!;
    expect(a.run('text.deleteBackward', { at: { elementId: target, offset: 0 }, unit: 'element' })).toMatchObject({ ok: true });
    expect(b.run('text.insert', { at: { elementId: target, offset: 8 }, text: ' again' })).toMatchObject({ ok: true });
    converge(a, b);
    expect(a.model.element(target)).toBeUndefined();
  });

  it('converges over a long interleaved session on both sides', () => {
    const { a, b } = pair(SCRIPT);
    for (let round = 0; round < 6; round++) {
      const idsA = a.elementIds();
      const idsB = b.elementIds();
      a.run('text.insert', { at: { elementId: idsA[round % idsA.length]!, offset: 0 }, text: `a${round} ` });
      b.run('text.insert', { at: { elementId: idsB[(round + 2) % idsB.length]!, offset: 0 }, text: `b${round} ` });
      a.run('element.setStyle', { elements: [idsA[(round + 1) % idsA.length]], style: round % 2 ? 'st_action' : 'st_shot' });
      b.run('element.split', { at: { elementId: idsB[1]!, offset: 3 } });
    }
    converge(a, b);
  });
});
