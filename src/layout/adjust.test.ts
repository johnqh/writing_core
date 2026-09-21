import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { autoAdjustLines, clampDeltaRight, LINE_ADJUST_MAX, LINE_ADJUST_MIN } from './adjust.js';
import { layoutDocument } from './layout-document.js';

const W = 'aaaaaaaaa';
const TWO_OVER = `${Array.from({ length: 6 }, () => W).join(' ')} bb`; // 62 chars in a 60-char action: last line is one word, fits with +2 chars
const ONE_OVER = `${Array.from({ length: 6 }, () => W).join(' ')} b`; // 61 chars: fits with +1
const THREE_WORDS = `${Array.from({ length: 6 }, () => W).join(' ')} bb cc dd`; // last line has 3 words

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  return { h, ids, tpl: h.model.template() };
}
const lineCount = (h: ReturnType<typeof build>['h'], id: string) => layoutDocument(h.model).pages.flatMap((p) => p.lines).filter((l) => l.elementId === id && l.kind === 'text').length;

describe('autoAdjustLines', () => {
  it('pulls a one-word last line back with the first widening that reduces the line count', () => {
    const { h, ids, tpl } = build([['st_scene_heading', 'INT. A - DAY'], ['st_action', TWO_OVER], ['st_action', ONE_OVER]]);
    expect(lineCount(h, ids[1]!)).toBe(2);
    const r = autoAdjustLines(h.model, tpl, 'all');
    expect(r.adjustments.map((a) => [a.elementId, a.deltaRight, a.auto, a.linesBefore, a.linesAfter])).toEqual([
      [ids[1], 2 * 91_440, true, 2, 1],
      [ids[2], 91_440, true, 2, 1],
    ]);
    expect(r.pagesBefore).toBe(r.pagesAfter);
  });

  it('leaves paragraphs whose last line has more than orphanWords words, and honours orphanWords and maxChars', () => {
    const { h, ids, tpl } = build([['st_scene_heading', 'INT. A - DAY'], ['st_action', THREE_WORDS], ['st_action', TWO_OVER]]);
    expect(autoAdjustLines(h.model, tpl, 'all').adjustments.map((a) => a.elementId)).toEqual([ids[2]]);
    expect(autoAdjustLines(h.model, tpl, 'all', { maxChars: 1 }).adjustments).toEqual([]);
    expect(lineCount(h, ids[1]!)).toBeGreaterThanOrEqual(2);
  });

  it('only touches the requested range', () => {
    const { h, ids, tpl } = build([['st_scene_heading', 'INT. A - DAY'], ['st_action', TWO_OVER], ['st_action', ONE_OVER]]);
    expect(autoAdjustLines(h.model, tpl, [ids[2]!]).adjustments.map((a) => a.elementId)).toEqual([ids[2]]);
  });

  it('does nothing for single-line paragraphs', () => {
    const { h, tpl } = build([['st_scene_heading', 'INT. A - DAY'], ['st_action', 'One line.']]);
    expect(autoAdjustLines(h.model, tpl, 'all')).toEqual({ adjustments: [], pagesBefore: 1, pagesAfter: 1 });
  });

  it('bounds deltaRight to [-1.0 in, +0.5 in]', () => {
    expect(clampDeltaRight(-2_000_000)).toBe(LINE_ADJUST_MIN);
    expect(clampDeltaRight(2_000_000)).toBe(LINE_ADJUST_MAX);
    expect(clampDeltaRight(91_440)).toBe(91_440);
  });
});
