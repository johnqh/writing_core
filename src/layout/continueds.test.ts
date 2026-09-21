import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { synthesizedCue } from './continueds.js';
import { layoutDocument } from './layout-document.js';

const text = (d: { runs: { text: string }[] }) => d.runs.map((r) => r.text).join('');
// 31-character sentences: each fills one 35-column dialogue line, so every line ends a sentence (the sentence rule of §13.6 allows a break after any of them).
export const SPEECH = Array.from({ length: 7 }, () => 'Hold the door and listen to me.').join(' ');

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  return { h, ids, layout: () => layoutDocument(h.model) };
}

/** A scene with `n` one-line actions (two rows each) then MAYA's long speech. */
function speechAfter(n: number): [string, string][] {
  return [
    ['st_scene_heading', 'INT. STATION - NIGHT'],
    ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
    ['st_character', 'MAYA'], ['st_dialogue', SPEECH],
  ];
}

describe('synthesizedCue', () => {
  it("appends the continuation text once and never doubles it", () => {
    expect(synthesizedCue('MAYA', "(CONT'D)", ' ')).toBe("MAYA (CONT'D)");
    expect(synthesizedCue('SARAH (V.O.)', "(CONT'D)", ' ')).toBe("SARAH (V.O.) (CONT'D)");
    expect(synthesizedCue("MAYA (CONT'D)", "(CONT'D)", ' ')).toBe("MAYA (CONT'D)");
    expect(synthesizedCue('MAYA (CONT’D)', "(CONT'D)", ' ')).toBe('MAYA (CONT’D)');
  });
});

describe('(MORE) and (CONT\'D)', () => {
  // Find a filler count that makes the speech straddle the first page break.
  const n = (() => {
    for (let k = 18; k < 30; k++) {
      const { layout } = build(speechAfter(k));
      const l = layout();
      if (l.pages.length === 2 && l.pages[0]!.lines.some((x) => x.kind === 'more')) return k;
    }
    throw new Error('no straddling speech found');
  })();

  it('puts (MORE) under the head and NAME (CONT\'D) atop the continuation, without editable source ranges', () => {
    const { layout, ids } = build(speechAfter(n));
    const l = layout();
    const p1 = l.pages[0]!.lines;
    const last = p1[p1.length - 1]!;
    expect(last.kind).toBe('more');
    expect(text(last)).toBe('(MORE)');
    expect(last.sourceStart).toBe(0);
    expect(last.sourceEnd).toBe(0);
    expect(last.y + last.pitch).toBeLessThanOrEqual(l.bodyBottom);
    const cue = p1.find((x) => x.elementId === ids[ids.length - 2] && x.kind === 'text')!;
    expect(last.x).toBe(cue.x); // (MORE) sits in the cue's geometry
    const first = l.pages[1]!.lines[0]!;
    expect(first.kind).toBe('contdCue');
    expect(text(first)).toBe("MAYA (CONT'D)");
    expect(first.y).toBe(l.bodyTop);
    expect(first.x).toBe(cue.x);
    // the continuation text follows the cue line
    expect(l.pages[1]!.lines[1]!.kind).toBe('text');
    expect(l.pages[1]!.lines[1]!.elementId).toBe(ids[ids.length - 1]);
    // at least two dialogue lines on each side of the break
    expect(p1.filter((x) => x.elementId === ids[ids.length - 1]).length).toBeGreaterThanOrEqual(2);
    expect(l.pages[1]!.lines.filter((x) => x.elementId === ids[ids.length - 1]).length).toBeGreaterThanOrEqual(2);
  });

  it('turns both decorations off with template.setContinueds', () => {
    const { h, layout } = build(speechAfter(n));
    expect(h.run('template.setContinueds', { moreAtBottom: false, contAtTop: false }).ok).toBe(true);
    const l = layout();
    expect(l.pages.flatMap((p) => p.lines).some((x) => x.kind === 'more' || x.kind === 'contdCue')).toBe(false);
  });

  it('does not double a cue that already ends with the continuation text', () => {
    const rows = speechAfter(n);
    rows[rows.length - 2] = ['st_character', "MAYA (CONT'D)"];
    const { layout } = build(rows);
    expect(text(layout().pages[1]!.lines[0]!)).toBe("MAYA (CONT'D)");
  });

  it('puts a parenthetical after the synthesized cue and splits only before it', () => {
    const rows = speechAfter(n);
    rows.splice(rows.length - 1, 1, ['st_dialogue', SPEECH.slice(0, 140)], ['st_parenthetical', '(quietly)'], ['st_dialogue', SPEECH.slice(0, 120)]);
    const { layout, ids } = build(rows);
    const l = layout();
    let breaks = 0;
    for (let i = 0; i < l.pages.length - 1; i++) {
      if (!l.pages[i]!.lines.some((x) => x.kind === 'more')) continue;
      breaks++;
      const nextFirst = l.pages[i + 1]!.lines[0]!;
      expect(nextFirst.kind).toBe('contdCue');
      // a split never leaves a parenthetical as the last text line of a page
      const lastText = l.pages[i]!.lines.filter((x) => x.kind === 'text').pop()!;
      expect(lastText.elementId).not.toBe(ids[ids.length - 2]);
    }
    expect(breaks).toBeGreaterThan(0);
  });
});

describe('automatic character continueds (§14.3)', () => {
  it("adds (CONT'D) to a cue that speaks again after action in the same scene", () => {
    const { layout } = build([
      ['st_scene_heading', 'INT. STATION - NIGHT'], ['st_character', 'MAYA'], ['st_dialogue', 'Hello.'],
      ['st_action', 'She waits.'], ['st_character', 'MAYA'], ['st_dialogue', 'Still here.'],
    ]);
    const cues = layout().pages[0]!.lines.filter((x) => text(x).startsWith('MAYA'));
    expect(cues.map(text)).toEqual(['MAYA', "MAYA (CONT'D)"]);
  });
});

describe('scene continueds', () => {
  const rows = (): [string, string][] => [
    ['st_scene_heading', 'INT. STATION - NIGHT'],
    ...Array.from({ length: 40 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
  ];

  it('is off by default', () => {
    const l = build(rows()).layout();
    expect(l.pages.flatMap((p) => p.lines).some((x) => x.kind === 'continuedTop' || x.kind === 'continuedBottom')).toBe(false);
  });

  it('emits each side only when its own flag is on', () => {
    const b = build(rows());
    b.h.run('template.setContinueds', { sceneBottom: true });
    let l = b.layout();
    expect(l.pages.length).toBeGreaterThan(1);
    let bottom = l.pages[0]!.lines.filter((x) => x.kind === 'continuedBottom');
    expect(bottom).toHaveLength(1);
    expect(text(bottom[0]!)).toBe('(CONTINUED)');
    expect(l.pages[1]!.lines.some((x) => x.kind === 'continuedTop')).toBe(false);
    // the reserve keeps body content off the (CONTINUED) line
    const body = l.pages[0]!.lines.filter((x) => x.kind === 'text');
    expect(body[body.length - 1]!.y + body[body.length - 1]!.pitch).toBeLessThanOrEqual(bottom[0]!.y);
    expect(bottom[0]!.y + bottom[0]!.pitch).toBeLessThanOrEqual(l.bodyBottom);

    b.h.run('template.setContinueds', { sceneBottom: false, sceneTop: true });
    l = b.layout();
    expect(l.pages[0]!.lines.some((x) => x.kind === 'continuedBottom')).toBe(false);
    const top = l.pages[1]!.lines.filter((x) => x.kind === 'continuedTop');
    expect(top).toHaveLength(1);
    expect(text(top[0]!)).toBe('CONTINUED:');
    expect(top[0]!.y).toBe(l.bodyTop);
    // the first real paragraph follows the CONTINUED line and its blank line
    const firstBody = l.pages[1]!.lines.find((x) => x.kind === 'text')!;
    expect(firstBody.y).toBeGreaterThanOrEqual(top[0]!.y + 2 * top[0]!.pitch);
  });

  it('numbers continuation pages from the second one when numbered is on', () => {
    const b = build([['st_scene_heading', 'INT. STATION - NIGHT'], ...Array.from({ length: 100 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`])]);
    b.h.run('template.setContinueds', { sceneTop: true, sceneNumbered: true });
    const l = b.layout();
    expect(l.pages.length).toBeGreaterThanOrEqual(3);
    const tops = l.pages.map((p) => p.lines.find((x) => x.kind === 'continuedTop')).map((x) => (x ? text(x) : null));
    expect(tops.slice(0, 3)).toEqual([null, 'CONTINUED:', 'CONTINUED: (2)']);
  });

  it('gets no top CONTINUED when the page starts at a new scene, and no bottom CONTINUED at a scene boundary', () => {
    const b = build([
      ['st_scene_heading', 'INT. A - DAY'], ...Array.from({ length: 25 }, (_, i): [string, string] => ['st_action', `A${i}.`]),
      ['st_scene_heading', 'INT. B - DAY'], ...Array.from({ length: 25 }, (_, i): [string, string] => ['st_action', `B${i}.`]),
    ]);
    b.h.run('template.setContinueds', { sceneTop: true, sceneBottom: true });
    const l = b.layout();
    for (const [i, p] of l.pages.entries()) {
      const firstText = p.lines.find((x) => x.kind === 'text');
      if (firstText && text(firstText).startsWith('INT. B')) {
        expect(p.lines.some((x) => x.kind === 'continuedTop')).toBe(false);
        if (i > 0) expect(l.pages[i - 1]!.lines.some((x) => x.kind === 'continuedBottom')).toBe(false);
      }
    }
  });
});
