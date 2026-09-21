/**
 * Spec 02 §19 (title page), §20 (headers and footers) and §21.4 (scene numbers in the margins):
 * the "S6 decoration" work `layoutDocument` runs after pagination. Everything here is drawn OUTSIDE
 * the body flow (in the top/bottom margins or the side margins), so it never changes pagination.
 *
 * Speed-mode scope: slot text that overflows a slot is not truncated with an ellipsis (no
 * `headerTruncated` diagnostic), `inline` scene numbers are not drawn, the title page's Roman
 * numbering (`titlePage: 'romanLower'`), revision tokens and `{style:}` / `{label}` header tokens
 * render empty, and body page labels come from `layoutDocument` (locked labels / A-pages, else `start + index`).
 */
import type { ElementId, StyleId } from '../ids/ids.js';
import { formatNumberLabel } from '../read-model/number-label.js';
import type { DocumentModel } from '../read-model/open.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { type TitleField } from '../schema/vocab.js';
import { defaultLocaleData, type LocaleDataPort } from '../template/locale-data.js';
import { resolveStyle, type ResolvedStyle } from '../template/resolve.js';
import { renderTokenString, type TokenContext } from '../template/tokens.js';
import { graphemeClusters } from '../text/grapheme.js';
import { upperCaseWithMap } from '../text/casing.js';
import type { ElementContext } from './context.js';
import type { AssignNumbersResult } from '../numbering/assign.js';
import { layoutParagraph, type ParaLine } from './paragraph.js';
import type { FontRegistry, GlyphRun, LayoutDiagnostic, Shaper } from './types.js';

export type DecorationKind = 'header' | 'footer' | 'sceneNumber';

/** A line of generated text drawn in a margin: a header/footer slot or a scene number. */
export interface DocDecoration {
  kind: DecorationKind;
  slot: 'left' | 'center' | 'right';
  text: string;
  /** The numbered element, for `sceneNumber`. */
  elementId: ElementId | null;
  x: number;
  width: number;
  y: number;
  baseline: number;
  pitch: number;
  runs: GlyphRun[];
}

export interface DecorateEnv {
  model: DocumentModel;
  template: EmbeddedTemplateJSON;
  fonts: FontRegistry;
  shaper: Shaper | null;
  lang: string;
  referenceSizePt: number;
  locale?: LocaleDataPort;
  renderTimeMs: number;
  filename?: string;
}

const NUMBER_BOX = 640_080; // 0.7 in, room for "12A" / "123B" beside the text

function textDisplay(text: string, lang: string, caps: boolean) {
  if (caps) {
    const up = upperCaseWithMap(text, lang);
    return { text: up.display, clusterSource: Uint32Array.from(up.clusterSource), sourceLength: text.length };
  }
  return { text, clusterSource: new Uint32Array(graphemeClusters(text).length), sourceLength: text.length };
}

/** What `plainLine` needs of the environment (also satisfied by `DecorateEnv`). */
export type LineEnv = Pick<DecorateEnv, 'template' | 'fonts' | 'shaper' | 'lang' | 'referenceSizePt'>;

/** One line of plain generated text at an absolute x/width in the given style, aligned inside its box. */
export function plainLine(env: LineEnv, text: string, style: ResolvedStyle, textLeft: number, width: number, align: 'left' | 'center' | 'right'): ParaLine | null {
  if (text === '') return null;
  const flat: ResolvedStyle = { ...style, align, indentLeft: 0, indentRight: 0, indentFirstLine: 0, spaceBefore: 0 };
  const layout = layoutParagraph({
    elementId: 'el_decoration' as ElementId,
    displayText: () => textDisplay(text, env.lang, style.allCaps),
    attrs: [], style: flat, category: 'general', page: env.template.page, referenceSizePt: env.referenceSizePt, lang: env.lang,
    fonts: env.fonts, shaper: env.shaper, geometry: { textLeft, width },
  });
  return layout.lines[0] ?? null;
}

function titleTexts(model: DocumentModel): Partial<Record<TitleField, string>> {
  const out: Partial<Record<TitleField, string>> = {};
  const tp = model.titlePage();
  for (const [k, v] of Object.entries(tp.fields)) out[k as TitleField] = v.text;
  out.wordCount = String(tp.computed.wordCount);
  return out;
}

export interface PageForDecoration {
  index: number;
  label: string;
  /** Body page: the first line's element, for `{scene.*}`. */
  firstElementId: ElementId | null;
  isTitle: boolean;
}

/** Header and footer slot lines for one page. */
export function headerFooterFor(
  env: DecorateEnv, page: PageForDecoration, pageCount: number, contexts: ReadonlyMap<ElementId, ElementContext>, numbers: AssignNumbersResult,
  diagnostics: LayoutDiagnostic[],
): DocDecoration[] {
  const { template, model } = env;
  const pg = template.page;
  const out: DocDecoration[] = [];
  const title = titleTexts(model);
  let scene: TokenContext['scene'];
  if (page.firstElementId) {
    const sceneId = contexts.get(page.firstElementId)?.sceneId ?? null;
    const heading = sceneId ? model.element(sceneId) : undefined;
    if (heading) {
      const lbl = numbers.labels.get(sceneId as ElementId);
      scene = { heading: heading.text.plain, number: lbl ? formatNumberLabel(lbl.label) : null };
    }
  }
  const ctx: TokenContext = {
    page: { label: page.label, count: pageCount, revisionName: null },
    title, scene, locale: env.locale ?? defaultLocaleData, language: env.lang, renderTimeMs: env.renderTimeMs,
    document: { filename: env.filename ?? '', project: null, snapshot: null, label: null, lastRevised: null },
  };
  const left = pg.margins.left;
  const fullWidth = pg.width - pg.margins.left - pg.margins.right;
  for (const kind of ['header', 'footer'] as const) {
    const spec = template[kind];
    if (!spec.enabled) continue;
    if (page.isTitle ? !spec.showOnTitlePage : (page.index === 0 && !spec.showOnFirstPage) || page.index + 1 < spec.startAtPage) continue;
    const style = resolveStyle(template, (spec.styleId ?? template.defaults.root) as StyleId);
    const slots = (['left', 'center', 'right'] as const)
      .map((slot) => ({ slot, text: renderTokenString(spec[slot], ctx) }))
      .map((s) => {
        for (const u of s.text.unknown) diagnostics.push({ code: 'unknownToken', elementId: null, pageIndex: page.index, detail: { token: u, where: kind } });
        return { slot: s.slot, text: s.text.text };
      })
      .filter((s) => s.text.trim() !== '');
    if (slots.length === 0) continue;
    const boxW = slots.length === 1 ? fullWidth : Math.floor(fullWidth / 3);
    for (const s of slots) {
      const boxX = slots.length === 1 ? left : s.slot === 'left' ? left : s.slot === 'center' ? left + boxW : left + fullWidth - boxW;
      const line = plainLine(env, s.text, style, boxX, boxW, s.slot);
      if (!line) continue;
      const y = kind === 'header' ? pg.headerOffset : pg.height - pg.footerOffset - line.pitch;
      out.push({ kind, slot: s.slot, text: s.text, elementId: null, x: line.x, width: line.width, y, baseline: y + (line.baseline - line.top), pitch: line.pitch, runs: line.runs });
    }
  }
  return out;
}

/** Scene number decorations for one page's lines (first line of each numbered element). */
export function sceneNumbersFor(
  env: DecorateEnv,
  lines: readonly { elementId: ElementId; lineIndexInElement: number; y: number; baseline: number; pitch: number; runs: GlyphRun[]; x: number; width: number }[],
  contexts: ReadonlyMap<ElementId, ElementContext>,
  numbers: AssignNumbersResult,
  styleOf: (id: ElementId) => ResolvedStyle,
): DocDecoration[] {
  const out: DocDecoration[] = [];
  for (const l of lines) {
    if (l.lineIndexInElement !== 0) continue;
    const ctx = contexts.get(l.elementId);
    if (!ctx || ctx.hidden || !ctx.numberLabel) continue;
    if (ctx.numberLabel.custom === '') continue;
    const style = styleOf(l.elementId);
    const rule = style.numbering;
    if (!rule || !rule.enabled || rule.position === 'inline') continue;
    const text = renderTokenString(rule.format, {
      number: { label: ctx.numberLabel, counts: numbers.counts.get(l.elementId) ?? new Map() },
      locale: env.locale ?? defaultLocaleData, language: env.lang, renderTimeMs: env.renderTimeMs,
    }).text;
    if (text === '') continue;
    const last = l.runs[l.runs.length - 1];
    const extentRight = last ? last.x + last.width : l.x;
    for (const side of ['left', 'right'] as const) {
      if (rule.position !== 'both' && rule.position !== side) continue;
      const x0 = side === 'left' ? rule.leftOffset : rule.rightOffset;
      if (side === 'right' && rule.hideRightOnOverlap && extentRight > x0 - 91_440) continue;
      const line = plainLine(env, text, { ...style, allCaps: false }, x0, NUMBER_BOX, 'left');
      if (!line) continue;
      out.push({ kind: 'sceneNumber', slot: side, text, elementId: l.elementId, x: line.x, width: line.width, y: l.y, baseline: l.baseline, pitch: l.pitch, runs: line.runs });
    }
  }
  return out;
}
