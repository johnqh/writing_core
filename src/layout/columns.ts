/**
 * Column blocks, spec 02 §16 (AV two-column and BBC name-beside-dialogue).
 *
 * `blocks.ts` delimits a run of `column ∈ {1,2}` paragraphs; `formRows` (§16.1) is the single owner of dividing it
 * into rows: a row is a maximal column-1 run followed by a maximal column-2 run, and a column-1 paragraph after a
 * column-2 one starts a new row. `layoutRow` stacks each side and gives the row height (max of both stacks) and the
 * row's space before (max of the two firsts, the first paragraph of each side then has none). Geometry is always the
 * styles' own indents (§16), so each paragraph layout already carries its column's x/width; overlap is drawn and
 * reported (`columnOverlap`). `splitSide` / `splitRowSides` implement §16.2: each side splits independently at its
 * largest legal point that fits; the row moves whole when a side has neither a fit nor a legal split.
 *
 * Speed-mode scope: no `(MORE)` / `(CONT'D)` inside a column-2 dialogue split (AV and BBC templates set
 * `dialoguePageBreaks` false, so a dialogue block never splits there; a template that allows it splits without them).
 */
import type { BlockPara } from './blocks.js';
import { rowsHeight, type DlgRow } from './continueds.js';
import type { ParaLine } from './paragraph.js';

export interface ColumnRow {
  left: BlockPara[];
  right: BlockPara[];
}

/** One line of a column side. */
export type SideRow = DlgRow;

export interface RowLayout {
  left: SideRow[];
  right: SideRow[];
  /** `max(spaceBefore(first left), spaceBefore(first right))`. */
  spaceBefore: number;
  /** `max(leftStackHeight, rightStackHeight)`, excluding the row's space before. */
  height: number;
  /** A left line's text extends past the start of the right column. */
  overlap: boolean;
}

/** §16.1. `paras` is a maximal run of `column ∈ {1,2}` paragraphs in document order. */
export function formRows(paras: readonly BlockPara[]): ColumnRow[] {
  const rows: ColumnRow[] = [];
  let cur: ColumnRow | null = null;
  for (const p of paras) {
    if (p.flags.column === 1) {
      if (!cur || cur.right.length > 0) rows.push((cur = { left: [], right: [] }));
      cur.left.push(p);
    } else {
      if (!cur) rows.push((cur = { left: [], right: [] }));
      cur.right.push(p);
    }
  }
  return rows;
}

function sideRows(paras: readonly BlockPara[]): SideRow[] {
  const out: SideRow[] = [];
  paras.forEach((p, pi) => {
    const n = p.layout.lines.length;
    for (let li = 0; li < n; li++) out.push({ h: (p.layout.lines[li] as ParaLine).pitch, sb: li === 0 && pi > 0 ? p.layout.spaceBefore : 0, p, line: li, nLines: n });
  });
  return out;
}

const extentRight = (l: ParaLine): number => {
  const last = l.runs[l.runs.length - 1];
  return last ? last.x + last.width : l.x;
};

/** §16.1 row geometry. */
export function layoutRow(row: ColumnRow): RowLayout {
  const left = sideRows(row.left);
  const right = sideRows(row.right);
  const sb = Math.max(row.left[0]?.layout.spaceBefore ?? 0, row.right[0]?.layout.spaceBefore ?? 0);
  let overlap = false;
  if (row.left.length > 0 && row.right.length > 0) {
    const rightStart = Math.min(...row.right.flatMap((p) => p.layout.lines.map((l) => l.x)));
    overlap = row.left.some((p) => p.layout.lines.some((l) => extentRight(l) > rightStart));
  }
  return { left, right, spaceBefore: sb, height: Math.max(rowsHeight(left, 0, left.length), rowsHeight(right, 0, right.length)), overlap };
}

export function layoutRows(rows: readonly ColumnRow[]): RowLayout[] {
  return rows.map(layoutRow);
}

export interface RowRules {
  minBefore: number;
  minAfter: number;
  /** `dialoguePageBreaks`: whether a dialogue block inside a side may break. */
  dialogueBreaks: boolean;
}

const isMember = (c: string): boolean => c === 'parenthetical' || c === 'dialogue';
const inDialogueBlock = (c: string): boolean => c === 'character' || isMember(c);

/** Is a split between side rows `s-1` and `s` legal (§13.6 per paragraph, §14.1 inside a dialogue block)? `level` relaxes as in §13.6. */
export function legalSideSplit(rows: readonly SideRow[], s: number, from: number, rules: RowRules, level: number): boolean {
  if (level >= 3) return true;
  const a = rows[s - 1] as SideRow;
  const b = rows[s] as SideRow;
  const ca = a.p.ctx.category;
  const cb = b.p.ctx.category;
  const dlg = inDialogueBlock(ca) && (a.p === b.p ? true : isMember(cb));
  if (dlg && !rules.dialogueBreaks) return false;
  if (a.p === b.p) {
    if (!a.p.flags.splittable) return false;
    if (level < 2) {
      const startLine = (rows[from] as SideRow).p === a.p ? (rows[from] as SideRow).line : 0;
      if (a.line + 1 - startLine < rules.minBefore) return false;
      if (a.nLines - (a.line + 1) < rules.minAfter) return false;
    }
    if (level < 1 && a.p.flags.sentenceRule && a.p.layout.sentenceEndLines[a.line] !== 1) return false;
    return true;
  }
  if (dlg) {
    if (cb !== 'parenthetical' || ca === 'parenthetical' || ca === 'character') return false;
    return true;
  }
  return level >= 1 || (!a.p.flags.keepWithNext && !b.p.flags.keepsWithPrevious);
}

/** The largest legal exclusive end in `(from, rows.length]` whose head fits `avail`, or `rows.length` when the rest fits; -1 when none. */
export function splitSide(rows: readonly SideRow[], from: number, avail: number, rules: RowRules, level = 0): number {
  if (from >= rows.length) return rows.length;
  if (rowsHeight(rows, from, rows.length) <= avail) return rows.length;
  for (let s = rows.length - 1; s > from; s--) {
    if (rowsHeight(rows, from, s) > avail) continue;
    if (legalSideSplit(rows, s, from, rules, level)) return s;
  }
  return -1;
}

export interface RowSplitChoice {
  /** Exclusive end of each side's head; the side's length means it finishes on this page. */
  toL: number;
  toR: number;
  /** Head height, `max(hL, hR)`. */
  height: number;
}

/**
 * §16.2: per side the largest legal head that fits, whole when the whole fits; legal iff every side has one and at
 * least one side is really split. `level` 3 forces each side at its largest fitting boundary (at least one line).
 */
export function splitRowSides(left: readonly SideRow[], right: readonly SideRow[], avail: number, rules: RowRules, level = 0): RowSplitChoice | null {
  const side = (rows: readonly SideRow[]): number => {
    if (level < 3) return splitSide(rows, 0, avail, rules, level);
    if (rows.length === 0) return 0;
    let s = rows.length;
    while (s > 1 && rowsHeight(rows, 0, s) > avail) s--;
    return s;
  };
  const toL = side(left);
  const toR = side(right);
  if (toL < 0 || toR < 0) return null;
  if (toL >= left.length && toR >= right.length) return null; // nothing split: the caller places it whole
  return { toL, toR, height: Math.max(rowsHeight(left, 0, toL), rowsHeight(right, 0, toR)) };
}

/** The smallest head the row could ever place: what a keep chain must reserve for it. */
export function rowMinHead(layout: RowLayout, rules: RowRules): number {
  const min = (rows: readonly SideRow[]): number => {
    let best = rowsHeight(rows, 0, rows.length);
    for (let s = 1; s < rows.length; s++) if (legalSideSplit(rows, s, 0, rules, 0)) best = Math.min(best, rowsHeight(rows, 0, s));
    return best;
  };
  return Math.max(min(layout.left), min(layout.right));
}
