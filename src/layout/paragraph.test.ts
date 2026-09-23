import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { builtinStyleId } from '../ids/ids.js';
import type { TextRun } from '../schema/text.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { resolveStyle } from '../template/resolve.js';
import { categoryOf } from './category.js';
import { filterTrackChanges, layoutParagraph, layoutTrackChangesMarkup, type ParagraphInput } from './paragraph.js';

const fonts = createFontRegistry();
const template = screenplayStandard as never as Parameters<typeof resolveStyle>[0] & { page: ParagraphInput['page'] };

function lay(slug: string, text: string, over: Partial<ParagraphInput> = {}, ovStyle: Parameters<typeof resolveStyle>[2] = undefined) {
  const style = resolveStyle(template, builtinStyleId(slug), ovStyle);
  return layoutParagraph({
    elementId: 'el_test' as never,
    displayText: () => ({ text, clusterSource: null, sourceLength: text.length }),
    attrs: [],
    style,
    category: categoryOf(style),
    page: template.page,
    referenceSizePt: 12,
    lang: 'en',
    fonts,
    shaper: null,
    ...over,
  });
}

/** Longest single word (no break opportunity) that fits on one line. */
function charsPerLine(slug: string): number {
  let n = 1;
  while (lay(slug, 'A'.repeat(n + 1)).lines.length === 1) n++;
  return n;
}

describe('layoutParagraph', () => {
  it('fits exactly 60 action characters per line (used <= width, not <)', () => {
    expect(charsPerLine('action')).toBe(60);
    const l = lay('action', 'A'.repeat(60));
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0]!.width).toBe(60 * 91_440);
    expect(lay('action', 'A'.repeat(61)).diagnostics.map((d) => d.code)).toContain('overlongUnbreakable');
  });

  it('matches the screenplay-standard template columns (its own geometry, not the S2 spike)', () => {
    const got = ['action', 'dialogue', 'character', 'parenthetical', 'transition'].map((s) => [s, charsPerLine(s)]);
    expect(Object.fromEntries(got)).toEqual({ action: 60, dialogue: 35, character: 37, parenthetical: 26, transition: 16 });
  });

  it('breaks greedily with hanging trailing whitespace and stays on the 6 lpi grid', () => {
    const words = Array.from({ length: 12 }, () => 'abcde').join(' '); // 71 chars
    const l = lay('action', words);
    expect(l.lines.length).toBe(2);
    expect(l.lines[0]!.sourceEnd).toBe(60); // the hanging space stays on line 1
    expect(l.lines[0]!.width).toBe(59 * 91_440);
    expect(l.lines.every((x) => x.pitch === 152_400)).toBe(true);
    expect(l.totalHeight).toBe(2 * 152_400);
    expect(l.lines[1]!.top).toBe(152_400);
  });

  it('justify fills non-final lines exactly; last line marks a sentence end', () => {
    const text = Array.from({ length: 14 }, (_, i) => `w${i}xx`).join(' ') + '. Zz aa';
    const l = lay('action', text, {}, { align: 'justify' });
    expect(l.lines.length).toBeGreaterThan(1);
    expect(l.lines[0]!.width).toBe(60 * 91_440);
    expect(l.sentenceEndLines[l.sentenceEndLines.length - 1]).toBe(1);
  });

  it('spaceBefore converts lines to EMU', () => {
    expect(lay('action', 'x').spaceBefore).toBe(152_400);
  });

  it('reorders RTL runs and mirrors paired brackets', () => {
    const l = lay('action', 'שלום (עולם) abc');
    const runs = l.lines[0]!.runs;
    expect(runs.some((r) => r.bidiLevel % 2 === 1)).toBe(true);
    // Logical " (" and ") " are mirrored to " )" and "( " at odd levels.
    expect(runs.some((r) => r.text === ' )')).toBe(true);
    expect(runs.some((r) => r.text === '( ')).toBe(true);
  });

  describe('the §31.2 cache hook (Task 31)', () => {
    function memoryCache() {
      const map = new Map<string, ReturnType<typeof lay>>();
      let gets = 0;
      let sets = 0;
      return { get: (k: string) => { gets++; return map.get(k); }, set: (k: string, v: ReturnType<typeof lay>) => { sets++; map.set(k, v); }, map, stats: () => ({ gets, sets }) };
    }

    it('a hit returns the exact stored object, skipping recomputation entirely', () => {
      const cache = memoryCache();
      const first = lay('action', 'Rain on the window.', { cache });
      expect(cache.stats()).toEqual({ gets: 1, sets: 1 });
      const second = lay('action', 'Rain on the window.', { cache });
      expect(second).toBe(first); // same object reference: proof the rest of the function never ran
      expect(cache.stats()).toEqual({ gets: 2, sets: 1 });
    });

    it('a miss on any real input change (text, decorationHash, geometry) computes and stores fresh', () => {
      const cache = memoryCache();
      const a = lay('action', 'Rain on the window.', { cache });
      const b = lay('action', 'Rain on the roof.', { cache });
      expect(b).not.toBe(a);
      expect(cache.map.size).toBe(2);
      const c = lay('action', 'Rain on the window.', { cache, decorationHash: 42 });
      expect(c).not.toBe(a);
      expect(cache.map.size).toBe(3);
    });

    it('styleHash distinguishes two elements sharing a style id but different overrides (no cross-element collision)', () => {
      const cache = memoryCache();
      const base = resolveStyle(template, builtinStyleId('action'));
      const overridden = resolveStyle(template, builtinStyleId('action'), { spaceBefore: 3 });
      expect(base.id).toBe(overridden.id); // same style id — the id alone would collide
      const a = lay('action', 'Same text.', { cache, style: base, styleHash: 'hash-a' });
      const b = lay('action', 'Same text.', { cache, style: overridden, styleHash: 'hash-b' });
      expect(b).not.toBe(a);
      expect(cache.map.size).toBe(2);
      expect(a.spaceBefore).not.toBe(b.spaceBefore); // and the two really do differ — this would be a silent staleness bug without styleHash
    });

    it('without styleHash, two different overrides of the same style id DO collide (documents why styleHash exists)', () => {
      const cache = memoryCache();
      const base = resolveStyle(template, builtinStyleId('action'));
      const overridden = resolveStyle(template, builtinStyleId('action'), { spaceBefore: 3 });
      const a = lay('action', 'Same text.', { cache, style: base });
      const b = lay('action', 'Same text.', { cache, style: overridden });
      expect(b).toBe(a); // the stale hit: b's real (overridden) spaceBefore never gets computed
      expect(cache.map.size).toBe(1);
    });

    it('sourceLength distinguishes two calls whose GENERATED display text is identical but the real source range differs', () => {
      // The omitted-scene-heading case (§23.3): the display collapses to a fixed "OMITTED" placeholder
      // regardless of how long the real heading text underneath it is.
      const cache = memoryCache();
      const short = lay('scene_heading', 'OMITTED', { cache, displayText: () => ({ text: 'OMITTED', clusterSource: null, sourceLength: 16 }) });
      const long = lay('scene_heading', 'OMITTED', { cache, displayText: () => ({ text: 'OMITTED', clusterSource: null, sourceLength: 18 }) });
      expect(long).not.toBe(short);
      expect(short.lines[0]!.sourceEnd).toBe(16);
      expect(long.lines[0]!.sourceEnd).toBe(18);
    });
  });
});

describe('filterTrackChanges (spec 02 §26, M2 task 35)', () => {
  const track = { changeId: 'chg_x', by: 'u1', at: 0 };
  const runs: TextRun[] = [
    { text: 'Keep ', attrs: {} },
    { text: 'this', attrs: { del: track } },
    { text: 'that', attrs: { ins: track } },
    { text: '.', attrs: {} },
  ];

  it('final and simple hide del runs, keep ins runs as normal text', () => {
    for (const view of ['final', 'simple'] as const) {
      const { text, sourceOffsetAt } = filterTrackChanges(runs, view);
      expect(text).toBe('Keep that.');
      // 'K' (index 0 of filtered text) is source offset 0; the filtered 't' of 'that' (index 5) is
      // source offset 9 ('Keep this' is 9 code units, 'that' starts right after it in the source).
      expect(sourceOffsetAt[0]).toBe(0);
      expect(sourceOffsetAt[5]).toBe(9);
      expect(sourceOffsetAt.length).toBe(text.length);
    }
  });

  it('original hides ins runs, keeps del runs as normal text (the rejected state)', () => {
    const { text, sourceOffsetAt } = filterTrackChanges(runs, 'original');
    expect(text).toBe('Keep this.');
    expect(sourceOffsetAt[5]).toBe(5); // filtered 't' of 'this' is source offset 5, right after 'Keep '
  });

  it('markup hides nothing (its own inline rendering is layoutTrackChangesMarkup\'s job, not filtering)', () => {
    const { text } = filterTrackChanges(runs, 'markup');
    expect(text).toBe('Keep thisthat.');
  });

  it('a fmt-only run (no ins/del) is never hidden in any view', () => {
    const fmtRuns: TextRun[] = [{ text: 'plain ', attrs: {} }, { text: 'formatted', attrs: { fmt: track, b: true } }];
    for (const view of ['final', 'simple', 'original', 'markup'] as const) {
      expect(filterTrackChanges(fmtRuns, view).text).toBe('plain formatted');
    }
  });

  it('drops nothing when there are no marked runs at all (identity)', () => {
    const plain: TextRun[] = [{ text: 'Hello.', attrs: {} }];
    const { text, sourceOffsetAt } = filterTrackChanges(plain, 'final');
    expect(text).toBe('Hello.');
    expect(Array.from(sourceOffsetAt)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('layoutTrackChangesMarkup (spec 02 §26 markup: pure transform, not wired into layoutDocument)', () => {
  const colorOf = (by: string): string => (by === 'u1' ? '#224466' : '#aa0000');

  it('strikes a del run and underlines an ins run, both in the writer\'s colour; leaves plain runs untouched', () => {
    const runs: TextRun[] = [
      { text: 'Keep ', attrs: {} },
      { text: 'this', attrs: { del: { changeId: 'c1', by: 'u1', at: 0 } } },
      { text: 'that', attrs: { ins: { changeId: 'c2', by: 'u2', at: 0 } } },
    ];
    const out = layoutTrackChangesMarkup(runs, colorOf);
    expect(out).toEqual([
      { text: 'Keep ', attrs: {} },
      { text: 'this', attrs: { del: { changeId: 'c1', by: 'u1', at: 0 }, s: true, fc: '#224466' } },
      { text: 'that', attrs: { ins: { changeId: 'c2', by: 'u2', at: 0 }, u: true, fc: '#aa0000' } },
    ]);
  });

  it('a run with neither del nor ins is returned unchanged, not copied', () => {
    const runs: TextRun[] = [{ text: 'Plain', attrs: { b: true } }];
    expect(layoutTrackChangesMarkup(runs, colorOf)).toEqual(runs);
  });
});
