import { describe, expect, it } from 'vitest';
import { createFontRegistry } from '../fonts/registry.js';
import { builtinStyleId } from '../ids/ids.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { resolveStyle } from '../template/resolve.js';
import { categoryOf } from './category.js';
import { layoutParagraph, type ParagraphInput } from './paragraph.js';

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
});
