import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { dualGeometry, dualSideBox } from './dual.js';
import { layoutDocument } from './layout-document.js';

const text = (d: { runs: { text: string }[] }) => d.runs.map((r) => r.text).join('');
// 14-character sentences: one per line in the ~16-column half-width dialogue box the §15.2 derivation gives, so every line ends a sentence.
const SHORT = 'Hold the door.';
const SPEECH = Array.from({ length: 8 }, () => SHORT).join(' ');

function build(rows: [string, string][], dual = true) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  if (dual) {
    const cues = rows.map((r, i) => [r[0], i] as const).filter(([s]) => s === 'st_character').map(([, i]) => i);
    expect(h.run('dual.make', { element: ids[cues[1]!]! }).ok).toBe(true);
  }
  return { h, ids, layout: (t = h.model.template()) => layoutDocument(h.model, t) };
}

const pair = (left: string, right: string): [string, string][] => [
  ['st_scene_heading', 'INT. STATION - NIGHT'], ['st_action', 'They speak at once.'],
  ['st_character', 'MAYA'], ['st_dialogue', left], ['st_character', 'JONAH'], ['st_dialogue', right], ['st_action', 'Silence.'],
];

describe('dualGeometry', () => {
  const t = commandHarness().model.template();

  it('derives the halves proportionally from the single-column indents (integer arithmetic)', () => {
    const g = dualGeometry(t);
    const textLeft = t.page.margins.left;
    const textWidth = t.page.width - t.page.margins.left - t.page.margins.right;
    const gap = t.pagination.dualDialogue.columnGap;
    const half = Math.floor((textWidth - gap) / 2);
    for (const cat of ['character', 'parenthetical', 'dialogue'] as const) {
      const { leftSide, rightSide } = g[cat];
      expect(Number.isInteger(leftSide.left) && Number.isInteger(rightSide.right)).toBe(true);
      expect(leftSide.left).toBeGreaterThanOrEqual(textLeft);
      expect(leftSide.right).toBeLessThanOrEqual(textLeft + half);
      expect(rightSide.left).toBeGreaterThanOrEqual(textLeft + half + gap);
      expect(rightSide.right).toBeLessThanOrEqual(textLeft + textWidth);
      expect(rightSide.left - leftSide.left).toBe(half + gap); // the right half is the left half shifted
    }
    // dialogue: indentLeft 1in, indentRight 1.5in of a 6in text width
    expect(g.dialogue.leftSide.left).toBe(textLeft + Math.floor((914_400 * half) / textWidth));
  });

  it('uses stored geometry verbatim', () => {
    const stored = { ...dualGeometry(t), dialogue: { leftSide: { left: 1_000_000, right: 3_000_000 }, rightSide: { left: 4_000_000, right: 6_000_000 } } };
    const t2 = { ...t, pagination: { ...t.pagination, dualDialogue: { ...t.pagination.dualDialogue, geometry: stored } } };
    expect(dualSideBox(dualGeometry(t2), 'dialogue', 'right')).toEqual({ textLeft: 4_000_000, width: 2_000_000 });
    expect(dualSideBox(dualGeometry(t2), 'lyrics', 'left')).toEqual({ textLeft: 1_000_000, width: 2_000_000 }); // other categories use dialogue
  });
});

describe('dual.make / dual.clear', () => {
  it('pairs the dialogue block with the one before it, refuses a lone block, and clears the pair (undo-safe as one write)', () => {
    const h = commandHarness();
    const ids = h.replaceBody(pair('One.', 'Two.'));
    expect(h.run('dual.make', { element: ids[3]! }).ok).toBe(false); // MAYA has no dialogue block before it
    expect(h.run('dual.make', { element: ids[5]! }).ok).toBe(true);
    const els = h.model.elements();
    expect(els.slice(2, 6).map((e) => e.dual?.side)).toEqual(['left', 'left', 'right', 'right']);
    expect(new Set(els.slice(2, 6).map((e) => e.dual?.group)).size).toBe(1);
    expect(els[0]!.dual).toBeNull();
    expect(h.run('dual.make', { element: ids[5]! }).ok).toBe(false); // already dual
    expect(h.run('dual.clear', { element: ids[3]! }).ok).toBe(true);
    expect(h.model.elements().every((e) => e.dual === null)).toBe(true);
  });
});

describe('dual dialogue layout', () => {
  it('lays the two sides side by side at the same y with different x, and the block is as tall as the taller side', () => {
    const { layout, ids } = build(pair(SPEECH, SHORT));
    const l = layout();
    const lines = l.pages[0]!.lines;
    const cueL = lines.find((x) => x.elementId === ids[2])!;
    const cueR = lines.find((x) => x.elementId === ids[4])!;
    expect(cueL.dualSide).toBe('left');
    expect(cueR.dualSide).toBe('right');
    expect(cueR.y).toBe(cueL.y);
    expect(cueR.x).toBeGreaterThan(cueL.x);
    const g = dualGeometry(commandHarness().model.template());
    expect(cueL.x).toBeGreaterThanOrEqual(g.character.leftSide.left);
    expect(cueR.x).toBeGreaterThanOrEqual(g.character.rightSide.left);
    expect(cueR.x + cueR.width).toBeLessThanOrEqual(g.character.rightSide.right + 1);
    const speechL = lines.filter((x) => x.elementId === ids[3]);
    const speechR = lines.filter((x) => x.elementId === ids[5]);
    expect(speechL).toHaveLength(8);
    expect(speechR).toHaveLength(1);
    expect(speechR[0]!.y).toBe(speechL[0]!.y);
    expect(speechR[0]!.x).toBeGreaterThan(speechL[0]!.x + speechL[0]!.width - 1);
    // the next block starts below the taller (left) side, one blank line after it
    const after = lines.find((x) => x.elementId === ids[6])!;
    const bottom = speechL[speechL.length - 1]!;
    expect(after.y).toBe(bottom.y + bottom.pitch + 152_400);
    // and the other way round
    const flipped = build(pair(SHORT, SPEECH)).layout().pages[0]!.lines;
    const b2 = flipped.filter((x) => x.dualSide === 'right').pop()!;
    expect(flipped.find((x) => x.elementId === ids[6])!.y).toBe(b2.y + b2.pitch + 152_400);
  });

  it('stacks the sides when dual dialogue is disabled in the template', () => {
    const { h, layout, ids } = build(pair(SHORT, SHORT));
    const t = h.model.template();
    const off = layout({ ...t, pagination: { ...t.pagination, dualDialogue: { ...t.pagination.dualDialogue, enabled: false } } });
    const lines = off.pages[0]!.lines;
    const cueL = lines.find((x) => x.elementId === ids[2])!;
    const cueR = lines.find((x) => x.elementId === ids[4])!;
    expect(cueR.x).toBe(cueL.x);
    expect(cueR.y).toBeGreaterThan(cueL.y);
    expect(lines.every((x) => x.dualSide === null)).toBe(true);
  });

  it('splits across a page break with each side getting its own (MORE) and continuation cue, and re-pairs the tails', () => {
    // 22 one-line actions fill 45 rows; the pair's cues start on row 47, leaving 5 rows for a head.
    const rows = pair(SPEECH, SPEECH);
    rows.splice(1, 1, ...Array.from({ length: 22 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]));
    const { layout, ids } = build(rows);
    const l = layout();
    expect(l.pages.length).toBeGreaterThanOrEqual(2);
    const p1 = l.pages[0]!.lines;
    const mores = p1.filter((x) => x.kind === 'more');
    expect(mores.map((x) => x.dualSide).sort()).toEqual(['left', 'right']);
    expect(mores[0]!.y).toBe(mores[1]!.y);
    expect(mores[0]!.x).not.toBe(mores[1]!.x);
    const p2 = l.pages[1]!.lines;
    const cues = p2.filter((x) => x.kind === 'contdCue');
    expect(cues.map((x) => text(x))).toEqual(["MAYA (CONT'D)", "JONAH (CONT'D)"]);
    expect(cues[0]!.y).toBe(cues[1]!.y);
    expect(cues[0]!.y).toBe(l.bodyTop);
    expect(cues[1]!.x).toBeGreaterThan(cues[0]!.x);
    // every source line of both speeches is placed exactly once
    for (const id of [ids[ids.length - 4], ids[ids.length - 2]]) {
      expect(l.pages.flatMap((p) => p.lines).filter((x) => x.elementId === id && x.kind === 'text')).toHaveLength(8);
    }
  });

  it('splits only one side when the other fits, leaving the finished side without (MORE) or a continuation cue', () => {
    const rows = pair(SPEECH, SHORT);
    rows.splice(1, 1, ...Array.from({ length: 22 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]));
    const { layout } = build(rows);
    const l = layout();
    expect(l.pages[0]!.lines.filter((x) => x.kind === 'more').map((x) => x.dualSide)).toEqual(['left']);
    expect(l.pages[1]!.lines.filter((x) => x.kind === 'contdCue').map((x) => x.dualSide)).toEqual(['left']);
  });
});
