/**
 * `layoutDocument`: the seam the editor's page view draws from. Runs, in order, the stages built
 * so far — numbering, context pass (S2), paragraph layout (S3), block formation (S4) and the
 * paginator (S5) — and returns plain data: pages of lines, each carrying its element id, source
 * offset range, x/width/y in EMU and 1-based page number.
 *
 * Runs after pagination (never affecting it): the title page (§19; `titlePages`, unnumbered, kept apart from
 * the body `pages`), headers/footers (§20) and scene numbers in the margins (§21.4), as `decorations` on each page.
 *
 * NOT run yet: automatic and manual continueds — `(MORE)`, `(CONT'D)` at page tops, scene CONTINUED (§14),
 * dual dialogue geometry (dual groups are laid out stacked), column blocks (laid out at
 * full width), graphic-novel panels (§17), page locks / A-pages (§24), revision display (§25),
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
import type { FontRegistry, GlyphRun, LayoutDiagnostic, Shaper } from './types.js';
import { headerFooterFor, sceneNumbersFor, type DecorateEnv, type DocDecoration } from './decorate.js';
import { layoutTitlePages } from './title-page.js';

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
}

export interface DocPage {
  /** 'title' pages are unnumbered (`number` 0) and live in `DocLayout.titlePages`. */
  kind: 'body' | 'title';
  /** 1-based physical body page; 0 for a title page. */
  number: number;
  index: number;
  /** The page-number text `{page}` renders: `pageNumbering.start + index`; empty on a title page. */
  label: string;
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
  for (const id of order) {
    const el = byId.get(id) as ElementView;
    const ctx = contexts.get(id)!;
    if (ctx.hidden) continue;
    const style = styleOf(el);
    const layout = layoutParagraph({
      elementId: id, displayText, attrs: attrRuns(el), style, category: ctx.category, page: template.page, referenceSizePt, lang, fonts, shaper,
      lineAdjustDeltaRight: el.lineAdjust?.deltaRight, decorationHash: ctx.decorationHash,
    });
    diagnostics.push(...layout.diagnostics);
    paras.push({
      layout, ctx, flags: paraFlags(style, ctx.category, { actBreakStartsPage: template.pagination.actBreakStartsPage, dualGroup: el.dual?.group ?? null }),
    });
  }

  const blocks = formBlocks(paras, { dual: false });
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
  const filled = paginate(blocks, geometry, params);
  diagnostics.push(...filled.diagnostics);

  const pages: DocPage[] = filled.pages.map((fp) => ({
    kind: 'body' as const,
    number: fp.index + 1,
    index: fp.index,
    label: '',
    decorations: [] as DocDecoration[],
    lines: fp.lines.map((pl): DocLine => {
      const line: ParaLine = pl.line;
      return {
        elementId: pl.elementId, lineIndexInElement: pl.lineIndexInElement, sourceStart: line.sourceStart, sourceEnd: line.sourceEnd,
        x: line.x, width: line.width, y: geometry.bodyTop + pl.y, baseline: geometry.bodyTop + pl.y + (line.baseline - line.top),
        pitch: line.pitch, pageNumber: fp.index + 1, runs: line.runs,
      };
    }),
  }));

  const env: DecorateEnv = {
    model, template, fonts, shaper, lang, referenceSizePt, renderTimeMs: options.renderTimeMs ?? model.deps.clock(), filename: options.filename,
  };
  const start = template.pageNumbering.start;
  for (const p of pages) {
    p.label = String(start + p.index);
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
