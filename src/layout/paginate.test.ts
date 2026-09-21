import { describe, expect, it } from 'vitest';
import { formBlocks, type BlockPara } from './blocks.js';
import { CATEGORY_RULES, type PaginationCategory } from './category.js';
import type { ElementContext } from './context.js';
import { paginate, type PaginationParams } from './paginate.js';

const PITCH = 152_400;
const GEOMETRY = { pageWidth: 7_772_400, pageHeight: 10_058_400, bodyTop: 914_400, bodyBottom: 10_058_400 - 914_400 };
const PARAMS: PaginationParams = {};
let n = 0;

function p(
  category: PaginationCategory, lines: number,
  o: { sb?: number; pbb?: boolean; splittable?: boolean; kwn?: boolean; sentences?: boolean[] } = {},
): BlockPara {
  const rule = CATEGORY_RULES[category];
  const id = `el_${n++}` as never;
  const ends = new Uint8Array(lines);
  for (let i = 0; i < lines; i++) ends[i] = o.sentences ? (o.sentences[i] ? 1 : 0) : 1;
  return {
    layout: {
      elementId: id, cacheKey: '', spaceBefore: (o.sb ?? 0) * PITCH, totalHeight: lines * PITCH, sentenceEndLines: ends, category, diagnostics: [],
      lines: Array.from({ length: lines }, (_, i) => ({ top: i * PITCH, pitch: PITCH, baseline: 0, x: 0, width: 0, sourceStart: i * 10, sourceEnd: i * 10 + 10, runs: [], hardBreak: false })),
    },
    ctx: {
      category, sceneId: null, sceneOrdinal: 0, actId: null, omitted: false, hidden: false, speaker: null, autoContinued: false, numberLabel: null,
      generatedText: null, dualSide: null, columnRowId: null, decorationHash: 0,
    } as ElementContext,
    flags: {
      keepWithNext: rule.keepsWithNext === 'always' || (o.kwn ?? false), keepsWithPrevious: rule.keepsWithPrevious, pageBreakBefore: o.pbb ?? false,
      splittable: o.splittable ?? rule.splittable, sentenceRule: false, column: 0, dualGroup: null,
    },
  };
}

const run = (paras: BlockPara[], params: PaginationParams = PARAMS) => paginate(formBlocks(paras), GEOMETRY, params, {});
const counts = (r: ReturnType<typeof run>) => r.pages.map((pg) => pg.lines.length);
const filler = (lines: number): BlockPara[] => Array.from({ length: lines }, () => p('action', 1));

describe('paginate', () => {
  it('fills 54 lines per body page and suppresses space before at the top of a page', () => {
    expect(counts(run(filler(120)))).toEqual([54, 54, 12]);
    // 1-line paragraphs with one blank line before each: the first on a page loses its space, so 27 fit.
    const spaced = Array.from({ length: 60 }, () => p('action', 1, { sb: 1 }));
    expect(counts(run(spaced))).toEqual([27, 27, 6]);
    expect(run(spaced).pages[1]!.lines[0]!.y).toBe(0);
  });

  it('keeps a scene heading with the whole of an unsplittable 3-line action (spike finding 6)', () => {
    const paras = [...filler(52), p('sceneHeading', 1), p('action', 3, { splittable: false })];
    const r = run(paras);
    expect(counts(r)).toEqual([52, 4]);
    expect(r.pages[1]!.lines[0]!.elementId).toBe(paras[52]!.layout.elementId);
  });

  it('splits a splittable paragraph at the largest legal line, honouring widow/orphan', () => {
    const big = p('action', 10);
    expect(counts(run([...filler(51), big]))).toEqual([54, 7]); // 3 lines fit, 7 carry
    const one = p('action', 10);
    expect(counts(run([...filler(53), one]))).toEqual([53, 10]); // 1 line of room: below the orphan minimum
    const three = p('action', 3);
    expect(counts(run([...filler(52), three]))).toEqual([52, 3]); // 3 < 2 + 2: unsplittable
  });

  it('breaks only after a sentence end when the sentence rule applies, then relaxes', () => {
    const para = p('action', 8, { sentences: [false, false, false, true, false, false, false, true] });
    para.flags.sentenceRule = true;
    const r = run([...filler(50), para]);
    expect(counts(r)).toEqual([54, 4]); // largest legal: after line index 3 (4 lines)
  });

  it('splits dialogue before a parenthetical, never between the cue and its first paragraph', () => {
    const dlg = [p('character', 1, { sb: 1 }), p('dialogue', 4), p('parenthetical', 1), p('dialogue', 3)];
    const r = run([...filler(47), ...dlg]);
    // 47 filler + cue (space 1 + 1 line) + 4 dialogue = 52 lines (53 with the blank); the tail dialogue cannot split 2/2, so break before the parenthetical.
    expect(counts(r)).toEqual([52, 4]);
    expect(r.pages[1]!.lines[0]!.elementId).toBe(dlg[2]!.layout.elementId);
  });

  it('honours dialoguePageBreaks: false by moving the whole block', () => {
    const dlg = [p('character', 1), p('dialogue', 4), p('parenthetical', 1), p('dialogue', 3)];
    const r = run([...filler(47), ...dlg], { dialoguePageBreaks: false });
    expect(counts(r)).toEqual([47, 9]);
  });

  it('pageBreakBefore is a no-op on an empty page; an empty element makes a deliberate blank page', () => {
    expect(counts(run([p('action', 1, { pbb: true }), p('action', 1)]))).toEqual([2]);
    expect(counts(run([p('action', 1), p('action', 1, { pbb: true }), p('action', 1)]))).toEqual([1, 2]);
    const blank = run([p('action', 1), p('action', 1, { pbb: true }), p('action', 1, { pbb: true })]);
    expect(counts(blank)).toEqual([1, 1, 1]);
  });

  it('pulls lines back so a transition is not first on a page (§13.5)', () => {
    const r = run([...filler(52), p('action', 4), p('transition', 1)]);
    // The 4-line action splits 2/2 so the transition shares a page with its last 2 lines.
    expect(counts(r)).toEqual([54, 3]);
  });

  it('drops keep links from the last backwards when a chain overflows a page (keepViolated)', () => {
    const r = run([p('sceneHeading', 1), p('shot', 30, { splittable: false }), p('shot', 30, { splittable: false })]);
    expect(r.diagnostics.map((d) => d.code)).toContain('keepViolated');
    expect(counts(r)).toEqual([31, 30]);
  });

  it('force-splits a single unsplittable paragraph taller than a page', () => {
    const r = run([p('shot', 60, { splittable: false })]);
    expect(counts(r)).toEqual([54, 6]);
    expect(r.diagnostics.map((d) => d.code)).toContain('forcedSplit');
  });

  it('records a start state per page', () => {
    const r = run(filler(60));
    expect(r.pages[1]!.startState.blockIndex).toBe(54);
    expect(r.pages[0]!.startState.blockIndex).toBe(0);
  });
});
