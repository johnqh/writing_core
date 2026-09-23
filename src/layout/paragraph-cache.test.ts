import { describe, expect, it } from 'vitest';
import { builtinStyleId } from '../ids/ids.js';
import { resolveStyle } from '../template/resolve.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import type { ParagraphLayout } from './paragraph.js';
import { createParagraphCache, effectiveStyleHash, estimateParagraphBytes, paragraphCacheBound } from './paragraph-cache.js';

function fakeParagraph(elementId: string, textLength: number): ParagraphLayout {
  return {
    elementId: elementId as never, cacheKey: `k:${elementId}`, spaceBefore: 0,
    lines: [{
      top: 0, pitch: 152_400, baseline: 0, x: 0, width: 0, sourceStart: 0, sourceEnd: textLength,
      runs: [{
        x: 0, faceId: 'f', sizeEmu: 152_400, synthBold: false, synthItalic: false, text: 'x'.repeat(textLength), bidiLevel: 0,
        clusters: new Uint32Array(textLength), clusterAdvances: new Int32Array(textLength), clusterSource: new Uint32Array(textLength),
        width: 0, style: { color: '#000', background: null, underline: 'none', strike: false, smallCaps: false, baselineShift: 0 },
        annotations: { revisionSetId: null, trackChange: null, noteIds: [], tagIds: [], suggestionIds: [], highlight: null, link: null, nospell: false, lang: 'en', decoration: 'none' },
      }],
      hardBreak: false,
    }] as never,
    totalHeight: 152_400, sentenceEndLines: new Uint8Array(1), category: 'normal' as never, diagnostics: [],
  };
}

describe('effectiveStyleHash', () => {
  it('differs for two overrides of the same style id, and is stable for the same resolved style', () => {
    const base = resolveStyle(screenplayStandard, builtinStyleId('action'));
    const overridden = resolveStyle(screenplayStandard, builtinStyleId('action'), { spaceBefore: 3 });
    expect(effectiveStyleHash(base)).not.toBe(effectiveStyleHash(overridden));
    expect(effectiveStyleHash(base)).toBe(effectiveStyleHash(resolveStyle(screenplayStandard, builtinStyleId('action'))));
    expect(effectiveStyleHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('estimateParagraphBytes', () => {
  it('grows with text length and is always positive', () => {
    const small = estimateParagraphBytes(fakeParagraph('el_a', 5));
    const big = estimateParagraphBytes(fakeParagraph('el_a', 500));
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
  });
});

describe('paragraphCacheBound', () => {
  it('caps at 60 MB even when the memory budget would allow more', () => {
    expect(paragraphCacheBound(200 * 1024 * 1024, 0)).toBe(60 * 1024 * 1024);
  });

  it('subordinates to the remaining budget when that is smaller than 60 MB', () => {
    expect(paragraphCacheBound(40 * 1024 * 1024, 10 * 1024 * 1024)).toBe(30 * 1024 * 1024);
  });

  it('never goes negative when the live result already exceeds the budget', () => {
    expect(paragraphCacheBound(10 * 1024 * 1024, 20 * 1024 * 1024)).toBe(0);
  });
});

describe('createParagraphCache', () => {
  it('round-trips a get/set and reports size and count', () => {
    const cache = createParagraphCache(1024 * 1024);
    expect(cache.get('k1')).toBeUndefined();
    const p = fakeParagraph('el_a', 10);
    cache.set('k1', p);
    expect(cache.get('k1')).toBe(p);
    expect(cache.count()).toBe(1);
    expect(cache.size()).toBeGreaterThan(0);
  });

  it('evicts least-recently-used entries first once over budget', () => {
    const p1 = fakeParagraph('el_1', 200);
    const bound = estimateParagraphBytes(p1) * 3; // room for ~3 entries
    const cache = createParagraphCache(bound);
    cache.set('k1', p1);
    cache.set('k2', fakeParagraph('el_2', 200));
    cache.set('k3', fakeParagraph('el_3', 200));
    // Touch k1 so it is no longer the least-recently-used.
    cache.get('k1');
    cache.set('k4', fakeParagraph('el_4', 200)); // must evict someone to stay within bound
    expect(cache.get('k1')).toBeDefined(); // recently touched — survives
    expect(cache.get('k2')).toBeUndefined(); // the true LRU victim
    expect(cache.size()).toBeLessThanOrEqual(bound);
  });

  it('pinned entries are evicted last', () => {
    const one = fakeParagraph('el_pin', 200);
    const bound = estimateParagraphBytes(one) * 2;
    const cache = createParagraphCache(bound);
    cache.set('k1', one); // oldest, but about to be pinned
    cache.pin(['el_pin']);
    cache.set('k2', fakeParagraph('el_2', 200));
    cache.set('k3', fakeParagraph('el_3', 200)); // over budget: k1 is oldest but pinned
    expect(cache.get('k1')).toBeDefined(); // pinned — survives ahead of its recency order
    expect(cache.get('k2')).toBeUndefined(); // the unpinned, older-than-k3 entry goes instead
  });

  it('still evicts when every entry is pinned and the cache is over its hard ceiling', () => {
    const bound = estimateParagraphBytes(fakeParagraph('el_1', 200)) * 2;
    const cache = createParagraphCache(bound);
    cache.pin(['el_1', 'el_2', 'el_3']);
    cache.set('k1', fakeParagraph('el_1', 200));
    cache.set('k2', fakeParagraph('el_2', 200));
    cache.set('k3', fakeParagraph('el_3', 200));
    expect(cache.size()).toBeLessThanOrEqual(bound);
    expect(cache.count()).toBeLessThan(3);
  });

  it('clear empties the cache', () => {
    const cache = createParagraphCache(1024 * 1024);
    cache.set('k1', fakeParagraph('el_1', 10));
    cache.clear();
    expect(cache.count()).toBe(0);
    expect(cache.size()).toBe(0);
    expect(cache.get('k1')).toBeUndefined();
  });
});
