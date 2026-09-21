/**
 * The paginator, spec 02 §13 (S5, page mode).
 *
 * Model. Each keep chain (§12) is flattened into *rows* — one per paragraph line, carrying its
 * pitch and the space before it — and the loop of §13.3 places rows top to bottom. A split is a
 * boundary between two rows; whether it is legal is decided per boundary (§13.4 keeps, §13.5
 * transitions, §13.6 widow/orphan/sentence rules, §14.1 dialogue split points). The largest legal
 * boundary whose head fits wins. If a fresh page still cannot hold a legal head, the ladder relaxes
 * in the spec's order: drop keep links from the last backwards (`keepViolated`), relax the
 * sentence rule, relax widow/orphan (`forcedSplit`), then split at any boundary.
 *
 * Continueds (Task 22, `continueds.ts`). A split inside a dialogue block adds the `(MORE)` line to the head's
 * height and queues the synthesized cue for the next page. `openPage` runs once per fresh page, before anything is
 * placed: it decides scene CONTINUED (bottom on the previous page, top on this one) from the scene of the last
 * placed line and the scene of the next row, and stacks the top decorations, so `y` already includes them. The
 * scene-bottom reserve is held back everywhere except for a chain that ends its scene (the page then ends at a
 * scene boundary and the reserve is reclaimed).
 *
 * Dual dialogue (Task 23, `dual.ts`). A dual block is the LAST block of its run (the run is cut after it) and is one
 * pseudo-row in the chain, as tall as the smallest legal head, so keeps and the fit test work unchanged; when the
 * row is reached `placeDual` places (and splits) the two side-by-side stacks itself.
 *
 * Speed-mode scope. Not implemented: column-row splitting (24) — column blocks are placed as unsplittable
 * stacks — graphic-novel top decorations (25), page locks and segments (27), `headingsNeverOrphaned: false`
 * and `minLinesWithHeading` for non-heading links beyond the paragraph minimum; a keep link from a dual block to
 * a following transition is dropped (the run is cut after the dual block).
 */
import type { ElementId } from '../ids/ids.js';
import type { PageSpec } from '../schema/template.js';
import { firstPara, keepChains, lastPara, type Block, type BlockPara, type ColumnRowsBlock, type DialogueBlock, type DualBlock } from './blocks.js';
import { layoutRow, rowMinHead, splitRowSides, type ColumnRow, type RowLayout, type RowRules, type SideRow } from './columns.js';
import type { ParaLine } from './paragraph.js';
import { rowsHeight, type ContinuedsHooks, type DecoLine, type DlgRow, type SplitRules } from './continueds.js';
import { dualMinHead, layoutDual, splitDual, type DualLayout } from './dual.js';
import type { LayoutDiagnostic, LineKind, PageStartState, TopDecoration } from './types.js';

export interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  /** Absolute EMU from the page top. */
  bodyTop: number;
  bodyBottom: number;
}

export function pageGeometryOf(page: PageSpec): PageGeometry {
  return {
    pageWidth: page.width, pageHeight: page.height, bodyTop: page.margins.top, bodyBottom: page.height - page.margins.bottom,
  };
}

/** §24.2: the body is partitioned into locked segments, each filled independently (Task 27). */
export interface LockSegment { fromBlock: number; toBlock: number }

/** §9.3 short names. */
export interface PaginationParams {
  /** Already folded into resolved `splitRule` by `resolveStyle`; kept for parity with §9.3. */
  breakOnSentences?: boolean;
  /** `dialoguePageBreaks`; default true. */
  dialoguePageBreaks?: boolean;
  /** `minLinesBeforeBreak` / `minLinesAfterBreak` outside dialogue blocks; default 2 / 2. */
  minLinesBeforeBreak?: number;
  minLinesAfterBreak?: number;
  /** The same two, inside dialogue blocks; default 2 / 2. */
  dialogueMinLinesBeforeBreak?: number;
  dialogueMinLinesAfterBreak?: number;
  /** §13.4 `k` for heading-category keeps; default 2. */
  minLinesWithHeading?: number;
  /** `columnBlocks.breakBlocks` (§16.2): rows may split across pages; default false. */
  columnBlocksSplit?: boolean;
  segments?: readonly LockSegment[];
}

export interface BlockLineCursor { paragraph: number; line: number }

/** §13.2. */
export interface FillState {
  pageIndex: number;
  y: number;
  blockIndex: number;
  lineCursor: BlockLineCursor;
  pendingTopDecorations: TopDecoration[];
  sceneContinuationCount: Map<ElementId, number>;
  lockSegment: number | null;
}

// Result shapes for the later tasks' hooks (declared in full so the loop is written once).
export interface SplitChoice { headLines: number; more: boolean }
export interface DualSplit { headLines: number }
export interface RowSplit { headLines: number }

export interface PaginateDeps {
  bottomReserve(state: FillState): number; // Task 22; default () => 0
  splitDialogue(block: DialogueBlock, avail: number): SplitChoice | null; // Task 22; default null (rows split natively)
  splitDual(block: DualBlock, avail: number): DualSplit | null; // Task 23; default null
  splitRow(row: ColumnRow, avail: number): RowSplit | null; // Task 24; default null
  topDecorations(state: FillState): TopDecoration[]; // Tasks 22, 25; default []
  /** Task 22: `(MORE)`, synthesized cues and scene CONTINUED lines; null disables them all. */
  continueds: ContinuedsHooks | null;
}

export const DEFAULT_PAGINATE_DEPS: PaginateDeps = {
  bottomReserve: () => 0,
  splitDialogue: () => null,
  splitDual: () => null,
  splitRow: () => null,
  topDecorations: () => [],
  continueds: null,
};

export interface PlacedLine {
  elementId: ElementId;
  lineIndexInElement: number;
  line: ParaLine;
  /** Top of the line, EMU from `bodyTop`. */
  y: number;
  /** Generated lines only (`more`, `contdCue`, `continuedTop`, `continuedBottom`); absent means a text line. */
  kind?: LineKind;
  /** The side of a dual dialogue block the line belongs to. */
  dualSide?: 'left' | 'right';
  /** The column (§16) of a line inside a column row. */
  column?: 1 | 2;
}

export interface FilledPage {
  index: number;
  lines: PlacedLine[];
  /** Page-level generated lines: scene CONTINUED top/bottom and a continuation cue atop the page. */
  decor: PlacedLine[];
  /** Height of placed content, EMU. */
  usedHeight: number;
  startState: PageStartState;
  sceneIds: ElementId[];
}

interface Row {
  h: number;
  sb: number;
  p: BlockPara;
  line: number;
  nLines: number;
  /** Chain-local block index and the index of the block's first row. */
  bi: number;
  bStart: number;
  gbi: number;
  pi: number;
  kind: Block['kind'];
  /** Minimum lines of this row's paragraph a head must carry when a heading link precedes it (§13.4). */
  kFirst: number;
  /** The pseudo-row of a dual block. */
  dual?: DualLayout & { block: DualBlock };
  /** The pseudo-row of a column row (§16). */
  col?: RowLayout & { block: ColumnRowsBlock };
  /** The cue of a dialogue block, for its `(MORE)` and continuation cue. */
  cue?: BlockPara;
}

const HEADING_CATEGORIES: ReadonlySet<string> = new Set(['sceneHeading', 'shot', 'actBreak', 'pageHeading']);

function parasOf(b: Block): BlockPara[] {
  switch (b.kind) {
    case 'single':
    case 'omittedScene': return [b.para];
    case 'dialogue': return [b.cue, ...b.members];
    case 'dual': return [b.left.cue, b.right.cue];
    case 'columnRows': return b.paras;
  }
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function paginate(
  blocksIn: readonly Block[],
  geometry: PageGeometry,
  params: PaginationParams,
  depsIn: Partial<PaginateDeps> = {},
  state?: PageStartState,
): { pages: FilledPage[]; diagnostics: LayoutDiagnostic[] } {
  const deps: PaginateDeps = { ...DEFAULT_PAGINATE_DEPS, ...depsIn };
  const hooks = deps.continueds;
  const bodyH = geometry.bodyBottom - geometry.bodyTop;
  const minB = params.minLinesBeforeBreak ?? 2;
  const minA = params.minLinesAfterBreak ?? 2;
  const dMinB = params.dialogueMinLinesBeforeBreak ?? 2;
  const dMinA = params.dialogueMinLinesAfterBreak ?? 2;
  const kHeading = params.minLinesWithHeading ?? 2;
  const dialogueBreaks = params.dialoguePageBreaks !== false;
  const dualRules: SplitRules = { minBefore: dMinB, minAfter: dMinA, breaks: dialogueBreaks };
  const colRules: RowRules = { minBefore: minB, minAfter: minA, dialogueBreaks };
  const colSplit = params.columnBlocksSplit === true;

  const blockOffset = state?.blockIndex ?? 0;
  const blocks = blocksIn.slice(blockOffset);
  const diagnostics: LayoutDiagnostic[] = [];
  const pages: FilledPage[] = [];

  let pageIndex = 0;
  let page: FilledPage | null = null;
  let y = 0;
  let curGbi = 0;
  let curPara = 0;
  let curLine = 0;
  /** Has the current page been opened (top decorations decided)? */
  let opened = false;
  /** Scene of the last body line placed, for scene CONTINUED (§14.4). */
  let lastScene: ElementId | null = null;
  /** The cue whose continuation heads the next page (a dialogue split queued it). */
  let pendingCue: BlockPara | null = null;
  /** The last page-heading paragraph placed (§17), for `PAGE n (CONT'D)`. */
  let lastHeading: BlockPara | null = null;
  const sceneCont = new Map<ElementId, number>();

  const fillState = (): FillState => ({
    pageIndex, y, blockIndex: curGbi, lineCursor: { paragraph: curPara, line: curLine }, pendingTopDecorations: [],
    sceneContinuationCount: new Map(), lockSegment: null,
  });
  const startPage = (): FilledPage => {
    page = {
      index: pageIndex, lines: [], decor: [], usedHeight: 0, sceneIds: [],
      startState: {
        blockIndex: 0, elementId: '' as ElementId, lineIndexInElement: 0, partial: null, pendingTop: [], sceneId: null,
        sceneContinuationCount: 0, lockSegment: null, firstLineFingerprint: 0,
      },
    };
    return page;
  };
  const curPage = (): FilledPage => page ?? startPage();
  const endPage = (): void => {
    if (page && page.lines.length > 0) {
      page.usedHeight = y;
      pages.push(page);
      pageIndex++;
      page = null;
      y = 0;
      opened = false;
    }
  };
  const pageEmpty = (): boolean => page === null || page.lines.length === 0;
  const reserveFor = (scene: ElementId | null): number => (scene === null ? 0 : hooks ? hooks.reserve : deps.bottomReserve(fillState()));

  /** Decide a fresh page's top decorations (and the previous page's bottom one) before anything is placed. */
  const openPage = (nextScene: ElementId | null, first: BlockPara | null = null): void => {
    opened = true;
    const prev = pages[pages.length - 1];
    if (!prev) {
      pendingCue = null;
      return;
    }
    const pg = curPage();
    let h = 0;
    if (hooks && lastScene !== null && lastScene === nextScene) {
      const bottom = hooks.sceneBottom(lastScene);
      if (bottom) for (const l of bottom.lines) prev.decor.push({ elementId: l.deco.elementId, lineIndexInElement: -1, line: l.deco.line, y: bodyH - l.dy, kind: l.deco.kind });
      const n = (sceneCont.get(lastScene) ?? 0) + 1;
      sceneCont.set(lastScene, n);
      const top = hooks.sceneTop(lastScene, n);
      if (top) {
        // The scene number is drawn on this line at the scene-number positions (§14.4), so it carries the heading's id and line 0.
        for (const l of top.lines) pg.decor.push({ elementId: l.deco.elementId, lineIndexInElement: 0, line: l.deco.line, y: h + l.dy, kind: l.deco.kind });
        h += top.height;
      }
    }
    // §17: a script page break inside a comic page starts the next page with `PAGE n (CONT'D)`.
    if (hooks?.pageContd && lastHeading && first && first.ctx.category !== 'pageHeading') {
      const d = hooks.pageContd(lastHeading);
      if (d) {
        pg.decor.push({ elementId: d.elementId, lineIndexInElement: -1, line: d.line, y: h, kind: 'pageHeadingContd' });
        h += d.line.pitch;
      }
    }
    if (hooks && pendingCue) {
      const d = hooks.contdCue(pendingCue, null);
      if (d) {
        pg.decor.push({ elementId: d.elementId, lineIndexInElement: -1, line: d.line, y: h, kind: d.kind });
        h += d.line.pitch;
      }
    }
    pendingCue = null;
    y = h;
    pg.startState.pendingTop = pg.decor.map((l): TopDecoration => ({ kind: (l.kind ?? 'contdCue') as TopDecoration['kind'], elementId: l.elementId, text: '' }));
  };

  const noteFirstLine = (pg: FilledPage, r: { gbi: number; p: BlockPara; line: number; pi: number }, partial: PageStartState['partial']): void => {
    if (pg.lines.length > 0) return;
    pg.startState = {
      blockIndex: r.gbi, elementId: r.p.layout.elementId, lineIndexInElement: r.line, partial, pendingTop: pg.startState.pendingTop,
      sceneId: r.p.ctx.sceneId, sceneContinuationCount: 0, lockSegment: null,
      firstLineFingerprint: fnv(`${r.p.layout.elementId}:${(r.p.layout.lines[r.line] as ParaLine).sourceStart}`),
    };
  };
  const noteScene = (pg: FilledPage, scene: ElementId | null): void => {
    if (scene === null) return;
    lastScene = scene;
    if (!pg.sceneIds.includes(scene)) pg.sceneIds.push(scene);
  };

  const chains = keepChains(blocks);
  // A pageBreakBefore on a later block of a chain splits the chain there; a dual block or a column row always ends its run (see header).
  const runs: { from: number; to: number }[] = [];
  for (const c of chains) {
    let from = c.from;
    for (let i = c.from; i < c.to; i++) {
      if (firstPara(blocks[i + 1] as Block).flags.pageBreakBefore || (blocks[i] as Block).kind === 'dual' || (blocks[i] as Block).kind === 'columnRows') {
        runs.push({ from, to: i });
        from = i + 1;
      }
    }
    runs.push({ from, to: c.to });
  }

  const moreCache: Record<'none' | 'left' | 'right', Map<BlockPara, DecoLine | null>> = { none: new Map(), left: new Map(), right: new Map() };
  const moreOf = (cue: BlockPara, side: 'left' | 'right' | null = null): DecoLine | null => {
    const cache = moreCache[side ?? 'none'];
    if (!cache.has(cue)) cache.set(cue, hooks ? hooks.moreLine(cue, side) : null);
    return cache.get(cue) ?? null;
  };

  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri] as { from: number; to: number };
    // Rows of this chain.
    const rows: Row[] = [];
    const chainBlocks = blocks.slice(run.from, run.to + 1);
    chainBlocks.forEach((b, bi) => {
      const bStart = rows.length;
      const prevLinked = bi > 0 ? HEADING_CATEGORIES.has(lastPara(chainBlocks[bi - 1] as Block).ctx.category) : false;
      if (b.kind === 'dual') {
        const layout = layoutDual(b);
        const mL = moreOf(b.left.cue, 'left')?.line.pitch ?? 0;
        const mR = moreOf(b.right.cue, 'right')?.line.pitch ?? 0;
        rows.push({
          h: dualMinHead(layout, mL, mR, dualRules), sb: layout.spaceBefore, p: b.left.cue, line: 0, nLines: 1, bi, bStart,
          gbi: run.from + bi + blockOffset, pi: 0, kind: 'dual', kFirst: 0, dual: { ...layout, block: b },
        });
        return;
      }
      if (b.kind === 'columnRows') {
        const layout = layoutRow(b.row);
        if (layout.overlap) diagnostics.push({ code: 'columnOverlap', elementId: b.paras[0]?.layout.elementId ?? null, pageIndex: null, detail: {} });
        rows.push({
          h: colSplit ? rowMinHead(layout, colRules) : layout.height, sb: layout.spaceBefore, p: b.paras[0] as BlockPara, line: 0, nLines: 1, bi, bStart,
          gbi: run.from + bi + blockOffset, pi: 0, kind: 'columnRows', kFirst: 0, col: { ...layout, block: b },
        });
        return;
      }
      parasOf(b).forEach((p, pi) => {
        const n = p.layout.lines.length;
        for (let li = 0; li < n; li++) {
          rows.push({
            h: (p.layout.lines[li] as ParaLine).pitch, sb: li === 0 ? p.layout.spaceBefore : 0, p, line: li, nLines: n, bi, bStart,
            gbi: run.from + bi + blockOffset, pi, kind: b.kind, kFirst: pi === 0 && prevLinked ? kHeading : 0,
            ...(b.kind === 'dialogue' ? { cue: b.cue } : {}),
          });
        }
      });
    });
    if (rows.length === 0) continue;
    const links = chainBlocks.length - 1;
    const lastRow = rows[rows.length - 1] as Row;
    const nextRun = runs[ri + 1];
    const nextScene = nextRun ? firstPara(blocks[nextRun.from] as Block).ctx.sceneId : null;
    // §13.3: a chain that ends its scene may use the reserve — the page then ends at a scene boundary.
    const sceneFinal = !nextRun || lastRow.p.ctx.sceneId !== nextScene;

    const pre = new Float64Array(rows.length + 1);
    const spoken = new Int32Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Row;
      pre[i + 1] = (pre[i] as number) + r.h + r.sb;
      spoken[i + 1] = (spoken[i] as number) + (r.p.ctx.category === 'dialogue' ? 1 : 0);
    }
    const heightOf = (a: number, b: number, top: boolean): number => (pre[b] as number) - (pre[a] as number) - (top ? (rows[a] as Row).sb : 0);

    /** A split between rows s-1 and s falls inside a dialogue block. */
    const inDialogue = (s: number): boolean => {
      const a = rows[s - 1] as Row;
      const b = rows[s] as Row;
      return a.kind === 'dialogue' && a.bi === b.bi;
    };
    const moreFor = (s: number): number => (inDialogue(s) && rows[s] ? moreOf((rows[s] as Row).cue as BlockPara)?.line.pitch ?? 0 : 0);

    /** Is a split between rows s-1 and s legal, at relaxation `level`, with the last `dropped` links dropped? */
    const legal = (s: number, cursor: number, level: number, dropped: number): boolean => {
      if (level >= 3) return true;
      const a = rows[s - 1] as Row;
      const b = rows[s] as Row;
      if (a.bi !== b.bi) return a.bi >= links - dropped;
      if (a.p === b.p) {
        // Inside a paragraph, after line a.line.
        if (!a.p.flags.splittable) return false;
        const dlg = a.kind === 'dialogue';
        if (dlg && !dialogueBreaks) return false;
        if (a.kind === 'dual' || a.kind === 'columnRows') return false;
        if (level < 2) {
          const before = dlg ? dMinB : minB;
          const after = dlg ? dMinA : minA;
          const startLine = (rows[cursor] as Row).p === a.p ? (rows[cursor] as Row).line : 0;
          const headLines = a.line + 1 - startLine;
          if (headLines < Math.max(before, a.kFirst)) return false;
          if (a.nLines - (a.line + 1) < after) return false;
        }
        if (level < 1 && a.p.flags.sentenceRule && a.p.layout.sentenceEndLines[a.line] !== 1) return false;
        return true;
      }
      // Between paragraphs of one block: dialogue only, before a parenthetical (§14.1).
      if (a.kind !== 'dialogue' || !dialogueBreaks) return false;
      if (b.p.ctx.category !== 'parenthetical') return false;
      if (a.p.ctx.category === 'parenthetical' || a.p.ctx.category === 'character') return false;
      if (level < 2) {
        const from = Math.max(cursor, a.bStart);
        if ((spoken[s] as number) - (spoken[from] as number) < dMinB) return false;
      }
      return true;
    };

    const findSplit = (cursor: number, avail: number, level: number, dropped: number): number => {
      for (let s = rows.length - 1; s > cursor; s--) {
        if (y + heightOf(cursor, s, pageEmpty()) + moreFor(s) > avail) continue;
        if (legal(s, cursor, level, dropped)) return s;
      }
      return -1;
    };

    /** A dual block's rows on one side, placed at `y0`; returns the bottom y. */
    const emitSide = (pg: FilledPage, rowsOf: readonly DlgRow[], a: number, b: number, side: 'left' | 'right', y0: number): number => {
      let yy = y0;
      for (let i = a; i < b; i++) {
        const dr = rowsOf[i] as DlgRow;
        if (i > a) yy += dr.sb;
        if (dr.deco) pg.lines.push({ elementId: dr.deco.elementId, lineIndexInElement: -1, line: dr.deco.line, y: yy, kind: 'contdCue', dualSide: side });
        else pg.lines.push({ elementId: dr.p.layout.elementId, lineIndexInElement: dr.line, line: dr.p.layout.lines[dr.line] as ParaLine, y: yy, dualSide: side });
        yy += dr.h;
      }
      return yy;
    };

    /** Place (and split) a dual block: both stacks side by side at the same y, height = max of the two (§15). */
    const placeDual = (r: Row): void => {
      const d = r.dual as NonNullable<Row['dual']>;
      const blk = d.block;
      const moreL = moreOf(blk.left.cue, 'left');
      const moreR = moreOf(blk.right.cue, 'right');
      const mL = moreL?.line.pitch ?? 0;
      const mR = moreR?.line.pitch ?? 0;
      let L = d.left;
      let R = d.right;
      const scene = r.p.ctx.sceneId;
      let sb = d.spaceBefore;
      for (let guard = 0; guard < 500; guard++) {
        const top = pageEmpty();
        const y0 = y + (top ? 0 : sb);
        const reserve = reserveFor(scene);
        const avail = bodyH - reserve - y0;
        const availWhole = sceneFinal ? bodyH - y0 : avail;
        const hFull = Math.max(rowsHeight(L, 0, L.length), rowsHeight(R, 0, R.length));
        const pg = curPage();
        const place = (toL: number, toR: number, height: number): void => {
          noteFirstLine(pg, { gbi: r.gbi, p: L[0]?.p ?? r.p, line: L[0]?.line ?? 0, pi: 0 }, { kind: 'dual', cursor: [0, 0] });
          emitSide(pg, L, 0, toL, 'left', y0);
          emitSide(pg, R, 0, toR, 'right', y0);
          if (toL < L.length && moreL) pg.lines.push({ elementId: moreL.elementId, lineIndexInElement: -1, line: moreL.line, y: y0 + rowsHeight(L, 0, toL), kind: 'more', dualSide: 'left' });
          if (toR < R.length && moreR) pg.lines.push({ elementId: moreR.elementId, lineIndexInElement: -1, line: moreR.line, y: y0 + rowsHeight(R, 0, toR), kind: 'more', dualSide: 'right' });
          y = y0 + height;
          noteScene(pg, scene);
        };
        if (hFull <= availWhole) {
          place(L.length, R.length, hFull);
          return;
        }
        let choice = dialogueBreaks ? splitDual(L, R, [0, 0], avail, mL, mR, dualRules, 0) : null;
        if (!choice && !top) {
          endPage();
          openPage(scene);
          sb = 0;
          continue;
        }
        if (!choice) {
          // A fresh page and no legal head: relax as §13.6 does (widow/orphan, then anywhere), diagnosing forcedSplit.
          for (let level = 1; level <= 3 && !choice; level++) {
            choice = splitDual(L, R, [0, 0], avail, mL, mR, { ...dualRules, breaks: true }, level);
            if (choice) diagnostics.push({ code: 'forcedSplit', elementId: blk.left.cue.layout.elementId, pageIndex, detail: { relaxedLevel: level, dual: 1 } });
          }
        }
        if (!choice) {
          place(L.length, R.length, hFull); // nothing splits: overflow rather than loop
          return;
        }
        place(choice.toL, choice.toR, choice.height);
        endPage();
        const tail = (rowsOf: readonly DlgRow[], to: number, cue: BlockPara, side: 'left' | 'right'): DlgRow[] => {
          if (to >= rowsOf.length) return [];
          const out = rowsOf.slice(to);
          const c = hooks?.contdCue(cue, side) ?? null;
          if (c) out.unshift({ h: c.line.pitch, sb: 0, p: cue, line: 0, nLines: 1, deco: c });
          return out;
        };
        L = tail(L, choice.toL, blk.left.cue, 'left');
        R = tail(R, choice.toR, blk.right.cue, 'right');
        openPage(scene);
        sb = 0;
      }
    };

    const emitCol = (pg: FilledPage, rowsOf: readonly SideRow[], b: number, column: 1 | 2, y0: number): void => {
      let yy = y0;
      for (let i = 0; i < b; i++) {
        const cr = rowsOf[i] as SideRow;
        if (i > 0) yy += cr.sb;
        pg.lines.push({ elementId: cr.p.layout.elementId, lineIndexInElement: cr.line, line: cr.p.layout.lines[cr.line] as ParaLine, y: yy, column });
        yy += cr.h;
      }
    };

    /** Place (and split, §16.2) a column row: both stacks at the same y, height = max of the two. */
    const placeColRow = (r: Row): void => {
      const d = r.col as NonNullable<Row['col']>;
      let L = d.left;
      let R = d.right;
      const scene = r.p.ctx.sceneId;
      let sb = d.spaceBefore;
      let fresh = true;
      for (let guard = 0; guard < 500; guard++) {
        const top = pageEmpty();
        const y0 = y + (top ? 0 : sb);
        const reserve = reserveFor(scene);
        const avail = bodyH - reserve - y0;
        const availWhole = sceneFinal ? bodyH - y0 : avail;
        const hFull = Math.max(rowsHeight(L, 0, L.length), rowsHeight(R, 0, R.length));
        const pg = curPage();
        const place = (toL: number, toR: number, height: number): void => {
          const first = L[0] ?? R[0];
          noteFirstLine(pg, { gbi: r.gbi, p: first?.p ?? r.p, line: first?.line ?? 0, pi: 0 }, fresh ? null : { kind: 'row', cursor: [first?.line ?? 0] });
          emitCol(pg, L, toL, 1, y0);
          emitCol(pg, R, toR, 2, y0);
          y = y0 + height;
          noteScene(pg, scene);
        };
        if (hFull <= availWhole) {
          place(L.length, R.length, hFull);
          return;
        }
        let choice = colSplit ? splitRowSides(L, R, avail, colRules, 0) : null;
        if (!choice && !top) {
          endPage();
          openPage(scene, r.p);
          sb = 0;
          continue;
        }
        if (!choice) {
          // A fresh page and no legal head: relax as §13.6 does, diagnosing forcedSplit (an over-page row is force-split even when rows never split).
          for (let level = colSplit ? 1 : 3; level <= 3 && !choice; level++) {
            choice = splitRowSides(L, R, avail, colRules, level);
            if (choice) diagnostics.push({ code: 'forcedSplit', elementId: r.p.layout.elementId, pageIndex, detail: { relaxedLevel: level, row: 1 } });
          }
        }
        if (!choice) {
          place(L.length, R.length, hFull); // nothing splits: overflow rather than loop
          return;
        }
        place(choice.toL, choice.toR, choice.height);
        endPage();
        L = L.slice(choice.toL);
        R = R.slice(choice.toR);
        fresh = false;
        openPage(scene, (L[0] ?? R[0])?.p ?? r.p);
        sb = 0;
      }
    };

    const emit = (from: number, to: number): void => {
      for (let i = from; i < to; i++) {
        const r = rows[i] as Row;
        if (r.dual) {
          placeDual(r);
          continue;
        }
        if (r.col) {
          placeColRow(r);
          continue;
        }
        const pg = curPage();
        if (pg.lines.length === 0) {
          noteFirstLine(pg, r, r.line > 0 || (r.pi > 0 && r.kind === 'dialogue') ? { kind: 'paragraph', cursor: [r.pi, r.line] } : null);
        } else y += r.sb;
        pg.lines.push({ elementId: r.p.layout.elementId, lineIndexInElement: r.line, line: r.p.layout.lines[r.line] as ParaLine, y });
        if (r.p.ctx.category === 'pageHeading') lastHeading = r.p;
        y += r.h;
        noteScene(pg, r.p.ctx.sceneId);
      }
    };

    // pageBreakBefore on the chain's first block (§13.3): a no-op on an empty page.
    if (firstPara(chainBlocks[0] as Block).flags.pageBreakBefore && !pageEmpty()) endPage();

    let cursor = 0;
    while (cursor < rows.length) {
      const row0 = rows[cursor] as Row;
      curGbi = row0.gbi;
      curPara = row0.pi;
      curLine = row0.line;
      if (!opened) openPage(row0.p.ctx.sceneId, row0.p);
      const avail = bodyH - reserveFor(row0.p.ctx.sceneId);
      const availWhole = sceneFinal ? bodyH : avail;
      if (y + heightOf(cursor, rows.length, pageEmpty()) <= availWhole) {
        emit(cursor, rows.length);
        break;
      }
      let s = findSplit(cursor, avail, 0, 0);
      if (s < 0 && !pageEmpty()) {
        endPage();
        continue;
      }
      if (s < 0) {
        // Empty page and no legal head fits: relax in spec order.
        outer: for (let d = 0; d <= links; d++) {
          for (let level = 0; level <= 2; level++) {
            s = findSplit(cursor, avail, level, d);
            if (s >= 0) {
              if (d > 0) {
                const dropIdx = links - d + 1;
                diagnostics.push({ code: 'keepViolated', elementId: firstPara(chainBlocks[dropIdx] as Block).layout.elementId, pageIndex, detail: { droppedLinks: d } });
              }
              if (level > 0) diagnostics.push({ code: 'forcedSplit', elementId: (rows[s] as Row).p.layout.elementId, pageIndex, detail: { relaxedLevel: level } });
              break outer;
            }
          }
        }
        if (s < 0) {
          s = findSplit(cursor, avail, 3, links);
          if (s < 0) s = cursor + 1; // one row always goes, however tall
          diagnostics.push({ code: 'forcedSplit', elementId: (rows[s - 1] as Row).p.layout.elementId, pageIndex, detail: { relaxedLevel: 3 } });
        }
      }
      emit(cursor, s);
      if (s < rows.length && inDialogue(s)) {
        // §14.1: `(MORE)` directly after the last head line, and the continuation cue queued for the next page.
        const more = moreOf((rows[s] as Row).cue as BlockPara);
        if (more) {
          curPage().lines.push({ elementId: more.elementId, lineIndexInElement: -1, line: more.line, y, kind: 'more' });
          y += more.line.pitch;
        }
        pendingCue = (rows[s] as Row).cue as BlockPara;
      }
      endPage();
      cursor = s;
    }
  }

  endPage();
  if (pages.length === 0) pages.push(startPage());
  return { pages, diagnostics };
}
