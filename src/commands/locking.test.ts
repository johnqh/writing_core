import { describe, expect, it } from 'vitest';
import type { ElementId } from '../ids/ids.js';
import { assignNumbers } from '../numbering/assign.js';
import { formatNumberLabel } from '../read-model/number-label.js';
import { layoutDocument } from '../layout/layout-document.js';
import { commandHarness } from './test-harness.js';

const heading = (n: number): [string, string] => ['st_scene_heading', `INT. ROOM ${n} - DAY`];

function fiveScenes() {
  const h = commandHarness();
  const rows: [string, string][] = [];
  for (let i = 1; i <= 5; i++) rows.push(heading(i), ['st_action', `Action ${i}.`]);
  const ids = h.replaceBody(rows);
  expect(h.run('template.setSceneNumbering', { mode: 'both' }).ok).toBe(true);
  const label = (id: ElementId) => {
    const a = assignNumbers(h.model).labels.get(id);
    return a ? formatNumberLabel(a.label) : null;
  };
  const scenes = [0, 2, 4, 6, 8].map((i) => ids[i]!);
  return { h, ids, scenes, label };
}

describe('scene.lockNumbers / scene.unlockNumbers', () => {
  it('freezes numbering; inserted scenes take A-numbers; omitted and deleted scenes keep theirs', () => {
    const { h, scenes, label } = fiveScenes();
    expect(scenes.map(label)).toEqual(['1', '2', '3', '4', '5']);
    expect(h.run('scene.lockNumbers', {}).ok).toBe(true);
    expect(h.model.productionState().scenesLocked).toBe(true);
    // Insert after scene 3's action: 3A, then another after that: 3B (in document order).
    const first = h.run('element.insert', { after: scenes[2], style: 'st_scene_heading', text: 'INT. NEW ONE - DAY' });
    expect(first.ok).toBe(true);
    const newOne = h.model.elements().find((e) => e.text.plain === 'INT. NEW ONE - DAY')!.id;
    expect(label(newOne)).toBe('3A');
    const newTwo = (() => {
      h.run('element.insert', { after: newOne, style: 'st_scene_heading', text: 'INT. NEW TWO - DAY' });
      return h.model.elements().find((e) => e.text.plain === 'INT. NEW TWO - DAY')!.id;
    })();
    expect(label(newOne)).toBe('3A');
    expect(label(newTwo)).toBe('3B');
    // The stored ones did not move.
    expect(scenes.map(label)).toEqual(['1', '2', '3', '4', '5']);
    // Omitting keeps the number.
    expect(h.run('scene.setOmitted', { scene: scenes[1], omitted: true }).ok).toBe(true);
    expect(label(scenes[1]!)).toBe('2');
    expect(label(scenes[2]!)).toBe('3');
  });

  it('a scene inserted before scene 1 gets A1 (preSeq)', () => {
    const { h, scenes, label } = fiveScenes();
    h.run('scene.lockNumbers', {});
    h.run('element.insert', { after: scenes[0], style: 'st_scene_heading', text: 'INT. FIRST - DAY' });
    // Move it before scene 1.
    const fresh = h.model.elements().find((e) => e.text.plain === 'INT. FIRST - DAY')!.id;
    expect(h.run('scene.move', { scenes: [fresh], to: { before: scenes[0] } }).ok).toBe(true);
    expect(label(fresh)).toBe('A1');
  });

  it('a deleted locked scene leaves a hole: the next scene keeps its number', () => {
    const { h, ids, scenes, label } = fiveScenes();
    h.run('scene.lockNumbers', {});
    h.doc.transact(() => {
      const els = h.doc.getMap<unknown>('elements');
      els.delete(ids[2]!);
      els.delete(ids[3]!);
    });
    expect(label(scenes[3]!)).toBe('4');
    expect(label(scenes[2]!)).toBe('3');
    expect(label(scenes[1]!)).toBeNull();
  });

  it('unlock clears stored numbers and renumbering resumes', () => {
    const { h, scenes, label } = fiveScenes();
    h.run('scene.lockNumbers', {});
    h.run('element.insert', { after: scenes[2], style: 'st_scene_heading', text: 'INT. NEW - DAY' });
    expect(h.run('scene.unlockNumbers', {}).ok).toBe(true);
    expect(h.model.productionState().scenesLocked).toBe(false);
    expect(h.model.elements().every((e) => e.num === null)).toBe(true);
    expect(scenes.map(label)).toEqual(['1', '2', '3', '5', '6']);
  });

  it('refuses while scene numbering is off', () => {
    const h = commandHarness();
    h.replaceBody([heading(1), ['st_action', 'a']]);
    expect(h.run('scene.lockNumbers', {}).ok).toBe(false);
  });

  it('relock makes provisional labels permanent', () => {
    const { h, scenes } = fiveScenes();
    h.run('scene.lockNumbers', {});
    h.run('element.insert', { after: scenes[2], style: 'st_scene_heading', text: 'INT. NEW - DAY' });
    const id = h.model.elements().find((e) => e.text.plain === 'INT. NEW - DAY')!.id;
    expect(h.model.element(id)!.num).toBeNull();
    expect(h.run('scene.lockNumbers', {}).ok).toBe(true);
    expect(formatNumberLabel(h.model.element(id)!.num!.label)).toBe('3A');
  });
});

describe('page.lock / page.unlock', () => {
  const longScript = (h: ReturnType<typeof commandHarness>, scenes: number, perScene: number) => {
    const rows: [string, string][] = [];
    for (let i = 1; i <= scenes; i++) {
      rows.push(heading(i));
      for (let j = 0; j < perScene; j++) rows.push(['st_action', `Scene ${i} beat ${j}.`]);
    }
    return h.replaceBody(rows);
  };

  it('records one lock per page and keeps the same pages; unlock removes them', () => {
    const h = commandHarness();
    longScript(h, 6, 12);
    const before = layoutDocument(h.model);
    expect(before.pages.length).toBeGreaterThan(2);
    expect(h.run('page.lock', {}).ok).toBe(true);
    const prod = h.model.productionState();
    expect(prod.pagesLocked).toBe(true);
    expect(prod.pageLocks).toHaveLength(before.pages.length);
    const after = layoutDocument(h.model);
    expect(after.pages.map((p) => p.label)).toEqual(before.pages.map((p) => String(p.number)));
    expect(after.pages.every((p) => p.lockId)).toBe(true);
    expect(h.run('page.lock', {}).ok).toBe(false); // nothing left to lock
    expect(h.run('page.unlock', {}).ok).toBe(true);
    expect(h.model.productionState().pageLocks).toHaveLength(0);
    expect(layoutDocument(h.model).pages.map((p) => p.label)).toEqual(before.pages.map((p) => String(p.number)));
  });
});
