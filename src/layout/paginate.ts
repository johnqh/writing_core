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
 * Speed-mode scope. Not implemented (deps hooks are declared for them and are inert today):
 * `(MORE)` and `(CONT'D)` decorations and the dialogue bottom reserve (Task 22 — `bottomReserve`
 * is consulted but defaults to 0; `splitDialogue` is not yet consulted because dialogue splitting
 * is done natively on rows), dual dialogue splitting (23) and column-row splitting (24) — both
 * block kinds are placed as unsplittable stacks — graphic-novel top decorations (25), page locks
 * and segments (27), `headingsNeverOrphaned: false` and `minLinesWithHeading` for non-heading
 * links beyond the paragraph minimum.
 */
import type { ElementId } from '../ids/ids.js';
import type { PageSpec } from '../schema/template.js';
import { firstPara, keepChains, lastPara, type Block, type BlockPara, type DialogueBlock, type DualBlock } from './blocks.js';
import type { ParaLine } from './paragraph.js';
import type { LayoutDiagnostic, PageStartState, TopDecoration } from './types.js';

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
export interface ColumnRow { paras: BlockPara[] }

export interface PaginateDeps {
  bottomReserve(state: FillState): number; // Task 22; default () => 0
  splitDialogue(block: DialogueBlock, avail: number): SplitChoice | null; // Task 22; default null (rows split natively)
  splitDual(block: DualBlock, avail: number): DualSplit | null; // Task 23; default null
  splitRow(row: ColumnRow, avail: number): RowSplit | null; // Task 24; default null
  topDecorations(state: FillState): TopDecoration[]; // Tasks 22, 25; default []
}

export const DEFAULT_PAGINATE_DEPS: PaginateDeps = {
  bottomReserve: () => 0,
  splitDialogue: () => null,
  splitDual: () => null,
  splitRow: () => null,
  topDecorations: () => [],
};

export interface PlacedLine {
  elementId: ElementId;
  lineIndexInElement: number;
  line: ParaLine;
  /** Top of the line, EMU from `bodyTop`. */
  y: number;
}

export interface FilledPage {
  index: number;
  lines: PlacedLine[];
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
}

const HEADING_CATEGORIES: ReadonlySet<string> = new Set(['sceneHeading', 'shot', 'actBreak', 'pageHeading']);

function parasOf(b: Block): BlockPara[] {
  switch (b.kind) {
    case 'single':
    case 'omittedScene': return [b.para];
    case 'dialogue': return [b.cue, ...b.members];
    case 'dual': return [b.left.cue, ...b.left.members, b.right.cue, ...b.right.members];
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
  const bodyH = geometry.bodyBottom - geometry.bodyTop;
  const minB = params.minLinesBeforeBreak ?? 2;
  const minA = params.minLinesAfterBreak ?? 2;
  const dMinB = params.dialogueMinLinesBeforeBreak ?? 2;
  const dMinA = params.dialogueMinLinesAfterBreak ?? 2;
  const kHeading = params.minLinesWithHeading ?? 2;
  const dialogueBreaks = params.dialoguePageBreaks !== false;

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

  const fillState = (): FillState => ({
    pageIndex, y, blockIndex: curGbi, lineCursor: { paragraph: curPara, line: curLine }, pendingTopDecorations: [],
    sceneContinuationCount: new Map(), lockSegment: null,
  });
  const startPage = (): FilledPage => {
    page = {
      index: pageIndex, lines: [], usedHeight: 0, sceneIds: [],
      startState: {
        blockIndex: 0, elementId: '' as ElementId, lineIndexInElement: 0, partial: null, pendingTop: [], sceneId: null,
        sceneContinuationCount: 0, lockSegment: null, firstLineFingerprint: 0,
      },
    };
    return page;
  };
  const endPage = (): void => {
    if (page && page.lines.length > 0) {
      page.usedHeight = y;
      pages.push(page);
      pageIndex++;
      page = null;
      y = 0;
    }
  };
  const pageEmpty = (): boolean => page === null || page.lines.length === 0;

  const chains = keepChains(blocks);
  // A pageBreakBefore on a later block of a chain splits the chain there (the link is dropped).
  const runs: { from: number; to: number }[] = [];
  for (const c of chains) {
    let from = c.from;
    for (let i = c.from + 1; i <= c.to; i++) {
      if (firstPara(blocks[i] as Block).flags.pageBreakBefore) {
        runs.push({ from, to: i - 1 });
        from = i;
      }
    }
    runs.push({ from, to: c.to });
  }

  for (const run of runs) {
    // Rows of this chain.
    const rows: Row[] = [];
    const chainBlocks = blocks.slice(run.from, run.to + 1);
    chainBlocks.forEach((b, bi) => {
      const bStart = rows.length;
      const prevLinked = bi > 0 ? HEADING_CATEGORIES.has(lastPara(chainBlocks[bi - 1] as Block).ctx.category) : false;
      parasOf(b).forEach((p, pi) => {
        const n = p.layout.lines.length;
        for (let li = 0; li < n; li++) {
          rows.push({
            h: (p.layout.lines[li] as ParaLine).pitch, sb: li === 0 ? p.layout.spaceBefore : 0, p, line: li, nLines: n, bi, bStart,
            gbi: run.from + bi + blockOffset, pi, kind: b.kind, kFirst: pi === 0 && prevLinked ? kHeading : 0,
          });
        }
      });
    });
    if (rows.length === 0) continue;
    const links = chainBlocks.length - 1;

    const pre = new Float64Array(rows.length + 1);
    const spoken = new Int32Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as Row;
      pre[i + 1] = (pre[i] as number) + r.h + r.sb;
      spoken[i + 1] = (spoken[i] as number) + (r.p.ctx.category === 'dialogue' ? 1 : 0);
    }
    const heightOf = (a: number, b: number, top: boolean): number => (pre[b] as number) - (pre[a] as number) - (top ? (rows[a] as Row).sb : 0);

    /** Is a split between rows s-1 and s legal, at relaxation `level`, with the last `dropped` links dropped? */
    const legal = (s: number, cursor: number, level: number, dropped: number): boolean => {
      if (level >= 3) return true;
      const a = rows[s - 1] as Row;
      const b = rows[s] as Row;
      if (a.bi !== b.bi) return a.bi >= links - dropped;
      if (a.p === b.p) {
        // Inside a paragraph, after line a.line.
        if (!a.p.flags.splittable) return false;
        const inDialogue = a.kind === 'dialogue';
        if (inDialogue && !dialogueBreaks) return false;
        if (a.kind === 'dual' || a.kind === 'columnRows') return false;
        if (level < 2) {
          const before = inDialogue ? dMinB : minB;
          const after = inDialogue ? dMinA : minA;
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
        if (y + heightOf(cursor, s, pageEmpty()) > avail) continue;
        if (legal(s, cursor, level, dropped)) return s;
      }
      return -1;
    };

    const emit = (from: number, to: number): void => {
      const pg = page ?? startPage();
      for (let i = from; i < to; i++) {
        const r = rows[i] as Row;
        if (pg.lines.length === 0) {
          pg.startState = {
            blockIndex: r.gbi, elementId: r.p.layout.elementId, lineIndexInElement: r.line,
            partial: r.line > 0 || (r.pi > 0 && r.kind === 'dialogue') ? { kind: 'paragraph', cursor: [r.pi, r.line] } : null,
            pendingTop: [], sceneId: r.p.ctx.sceneId, sceneContinuationCount: 0, lockSegment: null,
            firstLineFingerprint: fnv(`${r.p.layout.elementId}:${(r.p.layout.lines[r.line] as ParaLine).sourceStart}`),
          };
        } else y += r.sb;
        pg.lines.push({ elementId: r.p.layout.elementId, lineIndexInElement: r.line, line: r.p.layout.lines[r.line] as ParaLine, y });
        y += r.h;
        const sc = r.p.ctx.sceneId;
        if (sc !== null && !pg.sceneIds.includes(sc)) pg.sceneIds.push(sc);
      }
    };

    // pageBreakBefore on the chain's first block (§13.3): a no-op on an empty page.
    if (firstPara(chainBlocks[0] as Block).flags.pageBreakBefore && !pageEmpty()) endPage();

    let cursor = 0;
    while (cursor < rows.length) {
      curGbi = (rows[cursor] as Row).gbi;
      curPara = (rows[cursor] as Row).pi;
      curLine = (rows[cursor] as Row).line;
      const avail = bodyH - deps.bottomReserve(fillState());
      if (y + heightOf(cursor, rows.length, pageEmpty()) <= avail) {
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
      endPage();
      cursor = s;
    }
  }

  endPage();
  if (pages.length === 0) pages.push(startPage());
  return { pages, diagnostics };
}
