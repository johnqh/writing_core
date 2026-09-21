import { describe, expect, it } from 'vitest';
import type { PaginationCategory } from './category.js';
import { CATEGORY_RULES } from './category.js';
import { formBlocks, keepChains, type BlockPara } from './blocks.js';
import type { ElementContext } from './context.js';

let n = 0;
function para(category: PaginationCategory, over: { column?: 0 | 1 | 2; dual?: { group: string; side: 'left' | 'right' }; omitted?: boolean; generatedText?: string | null; hidden?: boolean } = {}): BlockPara {
  const rule = CATEGORY_RULES[category];
  const id = `el_${n++}` as never;
  return {
    layout: { elementId: id, cacheKey: '', spaceBefore: 0, lines: [], totalHeight: 0, sentenceEndLines: new Uint8Array(0), category, diagnostics: [] },
    ctx: {
      category, sceneId: null, sceneOrdinal: 0, actId: null, omitted: over.omitted ?? false, hidden: over.hidden ?? false, speaker: null,
      autoContinued: false, numberLabel: null, generatedText: over.generatedText ?? null, dualSide: over.dual?.side ?? null, columnRowId: null, decorationHash: 0,
    } as ElementContext,
    flags: {
      keepWithNext: rule.keepsWithNext === 'always', keepsWithPrevious: rule.keepsWithPrevious, pageBreakBefore: false,
      splittable: rule.splittable, sentenceRule: false, column: over.column ?? 0, dualGroup: over.dual?.group ?? null,
    },
  };
}

describe('formBlocks', () => {
  it('a dialogue block is a cue plus consecutive members and stops at other categories and the next cue', () => {
    const blocks = formBlocks([para('character'), para('parenthetical'), para('dialogue'), para('action'), para('character'), para('dialogue'), para('character')]);
    expect(blocks.map((b) => b.kind)).toEqual(['dialogue', 'single', 'dialogue', 'dialogue']);
    expect(blocks[0]!.kind === 'dialogue' && blocks[0]!.members).toHaveLength(2);
  });

  it('pairs dual sides by group, or stacks them when dual is off', () => {
    const seq = () => [para('character', { dual: { group: 'g', side: 'left' } }), para('dialogue'), para('character', { dual: { group: 'g', side: 'right' } }), para('dialogue')];
    expect(formBlocks(seq()).map((b) => b.kind)).toEqual(['dual']);
    expect(formBlocks(seq(), { dual: false }).map((b) => b.kind)).toEqual(['dialogue', 'dialogue']);
  });

  it('delimits a maximal run of column paragraphs and collapses an omitted scene', () => {
    const blocks = formBlocks([
      para('action'), para('action', { column: 1 }), para('action', { column: 2 }), para('action'),
      para('sceneHeading', { omitted: true, generatedText: 'OMITTED' }), para('action', { omitted: true, hidden: true }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['single', 'columnRows', 'single', 'omittedScene']);
  });
});

describe('keepChains', () => {
  it('links heading -> shot -> action transitively and keeps a transition with the previous block', () => {
    const blocks = formBlocks([para('sceneHeading'), para('shot'), para('action'), para('action'), para('transition'), para('action')]);
    expect(keepChains(blocks)).toEqual([{ from: 0, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 5 }]);
  });
});
