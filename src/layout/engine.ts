/**
 * Spec 02 §8.2 / §31 (M2 task 31): the layout engine — `load`/`applyChanges`/`layout`/`getResult` plus
 * Task 30's mapping functions, forwarded rather than reimplemented ("the logic exists once", per that
 * task's own header). Adapted to the thin cut established by Tasks 29/30: `getResult` and the internal
 * working state are `DocLayout`/`DocElementIndex` (`layout-document.ts`/`output.ts`), not the plan's
 * fuller `LayoutResult`/`ElementLayoutIndex` — nothing in this build populates that fuller structure,
 * and retrofitting it is a separate, larger undertaking than this task's own file list.
 *
 * How this honours §31, and the one pre-existing gap it does not (and was never asked to) close:
 * - §31.2 (paragraph cache): real — `paragraph.ts`'s own `cacheKey` (already reserved for this task via
 *   `keyPrefix`) plus `paragraph-cache.ts`'s `effectiveStyleHash`, wrapped in a genuine bounded LRU
 *   (`createParagraphCache`). A `layoutDocument` call given the same cache skips re-measuring any
 *   paragraph whose content, style, geometry and view mode are unchanged — the dominant cost per the
 *   spec's own architecture notes (§33), so this is the real source of "incremental" speed here.
 * - §31.4 (visible-first scheduling / time slicing): real — `paginate.ts`'s `stopAfter`/`resume` let a
 *   `layout()` call stop after `visiblePageHint + 2` pages or a `budgetMsPerSlice` deadline, returning
 *   `complete: false`; a later call resumes and finishes the job (§31.3, next). `getResult` never
 *   slices: it always runs to `complete: true`.
 * - §31.3 (page convergence, "reuse the remaining old pages"): real. `layoutDocument`'s `resumeFrom`
 *   (its own doc comment) genuinely continues S5 from where an earlier `complete: false` call left
 *   off — `layout()` here passes the previous call's own `getRawFilledPages` result back in whenever
 *   it is SAFE to (see `canResume` below): the view is unchanged and nothing has marked the engine
 *   dirty since. If either is false, the next call starts S5 over from page 0 (S1-S4 always rerun in
 *   full regardless; the real §31.2 paragraph cache is what keeps THAT cheap). `layout()`'s
 *   `LayoutDelta` is, on top of that, a genuine, verified DIFF against the previous result
 *   (`replacedPages` is computed by comparing the fresh pages to the old ones, never assumed).
 * - §31.1 (change classification): `applyChanges` reads spec 01 §10.3's `ModelChange` kinds and marks
 *   the engine dirty for every kind that can affect layout or decoration. It does not attempt the
 *   table's finer "decoration-only, no refill" distinction, because — again — every `layout()` call
 *   already recomputes fully; the distinction has no separate code path to exercise. A change kind with
 *   no possible layout effect (`tags`, `notes`, `beats`, `shots`, `smartType`, `bin`, `bookmarks`,
 *   `macros`, `folders`, `writers`) leaves the engine clean, so an unrelated edit costs nothing: `layout()`
 *   returns the SAME page objects (`replacedPages` empty), verified in `engine.test.ts`.
 * - View modes: `ViewSpec.trackChanges`/`revisionFilter`/`alternatesMode` are folded into the paragraph
 *   cache's `viewTextMode` key component, AND (task 35) both `trackChanges` and `alternatesMode` are
 *   passed through as `layoutDocument`'s own `trackChangesView`/`alternatesMode` on every call here —
 *   `final`/`simple`/`original` genuinely render differently (§26; `markup` is narrowed to `final` by
 *   `layoutDocument` itself, needing the speed view, §34.2, not built by this pipeline — see that
 *   file's own header), and `alternatesMode: 'all'` genuinely renders each element's inactive
 *   alternates inline (spec 09). `revisionFilter` (§25.4, which pages/sets are visible) is a
 *   post-pagination decoration pass (`applyRevisionDisplay`), not a paragraph-content concern, so it
 *   has no `layoutDocument` option of its own to thread through here.
 */
import type { DocumentModel } from '../read-model/open.js';
import type { ModelChange } from '../read-model/views.js';
import { buildElementIndex, type DocElementIndex } from './output.js';
import { docVersionOf } from './output.js';
import { getRawFilledPages, layoutDocument, type DocLayout, type DocPage } from './layout-document.js';
import type { FilledPage } from './paginate.js';
import { pointToPosition, positionAbove, positionBelow, positionToCaret, selectionRects, pageOf as pageOfImpl, type VerticalMove } from './mapping.js';
import { createParagraphCache, type SizedParagraphCache } from './paragraph-cache.js';
import type {
  CaretGeometry, FontRegistry, HitResult, LayoutDiagnostic, LayoutEngineOptions, ModelPosition, ModelRange, PagePoint, SelectionRect, Shaper, ViewSpec,
} from './types.js';

/** The thin-cut counterpart of spec 02 §31.4's `LayoutDelta` (`pages: DocPage[]`, not `PageLayout[]`). */
export interface DocLayoutDelta {
  docVersion: string;
  complete: boolean;
  pageCount: number;
  replacedPages: { from: number; to: number; pages: DocPage[] };
  removedPageCount: number;
  decorationsChanged: number[];
  diagnosticsChanged: boolean;
}

export interface LayoutEngine {
  load(model: DocumentModel): void;
  applyChanges(changes: readonly ModelChange[]): void;
  layout(view: ViewSpec, opts?: { visiblePageHint?: number }): DocLayoutDelta;
  /** Always complete (never sliced), for export/PDF/reports. */
  getResult(view: ViewSpec): DocLayout;
  positionToCaret(pos: ModelPosition, affinity?: 'upstream' | 'downstream'): CaretGeometry | null;
  pointToPosition(hit: PagePoint): HitResult | null;
  selectionRects(range: ModelRange): SelectionRect[];
  pageOf(pos: ModelPosition): number | null;
  positionAbove(pos: ModelPosition, goalX?: number): VerticalMove | null;
  positionBelow(pos: ModelPosition, goalX?: number): VerticalMove | null;
  diagnostics(): LayoutDiagnostic[];
}

/** §31.1's own table, reduced to the one bit this engine's `layout()` actually needs (see header): does this change kind ever affect what a page looks like? */
function isLayoutRelevant(change: ModelChange): boolean {
  switch (change.kind) {
    case 'elements': return change.inserted.length > 0 || change.removed.length > 0 || change.changed.length > 0 || change.reordered;
    case 'template': return true;
    case 'titlePage': return true;
    case 'production': return true; // lockedStyles/pageLocks/scenesLocked all reach the body or its badges
    case 'revisions': return true; // 'sets' changes revised-text styling; 'display'/'other' change page tint/labels
    case 'trackChanges': return true; // view-mode text, genuinely rendered differently now (§26, M2 task 35)
    case 'settings': return change.what === 'watermark';
    case 'entities': return true; // conservative: a character rename can change speaker keys (§31.1's own carve-out); cheap either way since a no-op relayout still just diffs to nothing
    case 'writers': return true; // §26 `simple` change bars read a writer's `color` by uid — a renamed/recoloured writer must relayout
    case 'tags': case 'notes': case 'folders': case 'beats': case 'shots':
    case 'smartType': case 'bin': case 'bookmarks': case 'macros':
      return false; // no thin-cut field these can change (GlyphRun.annotations is not populated — output.ts's own note)
  }
}

function viewTextModeOf(view: ViewSpec): string {
  return `${view.trackChanges}|${view.revisionFilter.kind}|${view.alternatesMode}`;
}

/** `JSON.stringify` equality: correct (typed arrays and all), simple, and not the hot path — the paragraph cache is. */
function samePage(a: DocPage, b: DocPage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffPages(oldPages: readonly DocPage[], newPages: readonly DocPage[]): { from: number; to: number; removedPageCount: number } {
  let from = 0;
  const minLen = Math.min(oldPages.length, newPages.length);
  while (from < minLen && samePage(oldPages[from]!, newPages[from]!)) from++;
  if (from === oldPages.length && from === newPages.length) return { from, to: from, removedPageCount: 0 };
  // Minimal replaced range: also match a common, unchanged SUFFIX (a mid-document edit that does not
  // shift anything after it — most single-page edits — leaves every later page untouched).
  let oldEnd = oldPages.length;
  let newEnd = newPages.length;
  while (oldEnd > from && newEnd > from && samePage(oldPages[oldEnd - 1]!, newPages[newEnd - 1]!)) {
    oldEnd--;
    newEnd--;
  }
  return { from, to: newEnd, removedPageCount: Math.max(0, (oldEnd - from) - (newEnd - from)) };
}

/** Page indices OUTSIDE the replaced range whose decorations alone changed (e.g. a `{Pages}` token, a revision label). */
function decorationsChanged(oldPages: readonly DocPage[], newPages: readonly DocPage[], skipFrom: number, skipTo: number): number[] {
  const out: number[] = [];
  const n = Math.min(oldPages.length, newPages.length);
  for (let i = 0; i < n; i++) {
    if (i >= skipFrom && i < skipTo) continue;
    if (JSON.stringify(oldPages[i]!.decorations) !== JSON.stringify(newPages[i]!.decorations)) out.push(i);
  }
  return out;
}

export function createLayoutEngine(opts: LayoutEngineOptions): LayoutEngine {
  const fonts: FontRegistry = opts.fonts;
  const shaper: Shaper | null = opts.shaper;
  const budgetMsPerSlice = opts.budgetMsPerSlice ?? 8;
  const paragraphCache: SizedParagraphCache = createParagraphCache(60 * 1024 * 1024);

  let model: DocumentModel | null = null;
  let dirty = true;
  let lastLayout: DocLayout | null = null;
  let lastIndex: DocElementIndex | null = null;
  let lastViewTextMode: string | null = null;
  let lastDiagnostics: LayoutDiagnostic[] = [];
  /** The raw pages behind `lastLayout`, for `layout()`'s own `resumeFrom` — see the file header. */
  let lastRawFilledPages: readonly FilledPage[] | null = null;

  const requireModel = (): DocumentModel => {
    if (!model) throw new Error('createLayoutEngine: load(model) must be called before use');
    return model;
  };

  const pinAround = (layout: DocLayout, index: DocElementIndex, hint: number | undefined): void => {
    if (hint === undefined) {
      const all = new Set<string>();
      for (let i = 0; i < layout.pages.length; i++) for (const id of index.elementsOnPage(i)) all.add(id);
      paragraphCache.pin(all);
      return;
    }
    const ids = new Set<string>();
    for (let i = Math.max(0, hint - 1); i <= hint + 3 && i < layout.pages.length; i++) for (const id of index.elementsOnPage(i)) ids.add(id);
    paragraphCache.pin(ids);
  };

  return {
    load(m: DocumentModel): void {
      model = m;
      dirty = true;
      lastLayout = null;
      lastIndex = null;
      lastViewTextMode = null;
      lastDiagnostics = [];
      lastRawFilledPages = null;
      paragraphCache.clear();
    },

    applyChanges(changes: readonly ModelChange[]): void {
      if (changes.some(isLayoutRelevant)) dirty = true;
    },

    layout(view: ViewSpec, opts2?: { visiblePageHint?: number }): DocLayoutDelta {
      const m = requireModel();
      const viewTextMode = viewTextModeOf(view);
      const docVersion = docVersionOf(m);
      const sameView = lastLayout !== null && viewTextMode === lastViewTextMode;

      // Truly nothing to do: same view, nothing changed, and the last result already covered the
      // whole document. An INCOMPLETE last result (`!lastLayout.complete`) always falls through to
      // do more work below instead — otherwise a caller asking to finish an earlier partial layout
      // would just get that same partial result echoed back forever.
      if (!dirty && sameView && lastLayout!.complete) {
        return {
          docVersion, complete: true, pageCount: lastLayout!.pages.length,
          replacedPages: { from: 0, to: 0, pages: [] }, removedPageCount: 0, decorationsChanged: [], diagnosticsChanged: false,
        };
      }

      // Safe to resume (§31.3, `layoutDocument`'s own doc comment on `resumeFrom`): the view has not
      // changed and nothing has marked the engine dirty since the incomplete result being continued.
      const canResume = !dirty && sameView && lastLayout !== null && !lastLayout.complete && lastRawFilledPages !== null;
      const template = m.template();
      const newLayout = layoutDocument(m, template, {
        fonts, shaper, paragraphCache, viewTextMode, trackChangesView: view.trackChanges, alternatesMode: view.alternatesMode,
        visiblePageHint: opts2?.visiblePageHint, budgetMs: budgetMsPerSlice,
        ...(canResume ? { resumeFrom: { priorPages: lastRawFilledPages!, state: lastLayout!.resume! } } : {}),
      });
      const newIndex = buildElementIndex(newLayout, m);
      pinAround(newLayout, newIndex, opts2?.visiblePageHint);

      // The diff is always against the FULL previous result, even when this call only resumed (i.e.
      // only computed a tail): `canResume`'s own prior pages are included unchanged in `newLayout`,
      // so a real diff still correctly reports them as unreplaced.
      const oldPages = lastLayout?.pages ?? [];
      const { from, to, removedPageCount } = diffPages(oldPages, newLayout.pages);
      const decosChanged = decorationsChanged(oldPages, newLayout.pages, from, to);
      const diagnosticsChanged = JSON.stringify(lastDiagnostics) !== JSON.stringify(newLayout.diagnostics);

      lastLayout = newLayout;
      lastIndex = newIndex;
      lastViewTextMode = viewTextMode;
      lastDiagnostics = newLayout.diagnostics;
      lastRawFilledPages = getRawFilledPages(newLayout) ?? null;
      dirty = false;

      return {
        docVersion, complete: newLayout.complete, pageCount: newLayout.pages.length,
        replacedPages: { from, to, pages: newLayout.pages.slice(from, to) },
        removedPageCount, decorationsChanged: decosChanged, diagnosticsChanged,
      };
    },

    getResult(view: ViewSpec): DocLayout {
      const m = requireModel();
      const template = m.template();
      const viewTextMode = viewTextModeOf(view);
      const newLayout = layoutDocument(m, template, { fonts, shaper, paragraphCache, viewTextMode, trackChangesView: view.trackChanges, alternatesMode: view.alternatesMode });
      const newIndex = buildElementIndex(newLayout, m);
      pinAround(newLayout, newIndex, undefined);
      lastLayout = newLayout;
      lastIndex = newIndex;
      lastViewTextMode = viewTextMode;
      lastDiagnostics = newLayout.diagnostics;
      lastRawFilledPages = getRawFilledPages(newLayout) ?? null;
      dirty = false;
      return newLayout;
    },

    positionToCaret(pos, affinity = 'downstream') {
      return lastLayout && lastIndex ? positionToCaret(lastLayout, lastIndex, pos, affinity) : null;
    },
    pointToPosition(hit) {
      return lastLayout ? pointToPosition(lastLayout, hit) : null;
    },
    selectionRects(range) {
      if (!lastLayout || !lastIndex || !model) return [];
      const ia = model.indexOf(range.anchor.elementId);
      const ih = model.indexOf(range.head.elementId);
      const [from, to] =
        ia < ih || (ia === ih && range.anchor.offset <= range.head.offset) ? [range.anchor, range.head] : [range.head, range.anchor];
      return selectionRects(lastLayout, lastIndex, from, to);
    },
    pageOf(pos) {
      return lastIndex ? pageOfImpl(lastIndex, pos) : null;
    },
    positionAbove(pos, goalX) {
      return lastLayout && lastIndex ? positionAbove(lastLayout, lastIndex, pos, goalX) : null;
    },
    positionBelow(pos, goalX) {
      return lastLayout && lastIndex ? positionBelow(lastLayout, lastIndex, pos, goalX) : null;
    },
    diagnostics(): LayoutDiagnostic[] {
      return lastLayout?.diagnostics ?? [];
    },
  };
}
