/**
 * `layoutDocument`: the seam the editor's page view draws from. Runs, in order, the stages built
 * so far — numbering, context pass (S2), paragraph layout (S3), block formation (S4) and the
 * paginator (S5) — and returns plain data: pages of lines, each carrying its element id, source
 * offset range, x/width/y in EMU and 1-based page number.
 *
 * Runs after pagination (never affecting it): the title page (§19; `titlePages`, unnumbered, kept apart from
 * the body `pages`), headers/footers (§20) and scene numbers in the margins (§21.4), as `decorations` on each page.
 *
 * Continueds (§14: `(MORE)`, synthesized `NAME (CONT'D)` cues, scene CONTINUED) and dual dialogue (§15, side by
 * side per `dualGeometry`, or stacked when `dualDialogue.enabled` is false) are paginated here: their lines
 * come back in `DocPage.lines` with a `kind` other than `text` (generated, not editable) and, inside a dual
 * block, a `dualSide`; a dual side's `x`/`width` already carry the column geometry.
 *
 * Revision display (§25, `revisions.ts`): margin marks on lines, page set/label/tint, and a header label decoration.
 *
 * Page locks (§24, `locks.ts`): anchors snap to block starts and force a break; overflow pages get A labels (`DocPage.label`).
 *
 * Column blocks (§16, `columns.ts`): rows of two stacks side by side (`DocLine.column`, x from the styles' own indents).
 * Graphic-novel panels (§17, `panels.ts`): generated `PAGE ONE (TWO PANELS)` headings, inline `Panel n.` labels and the
 * `PAGE n (CONT'D)` line atop a script page that continues a comic page.
 *
 * Track Changes display (§26, M2 task 35): `options.trackChangesView` (`final`/`simple`/`original`;
 * `markup` is narrowed to `final` here with a `markupForcesSpeedView` diagnostic, since page mode has
 * nowhere to put a deletion's now-extra-space text — `markup` needs the speed view, §34.2, which this
 * pipeline does not implement). Element-level hiding (`tc.kind === 'delete'|'insert'`, skipped the same
 * way as `ctx.hidden` below) and `tc.kind === 'style'`'s `fromStyle` substitution (`original` only) are
 * this function's own job — `makeDisplayText`/`layoutParagraph` only ever see an element already
 * decided should lay out, in the style it should lay out in. `simple` additionally marks
 * `DocLine.changeBar` on any line whose source range holds a live `ins`/`del`/`fmt` run mark or whose
 * element carries a `tc` record.
 *
 * Task 31 (§31.2-§31.4): `options.paragraphCache` skips re-measuring any unchanged paragraph;
 * `options.resumeFrom` genuinely continues S5 from an earlier `complete: false` call's own raw pages
 * (`getRawFilledPages`) instead of restarting it — S1-S4 above always rerun in full either way, so the
 * cache is what actually keeps a resumed call cheap for the part it does NOT have to redo. `engine.ts`
 * is the intended caller for both; a resumed call's caller owns the one thing this function cannot
 * verify itself — that nothing on an already-placed page's own elements changed since the call that
 * produced `resumeFrom.priorPages` (see `LayoutDocumentOptions.resumeFrom`'s own doc comment).
 *
 * `options.alternatesMode` (spec 09, M2 task 35): `'all'` passes through to the context pass
 * (`decorationHash` folds in each element's inactive alternates' text) and `makeDisplayText` (each
 * renders inline as ` // ` + its text, a non-editable generated suffix); defaults to `'active'`.
 */
import type { ElementId } from '../ids/ids.js';
import { createFontRegistry } from '../fonts/registry.js';
import { assignNumbers } from '../numbering/assign.js';
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { TrackChangeView } from '../schema/vocab.js';
import { resolveStyle, type ResolvedStyle } from '../template/resolve.js';
import { formBlocks, paraFlags, type BlockPara } from './blocks.js';
import { contextPass } from './context.js';
import type { AttrRun } from './itemize.js';
import { hiddenMarkFor, layoutParagraph, makeDisplayText, type ParaLine, type ParagraphCache } from './paragraph.js';
import { effectiveStyleHash } from './paragraph-cache.js';
import { pageGeometryOf, paginate, type FilledPage, type PaginateResumePoint, type PaginationParams } from './paginate.js';
import { LAYOUT_ENGINE_VERSION } from './round.js';
import type { FontRegistry, GlyphRun, LayoutDiagnostic, LineKind, Shaper } from './types.js';
import { makeContinueds } from './continueds.js';
import { dualGeometry, dualSideBox } from './dual.js';
import { applyRevisionDisplay, type LineRevisionMark } from './revisions.js';
import { headerFooterFor, revisionLabelDecoration, sceneNumbersFor, type DecorateEnv, type DocDecoration } from './decorate.js';
import { layoutTitlePages } from './title-page.js';
import { applyPanelText, pageContdLine, panelHeadings } from './panels.js';
import { forceBreaks, labelPages, resolveLocks, type ResolvedLocks } from './locks.js';
import type { NumberLabel } from '../schema/template.js';

export type { DocDecoration } from './decorate.js';

export interface LayoutDocumentOptions {
  fonts?: FontRegistry;
  shaper?: Shaper | null;
  /** `{date}` in headers/footers, epoch ms; defaults to the model's injected clock. */
  renderTimeMs?: number;
  /** `{filename}` in headers/footers. */
  filename?: string;
  /** `lineAdjust.deltaRight` per element, replacing the stored one (what-if layout for Auto Adjust Lines, §28.2). */
  lineAdjustOverrides?: ReadonlyMap<ElementId, number>;
  /** Task 31 (§31.2): shared across calls (by the caller) to skip re-measuring unchanged paragraphs. */
  paragraphCache?: ParagraphCache;
  /** Task 31: `keyPrefix`'s third component (Track Changes / alternates display mode); defaults to `'final'`. */
  viewTextMode?: string;
  /**
   * Spec 02 §26 (M2 task 35): which Track Changes view to render; defaults to `'final'`. `'markup'` is
   * narrowed to `'final'` for page-mode layout (see this file's own header) with a
   * `markupForcesSpeedView` diagnostic — real `markup` rendering needs the speed view (§34.2), not
   * built by this pipeline.
   */
  trackChangesView?: TrackChangeView;
  /** Spec 09 (M2 task 35): `'all'` renders each element's inactive alternates inline (`text // alt1 // alt2`); defaults to `'active'`. */
  alternatesMode?: 'active' | 'all';
  /**
   * Task 31 (§31.4): stop once at least this many pages past the hint are placed, returning
   * `complete: false` and a `resume` a later call's `budgetMs`/`visiblePageHint` can pick up from
   * (paired with a real `paragraphCache`, that later call is cheap for the pages already placed).
   */
  visiblePageHint?: number;
  /** Task 31 (§31.4): stop once this many milliseconds of wall-clock time have been spent filling pages. */
  budgetMs?: number;
  /**
   * `budgetMs`'s own time source (epoch ms), injectable so it stays platform-free (this package
   * references no host clock directly — spec 02 §1.1, `__guards/platform-free.test.ts`) and so tests
   * can drive the deadline deterministically. Defaults to `model.deps.clock`.
   */
  clock?: () => number;
  /**
   * Task 31 (§31.3): genuine cross-call resumption of an earlier `complete: false` result — S5
   * (pagination) picks up at `state.blockIndex` instead of restarting from page 0, appending only
   * the newly-placed pages to `priorPages` (S1-S4 still run over the WHOLE current document every
   * call; the real §31.2 cache is what keeps that cheap — S5 alone is what this actually resumes).
   * `priorPages` is the previous call's own returned `DocLayout.pages`... no: it is that call's raw
   * `FilledPage[]` (from `getRawFilledPages` below), not the public `DocPage[]` — the public shape
   * has already dropped the fields (`startState`, undecorateed `decor`) a further resume needs.
   *
   * **The caller's own responsibility, not something this function can check:** `priorPages` must
   * still be correct — i.e. nothing on an already-placed page's own elements changed since the call
   * that produced them. `layoutDocument` re-runs S1-S4 fully every time (so a change AFTER the
   * resume frontier is always reflected correctly in the newly-placed pages), but it does not, and
   * cannot, re-verify that a PRIOR page is still accurate — that would mean re-pagination from
   * scratch, defeating the point. `engine.ts` upholds this by only ever resuming when nothing
   * (`applyChanges`) has marked the engine dirty since the incomplete result it is resuming from.
   */
  resumeFrom?: { priorPages: readonly FilledPage[]; state: PaginateResumePoint };
}

/** Task 31 (§31.3): the raw `FilledPage[]` behind a `DocLayout`'s `resume`-eligible result, for a
 *  caller that wants to pass it back in as `LayoutDocumentOptions.resumeFrom.priorPages`. Kept out of
 *  `DocLayout` itself (which stays the public, already-decorated shape) via a side channel keyed by
 *  the exact `DocLayout` object `layoutDocument` just returned. */
const rawFilledPagesOf = new WeakMap<DocLayout, FilledPage[]>();
export function getRawFilledPages(layout: DocLayout): readonly FilledPage[] | undefined {
  return rawFilledPagesOf.get(layout);
}

export interface DocLine {
  elementId: ElementId;
  lineIndexInElement: number;
  /** UTF-16 offsets into the element's source text. */
  sourceStart: number;
  sourceEnd: number;
  /** EMU from the page's left edge. */
  x: number;
  width: number;
  /** EMU from the page's top edge (top of the line box), plus the baseline and pitch. */
  y: number;
  baseline: number;
  pitch: number;
  /** 1-based. */
  pageNumber: number;
  runs: GlyphRun[];
  /** `text` for a source line; `more`, `contdCue`, `continuedTop` and `continuedBottom` are generated (§14.2). */
  kind: LineKind;
  /** The side of a dual dialogue block this line belongs to (§15), else null. */
  dualSide: 'left' | 'right' | null;
  /** The column (§16) of a line inside a column row (AV / BBC), else 0. Its `x` already carries the column geometry. */
  column: 0 | 1 | 2;
  /** Revision mark drawn in the right margin (§25.5), when the line holds a visible revised run or deletion. */
  revisionMark?: LineRevisionMark;
  /** Spec 02 §26: `simple` view only — a writer-coloured margin rule on a line touching any tracked change. */
  changeBar?: { writerColor: string } | null;
}

export interface DocPage {
  /** 'title' pages are unnumbered (`number` 0) and live in `DocLayout.titlePages`. */
  kind: 'body' | 'title';
  /** 1-based physical body page; 0 for a title page. */
  number: number;
  index: number;
  /** The page-number text `{page}` renders: `pageNumbering.start + index`, or the locked label (`12A`, `2-3`); empty on a title page. */
  label: string;
  /** Locked pages (spec 02 §24): the structural label, the lock record starting this page (null on an A page or unlocked), and 0 / k for the k-th A page. */
  numberLabel?: NumberLabel | null;
  lockId?: string | null;
  overflow?: number;
  lines: DocLine[];
  /** Revision display (§25.4): the highest visible set on the page, its printed-paper tint (when `showPageColor`) and header label. */
  revisionSetId?: string | null;
  pageColor?: string | null;
  revisionLabel?: string | null;
  /** Every set holding a mark on this page, whatever the display filter (Revised Pages list). */
  revisedSetIds?: string[];
  /** Header/footer slot lines and scene numbers, drawn in the margins. */
  decorations: DocDecoration[];
}

export interface DocLayout {
  pageSize: { width: number; height: number };
  bodyTop: number;
  bodyBottom: number;
  /** Title page(s), before page 1; empty when the title page has no content. */
  titlePages: DocPage[];
  pages: DocPage[];
  diagnostics: LayoutDiagnostic[];
  /**
   * Task 31 (§31.4): `false` when `visiblePageHint`/`budgetMs` cut pagination short — `pages` then
   * holds only the placed prefix, and `resume` is where a later call (with a bigger hint/budget)
   * should pick up from. Body page LABELS in a `complete: false` result are provisional: they reflect
   * only the pages placed so far (the eventual total, and hence any lock/lettering that depends on it,
   * is not yet known) — the spec's own "page count display shows ~118" language for exactly this case.
   */
  complete: boolean;
  resume: PaginateResumePoint | null;
}

let defaultFonts: FontRegistry | null = null;

/**
 * `at` is over the SAME (hidden-run-filtered) text `filterTrackChanges` produces for this view — an
 * `AttrRun` for a run after a hidden one must not carry the hidden run's now-removed length, or every
 * attribute (bold, colour, the `ins`/`fmt` marks themselves) downstream of a deletion would itemize
 * against the wrong offsets.
 */
function attrRuns(el: ElementView, view: TrackChangeView): AttrRun[] {
  const hidden = hiddenMarkFor(view);
  const out: AttrRun[] = [];
  let at = 0;
  for (const r of el.text.runs) {
    if (hidden !== null && r.attrs[hidden] !== undefined && r.attrs[hidden] !== null) continue;
    if (Object.keys(r.attrs).length > 0) out.push({ start: at, end: at + r.text.length, attrs: r.attrs });
    at += r.text.length;
  }
  return out;
}

/** Run ranges (full, unfiltered source offsets) carrying a live `ins`/`del`/`fmt` mark, plus who made it — spec 02 §26 `simple` change bars. */
function changeRunsOf(el: ElementView): { start: number; end: number; by: string }[] {
  const out: { start: number; end: number; by: string }[] = [];
  let at = 0;
  for (const r of el.text.runs) {
    const mark = (r.attrs.ins ?? r.attrs.del ?? r.attrs.fmt) as { by?: string } | undefined;
    if (mark) out.push({ start: at, end: at + r.text.length, by: mark.by ?? '' });
    at += r.text.length;
  }
  return out;
}

export function layoutDocument(model: DocumentModel, templateIn?: EmbeddedTemplateJSON, options: LayoutDocumentOptions = {}): DocLayout {
  const template = templateIn ?? model.template();
  const fonts = options.fonts ?? (defaultFonts ??= createFontRegistry());
  const shaper = options.shaper ?? null;
  const lang = model.meta().language;
  // Spec 02 §26: `markup` has nowhere to lay out a deletion's now-extra-space text in page mode (this
  // pipeline's only mode, `paginate.ts`'s own header) — narrowed to `final` with a diagnostic, exactly
  // as the spec's own "served as speed view" language describes for a page-view request.
  const requestedTcView: TrackChangeView = options.trackChangesView ?? 'final';
  const tcView: TrackChangeView = requestedTcView === 'markup' ? 'final' : requestedTcView;
  const alternatesMode = options.alternatesMode ?? 'active';
  const numbers = assignNumbers(model);
  const { contexts, order } = contextPass(model, template, numbers, { alternatesMode });
  const referenceSizePt = resolveStyle(template, template.defaults.root).font.size;
  applyPanelText(contexts, panelHeadings({ model, template, contexts, numbers, renderTimeMs: options.renderTimeMs ?? model.deps.clock() }));

  const byId = new Map<ElementId, ElementView>();
  for (const el of model.elements()) byId.set(el.id, el);
  const styles = new Map<ElementId, ResolvedStyle>();
  const styleOf = (el: ElementView): ResolvedStyle => {
    let s = styles.get(el.id);
    if (!s) {
      // §26 `original`: a `tc.kind: 'style'` element (spec 01 §5.10.4's `element.setStyle` write)
      // resolves against the style it changed FROM, as if the change were rejected.
      const styleId = tcView === 'original' && el.tc?.kind === 'style' && el.tc.fromStyle ? el.tc.fromStyle : el.style;
      styles.set(el.id, (s = resolveStyle(template, styleId, el.ov)));
    }
    return s;
  };
  const displayText = makeDisplayText(model, template, contexts, styleOf, lang, tcView, alternatesMode);
  // Task 31 (§31.2): one hash per distinct resolved style object (not per element — many elements
  // share one), and `keyPrefix`'s three document-wide components.
  const styleHashes = new WeakMap<ResolvedStyle, string>();
  const styleHashOf = (style: ResolvedStyle): string => {
    let h = styleHashes.get(style);
    if (h === undefined) styleHashes.set(style, (h = effectiveStyleHash(style)));
    return h;
  };
  // `viewTextMode`, when the caller supplies it (`engine.ts` always does), is the fuller
  // `trackChanges|revisionFilter|alternatesMode` key; `tcView` alone is still the correct fallback so a
  // direct `layoutDocument({ trackChangesView })` call (no `viewTextMode`) never collides its cache
  // entries with a different view's.
  const keyPrefix = `${fonts.version}|${LAYOUT_ENGINE_VERSION}|${options.viewTextMode ?? tcView}`;

  const diagnostics: LayoutDiagnostic[] = [];
  if (requestedTcView === 'markup') diagnostics.push({ code: 'markupForcesSpeedView', elementId: null, pageIndex: null, detail: {} });
  const paras: BlockPara[] = [];
  const dualOn = template.pagination.dualDialogue.enabled;
  const dualGeom = dualOn ? dualGeometry(template) : null;
  // A dual side is only laid out in its column when its group has both sides (otherwise it stacks as ordinary dialogue).
  const groupSides = new Map<string, Set<string>>();
  if (dualOn) for (const el of model.elements()) if (el.dual) (groupSides.get(el.dual.group) ?? groupSides.set(el.dual.group, new Set()).get(el.dual.group)!).add(el.dual.side);
  for (const id of order) {
    const el = byId.get(id) as ElementView;
    const ctx = contexts.get(id)!;
    if (ctx.hidden) continue;
    // §26 element-level hiding: `final`/`simple` show the accepted state (deletions gone), `original`
    // the rejected one (insertions gone) — analogous to `ctx.hidden` above, just view-conditional.
    if ((tcView === 'final' || tcView === 'simple') && el.tc?.kind === 'delete') continue;
    if (tcView === 'original' && el.tc?.kind === 'insert') continue;
    const style = styleOf(el);
    const layout = layoutParagraph({
      elementId: id, displayText, attrs: attrRuns(el, tcView), style, category: ctx.category, page: template.page, referenceSizePt, lang, fonts, shaper,
      lineAdjustDeltaRight: options.lineAdjustOverrides?.get(id) ?? el.lineAdjust?.deltaRight, decorationHash: ctx.decorationHash,
      geometry: dualGeom && el.dual && groupSides.get(el.dual.group)?.size === 2 ? dualSideBox(dualGeom, ctx.category, el.dual.side) : undefined,
      keyPrefix, styleHash: styleHashOf(style), cache: options.paragraphCache,
    });
    diagnostics.push(...layout.diagnostics);
    paras.push({
      layout, ctx, style, flags: paraFlags(style, ctx.category, { actBreakStartsPage: template.pagination.actBreakStartsPage, dualGroup: el.dual?.group ?? null }),
    });
  }

  const blocks = formBlocks(paras, { dual: dualOn });
  // Page locks (§24): resolve anchors to blocks and force a break at each; labels are assigned after pagination.
  const production = model.productionState();
  let lockRes: ResolvedLocks | null = null;
  if (production.pagesLocked && production.pageLocks.length > 0) {
    lockRes = resolveLocks(production.pageLocks, blocks, model.elements(), template.pageNumbering.suffixMode);
    if (lockRes.live.length === 0) lockRes = null;
    else forceBreaks(blocks, lockRes.live);
  }
  const geometry = pageGeometryOf(template.page);
  const pg = template.pagination;
  const params: PaginationParams = {
    breakOnSentences: pg.breakOnSentences,
    dialoguePageBreaks: pg.dialogue.allowBreaks,
    minLinesBeforeBreak: pg.widowOrphan.minLinesAtPageBottom,
    minLinesAfterBreak: pg.widowOrphan.minLinesAtPageTop,
    dialogueMinLinesBeforeBreak: pg.dialogue.minLinesBeforeBreak,
    dialogueMinLinesAfterBreak: pg.dialogue.minLinesAfterBreak,
    minLinesWithHeading: pg.keepWithNextMinLines,
    columnBlocksSplit: pg.columnBlocks.breakBlocks,
  };
  const continueds = makeContinueds({
    template, fonts, shaper, lang, referenceSizePt,
    sideGeometry: dualGeom ? (category, side) => dualSideBox(dualGeom, category, side) : null,
  });
  const lineEnv = { template, fonts, shaper, lang, referenceSizePt };
  // Task 31 (§31.3/§31.4): resumed calls pick up S5 at `resumeFrom.state.blockIndex`; either way this
  // is one `paginate()` call that may stop early, and the real §31.2 paragraph cache is what makes a
  // later, bigger-budget call cheap for the pages already placed (S1-S4 above always reran in full).
  const priorPages = options.resumeFrom?.priorPages ?? [];
  const clock = options.clock ?? model.deps.clock;
  const stopAfterPages = options.visiblePageHint !== undefined ? Math.max(options.visiblePageHint + 2 - priorPages.length, 0) : undefined;
  const deadline = options.budgetMs !== undefined ? clock() + options.budgetMs : null;
  const stopAfter =
    stopAfterPages !== undefined || deadline !== null
      ? (pagesSoFarThisCall: number): boolean => (stopAfterPages !== undefined && pagesSoFarThisCall >= stopAfterPages) || (deadline !== null && clock() >= deadline)
      : undefined;
  const filled = paginate(
    blocks, geometry, params,
    { continueds: template.layoutMode === 'panels' ? { ...continueds, pageContd: (h) => pageContdLine(lineEnv, h) } : continueds },
    options.resumeFrom?.state, { stopAfter },
  );
  diagnostics.push(...filled.diagnostics);
  const complete = filled.resume === null;

  // A scene-bottom decoration due on the page that closed the PRIOR chunk: that page was already
  // returned by an earlier call, so `paginate()` could not write it directly (`paginate.ts`'s own doc
  // comment on `retroactiveSceneBottom`) — applied here, onto the caller's own retained copy.
  if (filled.retroactiveSceneBottom && priorPages.length > 0) {
    const lastPrior = priorPages[priorPages.length - 1] as FilledPage;
    lastPrior.decor.push(...filled.retroactiveSceneBottom);
  }
  const offset = priorPages.length;
  const allFilled: FilledPage[] = [...priorPages, ...filled.pages.map((fp) => ({ ...fp, index: fp.index + offset }))];

  // §26 `simple`: a writer-coloured change bar on any real (non-generated) line touching a tracked
  // change — the whole element (a tracked insert or style change: `el.tc`) or a run-level `ins`/`del`/
  // `fmt` mark overlapping the line's own source range. Cached per element since one element usually
  // spans several lines.
  const changeRunsCache = new Map<ElementId, { start: number; end: number; by: string }[]>();
  const writerColorOf = (by: string): string => model.writers().find((w) => w.uid === by)?.color ?? '#000000';
  const changeBarFor = (elementId: ElementId, sourceStart: number, sourceEnd: number): { writerColor: string } | null => {
    const el = byId.get(elementId);
    if (!el) return null;
    if (el.tc) return { writerColor: writerColorOf(el.tc.by) };
    let runs = changeRunsCache.get(elementId);
    if (!runs) changeRunsCache.set(elementId, (runs = changeRunsOf(el)));
    const hit = runs.find((r) => r.start < sourceEnd && r.end > sourceStart);
    return hit ? { writerColor: writerColorOf(hit.by) } : null;
  };

  const pages: DocPage[] = allFilled.map((fp) => ({
    kind: 'body' as const,
    number: fp.index + 1,
    index: fp.index,
    label: '',
    decorations: [] as DocDecoration[],
    // Body lines and page-level generated lines, top to bottom (stable, so a dual block's sides keep their order).
    lines: [...fp.lines, ...fp.decor].sort((a, b) => a.y - b.y).map((pl): DocLine => {
      const line: ParaLine = pl.line;
      const generated = pl.kind !== undefined;
      return {
        elementId: pl.elementId, lineIndexInElement: pl.lineIndexInElement, sourceStart: generated ? 0 : line.sourceStart, sourceEnd: generated ? 0 : line.sourceEnd,
        x: line.x, width: line.width, y: geometry.bodyTop + pl.y, baseline: geometry.bodyTop + pl.y + (line.baseline - line.top),
        pitch: line.pitch, pageNumber: fp.index + 1, runs: line.runs, kind: pl.kind ?? 'text', dualSide: pl.dualSide ?? null, column: pl.column ?? 0,
        changeBar: tcView === 'simple' && !generated ? changeBarFor(pl.elementId, line.sourceStart, line.sourceEnd) : null,
      };
    }),
  }));

  const env: DecorateEnv = {
    model, template, fonts, shaper, lang, referenceSizePt, renderTimeMs: options.renderTimeMs ?? model.deps.clock(), filename: options.filename,
  };
  applyRevisionDisplay(model, pages);
  const start = template.pageNumbering.start;
  const locked = lockRes ? labelPages(allFilled, lockRes, template.pageNumbering.suffixMode, template.pageNumbering.skipIO, template.pageNumbering.combineDeletedRanges) : null;
  for (const p of pages) {
    p.label = locked?.[p.index]?.label ?? String(start + p.index);
    if (locked?.[p.index]) {
      const info = locked[p.index]!;
      p.numberLabel = info.numberLabel;
      p.lockId = info.lockId;
      p.overflow = info.overflow;
    }
    const first = p.lines[0]?.elementId ?? null;
    p.decorations.push(
      ...headerFooterFor(env, { index: p.index, label: p.label, firstElementId: first, isTitle: false, revisionName: p.revisionLabel ?? null }, pages.length, contexts, numbers, diagnostics),
      ...sceneNumbersFor(env, p.lines, contexts, numbers, (id) => styleOf(byId.get(id) as ElementView)),
    );
    if (p.revisionLabel) {
      const set = model.revisionState().sets.find((s) => s.id === p.revisionSetId);
      const deco = revisionLabelDecoration(env, p.revisionLabel, set?.textColor ?? null, p.decorations);
      if (deco) p.decorations.push(deco);
    }
  }
  const titlePages = layoutTitlePages({ model, template, fonts, shaper, lang, referenceSizePt }, diagnostics);
  for (const p of titlePages) {
    p.decorations.push(...headerFooterFor(env, { index: p.index, label: '', firstElementId: null, isTitle: true }, pages.length, contexts, numbers, diagnostics));
  }

  const result: DocLayout = {
    pageSize: { width: geometry.pageWidth, height: geometry.pageHeight }, bodyTop: geometry.bodyTop, bodyBottom: geometry.bodyBottom,
    titlePages, pages, diagnostics, complete, resume: filled.resume,
  };
  rawFilledPagesOf.set(result, allFilled);
  return result;
}
