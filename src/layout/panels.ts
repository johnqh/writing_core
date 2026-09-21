/**
 * Graphic novel `panels` layout mode, spec 02 §17. Flow pagination plus comic structure, using the numbering system
 * (§21) for every count:
 *
 * - Page heading (`page` role, `pageBreakBefore`): when its text is empty and `pagination.panels.autoHeadingText` is on it
 *   displays the generated label `PAGE ONE (TWO PANELS)` (the style's `numbering.format` through `renderTokenString`;
 *   `{count:st_panel}` comes from `assignNumbers`' `counts`, not from a second walk). A writer's own text is kept as typed.
 * - Panel heading (`panel` role): its `Panel {n}.` label is `inline`, i.e. part of the display text (it takes width and
 *   takes part in line breaking), followed by the writer's text.
 * - Comic pages are the author's page headings (each starts a script page); a script page break inside a comic page starts
 *   the next page with `PAGE ONE (CONT'D)` in the heading's style (`pageContdLine`, drawn by the paginator).
 * - `{n:words}` goes through `LocaleDataPort.spellOut` (no `Intl`).
 *
 * Speed-mode scope: a heading whose text merely equals its previous generated text is treated as the writer's own text
 * (there is no stored "previous generated text"); only the `page` / `panel` roles are generated (no balloon numbering,
 * which is ordinary dialogue numbering with `resetAfterStyle` and needs nothing here); omitted pages/panels (§23.3) are
 * not special-cased beyond what the numbering pass already does.
 */
import type { ElementId } from '../ids/ids.js';
import type { AssignNumbersResult } from '../numbering/assign.js';
import type { DocumentModel } from '../read-model/open.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { defaultLocaleData, type LocaleDataPort } from '../template/locale-data.js';
import { resolveStyle } from '../template/resolve.js';
import { renderTokenString } from '../template/tokens.js';
import type { BlockPara } from './blocks.js';
import type { DecoLine } from './continueds.js';
import type { ElementContext } from './context.js';
import { plainLine, type LineEnv } from './decorate.js';

export interface PanelText {
  /** The rendered `numbering.format` (`PAGE ONE (TWO PANELS)`, `Panel 1.`). */
  label: string;
  /** Replaces the whole display text (an empty page heading with `autoHeadingText`). */
  generated: string | null;
  /** Drawn before the writer's text, `inline` (a panel heading's `Panel 1.`). */
  prefix: string | null;
}

export interface PanelHeadingsInput {
  model: DocumentModel;
  template: EmbeddedTemplateJSON;
  contexts: ReadonlyMap<ElementId, ElementContext>;
  numbers: AssignNumbersResult;
  locale?: LocaleDataPort;
  renderTimeMs?: number;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** §17: generated heading text per page/panel heading; empty outside `panels` mode. */
export function panelHeadings(input: PanelHeadingsInput): Map<ElementId, PanelText> {
  const { model, template, contexts, numbers } = input;
  const out = new Map<ElementId, PanelText>();
  if (template.layoutMode !== 'panels') return out;
  const auto = template.pagination.panels.autoHeadingText;
  const language = model.meta().language;
  for (const el of model.elements()) {
    const ctx = contexts.get(el.id);
    if (!ctx || ctx.hidden || !ctx.numberLabel || ctx.numberLabel.custom === '') continue;
    if (ctx.category !== 'pageHeading' && ctx.category !== 'panelHeading') continue;
    const rule = resolveStyle(template, el.style, el.ov).numbering;
    if (!rule || !rule.enabled) continue;
    const label = renderTokenString(rule.format, {
      number: { label: ctx.numberLabel, counts: numbers.counts.get(el.id) ?? new Map() },
      locale: input.locale ?? defaultLocaleData, language, renderTimeMs: input.renderTimeMs ?? 0,
    }).text;
    if (label === '') continue;
    const empty = el.text.plain.trim() === '';
    if (ctx.category === 'pageHeading') out.set(el.id, { label, generated: auto && empty ? label : null, prefix: null });
    else out.set(el.id, { label, generated: null, prefix: rule.position === 'inline' ? label : null });
  }
  return out;
}

/** Fold `panelHeadings` into the contexts the paragraph layout reads (and its cache hash). */
export function applyPanelText(contexts: ReadonlyMap<ElementId, ElementContext>, texts: ReadonlyMap<ElementId, PanelText>): void {
  for (const [id, t] of texts) {
    const ctx = contexts.get(id);
    if (!ctx) continue;
    ctx.pageLabel = t.label;
    if (t.generated !== null && ctx.generatedText === null) ctx.generatedText = t.generated;
    ctx.numberPrefix = t.prefix;
    ctx.decorationHash = (ctx.decorationHash ^ fnv(`${t.generated ?? '~'}|${t.prefix ?? '~'}`)) >>> 0;
  }
}

/** `PAGE ONE (CONT'D)`: the heading's label without its trailing `(… PANELS)`, plus the template's continuation text. */
export function pageContdLine(env: LineEnv, heading: BlockPara): DecoLine | null {
  const label = heading.ctx.pageLabel;
  if (!label || !heading.style) return null;
  const t = env.template;
  const base = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const text = base + t.continueds.joiner + t.continueds.cont;
  const pg = t.page;
  const textLeft = pg.margins.left + heading.style.indentLeft;
  const width = pg.width - pg.margins.right - heading.style.indentRight - textLeft;
  const line = plainLine(env, text, heading.style, textLeft, width, heading.style.align === 'right' || heading.style.align === 'center' ? heading.style.align : 'left');
  return line ? { kind: 'pageHeadingContd', elementId: heading.layout.elementId, text, line } : null;
}
