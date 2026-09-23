import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { layoutDocument } from './layout-document.js';
import { buildElementIndex } from './output.js';
import { pageOf, pointToPosition, positionAbove, positionBelow, positionToCaret, selectionRects } from './mapping.js';

const scene = (n: number, heading: string): [string, string][] => [
  ['st_scene_heading', heading],
  ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${heading} ${i}.`]),
];

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  const layout = layoutDocument(h.model);
  return { h, ids, layout, index: buildElementIndex(layout, h.model) };
}

describe('pageOf', () => {
  it('finds the body page a source position falls on, and null for an unlaid-out element', () => {
    const rows: [string, string][] = [...scene(30, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')];
    const { ids, layout, index } = build(rows);
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(pageOf(index, { elementId: ids[0]!, offset: 0 })).toBe(0);
    const last = ids[ids.length - 1]!;
    const lastSpan = index.spanOf(last)!;
    expect(pageOf(index, { elementId: last, offset: 0 })).toBe(lastSpan.firstPage);
    expect(pageOf(index, { elementId: 'el_missing' as never, offset: 0 })).toBeNull();
  });
});

describe('positionToCaret', () => {
  it('caret x is monotonic non-decreasing with offset across a one-line action', () => {
    const { ids, layout, index } = build(scene(1, 'INT. A - DAY'));
    const text = `Beat INT. A - DAY 0.`;
    const xs = Array.from({ length: text.length + 1 }, (_, off) => positionToCaret(layout, index, { elementId: ids[1]!, offset: off })!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
    expect(xs[0]).toBeLessThan(xs[xs.length - 1]!);
  });

  it('picks line i vs i+1 at a soft-wrap boundary by affinity', () => {
    const long = Array.from({ length: 14 }, () => 'Sentence goes here.').join(' ');
    const { ids, layout, index } = build([...scene(1, 'INT. A - DAY'), ['st_action', long]]);
    const span = index.spanOf(ids[2]!)!;
    expect(span.lines.length).toBeGreaterThan(1); // must actually wrap for this test to mean anything
    const boundary = span.lines[0]!.sourceEnd;
    expect(span.lines[1]!.sourceStart).toBe(boundary);
    const up = positionToCaret(layout, index, { elementId: ids[2]!, offset: boundary }, 'upstream')!;
    const down = positionToCaret(layout, index, { elementId: ids[2]!, offset: boundary }, 'downstream')!;
    const line0 = layout.pages[span.lines[0]!.pageIndex]!.lines[span.lines[0]!.lineIndex]!;
    const line1 = layout.pages[span.lines[1]!.pageIndex]!.lines[span.lines[1]!.lineIndex]!;
    expect(up.top).toBe(line0.y);
    expect(down.top).toBe(line1.y);
    expect(down.top).toBeGreaterThan(up.top);
  });

  it('returns null for an element with no laid-out line', () => {
    const { layout, index } = build(scene(1, 'INT. A - DAY'));
    expect(positionToCaret(layout, index, { elementId: 'el_missing' as never, offset: 0 })).toBeNull();
  });

  it('handles a bidi-mixed line (Hebrew + Latin) without throwing, monotonic within each script run', () => {
    const { ids, layout, index } = build([['st_action', 'שלום (עולם) abc']]);
    const text = 'שלום (עולם) abc';
    for (let off = 0; off <= text.length; off++) {
      const caret = positionToCaret(layout, index, { elementId: ids[0]!, offset: off });
      expect(caret).not.toBeNull();
      expect(Number.isFinite(caret!.x)).toBe(true);
    }
  });
});

describe('pointToPosition', () => {
  it('round-trips positionToCaret -> pointToPosition back to the same offset, for every cluster-aligned offset', () => {
    const { ids, layout, index } = build(scene(1, 'INT. A - DAY'));
    const text = `Beat INT. A - DAY 0.`;
    const line = layout.pages[0]!.lines.find((l) => l.elementId === ids[1])!;
    for (let off = 0; off <= text.length; off++) {
      const caret = positionToCaret(layout, index, { elementId: ids[1]!, offset: off })!;
      const hit = pointToPosition(layout, { pageIndex: caret.pageIndex, x: caret.x, y: line.y + line.pitch / 2 })!;
      expect(hit.position).toEqual({ elementId: ids[1]!, offset: off });
      expect(hit.inside).toBe('text');
    }
  });

  it('reports margin for a point left of the text, and decoration for a generated line', () => {
    const { layout, ids } = build(scene(1, 'INT. A - DAY'));
    const line = layout.pages[0]!.lines[0]!;
    const inMargin = pointToPosition(layout, { pageIndex: 0, x: line.x - 500_000, y: line.y + 1 })!;
    expect(inMargin.inside).toBe('margin');

    const page = layout.pages[0]!;
    // A generated line always sits on its own row in real usage; give it a distinct y here too, so the
    // row-grouping this function does (dual/column sides share a row) does not lump it with a real line.
    page.lines.splice(1, 0, { ...page.lines[0]!, kind: 'more', elementId: ids[0]!, y: page.lines[0]!.y + 999 });
    const decoLine = page.lines[1]!;
    const onDeco = pointToPosition(layout, { pageIndex: 0, x: decoLine.x, y: decoLine.y })!;
    expect(onDeco.inside).toBe('decoration');
  });

  it('returns null for an unknown page', () => {
    const { layout } = build(scene(1, 'INT. A - DAY'));
    expect(pointToPosition(layout, { pageIndex: 99, x: 0, y: 0 })).toBeNull();
  });
});

describe('selectionRects', () => {
  it('a single-line selection produces one rect spanning the two offsets', () => {
    const { ids, layout, index } = build(scene(1, 'INT. A - DAY'));
    const from = { elementId: ids[1]!, offset: 2 };
    const to = { elementId: ids[1]!, offset: 6 };
    const rects = selectionRects(layout, index, from, to);
    expect(rects).toHaveLength(1);
    const a = positionToCaret(layout, index, from)!.x;
    const b = positionToCaret(layout, index, to)!.x;
    expect(rects[0]).toMatchObject({ pageIndex: 0, x: Math.min(a, b), width: Math.abs(b - a) });
  });

  it('a multi-line selection spans paragraph text edges for the boundary lines and the full paragraph width in between', () => {
    const long = Array.from({ length: 20 }, () => 'Sentence goes here.').join(' ');
    const { ids, layout, index } = build([...scene(1, 'INT. A - DAY'), ['st_action', long]]);
    const span = index.spanOf(ids[2]!)!;
    expect(span.lines.length).toBeGreaterThanOrEqual(3); // need a real middle line
    const midOfLine0 = Math.floor((span.lines[0]!.sourceStart + span.lines[0]!.sourceEnd) / 2);
    const midOfLastLine = Math.floor((span.lines.at(-1)!.sourceStart + span.lines.at(-1)!.sourceEnd) / 2);
    const from = { elementId: ids[2]!, offset: midOfLine0 };
    const to = { elementId: ids[2]!, offset: midOfLastLine };
    const rects = selectionRects(layout, index, from, to);
    expect(rects).toHaveLength(span.lines.length);
    const line0 = layout.pages[span.lines[0]!.pageIndex]!.lines[span.lines[0]!.lineIndex]!;
    expect(rects[0]!.x + rects[0]!.width).toBeCloseTo(line0.x + line0.width, -1);
    for (let i = 1; i < rects.length - 1; i++) {
      const l = layout.pages[span.lines[i]!.pageIndex]!.lines[span.lines[i]!.lineIndex]!;
      expect(rects[i]).toMatchObject({ x: l.x, width: l.width });
    }
    const lastLine = layout.pages[span.lines.at(-1)!.pageIndex]!.lines[span.lines.at(-1)!.lineIndex]!;
    expect(rects.at(-1)!.x).toBeCloseTo(lastLine.x, -1);
  });

  it('skips a generated (decoration) line inside the selected range', () => {
    const { ids, layout } = build(scene(2, 'INT. A - DAY'));
    const page = layout.pages[0]!;
    page.lines.splice(1, 0, { ...page.lines[0]!, kind: 'more' });
    const freshIndex = buildElementIndex(layout);
    const from = { elementId: ids[0]!, offset: 0 };
    const to = { elementId: ids[1]!, offset: 1 };
    const rects = selectionRects(layout, freshIndex, from, to);
    // Two real text lines were selected (the heading and the first action's start); the spliced `more`
    // line in between (now at index 1, between them) is not one of them.
    expect(rects).toHaveLength(2);
  });
});

describe('positionAbove / positionBelow', () => {
  it('moves to the row above/below and preserves goalX across successive calls', () => {
    const { ids, layout, index } = build(scene(3, 'INT. A - DAY'));
    const start = { elementId: ids[2]!, offset: 3 }; // middle action line
    const startCaret = positionToCaret(layout, index, start)!;
    const up = positionAbove(layout, index, start, startCaret.x)!;
    expect(up.position.elementId).toBe(ids[1]);
    expect(up.goalX).toBe(startCaret.x);
    const upAgain = positionAbove(layout, index, up.position, up.goalX)!;
    expect(upAgain.position.elementId).toBe(ids[0]);
    expect(upAgain.goalX).toBe(startCaret.x); // goalX unchanged across the second move

    const down = positionBelow(layout, index, start, startCaret.x)!;
    expect(down.position.elementId).toBe(ids[3]);
    expect(down.goalX).toBe(startCaret.x);
  });

  it('returns null moving above the first line or below the last line of a one-page document', () => {
    const { ids, layout, index } = build(scene(1, 'INT. A - DAY'));
    expect(positionAbove(layout, index, { elementId: ids[0]!, offset: 0 })).toBeNull();
    expect(positionBelow(layout, index, { elementId: ids[1]!, offset: 0 })).toBeNull();
  });

  it('spills onto the adjacent page at a page boundary', () => {
    const rows: [string, string][] = [...scene(30, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')];
    const { layout, index } = build(rows);
    expect(layout.pages.length).toBeGreaterThan(1);
    const lastOfPage0 = layout.pages[0]!.lines.at(-1)!;
    const down = positionBelow(layout, index, { elementId: lastOfPage0.elementId, offset: lastOfPage0.sourceStart });
    expect(down).not.toBeNull();
    expect(pageOf(index, down!.position)).toBe(1);
  });

  it('computes its own goalX from the current position when none is passed', () => {
    const { ids, layout, index } = build(scene(2, 'INT. A - DAY'));
    const pos = { elementId: ids[1]!, offset: 3 };
    const caretX = positionToCaret(layout, index, pos)!.x;
    const down = positionBelow(layout, index, pos)!;
    expect(down.goalX).toBe(caretX);
  });
});
