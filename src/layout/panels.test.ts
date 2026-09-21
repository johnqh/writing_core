import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { BUILTIN_TEMPLATES } from '../templates/catalogue.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import { layoutDocument } from './layout-document.js';

const GN = BUILTIN_TEMPLATES['graphic-novel']!;
const text = (d: { runs: { text: string }[] }) => d.runs.map((r) => r.text).join('');

function build(rows: [string, string][], template: EmbeddedTemplateJSON = GN) {
  const h = commandHarness(template);
  const ids = h.replaceBody(rows);
  return { h, ids, layout: (t: EmbeddedTemplateJSON = h.model.template()) => layoutDocument(h.model, t) };
}
const lineText = (l: ReturnType<typeof layoutDocument>, id: string) => l.pages.flatMap((p) => p.lines).filter((x) => x.elementId === id).map(text).join(' ');

const script: [string, string][] = [
  ['st_page', ''], ['st_panel', ''], ['st_action', 'A rainy street.'], ['st_character', 'MAYA'], ['st_dialogue', 'Not again.'],
  ['st_panel', ''], ['st_action', 'Close on her eyes.'],
  ['st_page', ''], ['st_panel', ''], ['st_action', 'The door opens.'],
  ['st_panel', 'Wide.'], ['st_action', 'Everyone turns.'], ['st_panel', ''], ['st_action', 'Silence.'],
];

describe('graphic novel panels mode', () => {
  it('generates PAGE ONE (TWO PANELS) headings and restarts panel numbering on each page', () => {
    const { layout, ids } = build(script);
    const l = layout();
    expect(lineText(l, ids[0]!)).toBe('PAGE ONE (TWO PANELS)');
    expect(lineText(l, ids[7]!)).toBe('PAGE TWO (THREE PANELS)');
    expect([1, 5, 8, 10, 12].map((i) => lineText(l, ids[i]!).split(' ')[0])).toEqual(['Panel', 'Panel', 'Panel', 'Panel', 'Panel']);
    expect([1, 5, 8, 10, 12].map((i) => lineText(l, ids[i]!))).toEqual(['Panel 1.', 'Panel 2.', 'Panel 1.', 'Panel 2. Wide.', 'Panel 3.']);
  });

  it('every page heading starts a script page (page count = author page breaks)', () => {
    const { layout, ids } = build(script);
    const l = layout();
    expect(l.pages).toHaveLength(2);
    expect(l.pages[1]!.lines[0]!.elementId).toBe(ids[7]);
  });

  it("keeps a writer's own heading text and honours autoHeadingText: false", () => {
    const own: [string, string][] = [['st_page', 'THE DINER'], ['st_panel', ''], ['st_action', 'Steam.']];
    const a = build(own);
    expect(lineText(a.layout(), a.ids[0]!)).toBe('THE DINER');
    const off = { ...GN, pagination: { ...GN.pagination, panels: { autoHeadingText: false } } } as EmbeddedTemplateJSON;
    const b = build(script, off);
    expect(lineText(b.layout(), b.ids[0]!)).toBe('');
    expect(lineText(b.layout(), b.ids[1]!)).toBe('Panel 1.'); // the inline label is not heading text
  });

  it('the inline label takes width: a panel line breaks earlier than the same text without it', () => {
    const long = Array.from({ length: 12 }, () => 'Wide shot').join(' ');
    const { layout, ids } = build([['st_page', ''], ['st_panel', long]]);
    const l = layout();
    const withLabel = l.pages[0]!.lines.filter((x) => x.elementId === ids[1]);
    expect(text(withLabel[0]!).startsWith('Panel 1. Wide')).toBe(true);
    const plain = build([['st_page', ''], ['st_action', long]]);
    const noLabel = plain.layout().pages[0]!.lines.filter((x) => x.elementId === plain.ids[1]);
    expect(text(withLabel[0]!).length).toBeLessThanOrEqual(text(noLabel[0]!).length + 'Panel 1. '.length);
    expect(withLabel.length).toBeGreaterThanOrEqual(noLabel.length);
  });

  it("a script page break inside a comic page starts the next page with PAGE ONE (CONT'D)", () => {
    const rows: [string, string][] = [['st_page', ''], ['st_panel', '']];
    for (let i = 0; i < 70; i++) rows.push(['st_action', `Beat ${i}.`]);
    const { layout, ids } = build(rows);
    const l = layout();
    expect(l.pages.length).toBeGreaterThanOrEqual(2);
    const first = l.pages[1]!.lines[0]!;
    expect(first.kind).toBe('pageHeadingContd');
    expect(text(first)).toBe("PAGE ONE (CONT'D)");
    expect(l.pages[0]!.lines[0]!.elementId).toBe(ids[0]);
  });

  it('a book with three pages of panels produces a sane page count and no CONT\'D when pages break cleanly', () => {
    const rows: [string, string][] = [];
    for (let p = 0; p < 3; p++) rows.push(['st_page', ''], ['st_panel', ''], ['st_action', 'Something happens.'], ['st_panel', ''], ['st_action', 'Then more.']);
    const { layout } = build(rows);
    const l = layout();
    expect(l.pages).toHaveLength(3);
    expect(l.pages.flatMap((p) => p.lines).some((x) => x.kind === 'pageHeadingContd')).toBe(false);
  });
});
