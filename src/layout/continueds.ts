/**
 * Continueds, spec 02 §14: `(MORE)` at the bottom of a split dialogue, the synthesized `NAME (CONT'D)` cue
 * atop its continuation, and scene `(CONTINUED)` / `CONTINUED:` lines. This module is the single owner of
 * their text and geometry: the paginator (`paginate.ts`) and dual dialogue (`dual.ts`) consume it.
 *
 * Speed-mode scope: legal split points for a *single* dialogue block are decided by the paginator's own row
 * legality (`paginate.ts`, same §14.1 rules); `splitDialogue` here is the same rule set over a flattened side
 * (used by dual sides). A cue that wraps onto several lines is decorated with its first line only.
 */
import type { ElementId } from '../ids/ids.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { resolveStyle, type ResolvedStyle } from '../template/resolve.js';
import type { BlockPara, DialogueBlock } from './blocks.js';
import { plainLine, type LineEnv } from './decorate.js';
import { basePitchOf, type ParaLine } from './paragraph.js';
import type { LineKind } from './types.js';

/** A generated line: `(MORE)`, a synthesized cue or a scene CONTINUED. Not editable, not selectable. */
export interface DecoLine {
  kind: LineKind;
  elementId: ElementId;
  text: string;
  line: ParaLine;
}

/** Lines of one decoration block with their offsets from the block's top, and its total height. */
export interface DecoBlock {
  lines: { deco: DecoLine; dy: number }[];
  height: number;
}

export interface ContinuedsHooks {
  /** §13.3 `bottomReserve`: height held back while a page may end mid-scene; 0 when scene bottoms are off. */
  reserve: number;
  moreLine(cue: BlockPara, side: 'left' | 'right' | null): DecoLine | null;
  contdCue(cue: BlockPara, side: 'left' | 'right' | null): DecoLine | null;
  sceneTop(sceneId: ElementId, n: number): DecoBlock | null;
  /** Lines relative to the bottom of the body (`dy` is measured up from `bodyBottom`, line top). */
  sceneBottom(sceneId: ElementId): DecoBlock | null;
}

const foldContd = (s: string): string => s.replace(/\s+/g, '').replace(/[‘’ʼ`]/g, "'").toUpperCase();

/** §14.1 top decoration text: `cueName + [" " + cueExtensions] + contJoiner + contText`, never doubling `contText`. */
export function synthesizedCue(cueDisplay: string, cont: string, joiner: string): string {
  const base = cueDisplay.trim();
  if (cont !== '' && foldContd(base).endsWith(foldContd(cont))) return base;
  return base + joiner + cont;
}

/** Display text of a laid-out cue paragraph (all caps and any automatic CONT'D already applied). */
export function cueDisplayText(cue: BlockPara): string {
  return cue.layout.lines.map((l) => l.runs.map((r) => r.text).join('')).join(' ').trim();
}

export interface SideGeometryFn {
  (category: 'character' | 'parenthetical' | 'dialogue', side: 'left' | 'right'): { textLeft: number; width: number };
}

export interface ContinuedsEnv extends LineEnv {
  /** Present when dual dialogue is laid out side by side. */
  sideGeometry?: SideGeometryFn | null;
}

function styleOr(template: EmbeddedTemplateJSON, id: string | null | undefined): ResolvedStyle {
  return resolveStyle(template, (id ?? template.defaults.root) as never);
}

function boxOf(template: EmbeddedTemplateJSON, style: ResolvedStyle): { textLeft: number; width: number } {
  const pg = template.page;
  const textLeft = pg.margins.left + style.indentLeft;
  return { textLeft, width: pg.width - pg.margins.right - style.indentRight - textLeft };
}

/** `(MORE)` in the cue's geometry (or the `continuedsStyle` font when set), no space before (§14.1). */
export function moreLine(env: ContinuedsEnv, cue: BlockPara, side: 'left' | 'right' | null): DecoLine | null {
  const t = env.template;
  const rules = t.pagination.dialogue;
  if (!rules.moreAtBottom || t.continueds.more === '') return null;
  const cueStyle = cue.style ?? styleOr(t, t.defaults.character);
  const style = t.continueds.styleId ? { ...cueStyle, font: styleOr(t, t.continueds.styleId).font } : cueStyle;
  const box = side && env.sideGeometry ? env.sideGeometry('character', side) : boxOf(t, cueStyle);
  const line = plainLine(env, t.continueds.more, style, box.textLeft, box.width, 'left');
  return line ? { kind: 'more', elementId: cue.layout.elementId, text: t.continueds.more, line } : null;
}

/** The synthesized cue line atop a continuation (§14.1); null when `contAtTop` is off. */
export function contdCueLine(env: ContinuedsEnv, cue: BlockPara, side: 'left' | 'right' | null): DecoLine | null {
  const t = env.template;
  if (!t.pagination.dialogue.contAtTop) return null;
  const cueStyle = cue.style ?? styleOr(t, t.defaults.character);
  const box = side && env.sideGeometry ? env.sideGeometry('character', side) : boxOf(t, cueStyle);
  const text = synthesizedCue(cueDisplayText(cue), t.continueds.cont, t.continueds.joiner);
  const line = plainLine(env, text, cueStyle, box.textLeft, box.width, 'left');
  return line ? { kind: 'contdCue', elementId: cue.layout.elementId, text, line } : null;
}

/** Scene `CONTINUED:` at the top of the next page (§14.4): the line, then `topBlankLines` blank lines. */
export function sceneContinuedTop(env: ContinuedsEnv, sceneId: ElementId, n: number): DecoBlock | null {
  const t = env.template;
  const rules = t.pagination.sceneContinueds;
  if (!rules.top) return null;
  const numbered = rules.numbered && n >= 2;
  const raw = numbered ? t.continueds.sceneTopNumbered : t.continueds.sceneTop;
  const text = raw.replace('{n}', String(n)).replace('#', String(n));
  if (text === '') return null;
  const style = styleOr(t, t.defaults.action);
  const box = boxOf(t, style);
  const line = plainLine(env, text, style, box.textLeft, box.width, 'left');
  if (!line) return null;
  return { lines: [{ deco: { kind: 'continuedTop', elementId: sceneId, text, line }, dy: 0 }], height: line.pitch + rules.topBlankLines * basePitchOf(t.page) };
}

/** Scene `(CONTINUED)` at the bottom of the page (§14.4), right-aligned to the transition style's text edge. */
export function sceneContinuedBottom(env: ContinuedsEnv, sceneId: ElementId): DecoBlock | null {
  const t = env.template;
  const rules = t.pagination.sceneContinueds;
  if (!rules.bottom || t.continueds.sceneBottom === '') return null;
  const style = styleOr(t, t.defaults.transition ?? t.defaults.action);
  const box = boxOf(t, style);
  const text = t.continueds.sceneBottom;
  const line = plainLine(env, text, style, box.textLeft, box.width, 'right');
  if (!line) return null;
  return { lines: [{ deco: { kind: 'continuedBottom', elementId: sceneId, text, line }, dy: line.pitch }], height: line.pitch + rules.bottomBlankLines * basePitchOf(t.page) };
}

/** §13.3: the height held back while the page may end mid-scene. */
export function bottomReserve(env: ContinuedsEnv): number {
  const b = sceneContinuedBottom(env, '' as ElementId);
  return b ? b.height : 0;
}

export function makeContinueds(env: ContinuedsEnv): ContinuedsHooks {
  return {
    reserve: bottomReserve(env),
    moreLine: (cue, side) => moreLine(env, cue, side),
    contdCue: (cue, side) => contdCueLine(env, cue, side),
    sceneTop: (id, n) => sceneContinuedTop(env, id, n),
    sceneBottom: (id) => sceneContinuedBottom(env, id),
  };
}

// ─── §14.1 legal split points over a flattened dialogue side ──────────────────────────────────────

/** One line of a dialogue side (cue, parenthetical or dialogue line), or a synthesized continuation cue. */
export interface DlgRow {
  h: number;
  sb: number;
  p: BlockPara;
  line: number;
  nLines: number;
  /** Set on a synthesized `NAME (CONT'D)` row; it is drawn from this instead of `p.layout.lines[line]`. */
  deco?: DecoLine;
}

export interface SplitRules {
  minBefore: number;
  minAfter: number;
  /** `dialoguePageBreaks`. */
  breaks: boolean;
}

export function dialogueRows(block: DialogueBlock): DlgRow[] {
  const rows: DlgRow[] = [];
  for (const p of [block.cue, ...block.members]) {
    const n = p.layout.lines.length;
    for (let li = 0; li < n; li++) rows.push({ h: (p.layout.lines[li] as ParaLine).pitch, sb: li === 0 ? p.layout.spaceBefore : 0, p, line: li, nLines: n });
  }
  return rows;
}

/** Height of rows `[a, b)`, ignoring the first row's space before (block-level space before is the caller's). */
export function rowsHeight(rows: readonly DlgRow[], a: number, b: number): number {
  let h = 0;
  for (let i = a; i < b; i++) h += (rows[i] as DlgRow).h + (i > a ? (rows[i] as DlgRow).sb : 0);
  return h;
}

/**
 * Is a split between rows `s-1` and `s` legal (§14.1 / §13.6)? `level` 0 = all rules, 1 = sentence rule
 * relaxed, 2 = widow/orphan relaxed, 3 = anywhere.
 */
export function legalDialogueSplit(rows: readonly DlgRow[], s: number, from: number, rules: SplitRules, level: number): boolean {
  if (level >= 3) return true;
  const a = rows[s - 1] as DlgRow;
  const b = rows[s] as DlgRow;
  if (!rules.breaks) return false;
  if (a.p === b.p) {
    if (!a.p.flags.splittable) return false;
    if (level < 2) {
      const startLine = (rows[from] as DlgRow).p === a.p ? (rows[from] as DlgRow).line : 0;
      if (a.line + 1 - startLine < rules.minBefore) return false;
      if (a.nLines - (a.line + 1) < rules.minAfter) return false;
    }
    if (level < 1 && a.p.flags.sentenceRule && a.p.layout.sentenceEndLines[a.line] !== 1) return false;
    return true;
  }
  if (b.p.ctx.category !== 'parenthetical') return false;
  if (a.p.ctx.category === 'parenthetical' || a.p.ctx.category === 'character') return false;
  if (level < 2) {
    let spoken = 0;
    for (let i = from; i < s; i++) if ((rows[i] as DlgRow).p.ctx.category === 'dialogue') spoken++;
    if (spoken < rules.minBefore) return false;
  }
  return true;
}

/** The largest legal `to` in `(from, rows.length)` whose head plus `moreH` fits `avail`; -1 when none. */
export function splitDialogue(rows: readonly DlgRow[], from: number, avail: number, moreH: number, rules: SplitRules, level = 0): number {
  for (let s = rows.length - 1; s > from; s--) {
    if (rowsHeight(rows, from, s) + moreH > avail) continue;
    if (legalDialogueSplit(rows, s, from, rules, level)) return s;
  }
  return -1;
}

/** The smallest legal head (with `(MORE)`) of a side, or its full height when it cannot split. */
export function minLegalHead(rows: readonly DlgRow[], from: number, moreH: number, rules: SplitRules): number {
  let best = rowsHeight(rows, from, rows.length);
  for (let s = from + 1; s < rows.length; s++) {
    if (!legalDialogueSplit(rows, s, from, rules, 0)) continue;
    best = Math.min(best, rowsHeight(rows, from, s) + moreH);
  }
  return best;
}
