/**
 * Spec 02 §19: the title page, a separate flow over `titlePage.elements` with `titlePageStyles`.
 * `flow` elements stack from the body top (the title element sits at `titlePageLayout.centerTop`);
 * the trailing run of `anchor: 'bottom'` elements is stacked upward so its last line rests on the
 * bottom margin; `pageBreakBefore` starts another title page. Empty title page = no page.
 *
 * Speed-mode scope: `titlePageOverflow` moves the bottom run to a following page but does not try
 * to re-balance; `wordCount` is substituted as plain text.
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { resolveStyle, type ResolvedStyle } from '../template/resolve.js';
import { graphemeClusters } from '../text/grapheme.js';
import { upperCaseWithMap } from '../text/casing.js';
import { layoutParagraph, type ParagraphLayout } from './paragraph.js';
import type { AttrRun } from './itemize.js';
import type { FontRegistry, LayoutDiagnostic, Shaper } from './types.js';
import type { DocLine, DocPage } from './layout-document.js';

export interface TitleEnv {
  model: DocumentModel;
  template: EmbeddedTemplateJSON;
  fonts: FontRegistry;
  shaper: Shaper | null;
  lang: string;
  referenceSizePt: number;
}

interface Item {
  el: ElementView;
  style: ResolvedStyle;
  para: ParagraphLayout;
  bottom: boolean;
}

function attrRuns(el: ElementView): AttrRun[] {
  const out: AttrRun[] = [];
  let at = 0;
  for (const r of el.text.runs) {
    if (Object.keys(r.attrs).length > 0) out.push({ start: at, end: at + r.text.length, attrs: r.attrs });
    at += r.text.length;
  }
  return out;
}

const isBlank = (el: ElementView) => el.text.plain.trim() === '';

/** True when the title page holds something worth a page (spec 02 §19: an empty title page is no page). */
export function titlePageHasContent(model: DocumentModel): boolean {
  const els = model.titlePage().elements;
  return els.some((el) => {
    if (isBlank(el)) return false;
    if (el.field === 'credit') return false; // "Written by" alone is boilerplate
    if (el.field === 'title' && el.text.plain.trim().toUpperCase() === 'UNTITLED') return false; // the seeded placeholder
    return true;
  });
}

export function layoutTitlePages(env: TitleEnv, diagnostics: LayoutDiagnostic[]): DocPage[] {
  const { model, template, fonts, shaper, lang, referenceSizePt } = env;
  if (!titlePageHasContent(model)) return [];
  const tp = model.titlePage();
  const tpTemplate = { ...template, styles: template.titlePageStyles };
  const page = template.page;
  const bodyTop = page.margins.top;
  const bodyBottom = page.height - page.margins.bottom;

  const authorBlank = (tp.fields.author?.text ?? '').trim() === '';
  const items: Item[] = [];
  for (const el of tp.elements) {
    if (el.field && isBlank(el)) continue; // an unfilled field prints nothing
    if (el.field === 'credit' && authorBlank) continue;
    const style = resolveStyle(tpTemplate, el.style, el.ov);
    const source = el.field === 'wordCount' ? String(tp.computed.wordCount) : el.text.plain;
    const para = layoutParagraph({
      elementId: el.id,
      displayText: () => {
        if (style.allCaps) {
          const up = upperCaseWithMap(source, lang);
          return { text: up.display, clusterSource: Uint32Array.from(up.clusterSource), sourceLength: source.length };
        }
        return { text: source, clusterSource: Uint32Array.from(graphemeClusters(source)), sourceLength: source.length };
      },
      attrs: el.field === 'wordCount' ? [] : attrRuns(el), style, category: 'general', page, referenceSizePt, lang, fonts, shaper,
    });
    diagnostics.push(...para.diagnostics);
    items.push({ el, style, para, bottom: (el.ov as { anchor?: string }).anchor === 'bottom' });
  }

  // Split into pages at pageBreakBefore.
  const groups: Item[][] = [[]];
  for (const it of items) {
    if (it.style.pageBreakBefore && groups[groups.length - 1]!.length > 0) groups.push([]);
    groups[groups.length - 1]!.push(it);
  }

  const pages: DocPage[] = [];
  const emit = (): DocPage => {
    const p: DocPage = { kind: 'title', number: 0, index: pages.length, label: '', lines: [], decorations: [] };
    pages.push(p);
    return p;
  };
  const place = (p: DocPage, it: Item, top: number): void => {
    for (const [i, line] of it.para.lines.entries()) {
      const l: DocLine = {
        elementId: it.el.id as ElementId, lineIndexInElement: i, sourceStart: line.sourceStart, sourceEnd: line.sourceEnd,
        x: line.x, width: line.width, y: top + line.top, baseline: top + line.baseline, pitch: line.pitch, pageNumber: 0, runs: line.runs,
      };
      p.lines.push(l);
    }
  };

  for (const group of groups) {
    let cut = group.length;
    while (cut > 0 && group[cut - 1]!.bottom) cut--;
    const flow = group.slice(0, cut);
    const bottom = group.slice(cut);
    const p = emit();
    let y = bodyTop;
    flow.forEach((it, i) => {
      if (i === 0 && it.el.field === 'title') y = Math.max(y, template.titlePageLayout.centerTop);
      else y += it.para.spaceBefore;
      place(p, it, y);
      y += it.para.totalHeight;
    });
    if (bottom.length > 0) {
      const total = bottom.reduce((n, it, i) => n + (i > 0 ? it.para.spaceBefore : 0) + it.para.totalHeight, 0);
      let start = bodyBottom - total;
      let target = p;
      if (start < y) {
        diagnostics.push({ code: 'titlePageOverflow', elementId: null, pageIndex: p.index, detail: {} });
        target = emit();
        start = bodyBottom - total;
      }
      let by = start;
      bottom.forEach((it, i) => {
        if (i > 0) by += it.para.spaceBefore;
        place(target, it, by);
        by += it.para.totalHeight;
      });
    }
  }
  return pages;
}
