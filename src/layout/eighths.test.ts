import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { radioScriptUs } from '../templates/builtin/generated/radio-script-us.js';
import { distributeEighths, formatEighths, formatRunningTime, runningTime, sceneEighths } from './eighths.js';
import { layoutDocument } from './layout-document.js';

const PITCH = 152_400;
const BODY = 54 * PITCH;

const scene = (n: number, heading: string): [string, string][] => [
  ['st_scene_heading', heading],
  ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${heading} ${i}.`]),
];

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  return { h, ids, layout: () => layoutDocument(h.model) };
}

describe('distributeEighths (largest remainder)', () => {
  it('gives three equal thirds of a page 3+3+2, not 3+3+3', () => {
    const shares = distributeEighths([BODY / 3, BODY / 3, BODY / 3], BODY);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(8);
    expect([...shares].sort()).toEqual([2, 3, 3]);
  });

  it('gives a page filled by one scene exactly 8', () => {
    expect(distributeEighths([BODY], BODY)).toEqual([8]);
  });

  it('gives any scene with extent > 0 at least one eighth', () => {
    const shares = distributeEighths([BODY - PITCH, PITCH / 2, PITCH / 2], BODY);
    expect(shares.every((s) => s >= 1)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(8);
    expect(distributeEighths([0, PITCH], BODY)[0]).toBe(0);
  });

  it('a partly filled page totals round(sum), not 8', () => {
    expect(distributeEighths([BODY / 4], BODY)).toEqual([2]);
  });

  it('holds the total at 8 for random splits of a full page', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rnd() * 6);
      const cuts = Array.from({ length: n - 1 }, () => 1 + Math.floor(rnd() * 53)).sort((a, b) => a - b);
      const lines = [...cuts, 54].map((c, i) => c - (i === 0 ? 0 : [...cuts, 54][i - 1]!)).filter((x) => x > 0);
      const shares = distributeEighths(lines.map((l) => l * PITCH), BODY);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(Math.max(8, lines.length));
      expect(shares.every((s) => s >= 1)).toBe(true);
    }
  });
});

describe('formatEighths', () => {
  it('is unreduced', () => {
    expect([0, 4, 8, 11, 16].map(formatEighths)).toEqual(['0', '4/8', '1', '1 3/8', '2']);
  });
});

describe('sceneEighths', () => {
  it('splits a page between the scenes on it and sums to 8 on a full page', () => {
    // 3 scenes of a heading + 5 one-line actions: each action has a blank line before it (2 rows), the heading 1 row.
    const rows: [string, string][] = [];
    for (const s of ['A', 'B', 'C']) rows.push(...scene(5, `INT. ${s} - DAY`));
    const { layout, h } = build(rows);
    const l = layout();
    expect(l.pages).toHaveLength(1);
    const e = sceneEighths(l, h.model);
    expect(e).toHaveLength(3);
    // 3 x (1 heading + 5 x 2) rows, but only heading 1 has its space suppressed: 33 rows of 54 => raw 4.9 => 5.
    const sum = e.reduce((a, s) => a + s.eighths, 0);
    expect(sum).toBe(5);
    expect(e.every((s) => s.eighths >= 1)).toBe(true);
    expect(e[0]!.pages).toEqual([{ pageIndex: 0, eighths: e[0]!.eighths }]);
  });

  it('gives a scene that fills a whole page 8/8 and carries eighths across pages', () => {
    const { layout, h } = build(scene(60, 'INT. LONG - DAY'));
    const l = layout();
    expect(l.pages.length).toBeGreaterThan(1);
    const e = sceneEighths(l, h.model);
    expect(e[0]!.pages[0]!.eighths).toBe(8);
    expect(e[0]!.eighths).toBe(e[0]!.pages.reduce((a, p) => a + p.eighths, 0));
    expect(e[0]!.display).toBe(formatEighths(e[0]!.eighths));
  });

  it('every full page of a multi-scene script sums to exactly 8', () => {
    const rows: [string, string][] = [];
    for (let i = 0; i < 12; i++) rows.push(...scene(9, `INT. R${i} - DAY`));
    const { layout, h } = build(rows);
    const l = layout();
    const e = sceneEighths(l, h.model);
    const perPage = new Map<number, number>();
    for (const s of e) for (const p of s.pages) perPage.set(p.pageIndex, (perPage.get(p.pageIndex) ?? 0) + p.eighths);
    expect(l.pages.length).toBeGreaterThan(2);
    for (let i = 0; i < l.pages.length - 1; i++) expect(perPage.get(i)).toBe(8);
  });

  it('excludes decoration lines: a generated (MORE) line adds no extent to the scene', () => {
    const { layout, h } = build(scene(20, 'INT. A - DAY'));
    const l = layout();
    const before = sceneEighths(l, h.model)[0]!.eighths;
    const page = l.pages[0]!;
    const last = page.lines[page.lines.length - 1]!;
    page.lines.push({ ...last, kind: 'more', y: last.y + last.pitch * 3 });
    expect(sceneEighths(l, h.model)[0]!.eighths).toBe(before);
  });

  it('is 0 for an omitted scene', () => {
    const { layout, h, ids } = build([...scene(2, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')]);
    expect(h.run('scene.setOmitted', { scene: ids[3], omitted: true }).ok).toBe(true);
    const e = sceneEighths(layout(), h.model);
    expect(e).toHaveLength(2);
    expect(e[1]!.eighths).toBe(0);
    expect(e[1]!.display).toBe('0');
    expect(e[0]!.eighths).toBeGreaterThan(0);
  });
});

describe('runningTime', () => {
  it('pages method: eighths / 8 x secondsPerPage', () => {
    const { layout, h } = build(scene(60, 'INT. LONG - DAY'));
    const l = layout();
    const e = sceneEighths(l, h.model);
    const rt = runningTime(l, h.model, h.model.template(), { secondsPerPage: 60 });
    expect(rt.scenes[0]!.seconds).toBe(e[0]!.eighths * 7.5);
    expect(rt.scenes[0]!.source).toBe('computed');
    expect(rt.totalSeconds).toBe(e[0]!.eighths * 7.5);
    expect(rt.display).toBe(formatRunningTime(rt.totalSeconds));
  });

  it('a scene estimatedSeconds overrides the computed value', () => {
    const { layout, h, ids } = build([...scene(2, 'INT. A - DAY'), ...scene(2, 'INT. B - DAY')]);
    const el = h.doc.getMap<unknown>('elements').get(ids[3]!) as Y.Map<unknown>;
    (el.get('scene') instanceof Y.Map ? (el.get('scene') as Y.Map<unknown>) : el.set('scene', new Y.Map<unknown>())).set('estimatedSeconds', 90);
    const rt = runningTime(layout(), h.model, h.model.template(), { secondsPerPage: 60 });
    expect(rt.scenes[1]).toMatchObject({ seconds: 90, source: 'estimate', display: '1:30' });
    expect(rt.scenes[0]!.source).toBe('computed');
  });

  it('words method: spoken words at wordsPerMinute plus soundCueSeconds per sound cue', () => {
    const h = commandHarness(radioScriptUs as never);
    const speech = Array.from({ length: 30 }, () => 'word').join(' ');
    h.replaceBody([
      ['st_scene_heading', 'INT. STUDIO - DAY'], ['st_character', 'ANN'], ['st_dialogue', speech], ['st_sound_effects_music', 'DOOR SLAM'], ['st_sound_effects_music', 'BELL'],
    ]);
    const tpl = h.model.template();
    const template = { ...tpl, pagination: { ...tpl.pagination, runningTime: { method: 'words' as const, wordsPerMinute: 150, soundCueSeconds: 3 } } };
    const rt = runningTime(layoutDocument(h.model, template), h.model, template, { secondsPerPage: 60 });
    expect(rt.scenes[0]!.seconds).toBe((30 / 150) * 60 + 2 * 3);
    expect(rt.display).toBe('0:18');
  });
});
