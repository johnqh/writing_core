/**
 * Spec 02 §30: source ↔ layout mapping (M2 task 30), as free functions over a `DocLayout` (the thin
 * cut — see `output.ts`'s own header comment — not the plan's fuller `LayoutResult`) plus the element
 * index `output.ts` already builds (`DocElementIndex.linesOf`, reused rather than re-scanning pages).
 * Task 31 (the engine) is the thing that would expose these as `LayoutEngine` methods; the logic lives
 * here so it exists once, per the plan's own note.
 *
 * Reduced scope, honestly: hidden-position resolution ("nearest visible") needs the document's element
 * ORDER, which a `DocLayout` alone does not carry (a hidden/omitted element has no line at all here,
 * by construction — `layoutDocument` already skips it) — a caller passing a position for an element with
 * no laid-out line gets `null` rather than a guessed nearest sibling; Task 31's engine, which does hold
 * the model, is the natural place to add that fallback. A generated line ((MORE), a synthesized
 * continuation cue, CONTINUED) resolves to the nearest real text line by vertical distance rather than
 * spec 02's exact "end of head / start of tail" rule, which needs continueds.ts's own block bookkeeping
 * that a `DocLayout` no longer carries once pagination is done. Selection/caret math is exact at cluster
 * granularity (every real caller already works in cluster/character offsets); an offset that falls
 * strictly inside a multi-UTF-16-unit cluster snaps to its nearest boundary rather than interpolating.
 */
import type { TextDirection } from '../schema/vocab.js';
import type { DocLayout, DocLine, DocPage } from './layout-document.js';
import type { DocElementIndex } from './output.js';
import type { CaretGeometry, GlyphRun, HitResult, ModelPosition, PagePoint, SelectionRect } from './types.js';

// ─── Per-line cluster geometry ────────────────────────────────────────────────

interface ClusterPoint {
  /** Source offset (element-relative, UTF-16), i.e. the cluster's LOGICAL start. */
  src: number;
  /** Physical x of the cluster's logical-start edge (its "before" caret position). */
  before: number;
  /** Physical x of the cluster's logical-end edge (its "after" caret position). */
  after: number;
  bidiLevel: number;
  run: GlyphRun;
}

/** Every cluster of a text line, in physical (visual) left-to-right order. Empty for a non-text line. */
function clusterPoints(line: DocLine): ClusterPoint[] {
  if (line.kind !== 'text') return [];
  const pts: ClusterPoint[] = [];
  for (const run of line.runs) {
    const n = run.clusters.length;
    const rtl = run.bidiLevel % 2 === 1;
    // Logical cluster 0 sits at the run's right edge for RTL (text flows right to left within the run),
    // its left edge for LTR; clusters are stored in logical order either way (paragraph.ts groups them
    // before visual reordering happens at the run level, not the cluster level).
    let leftCursor = run.x;
    let rightCursor = run.x + run.width;
    for (let k = 0; k < n; k++) {
      const adv = run.clusterAdvances[k] as number;
      const src = run.clusterSource[k] as number;
      if (rtl) {
        const left = rightCursor - adv;
        pts.push({ src, before: rightCursor, after: left, bidiLevel: run.bidiLevel, run });
        rightCursor = left;
      } else {
        const right = leftCursor + adv;
        pts.push({ src, before: leftCursor, after: right, bidiLevel: run.bidiLevel, run });
        leftCursor = right;
      }
    }
  }
  pts.sort((a, b) => Math.min(a.before, a.after) - Math.min(b.before, b.after));
  return pts;
}

/** Physical x for `offset` within `line` (element-relative, like `DocLine.sourceStart/sourceEnd`). */
function xAtOffset(line: DocLine, offset: number): { x: number; direction: TextDirection } {
  const pts = clusterPoints(line);
  if (pts.length === 0) return { x: line.x, direction: 'ltr' };
  const exact = pts.find((p) => p.src === offset);
  if (exact) return { x: exact.before, direction: exact.bidiLevel % 2 === 1 ? 'rtl' : 'ltr' };
  let minPt = pts[0]!;
  let maxPt = pts[0]!;
  for (const p of pts) {
    if (p.src < minPt.src) minPt = p;
    if (p.src > maxPt.src) maxPt = p;
  }
  if (offset >= maxPt.src) return { x: maxPt.after, direction: maxPt.bidiLevel % 2 === 1 ? 'rtl' : 'ltr' };
  if (offset <= minPt.src) return { x: minPt.before, direction: minPt.bidiLevel % 2 === 1 ? 'rtl' : 'ltr' };
  // Mid-cluster offset (documented simplification): snap to the nearest logical boundary.
  let best = pts[0]!;
  let bestDist = Math.abs(best.src - offset);
  for (const p of pts) {
    const d = Math.abs(p.src - offset);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return offset > best.src ? { x: best.after, direction: best.bidiLevel % 2 === 1 ? 'rtl' : 'ltr' } : { x: best.before, direction: best.bidiLevel % 2 === 1 ? 'rtl' : 'ltr' };
}

/** The reverse of `xAtOffset`: the offset (and its `GlyphRun`, for `HitResult.annotations`) nearest physical `x`. */
function offsetAtX(line: DocLine, x: number): { offset: number; run: GlyphRun | null } {
  const pts = clusterPoints(line);
  if (pts.length === 0) return { offset: line.sourceStart, run: null };
  let best = pts[0]!;
  let bestDist = Math.min(Math.abs(x - best.before), Math.abs(x - best.after));
  for (const p of pts) {
    const d = Math.min(Math.abs(x - p.before), Math.abs(x - p.after));
    if (d < bestDist) { best = p; bestDist = d; }
  }
  // Within the winning cluster, which of its two logical edges is `x` nearer to?
  if (Math.abs(x - best.after) < Math.abs(x - best.before)) {
    // Past this cluster's logical end: the next logical cluster's start, or the line's own end.
    let next: ClusterPoint | undefined;
    for (const p of pts) if (p.src > best.src && (!next || p.src < next.src)) next = p;
    return { offset: next ? next.src : line.sourceEnd, run: best.run };
  }
  return { offset: best.src, run: best.run };
}

// ─── §30.1 Caret geometry ─────────────────────────────────────────────────────

/** The `LineRef` for `pos`, honouring `affinity` at a soft-wrap (or any same-element) line boundary. */
function resolveLineRef(index: DocElementIndex, pos: ModelPosition, affinity: 'upstream' | 'downstream'): { pageIndex: number; lineIndex: number } | null {
  const refs = index.linesOf(pos.elementId);
  if (refs.length === 0) return null;
  const at = refs.filter((r) => pos.offset >= r.sourceStart && pos.offset <= r.sourceEnd);
  if (at.length === 0) return pos.offset < refs[0]!.sourceStart ? refs[0]! : refs[refs.length - 1]!;
  if (at.length === 1) return at[0]!;
  // Exactly at the boundary between two of the element's own lines: upstream = end of the earlier one,
  // downstream = start of the later one (refs are in document order, per `buildElementIndex`).
  return affinity === 'upstream' ? at[0]! : at[at.length - 1]!;
}

function lineAt(layout: DocLayout, ref: { pageIndex: number; lineIndex: number }): DocLine {
  return layout.pages[ref.pageIndex]!.lines[ref.lineIndex]!;
}

/** §30.1: caret geometry for a source position, at the given affinity (default `'downstream'`). */
export function positionToCaret(layout: DocLayout, index: DocElementIndex, pos: ModelPosition, affinity: 'upstream' | 'downstream' = 'downstream'): CaretGeometry | null {
  const ref = resolveLineRef(index, pos, affinity);
  if (!ref) return null;
  const line = lineAt(layout, ref);
  const { x, direction } = xAtOffset(line, pos.offset);
  return { pageIndex: ref.pageIndex, x, top: line.y, height: line.pitch, direction };
}

/** §30. The 1-based... no — the body page index (`DocPage.index`, 0-based) a source position falls on. */
export function pageOf(index: DocElementIndex, pos: ModelPosition): number | null {
  const refs = index.linesOf(pos.elementId);
  if (refs.length === 0) return null;
  const at = refs.find((r) => pos.offset >= r.sourceStart && pos.offset <= r.sourceEnd);
  return (at ?? (pos.offset < refs[0]!.sourceStart ? refs[0]! : refs[refs.length - 1]!)).pageIndex;
}

// ─── §30.2 Hit testing ────────────────────────────────────────────────────────

/** Lines sharing `line.y` on `page` — a dual/column block's sides, or just the one line otherwise. */
function rowAt(page: DocPage, y: number): DocLine[] {
  return page.lines.filter((l) => l.y === y);
}

/** The line, among `row`, whose x-range contains `x`, else the nearest one by edge distance. */
function pickInRow(row: readonly DocLine[], x: number): DocLine {
  const containing = row.find((l) => x >= l.x && x <= l.x + l.width);
  if (containing) return containing;
  let best = row[0]!;
  let bestDist = Math.min(Math.abs(x - best.x), Math.abs(x - (best.x + best.width)));
  for (const l of row) {
    const d = Math.min(Math.abs(x - l.x), Math.abs(x - (l.x + l.width)));
    if (d < bestDist) { best = l; bestDist = d; }
  }
  return best;
}

/** §30.2: the nearest source position (and, for a text hit, its run's annotations) to a page point. */
export function pointToPosition(layout: DocLayout, point: PagePoint): HitResult | null {
  const page = layout.pages[point.pageIndex];
  if (!page || page.lines.length === 0) return null;
  let bestLine = page.lines[0]!;
  let bestDist = Math.abs(point.y - bestLine.y);
  for (const l of page.lines) {
    const d = Math.abs(point.y - l.y);
    if (d < bestDist) { bestDist = d; bestLine = l; }
  }
  const row = rowAt(page, bestLine.y);
  const line = row.length > 1 ? pickInRow(row, point.x) : bestLine;
  if (line.kind !== 'text') {
    return { position: { elementId: line.elementId, offset: 0 }, affinity: 'downstream', inside: 'decoration', annotations: null };
  }
  const { offset, run } = offsetAtX(line, point.x);
  const inside = point.x < line.x || point.x > line.x + line.width ? 'margin' : 'text';
  const affinity = offset === line.sourceEnd ? 'upstream' : 'downstream';
  return { position: { elementId: line.elementId, offset }, affinity, inside, annotations: run?.annotations ?? null };
}

// ─── §30.3 Selection rectangles ───────────────────────────────────────────────

function ordinal(ref: { pageIndex: number; lineIndex: number }): number {
  return ref.pageIndex * 1_000_000 + ref.lineIndex;
}

/**
 * §30.3: one rect per covered text line, spanning the paragraph's own text edges (not the page) for a
 * fully covered line, and the exact offset-to-edge span for the two boundary lines; decoration lines in
 * between are skipped. `from`/`to` must already be in document order (this module holds no order of its
 * own to check it — the caller's model does).
 */
export function selectionRects(layout: DocLayout, index: DocElementIndex, from: ModelPosition, to: ModelPosition): SelectionRect[] {
  const fromRef = resolveLineRef(index, from, 'downstream');
  const toRef = resolveLineRef(index, to, 'upstream');
  if (!fromRef || !toRef) return [];
  const fromOrd = ordinal(fromRef);
  const toOrd = ordinal(toRef);
  const rects: SelectionRect[] = [];
  for (let p = fromRef.pageIndex; p <= toRef.pageIndex; p++) {
    const page = layout.pages[p]!;
    page.lines.forEach((line, lineIndex) => {
      const ord = ordinal({ pageIndex: p, lineIndex });
      if (ord < fromOrd || ord > toOrd) return;
      if (line.kind !== 'text') return;
      const isFirst = ord === fromOrd;
      const isLast = ord === toOrd;
      const leftX = isFirst ? xAtOffset(line, from.offset).x : line.x;
      const rightX = isLast ? xAtOffset(line, to.offset).x : line.x + line.width;
      const x = Math.min(leftX, rightX);
      const width = Math.max(1, Math.abs(rightX - leftX));
      rects.push({ pageIndex: p, x, y: line.y, width, height: line.pitch });
    });
  }
  return rects;
}

// ─── §30.4-ish vertical movement (goalX carried across successive calls) ──────

export interface VerticalMove {
  position: ModelPosition;
  goalX: number;
}

function moveVertical(layout: DocLayout, index: DocElementIndex, pos: ModelPosition, goalX: number | undefined, dir: -1 | 1): VerticalMove | null {
  const ref = resolveLineRef(index, pos, 'downstream');
  if (!ref) return null;
  const line = lineAt(layout, ref);
  const x = goalX ?? xAtOffset(line, pos.offset).x;
  let pageIndex = ref.pageIndex;
  let page = layout.pages[pageIndex]!;
  let lines = page.lines;
  let curY = line.y;
  for (;;) {
    const candidateY = dir < 0
      ? Math.max(...lines.filter((l) => l.y < curY).map((l) => l.y), -Infinity)
      : Math.min(...lines.filter((l) => l.y > curY).map((l) => l.y), Infinity);
    if (Number.isFinite(candidateY)) {
      const row = rowAt(page, candidateY);
      const target = pickInRow(row, x);
      if (target.kind === 'text') {
        const { offset } = offsetAtX(target, x);
        return { position: { elementId: target.elementId, offset }, goalX: x };
      }
      // A generated line in the target row: nearest real text line by vertical distance (documented above).
      const fallback = lines.reduce<DocLine | null>((best, l) => {
        if (l.kind !== 'text') return best;
        if (!best || Math.abs(l.y - candidateY) < Math.abs(best.y - candidateY)) return l;
        return best;
      }, null);
      if (fallback) {
        const { offset } = offsetAtX(fallback, x);
        return { position: { elementId: fallback.elementId, offset }, goalX: x };
      }
      curY = candidateY; // keep walking past an all-decoration row
      continue;
    }
    // Ran off this page: spill to the adjacent page's first/last row.
    pageIndex += dir;
    const next = layout.pages[pageIndex];
    if (!next || next.lines.length === 0) return null;
    page = next;
    lines = page.lines;
    curY = dir < 0 ? Infinity : -Infinity;
  }
}

/** §30: the position one visual row up from `pos`, preserving `goalX` across successive calls. */
export function positionAbove(layout: DocLayout, index: DocElementIndex, pos: ModelPosition, goalX?: number): VerticalMove | null {
  return moveVertical(layout, index, pos, goalX, -1);
}

/** §30: the position one visual row down from `pos`, preserving `goalX` across successive calls. */
export function positionBelow(layout: DocLayout, index: DocElementIndex, pos: ModelPosition, goalX?: number): VerticalMove | null {
  return moveVertical(layout, index, pos, goalX, 1);
}
