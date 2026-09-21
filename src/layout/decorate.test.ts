import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { layoutDocument } from './layout-document.js';

const text = (d: { runs: { text: string }[] }) => d.runs.map((r) => r.text).join('');

function build(rows: [string, string][]) {
  const h = commandHarness();
  const ids = h.replaceBody(rows);
  return { h, ids, layout: () => layoutDocument(h.model) };
}

const manyActions = (n: number): [string, string][] => [
  ['st_scene_heading', 'INT. HOUSE - DAY'],
  ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
];

describe('title page', () => {
  it('is absent while the title page is only the seeded placeholder', () => {
    const { layout } = build(manyActions(3));
    expect(layout().titlePages).toHaveLength(0);
  });

  it('is emitted as an unnumbered page 0 with the title centered about a third down, and does not count as a body page', () => {
    const { h, layout } = build(manyActions(3));
    h.run('title.setField', { field: 'title', text: 'The Night Train' });
    h.run('title.setField', { field: 'author', text: 'Jane Writer' });
    h.run('title.setField', { field: 'contact', text: 'jane@example.com' });
    const l = layout();
    expect(l.titlePages).toHaveLength(1);
    expect(l.pages).toHaveLength(1);
    const tp = l.titlePages[0]!;
    expect(tp.number).toBe(0);
    expect(tp.kind).toBe('title');
    const lines = tp.lines.map((x) => ({ t: text(x), x, y: x.y }));
    const title = lines.find((x) => x.t === 'THE NIGHT TRAIN')!;
    expect(title).toBeTruthy();
    expect(title.y).toBe(l.titlePages[0]!.lines[0]!.y);
    expect(title.y).toBe(3_200_400);
    expect(lines.map((x) => x.t)).toContain('Written by');
    expect(lines.map((x) => x.t)).toContain('Jane Writer');
    // Centered: the line's left edge is right of the left margin.
    expect(title.x.x).toBeGreaterThan(1_371_600);
    // Contact block rests on the bottom margin, left aligned.
    const contact = lines.find((x) => x.t === 'jane@example.com')!;
    expect(contact.x.x).toBe(1_371_600);
    expect(contact.y + contact.x.pitch).toBe(l.bodyBottom);
    expect(l.pages[0]!.number).toBe(1);
  });

  it('drops "Written by" when there is no author', () => {
    const { h, layout } = build(manyActions(1));
    h.run('title.setField', { field: 'title', text: 'Solo' });
    expect(layout().titlePages[0]!.lines.map(text)).toEqual(['SOLO']);
  });
});

describe('headers and footers', () => {
  it('draws the page number top-right from page 2, none on page 1', () => {
    const { layout } = build(manyActions(60));
    const l = layout();
    expect(l.pages.length).toBeGreaterThan(1);
    expect(l.pages[0]!.decorations.filter((d) => d.kind === 'header')).toHaveLength(0);
    const h2 = l.pages[1]!.decorations.filter((d) => d.kind === 'header');
    expect(h2).toHaveLength(1);
    expect(text(h2[0]!)).toBe('2.');
    expect(h2[0]!.slot).toBe('right');
    expect(h2[0]!.y).toBe(457_200); // in the top margin, above the body
    expect(h2[0]!.y + h2[0]!.pitch).toBeLessThanOrEqual(l.bodyTop);
    // Right edge sits on the right margin.
    const last = h2[0]!.runs[h2[0]!.runs.length - 1]!;
    expect(Math.abs(last.x + last.width - (7_772_400 - 914_400))).toBeLessThan(10);
    // The header does not eat body lines: 54-line page unchanged.
    expect(l.pages[0]!.lines.length).toBeGreaterThan(20);
  });

  it('substitutes tokens in footer slots and honors the first-page toggle', () => {
    const { h, layout } = build(manyActions(60));
    h.run('title.setField', { field: 'title', text: 'The Night Train' });
    h.run('template.setHeaderFooter', { which: 'footer', patch: { enabled: true, left: '{title}', center: '{page} of {pages}', right: '{field:author}', showOnFirstPage: false } });
    h.run('title.setField', { field: 'author', text: 'Jane' });
    let l = layout();
    expect(l.pages[0]!.decorations.filter((d) => d.kind === 'footer')).toHaveLength(0);
    const foot = l.pages[1]!.decorations.filter((d) => d.kind === 'footer');
    expect(foot.map((d) => `${d.slot}:${text(d)}`).sort()).toEqual(['center:2 of ' + l.pages.length, 'left:The Night Train', 'right:Jane']);
    expect(foot[0]!.y + foot[0]!.pitch).toBe(l.pageSize.height - 457_200);
    h.run('template.setHeaderFooter', { which: 'footer', patch: { showOnFirstPage: true } });
    l = layout();
    expect(l.pages[0]!.decorations.filter((d) => d.kind === 'footer')).toHaveLength(3);
  });
});

describe('scene numbers', () => {
  it('draws numbers in both margins, without moving the heading text', () => {
    const { h, ids, layout } = build([
      ['st_scene_heading', 'INT. A - DAY'], ['st_action', 'One.'], ['st_scene_heading', 'INT. B - DAY'], ['st_action', 'Two.'],
    ]);
    const before = layout().pages[0]!.lines.map((x) => [x.x, x.y]);
    expect(layout().pages[0]!.decorations.filter((d) => d.kind === 'sceneNumber')).toHaveLength(0);
    expect(h.run('template.setSceneNumbering', { mode: 'both' }).ok).toBe(true);
    const l = layout();
    expect(l.pages[0]!.lines.map((x) => [x.x, x.y])).toEqual(before);
    const nums = l.pages[0]!.decorations.filter((d) => d.kind === 'sceneNumber');
    expect(nums.map((d) => `${d.slot}${text(d)}`)).toEqual(['left1', 'right1', 'left2', 'right2']);
    const first = nums.find((d) => d.slot === 'left')!;
    expect(first.x).toBe(685_800);
    expect(first.y).toBe(l.pages[0]!.lines[0]!.y);
    expect(first.elementId).toBe(ids[0]);
    expect(nums.find((d) => d.slot === 'right')!.x).toBe(6_748_272);
    h.run('template.setSceneNumbering', { mode: 'left' });
    expect(layout().pages[0]!.decorations.filter((d) => d.kind === 'sceneNumber').map((d) => d.slot)).toEqual(['left', 'left']);
    h.run('template.setSceneNumbering', { mode: 'none' });
    expect(layout().pages[0]!.decorations.filter((d) => d.kind === 'sceneNumber')).toHaveLength(0);
  });

  it('an omitted scene keeps its number slot, its body prints nothing', () => {
    const { h, ids, layout } = build([
      ['st_scene_heading', 'INT. A - DAY'], ['st_action', 'One.'], ['st_scene_heading', 'INT. B - DAY'], ['st_action', 'Two.'], ['st_scene_heading', 'INT. C - DAY'],
    ]);
    h.run('template.setSceneNumbering', { mode: 'left' });
    expect(h.run('scene.setOmitted', { scene: ids[2], omitted: true }).ok).toBe(true);
    const l = layout();
    expect(l.pages[0]!.lines.map((x) => x.elementId)).not.toContain(ids[3]);
    expect(l.pages[0]!.decorations.filter((d) => d.kind === 'sceneNumber').map(text)).toEqual(['1', '2', '3']);
    expect(h.run('scene.setOmitted', { scene: ids[2], omitted: false }).ok).toBe(true);
    expect(layout().pages[0]!.lines.map((x) => x.elementId)).toContain(ids[3]);
  });
});
