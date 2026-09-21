/**
 * Dual dialogue, spec 02 §15: geometry (§15.2), side-by-side layout (§15.1) and splitting (§15.3).
 *
 * Geometry. A template's stored `dualDialogueGeometry` wins; when it is null (every built-in template today)
 * the §15.2 derivation applies: split the body text width into two halves separated by `columnGap` and map each
 * category's single-column indents proportionally into each half, with integer arithmetic. NOTE: the spec marks the
 * default numeric table of §15.2 "subject to V-02-5" (calibration against Final Draft output); this module uses
 * the derivation the spec gives for null geometry, and stored geometry verbatim.
 *
 * Each side's paragraphs are laid out by `layoutDocument` with `dualSideBox` as their geometry override; the
 * paginator then places the two stacks at the same y (block height = max of the two).
 */
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { DualDialogueGeometry } from '../schema/template.js';
import { resolveStyle } from '../template/resolve.js';
import type { DualBlock } from './blocks.js';
import { dialogueRows, legalDialogueSplit, minLegalHead, rowsHeight, splitDialogue, type DlgRow, type SplitRules } from './continueds.js';

export type DualCategory = 'character' | 'parenthetical' | 'dialogue';
export type { DualDialogueGeometry };

const CATEGORIES: readonly DualCategory[] = ['character', 'parenthetical', 'dialogue'];

/** §15.2: stored geometry, else the proportional derivation. Edges are EMU from the page's left edge. */
export function dualGeometry(template: EmbeddedTemplateJSON): DualDialogueGeometry {
  const stored = template.pagination.dualDialogue.geometry;
  if (stored) return stored;
  const pg = template.page;
  const gap = template.pagination.dualDialogue.columnGap;
  const textLeft = pg.margins.left;
  const textWidth = pg.width - pg.margins.left - pg.margins.right;
  const half = Math.floor((textWidth - gap) / 2);
  const rightHalfLeft = textLeft + half + gap;
  const map = (x: number, halfLeft: number): number => halfLeft + Math.floor(((x - textLeft) * half) / textWidth);
  const out = {} as Record<DualCategory, DualDialogueGeometry[DualCategory]>;
  for (const cat of CATEGORIES) {
    const id = template.defaults[cat] ?? template.defaults.dialogue ?? template.defaults.root;
    const st = resolveStyle(template, id as never);
    const l = textLeft + st.indentLeft;
    const r = pg.width - pg.margins.right - st.indentRight;
    out[cat] = {
      leftSide: { left: map(l, textLeft), right: map(r, textLeft) },
      rightSide: { left: map(l, rightHalfLeft), right: map(r, rightHalfLeft) },
    };
  }
  return out as DualDialogueGeometry;
}

/** The text box (left edge and width, EMU) of a category on one side. Categories other than cue/parenthetical use dialogue. */
export function dualSideBox(geometry: DualDialogueGeometry, category: string, side: 'left' | 'right'): { textLeft: number; width: number } {
  const cat: DualCategory = category === 'character' || category === 'parenthetical' ? category : 'dialogue';
  const e = geometry[cat][side === 'left' ? 'leftSide' : 'rightSide'];
  return { textLeft: e.left, width: Math.max(1, e.right - e.left) };
}

export interface DualLayout {
  left: DlgRow[];
  right: DlgRow[];
  /** Space before the block: the left cue's (§15.1). */
  spaceBefore: number;
  /** `max(leftHeight, rightHeight)`, excluding the block's space before. */
  height: number;
}

/** §15.1: the two stacks and the block height. */
export function layoutDual(block: DualBlock): DualLayout {
  const left = dialogueRows(block.left);
  const right = dialogueRows(block.right);
  return { left, right, spaceBefore: block.left.cue.layout.spaceBefore, height: Math.max(rowsHeight(left, 0, left.length), rowsHeight(right, 0, right.length)) };
}

export interface DualSplitChoice {
  /** Exclusive end row of each side's head; `rows.length` means the side finishes on this page. */
  toL: number;
  toR: number;
  /** Head height, `max(hL, hR)`, including each split side's `(MORE)`. */
  height: number;
}

/**
 * §15.3: per side, the largest legal head `<= avail` (its whole remainder when that fits, with no `(MORE)`);
 * legal iff both sides have one and at least one side is actually split. `level` relaxes as in §13.6 (3 = forced).
 */
export function splitDual(
  left: readonly DlgRow[], right: readonly DlgRow[], from: readonly [number, number], avail: number, moreL: number, moreR: number,
  rules: SplitRules, level = 0,
): DualSplitChoice | null {
  const side = (rows: readonly DlgRow[], c: number, more: number): { to: number; h: number } | null => {
    if (c >= rows.length) return { to: rows.length, h: 0 };
    const full = rowsHeight(rows, c, rows.length);
    if (full <= avail) return { to: rows.length, h: full };
    if (level >= 3) {
      let s = rows.length - 1;
      while (s > c + 1 && rowsHeight(rows, c, s) + more > avail) s--;
      return { to: Math.max(s, c + 1), h: rowsHeight(rows, c, Math.max(s, c + 1)) + more };
    }
    const s = splitDialogue(rows, c, avail, more, rules, level);
    return s < 0 ? null : { to: s, h: rowsHeight(rows, c, s) + more };
  };
  const l = side(left, from[0], moreL);
  const r = side(right, from[1], moreR);
  if (!l || !r) return null;
  if (l.to >= left.length && r.to >= right.length) return null; // nothing split: the caller places it whole
  return { toL: l.to, toR: r.to, height: Math.max(l.h, r.h) };
}

/** The smallest head the block could ever place: what the paginator must reserve for it in a keep chain (§13.4). */
export function dualMinHead(layout: DualLayout, moreL: number, moreR: number, rules: SplitRules): number {
  if (!rules.breaks) return layout.height;
  return Math.max(minLegalHead(layout.left, 0, moreL, rules), minLegalHead(layout.right, 0, moreR, rules));
}

export { legalDialogueSplit };
