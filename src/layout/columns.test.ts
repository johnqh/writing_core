import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { BUILTIN_TEMPLATES } from '../templates/catalogue.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { CATEGORY_RULES, type PaginationCategory } from './category.js';
import { formBlocks, type BlockPara } from './blocks.js';
import { formRows } from './columns.js';
import { layoutDocument } from './layout-document.js';
import type { ElementContext } from './context.js';

const text = (d: { runs: { text: string }[] }) => d.runs.map((r) => r.text).join('');
const AV = BUILTIN_TEMPLATES['av-two-column']!;
const BBC = BUILTIN_TEMPLATES['stage-play-bbc']!;
const RADIO = BUILTIN_TEMPLATES['radio-play-bbc']!;

let n = 0;
function para(category: PaginationCategory, column: 0 | 1 | 2): BlockPara {
  const rule = CATEGORY_RULES[category];
  const id = `el_${n++}` as never;
  return {
    layout: { elementId: id, cacheKey: '', spaceBefore: 0, lines: [], totalHeight: 0, sentenceEndLines: new Uint8Array(0), category, diagnostics: [] },
    ctx: { category, sceneId: null, sceneOrdinal: 0, actId: null, omitted: false, hidden: false, speaker: null, autoContinued: false, numberLabel: null, generatedText: null, dualSide: null, columnRowId: null, decorationHash: 0 } as ElementContext,
    flags: { keepWithNext: rule.keepsWithNext === 'always', keepsWithPrevious: rule.keepsWithPrevious, pageBreakBefore: false, splittable: rule.splittable, sentenceRule: false, column, dualGroup: null },
  };
}

describe('formRows (§16.1)', () => {
  it('AV: stacked video actions beside the audio that follows; an action after dialogue drops into a new row', () => {
    const [v1, v2, c, d, v3, c2] = [para('action', 1), para('action', 1), para('character', 2), para('dialogue', 2), para('action', 1), para('character', 2)];
    const rows = formRows([v1, v2, c, d, v3, c2]);
    expect(rows.map((r) => [r.left.length, r.right.length])).toEqual([[2, 2], [1, 1]]);
    expect(rows[0]!.left).toEqual([v1, v2]);
    expect(rows[1]!.right).toEqual([c2]);
  });

  it('BBC: name beside dialogue, one row per speech; a column-2 run with no name has an empty left side', () => {
    const rows = formRows([para('character', 1), para('dialogue', 2), para('character', 1), para('parenthetical', 2), para('dialogue', 2), para('dialogue', 2)]);
    expect(rows.map((r) => [r.left.length, r.right.length])).toEqual([[1, 1], [1, 3]]);
    expect(formRows([para('dialogue', 2), para('action', 1)]).map((r) => [r.left.length, r.right.length])).toEqual([[0, 1], [1, 0]]);
  });

  it('formBlocks emits one columnRows block per row', () => {
    const blocks = formBlocks([para('action', 1), para('dialogue', 2), para('action', 1), para('dialogue', 2)]);
    expect(blocks.map((b) => b.kind)).toEqual(['columnRows', 'columnRows']);
  });
});

function build(template: EmbeddedTemplateJSON, rows: [string, string][]) {
  const h = commandHarness(template);
  const ids = h.replaceBody(rows);
  return { h, ids, layout: (t: EmbeddedTemplateJSON = h.model.template()) => layoutDocument(h.model, t) };
}
const S = 'Hold the door now.';
const words = (k: number) => Array.from({ length: k }, () => S).join(' ');
const filler = (k: number): [string, string][] => Array.from({ length: k }, (_, i) => ['st_normal', `Filler ${i}`]);

describe('AV two-column layout', () => {
  it('sets video beside audio: same first-line y, different x; the row is as tall as the taller side', () => {
    const { layout, ids } = build(AV, [
      ['st_scene_heading', 'INT. STUDIO - DAY'],
      ['st_action', 'Wide shot of the studio floor.'], ['st_action', 'Camera pushes in on the host.'],
      ['st_character', 'HOST'], ['st_dialogue', 'Welcome to the show.'],
      ['st_action', 'Cut to the guest.'], ['st_character', 'GUEST'], ['st_dialogue', 'Glad to be here.'],
    ]);
    const l = layout();
    const lines = l.pages[0]!.lines;
    const v1 = lines.find((x) => x.elementId === ids[1])!;
    const cue = lines.find((x) => x.elementId === ids[3])!;
    expect(v1.column).toBe(1);
    expect(cue.column).toBe(2);
    expect(cue.x).toBeGreaterThan(v1.x);
    expect(cue.y).toBe(v1.y);
    const v2 = lines.find((x) => x.elementId === ids[2])!;
    const dlg = lines.find((x) => x.elementId === ids[4])!;
    expect(dlg.y).toBeGreaterThan(cue.y);
    expect(v2.y).toBeGreaterThan(v1.y);
    // The second action after dialogue drops below the first row and pairs with the next audio.
    const v3 = lines.find((x) => x.elementId === ids[5])!;
    const cue2 = lines.find((x) => x.elementId === ids[6])!;
    expect(v3.y).toBeGreaterThan(dlg.y);
    expect(cue2.y).toBe(v3.y);
    expect(l.pages).toHaveLength(1);
  });

  it('moves a row whole when a side cannot split, and splits it per side when rows may split', () => {
    const row: [string, string][] = [['st_action', words(8)], ['st_character', 'HOST'], ['st_dialogue', words(12)]];
    const { layout, ids } = build(AV, [...filler(48), ...row]);
    const whole = layout();
    // No head of the right side (cue + dialogue) fits the space left: the row moves to page 2 whole.
    expect(whole.pages).toHaveLength(2);
    expect(whole.pages[1]!.lines.some((x) => x.elementId === ids[48])).toBe(true);
    expect(whole.pages[0]!.lines.some((x) => x.elementId === ids[48])).toBe(false);

    // With dialogue breaks allowed and room for a head, each side splits independently and the tails start page 2 top-aligned.
    const b2 = build(AV, [...filler(44), ...row]);
    const t = { ...AV, pagination: { ...AV.pagination, dialogue: { ...AV.pagination.dialogue, allowBreaks: true } } } as EmbeddedTemplateJSON;
    const split = b2.layout(t);
    expect(split.pages).toHaveLength(2);
    const p1 = split.pages[0]!.lines.filter((x) => x.column > 0);
    const p2 = split.pages[1]!.lines.filter((x) => x.column > 0);
    expect(p1.some((x) => x.column === 1) && p1.some((x) => x.column === 2)).toBe(true);
    expect(p2.length).toBeGreaterThan(0);
    // The tail (the dialogue's remaining lines; the action fit whole) is top-aligned on page 2.
    expect(Math.min(...p2.map((x) => x.y))).toBe(split.bodyTop);
    // No line is lost or repeated across the split.
    const total = (l: typeof split) => l.pages.flatMap((p) => p.lines).filter((x) => x.column > 0).length;
    expect(total(split)).toBe(total(b2.layout()));
  });
});

describe('BBC layout', () => {
  it('puts the character beside the first line of dialogue (stage and radio templates)', () => {
    for (const t of [BBC, RADIO]) {
      const { layout, ids } = build(t, [
        ['st_scene_heading', 'THE KITCHEN'], ['st_character', 'ANNA'], ['st_dialogue', 'Is the kettle on?'],
        ['st_character', 'BEN'], ['st_parenthetical', '(quietly)'], ['st_dialogue', 'It is.'],
      ]);
      const lines = layout().pages[0]!.lines;
      const anna = lines.find((x) => x.elementId === ids[1])!;
      const d1 = lines.find((x) => x.elementId === ids[2])!;
      expect(anna.column).toBe(1);
      expect(d1.column).toBe(2);
      expect(d1.x).toBeGreaterThan(anna.x);
      expect(d1.y).toBe(anna.y);
      const ben = lines.find((x) => x.elementId === ids[3])!;
      expect(ben.y).toBeGreaterThan(d1.y);
      expect(lines.find((x) => x.elementId === ids[4])!.y).toBe(ben.y);
      expect(text(lines.find((x) => x.elementId === ids[5])!).toUpperCase()).toBe('IT IS.');
    }
  });

  it('a long BBC script paginates to a sane page count', () => {
    const rows: [string, string][] = [['st_scene_heading', 'THE KITCHEN']];
    for (let i = 0; i < 60; i++) rows.push(['st_character', i % 2 ? 'ANNA' : 'BEN'], ['st_dialogue', words(2)]);
    const { layout } = build(BBC, rows);
    const l = layout();
    expect(l.pages.length).toBeGreaterThanOrEqual(3);
    expect(l.pages.length).toBeLessThanOrEqual(8);
    for (const p of l.pages) expect(p.lines.every((x) => x.y + x.pitch <= l.bodyBottom + 1)).toBe(true);
  });
});
