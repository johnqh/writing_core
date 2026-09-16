import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACES } from '../fonts/generated/registry.generated.js';
import type { FaceId } from '../layout/types.js';
import { HARFBUZZ_CORE_VERSION, createHarfBuzzShaper, type HbModule } from './harfbuzz.js';

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
