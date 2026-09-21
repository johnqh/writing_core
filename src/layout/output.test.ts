import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { layoutDocument } from './layout-document.js';
import { buildElementIndex } from './output.js';

const scene = (n: number, heading: string): [string, string][] => [
  ['st_scene_heading', heading],
  ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${heading} ${i}.`]),
];

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  const layout = layoutDocument(h.model);
  return { h, ids, layout, index: buildElementIndex(layout, h.model) };
}

describe('buildElementIndex', () => {
  it('maps each element to its pages and lines, and each page to its elements in order', () => {
    const { ids, layout, index } = build([...scene(2, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')]);
    expect(layout.pages).toHaveLength(1);
    expect(index.elementsOnPage(0)).toEqual(ids);
    const span = index.spanOf(ids[1]!)!;
    expect(span).toMatchObject({ firstPage: 0, lastPage: 0, firstLabel: '1', lastLabel: '1', pages: [0] });
    expect(index.linesOf(ids[1]!)).toEqual([{ pageIndex: 0, lineIndex: 1, sourceStart: 0, sourceEnd: 'Beat INT. A - DAY 0.'.length }]);
    expect(index.linesOf('el_missing' as never)).toEqual([]);
    expect(index.elementsOnPage(5)).toEqual([]);
  });

  it('gives a paragraph that breaks across a page both pages, with contiguous source ranges', () => {
    const long = Array.from({ length: 14 }, () => 'Sentence goes here.').join(' ');
    const rows: [string, string][] = [...scene(24, 'INT. A - DAY'), ['st_action', long], ['st_action', 'After.']];
    const { ids, layout, index } = build(rows);
    const split = ids.find((id) => (index.spanOf(id)?.pages.length ?? 0) > 1);
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(split).toBeDefined();
    const span = index.spanOf(split!)!;
    expect(span.lastPage).toBe(span.firstPage + 1);
    expect(span.lines[0]!.sourceStart).toBe(0);
    for (let i = 1; i < span.lines.length; i++) expect(span.lines[i]!.sourceStart).toBeGreaterThanOrEqual(span.lines[i - 1]!.sourceEnd - 1);
    expect(span.lines.at(-1)!.sourceEnd).toBe(long.length);
    expect(index.elementsOnPage(span.firstPage)).toContain(split);
    expect(index.elementsOnPage(span.lastPage)).toContain(split);
  });

  it('computes each scene page extent and label, and keeps an omitted scene at the one page its OMITTED line sits on', () => {
    const rows: [string, string][] = [...scene(30, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY'), ...scene(2, 'INT. C - DAY')];
    const { h, ids, layout } = build(rows);
    expect(layout.pages).toHaveLength(2);
    expect(h.run('scene.setOmitted', { scene: ids[31], omitted: true }).ok).toBe(true);
    const index = buildElementIndex(layoutDocument(h.model), h.model);
    const [a, b, c] = h.model.scenes();
    expect(index.sceneExtentOf(a!.id)).toMatchObject({ firstPage: 0, lastPage: 1, pageLabel: '1-2' });
    expect(index.sceneExtentOf(b!.id)).toMatchObject({ firstPage: 1, lastPage: 1, pageLabel: '2' });
    expect(index.spanOf(ids[32]!)).toBeUndefined(); // the omitted scene's body is not laid out
    expect(index.sceneExtentOf(c!.id)).toMatchObject({ firstPage: 1, lastPage: 1, pageLabel: '2' });
    expect(index.sceneExtents().map((e) => e.sceneId)).toEqual([a!.id, b!.id, c!.id]);
  });

  it('excludes generated lines from element ranges', () => {
    const { layout, ids } = build(scene(3, 'INT. A - DAY'));
    const page = layout.pages[0]!;
    page.lines.push({ ...page.lines[1]!, kind: 'more' });
    const index = buildElementIndex(layout);
    expect(index.linesOf(ids[1]!)).toHaveLength(1);
  });

  it('answers over a 3000-element document', () => {
    const rows: [string, string][] = [];
    for (let s = 0; s < 100; s++) rows.push(...scene(29, `INT. R${s} - DAY`));
    const { h, ids, layout } = build(rows);
    const t0 = performance.now();
    const index = buildElementIndex(layout, h.model);
    const build_ms = performance.now() - t0;
    expect(ids).toHaveLength(3000);
    expect(layout.pages.length).toBeGreaterThan(50);
    const total = layout.pages.reduce((n, p, i) => n + index.elementsOnPage(i).length, 0);
    expect(total).toBeGreaterThanOrEqual(3000);
    const t1 = performance.now();
    for (let r = 0; r < 20; r++) for (const id of ids) index.linesOf(id);
    expect(performance.now() - t1).toBeLessThan(500);
    expect(build_ms).toBeLessThan(2000);
    expect(index.sceneExtents()).toHaveLength(100);
    const last = index.sceneExtents().at(-1)!;
    expect(last.lastPage).toBe(layout.pages.length - 1);
  });
});
