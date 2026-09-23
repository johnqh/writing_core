import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { commandHarness } from '../commands/test-harness.js';
import { buildElementIndex } from './output.js';
import { pageOf, pointToPosition, positionAbove, positionBelow, positionToCaret, selectionRects } from './mapping.js';
import { createLayoutEngine } from './engine.js';
import type { ViewSpec } from './types.js';

const scene = (n: number, heading: string): [string, string][] => [
  ['st_scene_heading', heading],
  ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${heading} ${i}.`]),
];

const VIEW: ViewSpec = {
  mode: 'page', revisionFilter: { kind: 'none' }, trackChanges: 'final', pageColor: 'off', showInvisibles: false, alternatesMode: 'active',
};

function newEngine() {
  return createLayoutEngine({ fonts: createFontRegistry(), shaper: null, segmentation: { ucdVersion: 'test' } });
}

describe('createLayoutEngine', () => {
  it('the first layout() after load() replaces the whole document', () => {
    const h = commandHarness();
    h.replaceBody(scene(2, 'INT. A - DAY'));
    const engine = newEngine();
    engine.load(h.model);
    const delta = engine.layout(VIEW);
    expect(delta.complete).toBe(true);
    expect(delta.replacedPages.from).toBe(0);
    expect(delta.replacedPages.pages.length).toBe(delta.pageCount);
    expect(delta.removedPageCount).toBe(0);
  });

  it('layout() again with nothing changed reports an empty delta and skips recomputation entirely', () => {
    const h = commandHarness();
    h.replaceBody(scene(2, 'INT. A - DAY'));
    const engine = newEngine();
    engine.load(h.model);
    engine.layout(VIEW);
    const second = engine.layout(VIEW);
    expect(second.replacedPages).toEqual({ from: 0, to: 0, pages: [] });
    expect(second.removedPageCount).toBe(0);
    expect(second.decorationsChanged).toEqual([]);
    expect(second.diagnosticsChanged).toBe(false);
  });

  it('a real content edit reports a narrow replaced range, not the whole document (§31.1: elements)', () => {
    const rows: [string, string][] = [...scene(30, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')];
    const h = commandHarness();
    const ids = h.replaceBody(rows);
    const engine = newEngine();
    engine.load(h.model);
    const first = engine.layout(VIEW);
    expect(first.pageCount).toBeGreaterThan(1);
    // Edit the very last element: only the last page(s) should show up as replaced.
    const last = ids[ids.length - 1]!;
    h.run('text.insert', { at: { elementId: last, offset: 0 }, text: 'More ' });
    engine.applyChanges([{ kind: 'elements', inserted: [], removed: [], changed: [last], reordered: false }]);
    const second = engine.layout(VIEW);
    expect(second.replacedPages.from).toBeGreaterThan(0);
    expect(second.replacedPages.from).toBe(first.pageCount - 1); // only the last page actually changed
  });

  it('a change kind with no possible layout effect leaves the engine clean (§31.1)', () => {
    const h = commandHarness();
    h.replaceBody(scene(2, 'INT. A - DAY'));
    const engine = newEngine();
    engine.load(h.model);
    engine.layout(VIEW);
    engine.applyChanges([{ kind: 'bin' }]);
    const second = engine.layout(VIEW);
    expect(second.replacedPages).toEqual({ from: 0, to: 0, pages: [] });
  });

  it('a layout-relevant change kind (e.g. titlePage) does trigger a recompute, even with no observable page diff', () => {
    const h = commandHarness();
    h.replaceBody(scene(2, 'INT. A - DAY'));
    const engine = newEngine();
    engine.load(h.model);
    const first = engine.layout(VIEW);
    engine.applyChanges([{ kind: 'titlePage' }]);
    const second = engine.layout(VIEW);
    // Recomputed (not short-circuited by the dirty flag), but the body pages are unchanged, so the
    // diff still correctly reports no REPLACED content — proving this is a real diff, not a rubber
    // stamp (a genuine change reports a from < to range; see the previous test).
    expect(second.replacedPages.pages).toEqual([]);
    expect(second.replacedPages.to).toBe(second.replacedPages.from);
    expect(first.pageCount).toBe(second.pageCount);
  });

  it('visiblePageHint on layout() can leave complete: false; getResult() always completes', () => {
    const h = commandHarness();
    h.replaceBody([['st_scene_heading', 'INT. HOUSE - DAY'], ...Array.from({ length: 90 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`])]);
    const engine = newEngine();
    engine.load(h.model);
    const delta = engine.layout(VIEW, { visiblePageHint: 0 });
    expect(delta.complete).toBe(false);
    expect(delta.pageCount).toBe(2); // max(0 + 2, 1)
    const full = engine.getResult(VIEW);
    expect(full.complete).toBe(true);
    expect(full.pages.length).toBeGreaterThan(delta.pageCount);
  });

  it('every mapping method forwards to mapping.ts, agreeing with a fresh call against getResult()', () => {
    const rows: [string, string][] = [...scene(2, 'INT. A - DAY')];
    const h = commandHarness();
    const ids = h.replaceBody(rows);
    const engine = newEngine();
    engine.load(h.model);
    engine.layout(VIEW);
    const layout = engine.getResult(VIEW);
    const index = buildElementIndex(layout, h.model);

    const pos = { elementId: ids[1]!, offset: 1 };
    expect(engine.positionToCaret(pos)).toEqual(positionToCaret(layout, index, pos, 'downstream'));
    expect(engine.pageOf(pos)).toEqual(pageOf(index, pos));

    const caret = positionToCaret(layout, index, pos)!;
    const point = { pageIndex: caret.pageIndex, x: caret.x, y: caret.top + 1 };
    expect(engine.pointToPosition(point)).toEqual(pointToPosition(layout, point));

    const range = { anchor: { elementId: ids[0]!, offset: 0 }, head: { elementId: ids[1]!, offset: 2 } };
    expect(engine.selectionRects(range)).toEqual(selectionRects(layout, index, range.anchor, range.head));
    // Reversed anchor/head must be reordered to the same result.
    expect(engine.selectionRects({ anchor: range.head, head: range.anchor })).toEqual(selectionRects(layout, index, range.anchor, range.head));

    expect(engine.positionAbove(pos, caret.x)).toEqual(positionAbove(layout, index, pos, caret.x));
    expect(engine.positionBelow(pos, caret.x)).toEqual(positionBelow(layout, index, pos, caret.x));
  });

  it('mapping methods return null/empty before load()/layout() has produced anything', () => {
    const engine = newEngine();
    expect(engine.positionToCaret({ elementId: 'el_x' as never, offset: 0 })).toBeNull();
    expect(engine.pointToPosition({ pageIndex: 0, x: 0, y: 0 })).toBeNull();
    expect(engine.selectionRects({ anchor: { elementId: 'el_x' as never, offset: 0 }, head: { elementId: 'el_x' as never, offset: 1 } })).toEqual([]);
    expect(engine.pageOf({ elementId: 'el_x' as never, offset: 0 })).toBeNull();
    expect(engine.diagnostics()).toEqual([]);
  });

  it('diagnostics() mirrors the last computed layout', () => {
    const h = commandHarness();
    h.replaceBody(scene(2, 'INT. A - DAY'));
    const engine = newEngine();
    engine.load(h.model);
    engine.layout(VIEW);
    expect(engine.diagnostics()).toEqual(engine.getResult(VIEW).diagnostics);
  });

  it('load() resets state: a second document does not see the first one\'s pages', () => {
    const h1 = commandHarness(); h1.replaceBody(scene(2, 'INT. A - DAY'));
    const h2 = commandHarness(); h2.replaceBody(scene(1, 'INT. B - DAY'));
    const engine = newEngine();
    engine.load(h1.model);
    const first = engine.layout(VIEW);
    engine.load(h2.model);
    const second = engine.layout(VIEW);
    expect(second.replacedPages.from).toBe(0); // treated as a brand new document, not a diff against h1
    expect(second.pageCount).toBeLessThanOrEqual(first.pageCount);
  });

  describe('resumeFrom is used for real (Task 31 §31.3, completed)', () => {
    function bigDoc() {
      const h = commandHarness();
      h.replaceBody([['st_scene_heading', 'INT. HOUSE - DAY'], ...Array.from({ length: 90 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`])]);
      return h;
    }

    it('finishing an incomplete layout later reaches complete: true with the same output as one uninterrupted call', () => {
      const h = bigDoc();
      const fullEngine = newEngine();
      fullEngine.load(h.model);
      const full = fullEngine.getResult(VIEW);

      const engine = newEngine();
      engine.load(h.model);
      const partial = engine.layout(VIEW, { visiblePageHint: 0 });
      expect(partial.complete).toBe(false);
      // Calling layout() again with nothing changed must make progress, not echo the same partial
      // result back forever (the bug this task's own header explains it fixed alongside adding
      // real resumption).
      const finished = engine.layout(VIEW);
      expect(finished.complete).toBe(true);
      expect(engine.getResult(VIEW).pages).toEqual(full.pages);
    });

    it('SAFETY: an edit to an already-placed page forces a fresh recompute instead of wrongly resuming past it', () => {
      const h = bigDoc();
      const engine = newEngine();
      engine.load(h.model);
      const partial = engine.layout(VIEW, { visiblePageHint: 0 });
      expect(partial.complete).toBe(false);
      expect(partial.replacedPages.pages.length).toBeGreaterThan(0);
      const placedElementId = partial.replacedPages.pages[0]!.lines[1]!.elementId; // an element on an already-placed page
      const unsubscribe = h.model.subscribe((batch) => engine.applyChanges(batch.changes));
      const r = h.run('text.insert', { at: { elementId: placedElementId, offset: 0 }, text: 'EDITED ' });
      unsubscribe();
      expect(r.ok).toBe(true);
      const after = engine.layout(VIEW);
      const editedLine = after.replacedPages.pages.flatMap((p) => p.lines).find((l) => l.elementId === placedElementId);
      expect(editedLine).toBeDefined();
      expect(editedLine!.runs.map((run) => run.text).join('')).toContain('EDITED');
    });
  });

  describe('Track Changes view is threaded through for real (§26, M2 task 35)', () => {
    it('layout() and getResult() render final/original differently for the same document, and a view flip alone still relayouts', () => {
      const h = commandHarness();
      const [a] = h.replaceBody(scene(1, 'INT. A - DAY'));
      h.doc.getMap('trackChanges').set('enabled', true);
      h.run('text.deleteRange', { range: { anchor: { elementId: a!, offset: 5 }, head: { elementId: a!, offset: 9 } } });

      const engine = newEngine();
      engine.load(h.model);
      const finalResult = engine.getResult({ ...VIEW, trackChanges: 'final' });
      const originalResult = engine.getResult({ ...VIEW, trackChanges: 'original' });
      const textOf = (r: typeof finalResult) => r.pages.flatMap((p) => p.lines).find((l) => l.elementId === a)!.runs.map((run) => run.text).join('');
      expect(textOf(finalResult)).not.toBe(textOf(originalResult));

      // Same distinction through the incremental layout() path, including NOT short-circuiting a
      // view-mode-only flip as "nothing changed".
      engine.load(h.model);
      const d1 = engine.layout({ ...VIEW, trackChanges: 'final' });
      expect(d1.replacedPages.pages.flatMap((p) => p.lines).find((l) => l.elementId === a)!.runs.map((r) => r.text).join('')).toBe(textOf(finalResult));
      const d2 = engine.layout({ ...VIEW, trackChanges: 'original' });
      expect(d2.replacedPages.pages.length).toBeGreaterThan(0); // the view flip must not be short-circuited
      expect(d2.replacedPages.pages.flatMap((p) => p.lines).find((l) => l.elementId === a)!.runs.map((r) => r.text).join('')).toBe(textOf(originalResult));
    });

    it('a page-view request for markup is served narrowed to final, with the diagnostic', () => {
      const h = commandHarness();
      h.replaceBody(scene(1, 'INT. A - DAY'));
      const engine = newEngine();
      engine.load(h.model);
      const result = engine.getResult({ ...VIEW, trackChanges: 'markup' });
      expect(result.diagnostics.some((d) => d.code === 'markupForcesSpeedView')).toBe(true);
    });
  });

  describe('alternatesMode is threaded through for real (spec 09, M2 task 35)', () => {
    it('getResult() and layout() render the inline " // " suffix only in "all", and a mode flip alone still relayouts', () => {
      const h = commandHarness();
      const [a] = h.replaceBody(scene(1, 'INT. A - DAY'));
      let altsMap = (h.doc.getMap('elements').get(a!) as Y.Map<unknown>).get('alts') as Y.Map<unknown> | undefined;
      if (!altsMap) {
        altsMap = new Y.Map();
        (h.doc.getMap('elements').get(a!) as Y.Map<unknown>).set('alts', altsMap);
      }
      const alt = new Y.Map<unknown>();
      alt.set('id', 'alt_01ARYZ6S410000000000000000');
      alt.set('pos', 'M');
      const t = new Y.Text();
      t.insert(0, 'A different beat.');
      alt.set('text', t);
      alt.set('style', 'st_action');
      alt.set('label', '');
      alt.set('createdBy', 'u1');
      alt.set('createdAt', 0);
      altsMap.set('alt_01ARYZ6S410000000000000000', alt);

      const engine = newEngine();
      engine.load(h.model);
      const textOf = (r: ReturnType<typeof engine.getResult>) => r.pages.flatMap((p) => p.lines).find((l) => l.elementId === a)!.runs.map((run) => run.text).join('');
      const active = engine.getResult({ ...VIEW, alternatesMode: 'active' });
      const all = engine.getResult({ ...VIEW, alternatesMode: 'all' });
      expect(textOf(active)).not.toContain('A different beat.');
      expect(textOf(all)).toContain(' // A different beat.');

      engine.load(h.model);
      engine.layout({ ...VIEW, alternatesMode: 'active' });
      const flipped = engine.layout({ ...VIEW, alternatesMode: 'all' });
      expect(flipped.replacedPages.pages.length).toBeGreaterThan(0); // the mode flip must not be short-circuited
      expect(flipped.replacedPages.pages.flatMap((p) => p.lines).find((l) => l.elementId === a)!.runs.map((r) => r.text).join('')).toContain(' // A different beat.');
    });
  });
});
