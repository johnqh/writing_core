import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACES } from '../fonts/generated/registry.generated.js';
import type { FaceId } from '../layout/types.js';
import { HARFBUZZ_CORE_VERSION, createHarfBuzzShaper, shapeCacheKey, type HbModule } from './harfbuzz.js';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fonts/src');

// The real API (M0 spike S3): the module is already initialized, exposes
// versionString(), and uses classes — new hb.Blob/Face/Font/Buffer, then
// buf.getGlyphInfos()/getGlyphPositions().
const load = async () => (await import('harfbuzzjs')) as unknown as HbModule;
// Tests read the binaries straight off disk; production injects the host's source.
const faceBytes = (faceId: FaceId) =>
  new Uint8Array(readFileSync(join(FONT_DIR, FACES.find((f) => f.faceId === faceId)!.file)));
const deps = { load, faceBytes };

describe('HarfBuzz shaper (spec 02 §5)', () => {
  it('asserts the pinned core version, not the npm version', async () => {
    const hb = (await import('harfbuzzjs')) as unknown as { versionString(): string };
    expect(hb.versionString()).toBe(HARFBUZZ_CORE_VERSION);
  });

  it('shapes Arabic into reordered glyphs with EMU advances', async () => {
    const shaper = await createHarfBuzzShaper(deps);
    const out = shaper.shape({
      faceId: 'noto-naskh-arabic:regular',
      text: 'نظر إليها',
      script: 'Arab', direction: 'rtl', language: 'ar', sizeEmu: 152_400,
    });
    expect(out.glyphIds.length).toBeGreaterThan(0);
    expect(out.advancesEmu.length).toBe(out.glyphIds.length);
    expect(out.clusters.length).toBe(out.glyphIds.length);
    // Contextual forms mean glyph count differs from code-point count.
    expect(out.glyphIds.length).not.toBe([...'نظر إليها'].length);
    for (const a of out.advancesEmu) expect(Number.isInteger(a)).toBe(true);
    expect(shaper.version).toBe(`harfbuzz-${HARFBUZZ_CORE_VERSION}`);
  });

  it('shapes a repeated call from the LRU instead of re-shaping', async () => {
    // Value equality alone passes with the cache deleted, so it proves nothing about
    // the subject. Count the calls that reach HarfBuzz.
    let shapeCalls = 0;
    const countingLoad = async () => {
      const hb = await load();
      return new Proxy(hb, {
        get: (target, prop, recv) =>
          // The brief's snippet spreads `unknown[]` into `hb.shape(font, buffer, features?)`,
          // which TS strict rejects (TS2556: a spread argument must have a tuple type) — cast
          // to the real tuple type instead of widening `shape`'s own signature to `unknown[]`.
          prop === 'shape' ? (...args: Parameters<HbModule['shape']>) => { shapeCalls += 1; return (target as HbModule).shape(...args); }
                           : Reflect.get(target, prop, recv),
      }) as HbModule;
    };
    const shaper = await createHarfBuzzShaper({ load: countingLoad, faceBytes });
    const input = { faceId: 'noto-sans-devanagari:regular', text: 'उसने', script: 'Deva', direction: 'ltr' as const, language: 'hi', sizeEmu: 152_400 };
    const a = shaper.shape(input);
    const b = shaper.shape(input);
    expect(shapeCalls).toBe(1);
    expect([...b.glyphIds]).toEqual([...a.glyphIds]);
    expect([...b.advancesEmu]).toEqual([...a.advancesEmu]);
  });

  it('refuses a face binary that does not match its metrics SHA (spec 02 §4.5)', async () => {
    const wrong = { load, faceBytes: () => new Uint8Array([0, 1, 2, 3]) };
    await expect(createHarfBuzzShaper(wrong).then((s) =>
      s.shape({ faceId: 'noto-naskh-arabic:regular', text: 'ا', script: 'Arab', direction: 'rtl' as const, language: 'ar', sizeEmu: 152_400 })),
    ).rejects.toThrow(/does not match metrics/i);
  });
});

// Review finding A: the shape cache key must be injective. A join with a single fixed
// separator and no escaping collides whenever that separator (or, for a poorly chosen
// separator, ordinary field content) can occur inside a field.
describe('shape cache key injectivity (review finding A)', () => {
  const base = { faceId: 'noto-sans-devanagari:regular', sizeEmu: 152_400, script: 'Deva', direction: 'ltr' as const };

  it('the reviewer-cited pair produce different keys', () => {
    const a = shapeCacheKey({ ...base, language: 'a b', text: 'c' });
    const b = shapeCacheKey({ ...base, language: 'a', text: 'b c' });
    expect(a).not.toBe(b);
  });

  it('a pair that collides under a fixed-separator join produces different keys under the fix', () => {
    // General construction: for ANY fixed separator SEP, joining `language SEP text`
    // collides whenever SEP itself sits inside one field at the position the join would
    // insert it — `(a + SEP + b, c)` and `(a, b + SEP + c)` both concatenate to
    // `a SEP b SEP c`. This is the same shape as the reviewer's `{'a b','c'}`/`{'a','b c'}`
    // example (there, SEP is effectively a space); here it is proven against the actual
    // separator this file used before the fix (U+0000), not just an illustrative one.
    const SEP = String.fromCharCode(0);
    const inputA = { ...base, language: `a${SEP}b`, text: 'c' };
    const inputB = { ...base, language: 'a', text: `b${SEP}c` };

    // RED, for the right reason: the OLD construction (a plain separator join, exactly
    // as `shapeCacheKey` used to be implemented) really does collide on this pair.
    const oldJoinKey = (input: typeof inputA) =>
      [input.faceId, input.sizeEmu, input.script, input.direction, input.language, input.text].join(SEP);
    expect(oldJoinKey(inputA)).toBe(oldJoinKey(inputB));

    // GREEN: the fixed, length-prefixed key does not collide on the same pair.
    expect(shapeCacheKey(inputA)).not.toBe(shapeCacheKey(inputB));
  });

  it('the cache stores the colliding pair separately rather than conflating them', async () => {
    // Value equality alone would pass even with the two inputs sharing one cache slot
    // (both could coincidentally shape to similar output), so count real HarfBuzz calls,
    // the same technique the LRU-reuse test above uses.
    let shapeCalls = 0;
    const countingLoad = async () => {
      const hb = await load();
      return new Proxy(hb, {
        get: (target, prop, recv) =>
          prop === 'shape' ? (...args: Parameters<HbModule['shape']>) => { shapeCalls += 1; return (target as HbModule).shape(...args); }
                           : Reflect.get(target, prop, recv),
      }) as HbModule;
    };
    const shaper = await createHarfBuzzShaper({ load: countingLoad, faceBytes });
    const SEP = String.fromCharCode(0);
    const inputA = { faceId: 'noto-sans-devanagari:regular' as FaceId, sizeEmu: 152_400, script: 'Deva', direction: 'ltr' as const, language: `a${SEP}b`, text: 'उसने' };
    const inputB = { faceId: 'noto-sans-devanagari:regular' as FaceId, sizeEmu: 152_400, script: 'Deva', direction: 'ltr' as const, language: 'a', text: `b${SEP}उसने` };
    shaper.shape(inputA);
    shaper.shape(inputB);
    expect(shapeCalls).toBe(2);
  });
});

// Review finding B (spec amended): `shape()` is synchronous, so an async `faceBytes`
// source needs a sanctioned way to warm a face ahead of time — `prepareFace`.
describe('prepareFace (spec 02 §5.2 amendment, review finding B)', () => {
  const asyncFaceBytes = (faceId: FaceId) => Promise.resolve(faceBytes(faceId));

  it('preparing then shaping works with an async faceBytes', async () => {
    const shaper = await createHarfBuzzShaper({ load, faceBytes: asyncFaceBytes });
    await shaper.prepareFace('noto-sans-devanagari:regular');
    const out = shaper.shape({
      faceId: 'noto-sans-devanagari:regular', text: 'उसने', script: 'Deva', direction: 'ltr', language: 'hi', sizeEmu: 152_400,
    });
    expect(out.glyphIds.length).toBeGreaterThan(0);
  });

  it('shaping an unprepared face throws a clear error naming the face', async () => {
    const shaper = await createHarfBuzzShaper({ load, faceBytes: asyncFaceBytes });
    expect(() =>
      shaper.shape({ faceId: 'noto-sans-devanagari:regular', text: 'उसने', script: 'Deva', direction: 'ltr', language: 'hi', sizeEmu: 152_400 }),
    ).toThrow(/noto-sans-devanagari:regular/);
  });

  it('prepareFace is idempotent (a second call after resolution does not re-fetch)', async () => {
    let fetchCalls = 0;
    const countingFaceBytes = async (faceId: FaceId) => {
      fetchCalls += 1;
      return faceBytes(faceId);
    };
    const shaper = await createHarfBuzzShaper({ load, faceBytes: countingFaceBytes });
    await shaper.prepareFace('noto-sans-devanagari:regular');
    await expect(shaper.prepareFace('noto-sans-devanagari:regular')).resolves.toBeUndefined();
    expect(fetchCalls).toBe(1);
    const out = shaper.shape({
      faceId: 'noto-sans-devanagari:regular', text: 'उसने', script: 'Deva', direction: 'ltr', language: 'hi', sizeEmu: 152_400,
    });
    expect(out.glyphIds.length).toBeGreaterThan(0);
  });

  it('concurrent calls for the same face resolve once', async () => {
    let fetchCalls = 0;
    const countingFaceBytes = async (faceId: FaceId) => {
      fetchCalls += 1;
      return faceBytes(faceId);
    };
    const shaper = await createHarfBuzzShaper({ load, faceBytes: countingFaceBytes });
    await Promise.all([
      shaper.prepareFace('noto-sans-devanagari:regular'),
      shaper.prepareFace('noto-sans-devanagari:regular'),
      shaper.prepareFace('noto-sans-devanagari:regular'),
    ]);
    expect(fetchCalls).toBe(1);
  });

  it('prepareFace on an unknown faceId rejects rather than warming garbage', async () => {
    const shaper = await createHarfBuzzShaper({ load, faceBytes: asyncFaceBytes });
    await expect(shaper.prepareFace('does-not-exist:regular')).rejects.toThrow(/unknown faceId/);
  });
});

// Review finding C: the per-face cache is deliberately unbounded because its key space
// is the closed, build-time-generated `FACES` registry, not open user input.
describe('per-face cache is bounded by the closed FACES registry (review finding C)', () => {
  it('an unknown faceId is refused rather than admitted into the cache', async () => {
    const shaper = await createHarfBuzzShaper(deps);
    expect(() =>
      shaper.shape({ faceId: 'does-not-exist:regular', text: 'x', script: 'Latn', direction: 'ltr', language: 'en', sizeEmu: 152_400 }),
    ).toThrow(/unknown faceId/);
  });
});
