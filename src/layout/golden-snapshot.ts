/**
 * M2 task 32: the compact snapshot form `golden-cases.test.ts` compares and `scripts/golden-update.ts`
 * writes — a `DocPage`/`DocLine` reduction (this pipeline's own thin cut, not spec 02 §37.2's literal
 * `fadewright.layout.json` shape, which presupposes the fuller `LayoutResult`/`PageLayout`) that keeps
 * exactly what a break-placement regression would change: each page's lines, in order, by element,
 * kind and rendered text — not glyph-level geometry, which `layout-document.test.ts` and friends
 * already pin at the unit level.
 */
import type { DocLayout } from './layout-document.js';

export interface CompactLine {
  elementId: string | null;
  kind: string;
  dualSide: 'left' | 'right' | null;
  text: string;
}

export interface CompactPage {
  lines: CompactLine[];
}

export interface CompactSnapshot {
  pageCount: number;
  pages: CompactPage[];
}

export function compactSnapshot(layout: DocLayout): CompactSnapshot {
  return {
    pageCount: layout.pages.length,
    pages: layout.pages.map((p) => ({
      lines: p.lines.map((l) => ({
        elementId: l.elementId, kind: l.kind, dualSide: l.dualSide,
        text: l.runs.map((r) => r.text).join(''),
      })),
    })),
  };
}
