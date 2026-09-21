/**
 * Auto Adjust Lines (spec 02 §28.2; M2 task 33), as a planner: it finds the `lineAdjust` values that pull a paragraph's
 * short last line back onto the one above and returns them. It writes nothing — the model has `lineAdjust` (§28.1) but
 * no command sets it yet (spec 08's adjust commands are Task 34's remainder), so a caller applies `adjustments` itself,
 * with `auto: true`; a manual adjust then clears `auto`.
 *
 * Paragraph line counts do not depend on other paragraphs, so each try lays the whole document out once with every
 * still-open candidate nudged by `c` steps (`LayoutDocumentOptions.lineAdjustOverrides`), not once per paragraph.
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { resolveStyle } from '../template/resolve.js';
import { layoutDocument, type DocLayout, type LayoutDocumentOptions } from './layout-document.js';

/** §28.1: `deltaRight` is bounded to [−1.0 in, +0.5 in]. */
export const LINE_ADJUST_MIN = -914_400;
export const LINE_ADJUST_MAX = 457_200;

export interface AutoAdjustOptions {
  /** A paragraph qualifies when its last line holds at most this many words (default 1). */
  orphanWords?: number;
  /** Try 1..maxChars steps (default 2). */
  maxChars?: number;
  /** One character width in EMU; default is 0.6 em of the paragraph's font (Courier: 0.1 in at 12 pt). */
  stepEmu?: number;
  layout?: LayoutDocumentOptions;
}

export interface LineAdjustment {
  elementId: ElementId;
  /** The new `lineAdjust.deltaRight`. */
  deltaRight: number;
  auto: true;
  linesBefore: number;
  linesAfter: number;
}

export interface AutoAdjustResult {
  adjustments: LineAdjustment[];
  pagesBefore: number;
  pagesAfter: number;
}

export const clampDeltaRight = (v: number): number => Math.max(LINE_ADJUST_MIN, Math.min(LINE_ADJUST_MAX, v));

function textLineCounts(layout: DocLayout): Map<ElementId, { count: number; last: { start: number; end: number; index: number } }> {
  const out = new Map<ElementId, { count: number; last: { start: number; end: number; index: number } }>();
  for (const p of layout.pages) {
    for (const l of p.lines) {
      if (l.kind !== 'text') continue;
      const cur = out.get(l.elementId);
      if (!cur) out.set(l.elementId, { count: 1, last: { start: l.sourceStart, end: l.sourceEnd, index: l.lineIndexInElement } });
      else {
        cur.count++;
        if (l.lineIndexInElement >= cur.last.index) cur.last = { start: l.sourceStart, end: l.sourceEnd, index: l.lineIndexInElement };
      }
    }
  }
  return out;
}

const words = (s: string): number => (s.match(/\S+/g) ?? []).length;

export function autoAdjustLines(
  model: DocumentModel, template: EmbeddedTemplateJSON, range: readonly ElementId[] | 'all', opts: AutoAdjustOptions = {},
): AutoAdjustResult {
  const orphanWords = opts.orphanWords ?? 1;
  const maxChars = opts.maxChars ?? 2;
  const base = layoutDocument(model, template, opts.layout);
  const counts = textLineCounts(base);
  const inRange = range === 'all' ? null : new Set(range);
  const step = new Map<ElementId, number>();
  const current = new Map<ElementId, number>();
  for (const el of model.elements()) {
    if (inRange && !inRange.has(el.id)) continue;
    const c = counts.get(el.id);
    if (!c || c.count < 2) continue;
    if (words(el.text.plain.slice(c.last.start, c.last.end)) > orphanWords) continue;
    step.set(el.id, opts.stepEmu ?? Math.round(resolveStyle(template, el.style, el.ov).font.size * 12_700 * 0.6));
    current.set(el.id, el.lineAdjust?.deltaRight ?? 0);
  }
  const found = new Map<ElementId, number>();
  for (let c = 1; c <= maxChars && found.size < step.size; c++) {
    const trial = new Map<ElementId, number>();
    for (const [id, st] of step) if (!found.has(id)) trial.set(id, clampDeltaRight(current.get(id)! + c * st));
    const laid = textLineCounts(layoutDocument(model, template, { ...opts.layout, lineAdjustOverrides: trial }));
    for (const [id, v] of trial) {
      if (v !== current.get(id) && (laid.get(id)?.count ?? Infinity) < counts.get(id)!.count) found.set(id, v);
    }
  }
  const after = found.size === 0 ? base : layoutDocument(model, template, { ...opts.layout, lineAdjustOverrides: found });
  const afterCounts = found.size === 0 ? counts : textLineCounts(after);
  const adjustments = [...step.keys()].filter((id) => found.has(id)).map((elementId): LineAdjustment => ({
    elementId, deltaRight: found.get(elementId)!, auto: true, linesBefore: counts.get(elementId)!.count, linesAfter: afterCounts.get(elementId)!.count,
  }));
  return { adjustments, pagesBefore: base.pages.length, pagesAfter: after.pages.length };
}
