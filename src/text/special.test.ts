/**
 * `TAB_STOP_EMU`, `tabAdvance`, `specialCharWidth` and `embedWidth` (spec 02 §7.4, task 10).
 *
 * Context item 5: three of these rules have no conformance corpus anywhere to catch a
 * regression — a tab's "next 0.5 in stop, minimum one space width" (two independently testable
 * mechanisms: the grid is anchored to `textLeft`, and the floor applies when the natural stop is
 * too close), an inline image's height rounding **up**, and a `revDel` embed's zero width. Each
 * gets its own disabled-mechanism proof below, not just a value assertion — six such proofs in
 * total (two for tab, one for NBSP borrowing the space glyph rather than its own metric, one for
 * image rounding, one for image proportional scaling under clamp, one for revDel), reported
 * exactly in the task 10 report.
 */
import { describe, expect, it } from 'vitest';
import type { FontFaceMetrics } from '../layout/types.js';
import type { AssetId, RevisionSetId } from '../ids/ids.js';
import type { Embed } from '../schema/text.js';
import { embedWidth, specialCharWidth, tabAdvance, TAB_STOP_EMU, type TabStops } from './special.js';

/** A minimal `FontFaceMetrics` stub: `advance` returns `overrides[cp]` if given, else 600. */
function fixtureFace(overrides: Record<number, number> = {}): FontFaceMetrics {
  return {
    faceId: 'test:regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    capHeight: 700,
    xHeight: 500,
    underlinePosition: -100,
    underlineThickness: 50,
    strikeoutPosition: 300,
    strikeoutThickness: 50,
    italicAngle: 0,
    monospace: false,
    requiresShaping: false,
    covers: () => true,
    advance: (cp) => overrides[cp] ?? 600,
    kern: () => 0,
  };
}

describe('TAB_STOP_EMU', () => {
  it('is 0.5 in in EMU', () => {
    expect(TAB_STOP_EMU).toBe(457_200);
  });
});

describe('specialCharWidth — NBSP borrows the space glyph\'s width (spec 02 §7.4)', () => {
  it('returns the SPACE (0x20) advance, not any advance the font itself reports for NBSP', () => {
    // A font whose own NBSP glyph (if it had a distinct one) would measure very differently
    // from its space glyph — the spec's rule is that this engine never asks the font, it
    // always substitutes the space glyph's own width.
    const face = fixtureFace({ 0x20: 500, 0x00a0: 999 });
    expect(specialCharWidth(0x00a0, face)).toBe(500);
  });

  it('REGRESSION: a naive `faceMetrics.advance(cp)` passthrough would have returned the trap value', () => {
    const face = fixtureFace({ 0x20: 500, 0x00a0: 999 });
    expect(face.advance(0x00a0)).toBe(999); // the wrong answer the fallthrough would have given
    expect(specialCharWidth(0x00a0, face)).not.toBe(face.advance(0x00a0));
  });
});

describe('specialCharWidth — ZWSP and sanitized control range are zero-width (spec 02 §7.4)', () => {
  it('U+200B ZERO WIDTH SPACE is zero regardless of what the font reports', () => {
    const face = fixtureFace({ 0x200b: 12345 });
    expect(specialCharWidth(0x200b, face)).toBe(0);
  });

  it('every code point in 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F is zero', () => {
    const face = fixtureFace();
    const probes = [0x00, 0x01, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x10, 0x1f];
    for (const cp of probes) expect(specialCharWidth(cp, face)).toBe(0);
  });

  it('tab (0x09) and LF (0x0A, the soft-return unit) are NOT swept into the zero-width rule', () => {
    const face = fixtureFace({ 0x09: 111, 0x0a: 222 });
    expect(specialCharWidth(0x09, face)).toBe(111);
    expect(specialCharWidth(0x0a, face)).toBe(222);
  });
});

describe('specialCharWidth — ordinary code points pass through to the font unchanged', () => {
  it('an ordinary letter delegates straight to faceMetrics.advance', () => {
    const face = fixtureFace({ 0x41: 733 });
    expect(specialCharWidth(0x41, face)).toBe(733);
  });
});

describe('tabAdvance — grid anchored to textLeft, minimum one space width (spec 02 §7.4)', () => {
  const stops = (minAdvanceEmu: number, positions?: readonly number[]): TabStops => ({ minAdvanceEmu, positions });

  it('from the left text edge, advances to the first 0.5in stop', () => {
    const textLeft = 0;
    expect(tabAdvance(textLeft, textLeft, stops(10_000))).toBe(TAB_STOP_EMU);
  });

  it('advances to the NEXT stop even when already exactly on one (standard tab semantics)', () => {
    const textLeft = 0;
    expect(tabAdvance(TAB_STOP_EMU, textLeft, stops(10_000))).toBe(2 * TAB_STOP_EMU);
  });

  it('the grid is anchored to textLeft, not to absolute x=0', () => {
    const textLeft = 300_000; // not a multiple of TAB_STOP_EMU
    expect(tabAdvance(textLeft, textLeft, stops(10_000))).toBe(textLeft + TAB_STOP_EMU);
  });

  it('REGRESSION: a naive grid computed from absolute x (ignoring textLeft) gives a different, wrong stop', () => {
    const textLeft = 300_000;
    const x = textLeft;
    const naiveIgnoringTextLeft = (Math.floor(x / TAB_STOP_EMU) + 1) * TAB_STOP_EMU;
    const real = tabAdvance(x, textLeft, stops(10_000));
    expect(naiveIgnoringTextLeft).toBe(TAB_STOP_EMU); // 457 200 — measured from 0, not from textLeft
    expect(real).toBe(textLeft + TAB_STOP_EMU); // 757 200 — the correct, textLeft-anchored stop
    expect(real).not.toBe(naiveIgnoringTextLeft);
  });

  it('when the natural next stop is closer than one space width, advances by the minimum instead', () => {
    const textLeft = 0;
    const spaceWidth = 76_200; // a plausible Courier space advance in EMU
    const x = TAB_STOP_EMU - 57_200; // 57 200 EMU short of the next stop — less than spaceWidth
    const result = tabAdvance(x, textLeft, stops(spaceWidth));
    expect(result - x).toBe(spaceWidth); // the floor won, not the grid
    expect(result).not.toBe(TAB_STOP_EMU); // didn't just snap to the stop either
  });

  it('REGRESSION: without the minimum-advance floor, that same tab would advance less than one space', () => {
    const textLeft = 0;
    const spaceWidth = 76_200;
    const x = TAB_STOP_EMU - 57_200;
    const naiveNoFloor = textLeft + TAB_STOP_EMU; // "just snap to the grid stop, no floor"
    expect(naiveNoFloor - x).toBe(57_200);
    expect(naiveNoFloor - x).toBeLessThan(spaceWidth); // violates "minimum advance = one space width"
    const real = tabAdvance(x, textLeft, stops(spaceWidth));
    expect(real - x).toBeGreaterThanOrEqual(spaceWidth);
    expect(real).not.toBe(naiveNoFloor);
  });

  it('the floor is a no-op for an ordinary tab (0.5in is far wider than one space)', () => {
    const textLeft = 0;
    expect(tabAdvance(textLeft, textLeft, stops(76_200))).toBe(TAB_STOP_EMU);
  });

  it('template-defined explicit tab stops are used ahead of the plain 0.5in grid', () => {
    const textLeft = 0;
    const positions = [200_000, 600_000];
    expect(tabAdvance(textLeft + 100_000, textLeft, stops(10_000, positions))).toBe(textLeft + 200_000);
    expect(tabAdvance(textLeft + 250_000, textLeft, stops(10_000, positions))).toBe(textLeft + 600_000);
  });

  it('past the last explicit stop, falls back to the 0.5in grid continuing from there', () => {
    const textLeft = 0;
    const positions = [200_000, 600_000];
    // 700 000 is past both explicit stops; the next 0.5in-grid multiple strictly greater is 914 400.
    expect(tabAdvance(textLeft + 700_000, textLeft, stops(10_000, positions))).toBe(textLeft + 914_400);
  });
});

describe('embedWidth — revDel is zero width and zero height (spec 02 §7.4)', () => {
  const revDel: Embed = { type: 'revDel', rev: 'rev_00000000000000000000000000' as RevisionSetId, by: 'user', at: 0 };

  it('a revDel embed measures as {0, 0} regardless of line width or pitch', () => {
    expect(embedWidth(revDel, 5_486_400, 152_400)).toEqual({ widthEmu: 0, heightEmu: 0 });
  });

  it('REGRESSION: dropping the revDel branch and falling through to the image formula produces garbage, not zero', () => {
    function embedWidthWithoutRevDelBranch(embed: { widthEmu?: number; heightEmu?: number }, lineWidthEmu: number, pitchEmu: number) {
      const widthEmu = Math.min(embed.widthEmu as number, lineWidthEmu);
      const scaledHeight =
        (embed.widthEmu as number) > 0 ? (embed.heightEmu as number) * (widthEmu / (embed.widthEmu as number)) : (embed.heightEmu as number);
      const pitches = Math.max(1, Math.ceil(scaledHeight / pitchEmu));
      return { widthEmu, heightEmu: pitches * pitchEmu };
    }
    const naive = embedWidthWithoutRevDelBranch(revDel as unknown as { widthEmu?: number; heightEmu?: number }, 5_486_400, 152_400);
    expect(Number.isNaN(naive.widthEmu)).toBe(true); // revDel has no widthEmu field — garbage, not the correct zero
    expect(embedWidth(revDel, 5_486_400, 152_400).widthEmu).toBe(0);
  });
});

describe('embedWidth — inline image (spec 02 §7.4)', () => {
  const pitchEmu = 152_400; // 6 lpi base pitch

  it('fits within the line: width unclamped, height still rounds UP to whole pitches', () => {
    const image: Embed = { type: 'image', assetId: 'asset_00000000000000000000000000' as AssetId, widthEmu: 300_000, heightEmu: 300_000, alt: '' };
    const result = embedWidth(image, 5_486_400, pitchEmu);
    expect(result.widthEmu).toBe(300_000); // no clamp needed
    expect(result.heightEmu).toBe(2 * pitchEmu); // 300 000 needs 2 pitches (304 800), not 1
    expect(result.heightEmu % pitchEmu).toBe(0);
  });

  it('REGRESSION: without rounding up, the height would be the raw scaled value, not a whole pitch multiple', () => {
    const image: Embed = { type: 'image', assetId: 'asset_00000000000000000000000000' as AssetId, widthEmu: 300_000, heightEmu: 300_000, alt: '' };
    const naiveHeight = image.type === 'image' ? image.heightEmu : 0; // "just use the raw height" — the rounding dropped
    expect(naiveHeight).toBe(300_000);
    expect(naiveHeight % pitchEmu).not.toBe(0); // not a whole pitch — the bug this rule prevents
    expect(embedWidth(image, 5_486_400, pitchEmu).heightEmu).not.toBe(naiveHeight);
  });

  it('wider than the line: width clamps and height scales proportionally before rounding up', () => {
    const image: Embed = { type: 'image', assetId: 'asset_00000000000000000000000000' as AssetId, widthEmu: 1_000_000, heightEmu: 500_000, alt: '' };
    const lineWidthEmu = 400_000;
    const result = embedWidth(image, lineWidthEmu, pitchEmu);
    expect(result.widthEmu).toBe(400_000); // clamped to the line
    // scaledHeight = 500 000 * (400 000/1 000 000) = 200 000, rounds up to 2 pitches (304 800).
    expect(result.heightEmu).toBe(2 * pitchEmu);
  });

  it('REGRESSION: clamping width without also scaling height would distort the aspect ratio', () => {
    const image: Embed = { type: 'image', assetId: 'asset_00000000000000000000000000' as AssetId, widthEmu: 1_000_000, heightEmu: 500_000, alt: '' };
    const lineWidthEmu = 400_000;
    const naiveHeightNoScale = image.type === 'image' ? Math.max(1, Math.ceil(image.heightEmu / pitchEmu)) * pitchEmu : 0; // clamps width but forgets to scale height first
    const real = embedWidth(image, lineWidthEmu, pitchEmu);
    expect(naiveHeightNoScale).toBe(4 * pitchEmu); // 500 000 rounds up to 4 pitches, unscaled — wrong
    expect(real.heightEmu).toBe(2 * pitchEmu);
    expect(real.heightEmu).not.toBe(naiveHeightNoScale);
  });

  it('never zero height, even for a degenerate embed', () => {
    const image: Embed = { type: 'image', assetId: 'asset_00000000000000000000000000' as AssetId, widthEmu: 100, heightEmu: 1, alt: '' };
    expect(embedWidth(image, 5_486_400, pitchEmu).heightEmu).toBe(pitchEmu);
  });
});
