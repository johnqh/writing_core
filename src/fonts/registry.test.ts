import { describe, expect, it } from 'vitest';
import { deterministicId } from '../ids/ids.js';
import { LOGICAL_FONT_FAMILIES } from '../schema/vocab.js';
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

  it('resolves every spec 02 §3.1 logical family to its OWN bound face, never a different family (spec 02 §3.2)', () => {
    // Exact faceId, not a loose "some regular face" pattern: a typo in FAMILY_BINDING that
    // silently mis-binds one family to another's face (e.g. `times` pointing at
    // `liberation-sans` instead of `liberation-serif`) must fail this test. Loose regex
    // assertions can't catch that — the classification fallback in `rowsFor` happily
    // returns *a* face of the right shape from the *wrong* family, and every prior test
    // still passes. After Task 4 every one of these ten families has its own bundled face,
    // so `rowsFor`'s classification-search and last-resort branches are dead code for all
    // of them; this test is what proves that.
    const expected: Record<(typeof LOGICAL_FONT_FAMILIES)[number], string> = {
      'courier-screenplay': 'courier-prime:regular',
      'courier-new': 'liberation-mono:regular',
      times: 'liberation-serif:regular',
      arial: 'liberation-sans:regular',
      calibri: 'carlito:regular',
      cambria: 'caladea:regular',
      georgia: 'gelasio:regular',
      serif: 'noto-serif:regular',
      sans: 'noto-sans:regular',
      mono: 'noto-sans-mono:regular',
    };
    for (const [id, expectedFaceId] of Object.entries(expected) as [(typeof LOGICAL_FONT_FAMILIES)[number], string][]) {
      expect(fonts.face(id, false, false).face.faceId, id).toBe(expectedFaceId);
    }
  });

  it('synthesizes italic for `mono` — Noto Sans Mono publishes no italic face (spec 02 §3.1, §3.4)', () => {
    // A real gap in the bundled set (confirmed against the upstream repo: Noto Sans Mono
    // ships only a `wght` axis, no separate italic file), not a contrived fixture — every
    // OTHER bundled family in the exact-match test above ships all four styles, so this is
    // the only case Task 4's own font set can exercise §3.4 synthesis against.
    const { face, synthBold, synthItalic } = fonts.face('mono', false, true);
    expect(face.faceId).toBe('noto-sans-mono:regular'); // falls back to Regular, not a different family
    expect(synthBold).toBe(false);
    expect(synthItalic).toBe(true);
    // §3.4: synthesis never changes the advance.
    expect(face.advance(0x41)).toBe(fonts.face('mono', false, false).face.advance(0x41));
  });

  it('synthesizes italic (not bold) for `mono` bold-italic, borrowing its real Bold face (spec 02 §3.4)', () => {
    const { face, synthBold, synthItalic } = fonts.face('mono', true, true);
    expect(face.faceId).toBe('noto-sans-mono:bold'); // the real Bold face, borrowed for its italic slot
    expect(synthBold).toBe(false);
    expect(synthItalic).toBe(true);
  });
});
