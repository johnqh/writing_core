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
 * Page locks (§24, `locks.ts`): anchors snap to block starts and force a break; overflow pages get A labels (`DocPage.label`).
 *
 * NOT run yet: column blocks (laid out at
 * full width), graphic-novel panels (§17), revision display (§25),
 * Track Changes and alternates view modes (§26; the `final` view is used), scene running time
 * (§27), the paragraph cache and incremental re-pagination (§31), and the element/line index (§29.5).
 */
import type { ElementId } from '../ids/ids.js';
import { createFontRegistry } from '../fonts/registry.js';
import { assignNumbers } from '../numbering/assign.js';
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { resolveStyle, type ResolvedStyle } from '../template/resolve.js';
import { formBlocks, paraFlags, type BlockPara } from './blocks.js';
import { contextPass } from './context.js';
import type { AttrRun } from './itemize.js';
import { layoutParagraph, makeDisplayText, type ParaLine } from './paragraph.js';
import { pageGeometryOf, paginate, type PaginationParams } from './paginate.js';
import type { FontRegistry, GlyphRun, LayoutDiagnostic, LineKind, Shaper } from './types.js';
import { makeContinueds } from './continueds.js';
import { dualGeometry, dualSideBox } from './dual.js';
import { headerFooterFor, sceneNumbersFor, type DecorateEnv, type DocDecoration } from './decorate.js';
import { layoutTitlePages } from './title-page.js';
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
}

let defaultFonts: FontRegistry | null = null;

function attrRuns(el: ElementView): AttrRun[] {
  const out: AttrRun[] = [];
  let at = 0;
  for (const r of el.text.runs) {
    if (Object.keys(r.attrs).length > 0) out.push({ start: at, end: at + r.text.length, attrs: r.attrs });
    at += r.text.length;
  }
  return out;
}

export function layoutDocument(model: DocumentModel, templateIn?: EmbeddedTemplateJSON, options: LayoutDocumentOptions = {}): DocLayout {
  const template = templateIn ?? model.template();
  const fonts = options.fonts ?? (defaultFonts ??= createFontRegistry());
  const shaper = options.shaper ?? null;
  const lang = model.meta().language;
  const numbers = assignNumbers(model);
  const { contexts, order } = contextPass(model, template, numbers);
  const referenceSizePt = resolveStyle(template, template.defaults.root).font.size;

  const byId = new Map<ElementId, ElementView>();
  for (const el of model.elements()) byId.set(el.id, el);
  const styles = new Map<ElementId, ResolvedStyle>();
  const styleOf = (el: ElementView): ResolvedStyle => {
    let s = styles.get(el.id);
    if (!s) styles.set(el.id, (s = resolveStyle(template, el.style, el.ov)));
    return s;
  };
  const displayText = makeDisplayText(model, template, contexts, styleOf, lang);

  const diagnostics: LayoutDiagnostic[] = [];
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
    const style = styleOf(el);
    const layout = layoutParagraph({
      elementId: id, displayText, attrs: attrRuns(el), style, category: ctx.category, page: template.page, referenceSizePt, lang, fonts, shaper,
      lineAdjustDeltaRight: el.lineAdjust?.deltaRight, decorationHash: ctx.decorationHash,
      geometry: dualGeom && el.dual && groupSides.get(el.dual.group)?.size === 2 ? dualSideBox(dualGeom, ctx.category, el.dual.side) : undefined,
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
    const orderIndex = new Map<ElementId, number>();
    order.forEach((id, i) => orderIndex.set(id, i));
    lockRes = resolveLocks(production.pageLocks, blocks, orderIndex, template.pageNumbering.suffixMode);
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
  };
  const continueds = makeContinueds({
    template, fonts, shaper, lang, referenceSizePt,
    sideGeometry: dualGeom ? (category, side) => dualSideBox(dualGeom, category, side) : null,
  });
  const filled = paginate(blocks, geometry, params, { continueds });
  diagnostics.push(...filled.diagnostics);

  const pages: DocPage[] = filled.pages.map((fp) => ({
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
        pitch: line.pitch, pageNumber: fp.index + 1, runs: line.runs, kind: pl.kind ?? 'text', dualSide: pl.dualSide ?? null,
      };
    }),
  }));

  const env: DecorateEnv = {
    model, template, fonts, shaper, lang, referenceSizePt, renderTimeMs: options.renderTimeMs ?? model.deps.clock(), filename: options.filename,
  };
  const start = template.pageNumbering.start;
  const locked = lockRes ? labelPages(filled.pages, lockRes, template.pageNumbering.suffixMode, template.pageNumbering.skipIO, template.pageNumbering.combineDeletedRanges) : null;
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
      ...headerFooterFor(env, { index: p.index, label: p.label, firstElementId: first, isTitle: false }, pages.length, contexts, numbers, diagnostics),
      ...sceneNumbersFor(env, p.lines, contexts, numbers, (id) => styleOf(byId.get(id) as ElementView)),
    );
  }
  const titlePages = layoutTitlePages({ model, template, fonts, shaper, lang, referenceSizePt }, diagnostics);
  for (const p of titlePages) {
    p.decorations.push(...headerFooterFor(env, { index: p.index, label: '', firstElementId: null, isTitle: true }, pages.length, contexts, numbers, diagnostics));
  }

  return {
    pageSize: { width: geometry.pageWidth, height: geometry.pageHeight }, bodyTop: geometry.bodyTop, bodyBottom: geometry.bodyBottom,
    titlePages, pages, diagnostics,
  };
}
