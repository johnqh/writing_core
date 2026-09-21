import { describe, expect, it } from 'vitest';
import { createSessionUndo } from '../undo/undo-manager.js';
import { documentToJSON } from '../model/json.js';
import { commandHarness, TEST_ACTOR } from './test-harness.js';

const at = (elementId: string, offset: number) => ({ elementId, offset });

function setup() {
  const h = commandHarness();
  const ids = h.replaceBody([['st_scene_heading', 'INT. ROOM - DAY'], ['st_action', 'First line.'], ['st_action', 'Second line.'], ['st_action', 'Third line.']]);
  return { h, ids };
}
const revOf = (h: ReturnType<typeof commandHarness>, id: string) => h.model.element(id as never)!.text.runs.map((r) => r.attrs.rev ?? null);
const sets = (h: ReturnType<typeof commandHarness>) => h.model.revisionState().sets;

describe('revision commands', () => {
  it('mode on + edit marks the element with the active set; mode off does not', () => {
    const { h, ids } = setup();
    expect(h.run('revision.mode', { on: true }).ok).toBe(false); // no active set yet
    expect(h.run('revision.setCurrent', {}).ok).toBe(true);
    const blue = sets(h).find((s) => s.colorKey === 'blue')!;
    expect(h.model.revisionState().activeSetId).toBe(blue.id);
    expect(blue.date).not.toBeNull();
    expect(h.run('revision.mode', { on: true }).ok).toBe(true);
    expect(h.run('text.insert', { at: at(ids[1]!, 5), text: ' NEW' }).ok).toBe(true);
    expect(revOf(h, ids[1]!)).toContain(blue.id);
    expect(revOf(h, ids[2]!).every((r) => r === null)).toBe(true);
    expect(h.run('revision.mode', { on: false }).ok).toBe(true);
    expect(h.run('text.insert', { at: at(ids[2]!, 0), text: 'X' }).ok).toBe(true);
    expect(revOf(h, ids[2]!).every((r) => r === null)).toBe(true);
  });

  it('a new set changes the colour; setCurrent advances Blue -> Pink and stamps the given date', () => {
    const { h, ids } = setup();
    h.run('revision.setCurrent', {});
    h.run('revision.mode', { on: true });
    h.run('text.insert', { at: at(ids[1]!, 0), text: 'a' });
    const date = Date.UTC(2026, 8, 21);
    expect(h.run('revision.setCurrent', { date }).ok).toBe(true);
    const pink = sets(h).find((s) => s.colorKey === 'pink')!;
    expect(h.model.revisionState().activeSetId).toBe(pink.id);
    expect(pink.date).toBe(date);
    h.run('text.insert', { at: at(ids[2]!, 0), text: 'b' });
    expect(revOf(h, ids[2]!)).toContain(pink.id);
    expect(revOf(h, ids[1]!)).not.toContain(pink.id);
  });

  it('undo removes both the edit and the mark', () => {
    const { h, ids } = setup();
    h.run('revision.setCurrent', {});
    h.run('revision.mode', { on: true });
    const undo = createSessionUndo(h.doc, h.origins, { clock: () => 1_000 });
    const before = JSON.stringify(documentToJSON(h.doc));
    expect(h.run('text.insert', { at: at(ids[1]!, 0), text: 'ZZ' }).ok).toBe(true);
    expect(JSON.stringify(documentToJSON(h.doc))).not.toBe(before);
    expect(undo.undo()).toBe(true);
    expect(JSON.stringify(documentToJSON(h.doc))).toBe(before);
    expect(TEST_ACTOR.userId).toBe('u1');
    undo.destroy();
  });

  it('a style change in revision mode marks the element; deleting leaves a revDel', () => {
    const { h, ids } = setup();
    h.run('revision.setCurrent', {});
    h.run('revision.mode', { on: true });
    h.run('element.setStyle', { elements: [ids[3]], style: 'st_shot' });
    expect(revOf(h, ids[3]!).some((r) => r !== null)).toBe(true);
    h.run('text.deleteRange', { range: { anchor: at(ids[2]!, 0), head: at(ids[2]!, 6) } });
    expect(h.model.element(ids[2]!)!.text.embeds.some((e) => e.embed.type === 'revDel')).toBe(true);
  });

  it('clear removes marks for one set or all, leaving the text', () => {
    const { h, ids } = setup();
    h.run('revision.setCurrent', {});
    h.run('revision.mode', { on: true });
    h.run('text.insert', { at: at(ids[1]!, 0), text: 'a' });
    const blue = h.model.revisionState().activeSetId!;
    h.run('revision.setCurrent', {});
    h.run('text.insert', { at: at(ids[2]!, 0), text: 'b' });
    const text = (id: string) => h.model.element(id as never)!.text.plain;
    expect(h.run('revision.clear', { setId: blue }).ok).toBe(true);
    expect(revOf(h, ids[1]!).every((r) => r === null)).toBe(true);
    expect(revOf(h, ids[2]!).some((r) => r !== null)).toBe(true);
    expect(h.run('revision.clear', {}).ok).toBe(true);
    expect(revOf(h, ids[2]!).every((r) => r === null)).toBe(true);
    expect(text(ids[1]!)).toBe('aFirst line.');
  });

  it('markElements marks and unmarks a selection', () => {
    const { h, ids } = setup();
    h.run('revision.setCurrent', {});
    const range = { anchor: at(ids[1]!, 0), head: at(ids[2]!, 4) };
    expect(h.run('revision.markElements', { range, marked: true }).ok).toBe(true);
    expect(revOf(h, ids[1]!).some((r) => r !== null)).toBe(true);
    expect(revOf(h, ids[2]!).some((r) => r !== null)).toBe(true);
    expect(h.run('revision.markElements', { range, marked: false }).ok).toBe(true);
    expect(revOf(h, ids[1]!).every((r) => r === null)).toBe(true);
  });
});
