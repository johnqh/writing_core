/**
 * Element -> page index over a `DocLayout` (spec 02 §29.5; M2 task 29, reduced to what the API projection needs).
 *
 * Adapted to the thin cut: it is built from `DocLayout` (not the plan's `LayoutResult`), so the plan's `buildIndex(pages)`
 * is `buildElementIndex(layout, model?)`; the `ElementLayoutIndex`/`LineRef` types are types.ts's (§29.5), and this index
 * adds `spanOf` and the per-scene page extent (`model` supplies the scene membership). Lookups are hash-map reads
 * (O(1), inside the O(log n) the spec asks for). Only body pages are indexed (title pages have no numbers), and only
 * `text` lines: a generated line (`(MORE)`, a synthesized cue, CONTINUED) belongs to no source range. NOT built here:
 * GlyphRun `clusterSource`, `drawNumbers` and `docVersion` (Task 29's remaining half, deferred).
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { DocLayout } from './layout-document.js';
import type { ElementLayoutIndex, LineRef } from './types.js';

export interface ElementPageSpan {
  elementId: ElementId;
  /** Body `DocPage.index` (0-based) of the first and last page the element has a text line on. */
  firstPage: number;
  lastPage: number;
  /** The printed page label of those pages (`12`, `12A`). */
  firstLabel: string;
  lastLabel: string;
  /** Distinct pages in order (a paragraph that splits across a page break has two). */
  pages: readonly number[];
  /** Every text line, page by page: `lineIndex` indexes `layout.pages[pageIndex].lines`. */
  lines: readonly LineRef[];
}

export interface SceneExtent {
  sceneId: ElementId;
  firstPage: number;
  lastPage: number;
  firstLabel: string;
  lastLabel: string;
  /** `12` when the scene sits on one page, else `12-13`. */
  pageLabel: string;
}

export interface DocElementIndex extends ElementLayoutIndex {
  /** Undefined for an element with no text line in the body (hidden, omitted, or unknown). */
  spanOf(elementId: ElementId): ElementPageSpan | undefined;
  /** Undefined for a scene with no laid-out text. An omitted scene keeps the page of its one OMITTED line. */
  sceneExtentOf(sceneId: ElementId): SceneExtent | undefined;
  /** Every scene extent, in document order. */
  sceneExtents(): readonly SceneExtent[];
}

const EMPTY: readonly never[] = Object.freeze([]);

export function buildElementIndex(layout: DocLayout, model?: DocumentModel): DocElementIndex {
  const lines = new Map<ElementId, LineRef[]>();
  const onPage: ElementId[][] = layout.pages.map(() => []);
  layout.pages.forEach((page, pageIndex) => {
    const seen = new Set<ElementId>();
    page.lines.forEach((l, lineIndex) => {
      if (l.kind !== 'text') return;
      const ref: LineRef = { pageIndex, lineIndex, sourceStart: l.sourceStart, sourceEnd: l.sourceEnd };
      const list = lines.get(l.elementId);
      if (list) list.push(ref);
      else lines.set(l.elementId, [ref]);
      if (!seen.has(l.elementId)) { seen.add(l.elementId); onPage[pageIndex]!.push(l.elementId); }
    });
  });

  const spans = new Map<ElementId, ElementPageSpan>();
  const labelOf = (pageIndex: number): string => layout.pages[pageIndex]!.label;
  for (const [elementId, refs] of lines) {
    const pages: number[] = [];
    for (const r of refs) if (pages[pages.length - 1] !== r.pageIndex) pages.push(r.pageIndex);
    const firstPage = pages[0]!;
    const lastPage = pages[pages.length - 1]!;
    spans.set(elementId, { elementId, firstPage, lastPage, firstLabel: labelOf(firstPage), lastLabel: labelOf(lastPage), pages, lines: refs });
  }

  const extents: SceneExtent[] = [];
  const extentById = new Map<ElementId, SceneExtent>();
  for (const scene of model?.scenes() ?? []) {
    let first = Infinity;
    let last = -1;
    for (const id of scene.elementIds) {
      const s = spans.get(id);
      if (!s) continue;
      if (s.firstPage < first) first = s.firstPage;
      if (s.lastPage > last) last = s.lastPage;
    }
    if (last < 0) continue;
    const firstLabel = labelOf(first);
    const lastLabel = labelOf(last);
    const extent: SceneExtent = { sceneId: scene.id, firstPage: first, lastPage: last, firstLabel, lastLabel, pageLabel: first === last || firstLabel === lastLabel ? firstLabel : `${firstLabel}-${lastLabel}` };
    extents.push(extent);
    extentById.set(scene.id, extent);
  }

  return {
    linesOf: (id) => lines.get(id) ?? EMPTY,
    elementsOnPage: (pageIndex) => onPage[pageIndex] ?? EMPTY,
    spanOf: (id) => spans.get(id),
    sceneExtentOf: (id) => extentById.get(id),
    sceneExtents: () => extents,
  };
}
