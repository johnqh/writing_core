import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { formatRevisionDate, revisionLabel, revisionReport } from './revisions.js';
import { layoutDocument } from './layout-document.js';

function longScript() {
  const h = commandHarness();
  const rows: [string, string][] = [];
  for (let i = 1; i <= 6; i++) {
    rows.push(['st_scene_heading', `INT. ROOM ${i} - DAY`]);
    for (let j = 0; j < 12; j++) rows.push(['st_action', `Scene ${i} beat ${j}.`]);
  }
  const ids = h.replaceBody(rows);
  return { h, ids };
}

describe('revision display', () => {
  it('draws an asterisk on the revised line and labels the page; other pages stay clean', () => {
    const { h, ids } = longScript();
    const before = layoutDocument(h.model);
    expect(before.pages.length).toBeGreaterThan(2);
    expect(before.pages.every((p) => p.revisionLabel == null && p.lines.every((l) => !l.revisionMark))).toBe(true);
    const date = Date.UTC(2026, 8, 21);
    h.run('revision.setCurrent', { date });
    h.run('revision.mode', { on: true });
    const target = layoutDocument(h.model).pages[1]!.lines.find((l) => l.kind === 'text' && l.lineIndexInElement === 0)!.elementId;
    expect(ids).toContain(target);
    h.run('text.insert', { at: { elementId: target, offset: 0 }, text: 'EDIT ' });
    const layout = layoutDocument(h.model);
    const marked = layout.pages.flatMap((p) => p.lines.filter((l) => l.revisionMark).map((l) => ({ page: p.index, line: l })));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.page).toBe(1);
    expect(marked[0]!.line.elementId).toBe(target);
    expect(marked[0]!.line.revisionMark).toMatchObject({ text: '*', color: '#0000FF', x: 7_086_600 });
    layout.pages.forEach((p, i) => {
      expect(p.revisionLabel ?? null).toBe(i === 1 ? 'Blue Revised 9/21/26' : null);
      expect(p.pageColor ?? null).toBe(i === 1 ? '#C6EDFE' : null);
      expect(p.decorations.some((d) => d.kind === 'revision')).toBe(i === 1);
    });
    expect(formatRevisionDate(date)).toBe('9/21/26');
    expect(revisionLabel(h.model.revisionState().sets.find((s) => s.colorKey === 'blue')!)).toBe('Blue Revised 9/21/26');
  });

  it('the page takes the highest set touching it; display none hides marks but the report still lists pages', () => {
    const { h } = longScript();
    h.run('revision.setCurrent', { date: Date.UTC(2026, 8, 21) });
    h.run('revision.mode', { on: true });
    const lines = () => layoutDocument(h.model).pages[1]!.lines.filter((l) => l.kind === 'text' && l.lineIndexInElement === 0);
    h.run('text.insert', { at: { elementId: lines()[0]!.elementId, offset: 0 }, text: 'A' });
    h.run('revision.setCurrent', { date: Date.UTC(2026, 8, 22) });
    h.run('text.insert', { at: { elementId: lines()[2]!.elementId, offset: 0 }, text: 'B' });
    const layout = layoutDocument(h.model);
    expect(layout.pages[1]!.revisionLabel).toBe('Pink Revised 9/22/26');
    expect(layout.pages[1]!.lines.filter((l) => l.revisionMark).map((l) => l.revisionMark!.color)).toEqual(['#0000FF', '#FF00FF']);
    const report = revisionReport(h.model, layout);
    expect(report.find((r) => r.name === 'Blue Revision')).toMatchObject({ markedElements: 1, pages: [{ index: 1, label: '2' }] });
    expect(report.find((r) => r.name === 'Pink Revision')).toMatchObject({ markedElements: 1, pages: [{ index: 1, label: '2' }] });
    h.run('revision.setDisplay', { display: 'none' });
    const hidden = layoutDocument(h.model);
    expect(hidden.pages.flatMap((p) => p.lines).some((l) => l.revisionMark)).toBe(false);
    expect(hidden.pages[1]!.revisionLabel ?? null).toBeNull();
    expect(revisionReport(h.model, hidden).find((r) => r.name === 'Pink Revision')!.pages).toHaveLength(1);
    h.run('revision.setDisplay', { display: 'collated' });
    expect(layoutDocument(h.model).pages[1]!.lines.filter((l) => l.revisionMark).map((l) => l.revisionMark!.color)).toEqual(['#FF00FF']);
  });
});
