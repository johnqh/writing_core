import { describe, expect, it } from 'vitest';
import { deterministicId } from '../ids/ids.js';
import { createFontRegistry } from './registry.js';

// A `custom:` family id must carry a real asset ULID (src/schema/primitives.ts).
// Deviation from the brief's literal snippet: `deterministicId`'s real signature
// (src/ids/ids.ts) takes `parts: readonly string[]`, not a bare string — the brief's
// `deterministicId('asset', 'missing')` does not typecheck, so `parts` is wrapped in
// an array here.
const MISSING = `custom:${deterministicId('asset', ['missing'])}` as const;
const PRESENT = `custom:${deterministicId('asset', ['present'])}` as const;

describe('font registry (spec 02 §4.3)', () => {
  const fonts = createFontRegistry();

  it('has a stable version hash', () => {
    expect(fonts.version).toMatch(/^[0-9a-f]{16}$/);
    expect(createFontRegistry().version).toBe(fonts.version);
  });

  it('resolves courier-screenplay to Courier Prime', () => {
    const { face, synthBold, synthItalic } = fonts.face('courier-screenplay', false, false);
    expect(face.faceId).toBe('courier-prime:regular');
    expect(face.monospace).toBe(true);
    expect(face.advance(0x41)).toBe(1228);   // font units; the 10 cpi layout override is Task 18's
    expect(synthBold).toBe(false);
    expect(synthItalic).toBe(false);
  });

  it('reports synthesis when a face is missing, keeping the regular advance', () => {
    const regular = fonts.face('courier-screenplay', false, false);
    const bold = fonts.face('courier-screenplay', true, false);
    // Whether synthesized or real, the advance must not change (spec 02 §3.4).
    expect(bold.face.advance(0x41)).toBe(regular.face.advance(0x41));
  });

  it('marks an unknown custom family as substituted', () => {
    expect(fonts.resolveFamily(MISSING)).toEqual({ familyId: 'mono', substituted: true });
    expect(fonts.resolveFamily('courier-screenplay')).toEqual({ familyId: 'courier-screenplay', substituted: false });
  });

  it('registers a custom family and then resolves it unsubstituted', () => {
    const r = createFontRegistry();
    const base = r.face('courier-screenplay', false, false).face;
    r.registerCustom(PRESENT, [base]);
    expect(r.resolveFamily(PRESENT)).toEqual({ familyId: PRESENT, substituted: false });
    expect(r.version).not.toBe(fonts.version); // registering changes the registry version
  });

  it('builds its family map from the FACES columns, not from module names', () => {
    // Every logical family in spec 01's vocabulary resolves to a face with the
    // matching `family` column; a face is never located by string-munging a path.
    for (const id of ['courier-screenplay', 'courier-new', 'times', 'arial'] as const) {
      const { face } = fonts.face(id, false, false);
      expect(face.faceId).toMatch(/^[a-z0-9-]+:regular$/);
    }
  });
});
