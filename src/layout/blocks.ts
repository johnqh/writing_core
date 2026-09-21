/**
 * Block formation, spec 02 §12 (S4): the paginator's unit is a block — a sequence of paragraph
 * layouts with attached rules — and `keepChains` links consecutive blocks that must share a page.
 *
 * Boundary with Task 24: a `columnRows` block only *delimits* the maximal run of `column ∈ {1,2}`
 * paragraphs here; splitting it into §16.1 rows is Task 24's `formRows`.
 */
import type { ResolvedStyle } from '../template/resolve.js';
import { CATEGORY_RULES, type PaginationCategory } from './category.js';
import type { ElementContext } from './context.js';
import type { ParagraphLayout } from './paragraph.js';

/** Per-paragraph pagination flags, derived once from the effective style (§9.2). */
export interface ParaFlags {
  keepWithNext: boolean;
  keepsWithPrevious: boolean;
  pageBreakBefore: boolean;
  /** Category and style allow the paragraph's lines to be distributed across pages (§9.2). */
  splittable: boolean;
  /** `splitRule: 'sentences'` — §13.6 rule 3 applies regardless of the global flag. */
  sentenceRule: boolean;
  column: 0 | 1 | 2;
  dualGroup: string | null;
}

export interface BlockPara {
  layout: ParagraphLayout;
  ctx: ElementContext;
  flags: ParaFlags;
  /** The resolved style, when the caller has it (continueds decorations are laid out in the cue's style). */
  style?: ResolvedStyle;
}

export interface SingleBlock { kind: 'single'; para: BlockPara }
export interface DialogueBlock { kind: 'dialogue'; cue: BlockPara; members: BlockPara[] }
export interface DualBlock { kind: 'dual'; group: string; left: DialogueBlock; right: DialogueBlock }
export interface ColumnRowsBlock { kind: 'columnRows'; paras: BlockPara[] }
export interface OmittedSceneBlock { kind: 'omittedScene'; para: BlockPara }
export type Block = SingleBlock | DialogueBlock | DualBlock | ColumnRowsBlock | OmittedSceneBlock;

/** A maximal run of blocks `[from, to]` (inclusive) linked by keep rules. */
export interface Chain { from: number; to: number }

export function paraFlags(
  style: ResolvedStyle,
  category: PaginationCategory,
  opts: { actBreakStartsPage?: boolean; dualGroup?: string | null } = {},
): ParaFlags {
  const rule = CATEGORY_RULES[category];
  return {
    keepWithNext: rule.keepsWithNext === 'always' || (rule.keepsWithNext === 'style' && style.keepWithNext),
    keepsWithPrevious: rule.keepsWithPrevious,
    pageBreakBefore: style.pageBreakBefore || (opts.actBreakStartsPage === true && style.role === 'actStart'),
    splittable: rule.splittable && !style.keepTogether && style.splitRule !== 'never',
    sentenceRule: style.splitRule === 'sentences',
    column: style.column,
    dualGroup: opts.dualGroup ?? null,
  };
}

export interface FormBlocksOptions {
  /** `dualDialogueEnabled`: when false, `dual` groups lay out stacked as ordinary dialogue blocks. */
  dual?: boolean;
}

export function firstPara(b: Block): BlockPara {
  switch (b.kind) {
    case 'single':
    case 'omittedScene': return b.para;
    case 'dialogue': return b.cue;
    case 'dual': return b.left.cue;
    case 'columnRows': return b.paras[0] as BlockPara;
  }
}

export function lastPara(b: Block): BlockPara {
  switch (b.kind) {
    case 'single':
    case 'omittedScene': return b.para;
    case 'dialogue': return b.members[b.members.length - 1] ?? b.cue;
    case 'dual': return lastPara(b.right);
    case 'columnRows': return b.paras[b.paras.length - 1] as BlockPara;
  }
}

/** §12: hidden paragraphs produce no lines and are skipped. `paras` is in document order. */
export function formBlocks(paras: readonly BlockPara[], opts: FormBlocksOptions = {}): Block[] {
  const dualOn = opts.dual !== false;
  const visible = paras.filter((p) => !p.ctx.hidden);
  const blocks: Block[] = [];
  let i = 0;
  while (i < visible.length) {
    const p = visible[i] as BlockPara;
    const cat = p.ctx.category;

    if (p.ctx.omitted && p.ctx.generatedText !== null) {
      blocks.push({ kind: 'omittedScene', para: p });
      i++;
      continue;
    }
    if (p.flags.column === 1 || p.flags.column === 2) {
      const run: BlockPara[] = [];
      while (i < visible.length && ((visible[i] as BlockPara).flags.column === 1 || (visible[i] as BlockPara).flags.column === 2)) run.push(visible[i++] as BlockPara);
      blocks.push({ kind: 'columnRows', paras: run });
      continue;
    }
    if (cat === 'character') {
      const members: BlockPara[] = [];
      i++;
      while (i < visible.length) {
        const q = visible[i] as BlockPara;
        if (CATEGORY_RULES[q.ctx.category].dialogueBlock !== 'member' || q.flags.column !== 0) break;
        members.push(q);
        i++;
      }
      const block: DialogueBlock = { kind: 'dialogue', cue: p, members };
      const prev = blocks[blocks.length - 1];
      // A dual pair: this cue's group matches the previous block's (opposite sides).
      if (
        dualOn && prev && prev.kind === 'dialogue' && p.flags.dualGroup !== null &&
        prev.cue.flags.dualGroup === p.flags.dualGroup && prev.cue.ctx.dualSide === 'left' && p.ctx.dualSide === 'right'
      ) {
        blocks[blocks.length - 1] = { kind: 'dual', group: p.flags.dualGroup, left: prev, right: block };
      } else blocks.push(block);
      continue;
    }
    blocks.push({ kind: 'single', para: p });
    i++;
  }
  return blocks;
}

/** §12: block A keeps with B when A's last paragraph keeps with next, or B's first keeps with previous. */
export function keepChains(blocks: readonly Block[]): Chain[] {
  const chains: Chain[] = [];
  let from = 0;
  for (let i = 0; i < blocks.length; i++) {
    const linked = i + 1 < blocks.length && (lastPara(blocks[i] as Block).flags.keepWithNext || firstPara(blocks[i + 1] as Block).flags.keepsWithPrevious);
    if (!linked) {
      chains.push({ from, to: i });
      from = i + 1;
    }
  }
  return chains;
}
