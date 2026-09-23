import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { commandHarness } from '../commands/test-harness.js';
import type { ModelChangeBatch } from '../read-model/views.js';
import { createLayoutEngine } from './engine.js';
import type { ViewSpec } from './types.js';

/**
 * Spec 02 §37.3 invariant 1 (M2 task 31): "after every edit, `applyChanges` + `layout` must deep-equal
 * a fresh `load` + full layout." Since this engine always recomputes the full page-filling pass when
 * dirty (`engine.ts`'s own header explains why), that half of the property holds by construction; the
 * part actually worth fuzzing is the OTHER direction — that the real §31.2 paragraph cache, which
 * persists across edits on one engine (unlike a freshly-loaded one, whose cache starts empty), never
 * serves a STALE entry for a document state it was never computed against. A cache-invalidation bug is
 * exactly the kind of thing a fixed set of hand-written tests tends to miss and a property test finds.
 *
 * Seeds, not `fast-check`'s own generator: M1's own undo property test found that a shrinking,
 * dependency-injected generator is more machinery than a fixed, reproducible seed list for a property
 * that needs *structurally valid* documents (a real command's real preconditions), and a bare seed list
 * makes a failure reproducible from the test name alone. The one thing that file's own header flags as
 * a past mistake — a generator that doesn't consume the RNG for every choice — is guarded against here
 * by literally threading `r()` through every one of `EDITS`' own parameter choices, and asserted via
 * the coverage check at the end (every edit kind must fire on at least 6 of the 8 seeds).
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];
const STYLES = ['st_scene_heading', 'st_action', 'st_character', 'st_parenthetical', 'st_dialogue', 'st_transition', 'st_shot'] as const;
const WORDS = ['Maya', 'waits', 'in', 'the', 'diner', 'Jonah', 'is', 'late', 'again', 'tonight', 'quietly', 'outside'];

const VIEW: ViewSpec = {
  mode: 'page', revisionFilter: { kind: 'none' }, trackChanges: 'final', pageColor: 'off', showInvisibles: false, alternatesMode: 'active',
};

function engineOpts() {
  return { fonts: createFontRegistry(), shaper: null, segmentation: { ucdVersion: 'test' } };
}

/** mulberry32 — small, deterministic, no dependency (same generator `undo-property.test.ts` uses). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDocument(seed: number) {
  const h = commandHarness(undefined, seed + 500);
  const r = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const count = 10 + Math.floor(r() * 12);
  const rows: [string, string][] = [['st_scene_heading', 'INT. START - DAY']];
  for (let i = 1; i < count; i++) {
    const words = 2 + Math.floor(r() * 6);
    rows.push([pick(STYLES), Array.from({ length: words }, () => pick(WORDS)).join(' ')]);
  }
  const ids = h.replaceBody(rows);
  return { h, ids, r };
}

type Edit = (h: ReturnType<typeof commandHarness>, ids: readonly string[], r: () => number) => { id: string; params: unknown } | null;

const EDITS: Record<string, Edit> = {
  'text.insert': (h, ids, r) => {
    const id = ids[Math.floor(r() * ids.length)]!;
    const len = (h.textMap(id as never) as { length: number }).length;
    return { id: 'text.insert', params: { at: { elementId: id, offset: Math.floor(r() * (len + 1)) }, text: 'zz' } };
  },
  'element.insert': (h, ids, r) => ({ id: 'element.insert', params: { after: ids[Math.floor(r() * ids.length)]!, style: 'st_action', text: 'A new beat.' } }),
  'element.setStyle': (h, ids, r) => ({ id: 'element.setStyle', params: { elements: [ids[Math.floor(r() * ids.length)]!], style: STYLES[Math.floor(r() * STYLES.length)]! } }),
  'element.split': (h, ids, r) => {
    const id = ids[Math.floor(r() * ids.length)]!;
    const len = (h.textMap(id as never) as { length: number }).length;
    if (len < 2) return null;
    return { id: 'element.split', params: { at: { elementId: id, offset: 1 + Math.floor(r() * (len - 1)) } } };
  },
  'mark.toggle': (h, ids, r) => {
    const id = ids[Math.floor(r() * ids.length)]!;
    const len = (h.textMap(id as never) as { length: number }).length;
    if (len < 1) return null;
    return { id: 'mark.toggle', params: { range: { anchor: { elementId: id, offset: 0 }, head: { elementId: id, offset: Math.min(len, 1 + Math.floor(r() * len)) } }, mark: 'b' } };
  },
  'element.duplicate': (h, ids, r) => ({ id: 'element.duplicate', params: { elements: [ids[Math.floor(r() * ids.length)]!] } }),
  'scene.setOmitted': (h, ids, r) => {
    const scene = h.model.scenes()[Math.floor(r() * Math.max(1, h.model.scenes().length))];
    return scene ? { id: 'scene.setOmitted', params: { scene: scene.id, omitted: r() < 0.5 } } : null;
  },
  'template.setSceneNumbering': (_h, _ids, r) => ({ id: 'template.setSceneNumbering', params: { mode: ['none', 'left', 'right', 'both'][Math.floor(r() * 4)] } }),
};

describe('spec 02 §37.3 invariant 1: incremental layout equals a fresh full layout', () => {
  const firedSeeds: Record<string, Set<number>> = Object.fromEntries(Object.keys(EDITS).map((k) => [k, new Set<number>()]));

  for (const seed of SEEDS) {
    it(`seed ${seed}: engine.getResult() after each real edit matches a fresh engine's getResult()`, () => {
      const { h, ids: initialIds, r } = randomDocument(seed);
      let ids = initialIds;
      const engine = createLayoutEngine(engineOpts());
      engine.load(h.model);
      engine.layout(VIEW);

      const editNames = Object.keys(EDITS);
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const name = editNames[Math.floor(r() * editNames.length)]!;
        const edit = EDITS[name]!(h, ids, r);
        if (!edit) continue;
        let changes: ModelChangeBatch['changes'] = [];
        const unsubscribe = h.model.subscribe((batch) => { changes = batch.changes; });
        const result = h.run(edit.id, edit.params);
        unsubscribe();
        if (!result.ok) continue;
        firedSeeds[name]!.add(seed);
        engine.applyChanges(changes);
        ids = h.model.elements().map((e) => e.id);

        const incremental = engine.getResult(VIEW);
        const fresh = createLayoutEngine(engineOpts());
        fresh.load(h.model);
        const full = fresh.getResult(VIEW);
        expect(incremental).toEqual(full);
      }
    });
  }

  it('coverage: every edit kind actually fired on at least 6 of the 8 seeds', () => {
    for (const [name, seeds] of Object.entries(firedSeeds)) expect(seeds.size, name).toBeGreaterThanOrEqual(6);
  });
});
