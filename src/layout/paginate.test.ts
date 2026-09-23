import { describe, expect, it } from 'vitest';
import { formBlocks, type BlockPara } from './blocks.js';
import { CATEGORY_RULES, type PaginationCategory } from './category.js';
import type { ElementContext } from './context.js';
import type { DecoBlock, DecoLine } from './continueds.js';
import { paginate, type PaginationParams } from './paginate.js';

const PITCH = 152_400;
const GEOMETRY = { pageWidth: 7_772_400, pageHeight: 10_058_400, bodyTop: 914_400, bodyBottom: 10_058_400 - 914_400 };
const PARAMS: PaginationParams = {};
let n = 0;

function p(
  category: PaginationCategory, lines: number,
  o: { sb?: number; pbb?: boolean; splittable?: boolean; kwn?: boolean; sentences?: boolean[]; scene?: string } = {},
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
      category, sceneId: (o.scene ?? null) as never, sceneOrdinal: 0, actId: null, omitted: false, hidden: false, speaker: null, autoContinued: false, numberLabel: null,
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

  describe('chunked resumption (Task 31 §31.4)', () => {
    it('stopAfter halts once the requested page count is reached and reports a resume point', () => {
      const paras = filler(120);
      const blocks = formBlocks(paras);
      const r1 = paginate(blocks, GEOMETRY, PARAMS, {}, undefined, { stopAfter: (n) => n >= 1 });
      expect(r1.pages).toHaveLength(1);
      expect(r1.resume).not.toBeNull();
      const r2 = paginate(blocks, GEOMETRY, PARAMS, {}, r1.resume!);
      const full = paginate(blocks, GEOMETRY, PARAMS, {});
      expect(counts(r1).concat(counts(r2))).toEqual(counts(full));
      const ids = (pgs: typeof full.pages) => pgs.map((pg) => pg.lines.map((l) => l.elementId));
      expect(ids(r1.pages).concat(ids(r2.pages))).toEqual(ids(full.pages));
    });

    it('never stops mid-page even when stopAfter is as aggressive as possible', () => {
      const r = paginate(formBlocks(filler(120)), GEOMETRY, PARAMS, {}, undefined, { stopAfter: () => true });
      expect(r.pages).toHaveLength(1); // at least one whole page is always produced before a stop
      expect(r.pages[0]!.lines).toHaveLength(54); // and it is a genuinely full page, not a truncated one
      expect(r.resume).not.toBeNull();
    });

    it('resuming several times in a row reaches the same end state as one unchunked call', () => {
      const paras = filler(200);
      const blocks = formBlocks(paras);
      const full = paginate(blocks, GEOMETRY, PARAMS, {});
      const chunks: ReturnType<typeof paginate>['pages'][] = [];
      let resume: ReturnType<typeof paginate>['resume'] | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const r = paginate(blocks, GEOMETRY, PARAMS, {}, resume ?? undefined, { stopAfter: (n) => n >= 1 });
        chunks.push(r.pages);
        resume = r.resume;
        if (!resume) break;
      }
      expect(resume).toBeNull(); // the loop above only exits via `break` once every page is placed
      const combined = chunks.flat();
      expect(combined.map((pg) => pg.lines.length)).toEqual(full.pages.map((pg) => pg.lines.length));
    });

    it('resume is null once the whole document has been placed', () => {
      const r = paginate(formBlocks(filler(10)), GEOMETRY, PARAMS, {}, undefined, { stopAfter: () => true });
      expect(r.resume).toBeNull();
    });

    it("carries a panels-mode PAGE n (CONT'D) across a chunk boundary (fixed: lastHeadingElementId)", () => {
      // A minimal fake `pageContd` hook (§17), same style as the rest of this file's hand-built
      // fixtures — not `panels.ts`'s own real heading text, just enough to prove the RESUME MECHANISM
      // itself carries `lastHeading` across a stop, which used to be a documented, real gap.
      const heading = p('pageHeading', 1);
      const decoLine: BlockPara['layout']['lines'][number] = { top: 0, pitch: PITCH, baseline: 0, x: 0, width: 0, sourceStart: 0, sourceEnd: 0, runs: [], hardBreak: false };
      const pageContdCalls: string[] = [];
      const deps = {
        continueds: {
          reserve: 0,
          moreLine: () => null,
          contdCue: () => null,
          sceneTop: () => null,
          sceneBottom: () => null,
          pageContd: (h: BlockPara) => {
            pageContdCalls.push(h.layout.elementId);
            return { kind: 'pageHeadingContd' as const, elementId: h.layout.elementId, text: "PAGE ONE (CONT'D)", line: decoLine };
          },
        },
      };
      const blocks = formBlocks([heading, ...filler(120)]);
      const full = paginate(blocks, GEOMETRY, PARAMS, deps);
      expect(full.pages.length).toBeGreaterThan(2); // needs at least 2 script-page breaks inside the one comic page
      const contdPages = full.pages.filter((pg) => pg.decor.some((l) => l.kind === 'pageHeadingContd'));
      expect(contdPages.length).toBe(full.pages.length - 1); // every page after the first repeats it

      // Now force a stop exactly after the FIRST script page (the one carrying the real heading, not
      // yet a CONT'D) and resume: the second call must still know `lastHeading`, with no hook access
      // at all until then (nothing to carry it forward except `resume` itself).
      pageContdCalls.length = 0;
      const r1 = paginate(blocks, GEOMETRY, PARAMS, deps, undefined, { stopAfter: (n2) => n2 >= 1 });
      expect(r1.pages).toHaveLength(1);
      expect(pageContdCalls).toEqual([]); // the hook is never even reached on the first page
      expect(r1.resume?.lastHeadingElementId).toBe(heading.layout.elementId);
      const r2 = paginate(blocks, GEOMETRY, PARAMS, deps, r1.resume!);
      expect(r2.pages[0]!.decor.some((l) => l.kind === 'pageHeadingContd')).toBe(true);
      expect(pageContdCalls[0]).toBe(heading.layout.elementId);

      const chunkedTexts = [...r1.pages, ...r2.pages].map((pg) => pg.decor.some((l) => l.kind === 'pageHeadingContd'));
      const fullTexts = full.pages.map((pg) => pg.decor.some((l) => l.kind === 'pageHeadingContd'));
      expect(chunkedTexts).toEqual(fullTexts);
    });

    it("carries a dialogue (MORE)/CONT'D cue AND a same-scene bottom/top decoration across a chunk boundary (fixed: the openPage `!prev` gate)", () => {
      // Both mechanisms are gated by the exact same `openPage` code path this task's own fix
      // touches, so both get their own direct proof here, not just an incidental one via the
      // panels test above. `sceneBottom` is the sharper case: the page it belongs on (the one that
      // ends the FIRST chunk) is already returned and gone by the time the SECOND call runs, so it
      // cannot be written directly — `retroactiveSceneBottom` is exactly that "please apply this to
      // the page you already have" instruction back to the caller.
      const decoLine = (n2: number): BlockPara['layout']['lines'][number] => ({ top: 0, pitch: PITCH, baseline: 0, x: 0, width: 0, sourceStart: n2, sourceEnd: n2, runs: [], hardBreak: false });
      const deps = {
        continueds: {
          reserve: PITCH,
          moreLine: (): DecoLine => ({ kind: 'more', elementId: 'el_more' as never, text: '(MORE)', line: decoLine(1) }),
          contdCue: (): DecoLine => ({ kind: 'contdCue', elementId: 'el_cue' as never, text: "CHARLIE (CONT'D)", line: decoLine(2) }),
          sceneTop: (): DecoBlock => ({ lines: [{ deco: { kind: 'continuedTop', elementId: 'el_top' as never, text: 'CONTINUED:', line: decoLine(3) }, dy: 0 }], height: PITCH }),
          sceneBottom: (): DecoBlock => ({ lines: [{ deco: { kind: 'continuedBottom', elementId: 'el_bottom' as never, text: '(CONTINUED)', line: decoLine(4) }, dy: 0 }], height: PITCH }),
        },
      };
      const dlgLines = 70; // long enough to need a split wherever it starts (a page holds ~54 lines)
      const scene: [string, string] = ['s1', 's1'];
      const blocks = [
        p('sceneHeading', 1, { scene: scene[0] }),
        ...filler(48).map((f) => ({ ...f, ctx: { ...f.ctx, sceneId: scene[0] as never } })),
        p('character', 1, { sb: 1, scene: scene[0] }),
        p('dialogue', dlgLines, { scene: scene[0] }),
      ];

      const full = paginate(formBlocks(blocks), GEOMETRY, PARAMS, deps);
      expect(full.pages.length).toBeGreaterThanOrEqual(2);
      const splitPageIndex = full.pages.findIndex((pg) => pg.lines.some((l) => l.kind === 'more'));
      expect(splitPageIndex).toBeGreaterThanOrEqual(0);
      const fullBefore = full.pages[splitPageIndex]!.decor.filter((l) => l.kind === 'continuedBottom');
      const fullAfter = full.pages[splitPageIndex + 1]!.decor.filter((l) => l.kind === 'continuedTop' || l.kind === 'contdCue');
      expect(fullBefore.length).toBe(1);
      expect(fullAfter.map((l) => l.kind).sort()).toEqual(['contdCue', 'continuedTop']);

      const r1 = paginate(formBlocks(blocks), GEOMETRY, PARAMS, deps, undefined, { stopAfter: (n2) => n2 > splitPageIndex });
      expect(r1.pages).toHaveLength(splitPageIndex + 1);
      expect(r1.resume?.pendingCueElementId).not.toBeNull();
      expect(r1.resume?.sceneId).toBe(scene[0]);
      const r2 = paginate(formBlocks(blocks), GEOMETRY, PARAMS, deps, r1.resume!);

      // The new page (which r2 DOES have locally) gets its top decorations exactly as the full run did.
      const r2After = r2.pages[0]!.decor.filter((l) => l.kind === 'continuedTop' || l.kind === 'contdCue');
      expect(r2After.map((l) => l.kind).sort()).toEqual(['contdCue', 'continuedTop']);

      // The old page (which only the FIRST chunk has) gets its bottom decoration via the returned
      // patch, applied here exactly as a real cross-call caller would.
      expect(r1.pages[r1.pages.length - 1]!.decor.some((l) => l.kind === 'continuedBottom')).toBe(false);
      expect(r2.retroactiveSceneBottom).not.toBeNull();
      for (const l of r2.retroactiveSceneBottom!) r1.pages[r1.pages.length - 1]!.decor.push(l);
      const patchedBefore = r1.pages[r1.pages.length - 1]!.decor.filter((l) => l.kind === 'continuedBottom');
      expect(patchedBefore).toEqual(fullBefore);
    });
  });
});
