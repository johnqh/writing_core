/**
 * Element -> page index over a `DocLayout` (spec 02 §29.5; M2 task 29, reduced to what the API projection needs).
 *
 * Adapted to the thin cut: it is built from `DocLayout` (not the plan's `LayoutResult`), so the plan's `buildIndex(pages)`
 * is `buildElementIndex(layout, model?)`; the `ElementLayoutIndex`/`LineRef` types are types.ts's (§29.5), and this index
 * adds `spanOf` and the per-scene page extent (`model` supplies the scene membership). Lookups are hash-map reads
 * (O(1), inside the O(log n) the spec asks for). Only body pages are indexed (title pages have no numbers), and only
 * `text` lines: a generated line (`(MORE)`, a synthesized cue, CONTINUED) belongs to no source range.
 *
 * `docVersion` and `drawNumbers` (below): the rest of Task 29's original scope, filled in on top of the thin cut.
 * `GlyphRun.clusterSource` was already real and populated by `measure.ts`/`paragraph.ts` (case-expansion, generated
 * text) — the gap the earlier note meant was in this module's OWN test coverage, closed by a test here, not new code.
 */
import * as Y from 'yjs';
import { sha256Hex } from '../hash/sha256.js';
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { DocDecoration } from './decorate.js';
import type { DocLayout } from './layout-document.js';
import type { ElementLayoutIndex, LineRef, PositionedText } from './types.js';

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

/**
 * Spec 02 §29.1: "hash of the Yjs state vector the layout reflects." Computed here, never in `src/hash`
 * (that module owns spec 11 §4.2's versioned content hash, `HASH_VERSION` and the frozen `vectors.json` —
 * a different, unrelated value; this one is unversioned and carries no `v1:` prefix). Changes whenever the
 * document's content changes and is stable across a view-only relayout (a fresh `Y.encodeStateVector` on an
 * unchanged doc is byte-identical).
 */
export function docVersionOf(model: DocumentModel): string {
  return sha256Hex(Y.encodeStateVector(model.doc));
}

/**
 * §21.4: the numbers already drawn on this line by `sceneNumbersFor` (`decorate.ts` — left/right/both,
 * `hideRightOnOverlap`, RTL mirroring), reshaped from the page's flat `DocDecoration[]` into the typed
 * per-line home the plan's `LayoutLine.numbers` describes. Not a second placement implementation: a lookup
 * over the one that already exists, matched by `elementId` + `lineIndexInElement` (a scene number only ever
 * draws on an element's first line).
 */
export function drawNumbers(line: { elementId: ElementId; lineIndexInElement: number }, decorations: readonly DocDecoration[]): { left?: PositionedText; right?: PositionedText } {
  const out: { left?: PositionedText; right?: PositionedText } = {};
  if (line.lineIndexInElement !== 0) return out;
  for (const d of decorations) {
    if (d.kind !== 'sceneNumber' || d.elementId !== line.elementId) continue;
    if (d.slot !== 'left' && d.slot !== 'right') continue;
    const face = d.runs[0];
    out[d.slot] = { text: d.text, x: d.x, faceId: face?.faceId ?? '', sizeEmu: face?.sizeEmu ?? 0 };
  }
  return out;
}
