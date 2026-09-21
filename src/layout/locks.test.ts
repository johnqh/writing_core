import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import type { ElementId } from '../ids/ids.js';
import { openDocument } from '../read-model/open.js';
import { layoutDocument } from './layout-document.js';

const heading = (n: number): [string, string] => ['st_scene_heading', `INT. ROOM ${n} - DAY`];

/** Six scenes of twelve one-line actions: several pages, each scene starting mid-page. */
function build() {
  const h = commandHarness();
  const rows: [string, string][] = [];
  for (let i = 1; i <= 6; i++) {
    rows.push(heading(i));
    for (let j = 0; j < 12; j++) rows.push(['st_action', `Scene ${i} beat ${j}.`]);
  }
  const ids = h.replaceBody(rows);
  return { h, ids };
}

const labels = (h: ReturnType<typeof commandHarness>) => layoutDocument(h.model).pages.map((p) => p.label);
const textOf = (page: { lines: { runs: { text?: string }[] }[] }) => page.lines.map((l) => l.runs.map((r) => r.text ?? '').join(''));

describe('page locking (§24)', () => {
  it('growth past a locked page spills onto A pages; later pages keep their numbers', () => {
    const { h, ids } = build();
    const base = labels(h);
    expect(base.length).toBeGreaterThanOrEqual(3);
    h.run('page.lock', {});
    // Add 70 action lines to page 1's first scene: page 1 overflows onto A pages.
    const first = ids[1]!;
    h.run('element.insert', { after: first, style: 'st_action', text: 'Extra one.' });
    let last: ElementId = h.model.elements().find((e) => e.text.plain === 'Extra one.')!.id;
    for (let i = 0; i < 70; i++) {
      h.run('element.insert', { after: last, style: 'st_action', text: `Extra ${i + 2}.` });
      last = h.model.elements().find((e) => e.text.plain === `Extra ${i + 2}.`)!.id;
    }
    const after = labels(h);
    expect(after.slice(0, 3)).toEqual(['1', '1A', '1B']);
    // The old page 2 and everything after it keep their labels.
    expect(after.slice(after.length - (base.length - 1))).toEqual(base.slice(1));
    // Header carries the locked label.
    const pg = layoutDocument(h.model).pages[1]!;
    expect(pg.decorations.some((d) => d.kind === 'header' && d.text === '1A.')).toBe(true);
    // Unlocking reflows to sequential numbers.
    h.run('page.unlock', {});
    expect(labels(h).every((l, i) => l === String(i + 1))).toBe(true);
  });

  it('deleting content leaves a short page and the numbers in place', () => {
    const { h, ids } = build();
    h.run('page.lock', {});
    const before = layoutDocument(h.model);
    // Delete four lines from scene 2 (page 1/2 region): later page starts must not move up.
    h.doc.transact(() => {
      const els = h.doc.getMap<unknown>('elements');
      const onPage2 = [...new Set(before.pages[1]!.lines.map((l) => l.elementId))].filter((id) => ids.includes(id));
      for (const id of onPage2.slice(3, 7)) els.delete(id);
    });
    const after = layoutDocument(h.model);
    expect(after.pages.map((p) => p.label)).toEqual(before.pages.map((p) => p.label));
    // Page 2 is shorter than before, page 3 still starts with the same element.
    expect(after.pages[1]!.lines.length).toBeLessThan(before.pages[1]!.lines.length);
    expect(textOf(after.pages[2]!)[0]).toBe(textOf(before.pages[2]!)[0]);
  });

  it('a page whose whole content is deleted is a deleted page: the previous page shows a range', () => {
    const { h, ids } = build();
    h.run('page.lock', {});
    const before = layoutDocument(h.model);
    // Remove every element that starts on page 2 (its anchor included), with repair off.
    const gone = new Set(before.pages[1]!.lines.map((l) => l.elementId));
    h.doc.transact(() => {
      const els = h.doc.getMap<unknown>('elements');
      for (const id of ids) if (gone.has(id)) els.delete(id);
    });
    const after = layoutDocument(h.model);
    expect(after.pages.length).toBe(before.pages.length - 1);
    expect(after.pages[0]!.label).toBe('1-2');
    expect(after.pages[1]!.label).toBe('3');
  });

  it('deleting the anchor element re-anchors the page start forward (repair on open)', () => {
    const { h } = build();
    h.run('page.lock', {});
    const before = layoutDocument(h.model);
    const anchor = before.pages[1]!.lines[0]!.elementId;
    h.doc.transact(() => h.doc.getMap<unknown>('elements').delete(anchor));
    const reopened = openDocument(h.doc, { ids: h.ids, clock: () => 5_000, locale: 'en' });
    const after = layoutDocument(reopened);
    expect(after.pages.map((p) => p.label)).toEqual(before.pages.map((p) => p.label));
    const lock = reopened.productionState().pageLocks.find((l) => l.label.base === 2)!;
    expect(lock.startElementId).not.toBe(anchor);
    expect(lock.reanchored).toBe(true);
  });

  it('the title page stays unnumbered while pages are locked', () => {
    const { h } = build();
    h.run('title.setField', { field: 'title', text: 'Locked' });
    h.run('page.lock', {});
    const l = layoutDocument(h.model);
    expect(l.titlePages[0]!.label).toBe('');
    expect(l.pages[0]!.label).toBe('1');
  });
});
