/**
 * spec 02 §6.4 dictionary segmentation. Three surfaces, per the brief:
 *  1. A known Thai sentence segments at the dictionary's own boundaries (real data, real
 *     module, no mocking).
 *  2. An unknown sequence falls back to grapheme-cluster break opportunities.
 *  3. `loadDictionary('en')` resolves `null` *without importing any dictionary module* —
 *     proven with `vi.doMock` factories that throw if ever invoked, not merely asserted.
 *
 * Plus the context item 3 regression proof: empty the Thai DAWG (mocked payload with zero
 * words) and watch the same known-sentence case fall back to per-cluster breaks — the exact
 * mechanism-disabled-and-shown-red/green proof the brief's step 3–5 asks for.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// ─── #1/#2: real dictionary, no mocking ────────────────────────────────────────────────
//
// Perf round (2026-09-16, perf-suite-brief.md item 3): the two tests below that touch a
// dictionary payload module for the first time — "segments a known two-word Thai string" and
// "loads Lao, Khmer and Myanmar too" — pay real, legitimate one-time cost (transforming the
// generated `dict-*.ts` payload module, decoding its base64+DAWG). None of it is repeated
// needlessly within this file: `loadDictionary`'s own module-scope `CACHE` (dict.ts) already
// means every other test in this describe, plus the GREEN sanity test in the regression-proof
// describe below (deliberately placed here, before the laziness describe's `vi.resetModules()`
// calls, so it shares this same module instance and its warm cache instead of forcing a second
// from-scratch decode of the real Thai DAWG — see that describe's own comment), gets a cache
// hit. What *is* real and irreducible is the first-touch cost itself: measured up to ~0.8s
// ("segments...") and ~1.7s ("loads Lao, Khmer and Myanmar too") locally under heavy synthetic
// CPU contention — well inside `vitest.config.ts`'s global 90000ms `testTimeout` (perf round 2,
// 2026-09-16 — see perf-suite-report.md "Round 2"), which is why these two no longer carry
// their own per-test override: one obvious mechanism, not two.
describe('loadDictionary — real Thai dictionary (spec 02 §6.4)', () => {
  it("segments a known two-word Thai string at the dictionary's own boundary", async () => {
    const { loadDictionary } = await import('./dict.js');
    const dict = await loadDictionary('th');
    expect(dict).not.toBeNull();
    // "กงกอน" and "กงพัด" are each their own entries in ICU's thaidict.txt; their
    // concatenation is not itself a longer entry, so longest-match must split exactly
    // between them — verified against the real, generated dict-th.ts payload, not invented.
    const combined = 'กงกอน' + 'กงพัด';
    expect(dict!.segment(combined)).toEqual([5]);
  });

  it('falls back to grapheme-cluster boundaries for a sequence outside the alphabet (spec 02 §6.4)', async () => {
    const { loadDictionary } = await import('./dict.js');
    const dict = await loadDictionary('th');
    expect(dict).not.toBeNull();
    // Plain ASCII letters are outside the Thai dictionary's alphabet entirely: every
    // position is a "no match", so segmentation falls back to one grapheme cluster (here,
    // one code point) at a time — offsets strictly between 0 and length.
    expect(dict!.segment('xyz')).toEqual([1, 2]);
  });

  it("loadDictionary resolves the same cached segmenter object on a second call for the same language", async () => {
    const { loadDictionary } = await import('./dict.js');
    const a = await loadDictionary('th');
    const b = await loadDictionary('th-TH'); // same primary subtag
    expect(a).toBe(b);
  });

  it('loads Lao, Khmer and Myanmar too (sanity — not just Thai)', async () => {
    const { loadDictionary } = await import('./dict.js');
    for (const lang of ['lo', 'km', 'my']) {
      const dict = await loadDictionary(lang);
      expect(dict, lang).not.toBeNull();
      // Any dictionary can at least fall back to grapheme clusters on unknown input.
      expect(dict!.segment('xyz')).toEqual([1, 2]);
    }
  });
});

// ─── Regression proof: emptying the Thai DAWG falls back to per-cluster breaks ─────────
//
// Deliberately placed here, immediately after the real-dictionary describe above and BEFORE
// the laziness describe's `vi.resetModules()` calls (perf round, 2026-09-16): the GREEN sanity
// test below shares the still-live module instance from the describe above, so
// `loadDictionary('th')` is a `CACHE` hit — no second from-scratch decode of the real Thai DAWG
// — and only the REGRESSION test's own explicit `vi.resetModules()` + mock actually forces a
// fresh import (of the tiny, mocked empty-DAWG payload, not the real one).
describe('loadDictionary — Thai DAWG regression proof (context item 3)', () => {
  afterEach(() => {
    vi.doUnmock('./generated/dict-th.js');
    vi.resetModules();
  });

  /** A minimal, structurally valid but *empty* DAWG payload (root node, no words at all) — mirrors scripts/build-dictionaries.ts's serialized format exactly, just with zero content. */
  function emptyDawgBase64(): string {
    // header: nodeCount=1, transitionCount=0, rootId=0, wide=0, alphabetLen=0 (5 x u32 LE)
    const header = new Uint8Array(new Uint32Array([1, 0, 0, 0, 0]).buffer);
    // finalFlags[1] = 0 (root is not a word), childCount[1] = 0 (no children)
    const body = new Uint8Array([0, 0]);
    const bytes = new Uint8Array(header.length + body.length);
    bytes.set(header, 0);
    bytes.set(body, header.length);
    return Buffer.from(bytes).toString('base64');
  }

  it('with the real Thai DAWG, "กงกอนกงพัด" splits at the dictionary boundary (GREEN, sanity before the regression)', async () => {
    const { loadDictionary } = await import('./dict.js');
    const dict = await loadDictionary('th');
    expect(dict!.segment('กงกอน' + 'กงพัด')).toEqual([5]);
  });

  it('REGRESSION: emptying the Thai DAWG makes the same string fall back to per-grapheme-cluster breaks', async () => {
    vi.resetModules();
    vi.doMock('./generated/dict-th.js', () => ({ DICT_TH_BASE64: emptyDawgBase64() }));

    const { loadDictionary } = await import('./dict.js');
    const dict = await loadDictionary('th');
    expect(dict).not.toBeNull();

    const combined = 'กงกอน' + 'กงพัด'; // 10 code points, one of which (ั, a combining vowel sign) folds onto its base
    const withEmptyDawg = dict!.segment(combined);
    // Every position is now a "no match" against the empty dictionary, so segmentation
    // falls back to one grapheme cluster at a time — not the single boundary at 5 the real
    // dictionary gives, and not naive per-code-point either (offset 8 is absent: code points
    // 7 and 8 are one cluster, a base consonant plus its combining vowel sign).
    expect(withEmptyDawg).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(withEmptyDawg).not.toEqual([5]);
  });
});

// ─── #3: laziness proof — loadDictionary('en') must never import a payload module ──────
describe("loadDictionary('en') — laziness (spec 02 §6.4, context item 5)", () => {
  afterEach(() => {
    vi.doUnmock('./generated/dict-th.js');
    vi.doUnmock('./generated/dict-lo.js');
    vi.doUnmock('./generated/dict-km.js');
    vi.doUnmock('./generated/dict-my.js');
    vi.resetModules();
  });

  it('resolves to null without importing any of the four dictionary payload modules', async () => {
    vi.resetModules();
    const fail = (name: string) => () => {
      throw new Error(`${name} must not be imported when loadDictionary is called with an unsupported language`);
    };
    vi.doMock('./generated/dict-th.js', fail('dict-th.js'));
    vi.doMock('./generated/dict-lo.js', fail('dict-lo.js'));
    vi.doMock('./generated/dict-km.js', fail('dict-km.js'));
    vi.doMock('./generated/dict-my.js', fail('dict-my.js'));

    const { loadDictionary } = await import('./dict.js');
    await expect(loadDictionary('en')).resolves.toBeNull();
    await expect(loadDictionary('fr')).resolves.toBeNull();
    await expect(loadDictionary('')).resolves.toBeNull();
  });
});

// ─── dict/LICENSES.md ground-truth cross-check (mirrors ucd-licenses.test.ts / fonts/budget.test.ts) ──
describe('dict/LICENSES.md (spec 02 §6.4, §3.1 obligation extended)', () => {
  const licenses = readFileSync(join(ROOT, 'dict/LICENSES.md'), 'utf8');

  it('names the ICU version pin and cites the Unicode License v3 text it reuses', () => {
    expect(licenses).toContain('release-78.3');
    expect(licenses).toMatch(/Unicode License v3/);
    expect(licenses).toContain('ucd/UNICODE-LICENSE.txt');
  });

  it("records every generated dictionary's own embedded source SHA-256", () => {
    const HEADER_RE = /Source SHA-256: ([0-9a-f]{64})/;
    for (const lang of ['th', 'lo', 'km', 'my']) {
      const src = readFileSync(join(ROOT, `src/text/generated/dict-${lang}.ts`), 'utf8');
      const m = HEADER_RE.exec(src);
      expect(m, `dict-${lang}.ts missing its GENERATED header's Source SHA-256`).not.toBeNull();
      expect(licenses, `dict/LICENSES.md missing SHA-256 ${m![1]} (dict-${lang}.ts's own embedded source hash)`).toContain(m![1]!);
    }
  });

  it('vendors the Lao and Burmese third-party licenses verbatim, distinct from Unicode License v3', () => {
    const lao = readFileSync(join(ROOT, 'dict/ICU-LAO-DICTIONARY-LICENSE.txt'), 'utf8');
    const burmese = readFileSync(join(ROOT, 'dict/ICU-BURMESE-DICTIONARY-LICENSE.txt'), 'utf8');
    expect(lao).toMatch(/Brian Eugene Wilson, Robert Martin Campbell/);
    expect(lao).toMatch(/Redistribution and use in source and binary forms/);
    expect(burmese).toMatch(/LeRoy Benjamin Sharon/);
    expect(burmese).toMatch(/Redistribution and use in source and binary forms/);
    // Neither is the Unicode License v3 (its distinctive operative sentence must not appear).
    expect(lao).not.toMatch(/Permission is hereby granted, free of charge, to any person obtaining a\ncopy of data files/);
    expect(burmese).not.toMatch(/Permission is hereby granted, free of charge, to any person obtaining a\ncopy of data files/);
  });
});
