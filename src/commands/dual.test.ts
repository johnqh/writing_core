import { describe, expect, it } from 'vitest';
import { newDualGroupId, newId } from '../ids/ids.js';
import { validateDocument } from '../model/validate/index.js';
import { commandHarness } from './test-harness.js';

type Dual = { group: string; side: 'left' | 'right' };

function dualOf(h: ReturnType<typeof commandHarness>, id: string): Dual | null {
  const rec = h.model.elements().find((e) => e.id === id);
  return (rec?.dual as Dual | undefined) ?? null;
}

describe('dual.create', () => {
  it('with a following speech, pairs forward (unlike dual.make, which pairs backward) and marks both sides', () => {
    const h = commandHarness();
    const ids = h.replaceBody([
      ['st_character', 'ALICE'],
      ['st_dialogue', 'Hello.'],
      ['st_character', 'BOB'],
      ['st_dialogue', 'Hi.'],
    ]);
    const r = h.run('dual.create', { character: ids[0] });
    expect(r.ok).toBe(true);
    const aliceDual = dualOf(h, ids[0]!);
    const helloDual = dualOf(h, ids[1]!);
    const bobDual = dualOf(h, ids[2]!);
    const hiDual = dualOf(h, ids[3]!);
    expect(aliceDual?.side).toBe('left');
    expect(helloDual?.side).toBe('left');
    expect(bobDual?.side).toBe('right');
    expect(hiDual?.side).toBe('right');
    expect(aliceDual?.group).toBe(bobDual?.group);
    expect(helloDual?.group).toBe(aliceDual?.group);
    expect(hiDual?.group).toBe(aliceDual?.group);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('with no following speech, inserts an empty right-side Character cue and pairs it', () => {
    const h = commandHarness();
    const ids = h.replaceBody([
      ['st_character', 'ALICE'],
      ['st_dialogue', 'Hello.'],
    ]);
    const before = h.model.elements().length;
    const r = h.run('dual.create', { character: ids[0] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    const createdId = (r as { ok: true; effects: { inserted: string[] } }).effects.inserted[0];
    expect(createdId).toBeDefined();
    expect(h.model.elements().length).toBe(before + 1);
    const created = h.model.elements().find((e) => e.id === createdId)!;
    expect(created.style).toBe('st_character');
    expect(created.text.plain).toBe('');
    const aliceDual = dualOf(h, ids[0]!);
    const createdDual = dualOf(h, createdId!);
    expect(aliceDual?.side).toBe('left');
    expect(createdDual?.side).toBe('right');
    expect(aliceDual?.group).toBe(createdDual?.group);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('refuses notApplicable when no character is named', () => {
    const h = commandHarness();
    h.replaceBody([['st_character', 'ALICE'], ['st_dialogue', 'Hello.']]);
    const r = h.run('dual.create', {});
    expect(r).toEqual({ ok: false, index: 0, reason: 'notApplicable' });
  });

  it('refuses notFound for an unknown element, notApplicable for a non-cue element', () => {
    const h = commandHarness();
    const ids = h.replaceBody([['st_character', 'ALICE'], ['st_dialogue', 'Hello.']]);
    expect(h.run('dual.create', { character: newId('el', h.ids) })).toEqual({ ok: false, index: 0, reason: 'notFound' });
    const r = h.run('dual.create', { character: ids[1] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('notApplicable');
  });
});

describe('dual.swapSides', () => {
  it('exchanges the side labels and reorders the elements to match', () => {
    const h = commandHarness();
    const ids = h.replaceBody([
      ['st_character', 'ALICE'],
      ['st_dialogue', 'Hello.'],
      ['st_character', 'BOB'],
      ['st_dialogue', 'Hi.'],
    ]);
    const made = h.run('dual.create', { character: ids[0] });
    expect(made.ok).toBe(true);
    const group = dualOf(h, ids[0]!)!.group;

    const r = h.run('dual.swapSides', { group });
    expect(r.ok).toBe(true);
    expect(dualOf(h, ids[0]!)?.side).toBe('right');
    expect(dualOf(h, ids[1]!)?.side).toBe('right');
    expect(dualOf(h, ids[2]!)?.side).toBe('left');
    expect(dualOf(h, ids[3]!)?.side).toBe('left');
    // Document order now matches the swapped labels: BOB/Hi (now 'left') come first.
    const order = h.model.elements().map((e) => e.id);
    expect(order.indexOf(ids[2]!)).toBeLessThan(order.indexOf(ids[0]!));
    expect(order.indexOf(ids[3]!)).toBeLessThan(order.indexOf(ids[1]!));
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('is its own inverse: swapping twice restores the original order and labels', () => {
    const h = commandHarness();
    const ids = h.replaceBody([
      ['st_character', 'ALICE'],
      ['st_dialogue', 'Hello.'],
      ['st_character', 'BOB'],
      ['st_dialogue', 'Hi.'],
    ]);
    h.run('dual.create', { character: ids[0] });
    const group = dualOf(h, ids[0]!)!.group;
    h.run('dual.swapSides', { group });
    const r = h.run('dual.swapSides', { group });
    expect(r.ok).toBe(true);
    expect(dualOf(h, ids[0]!)?.side).toBe('left');
    expect(dualOf(h, ids[2]!)?.side).toBe('right');
    expect(h.model.elements().map((e) => e.id)).toEqual(ids);
  });

  it('refuses notFound for an unknown group', () => {
    const h = commandHarness();
    h.replaceBody([['st_character', 'ALICE'], ['st_dialogue', 'Hello.']]);
    expect(h.run('dual.swapSides', { group: newDualGroupId(h.ids) })).toEqual({ ok: false, index: 0, reason: 'notFound' });
  });
});

describe('dual.dissolve', () => {
  it('deletes dual from every member, keyed by the group id directly', () => {
    const h = commandHarness();
    const ids = h.replaceBody([
      ['st_character', 'ALICE'],
      ['st_dialogue', 'Hello.'],
      ['st_character', 'BOB'],
      ['st_dialogue', 'Hi.'],
    ]);
    h.run('dual.create', { character: ids[0] });
    const group = dualOf(h, ids[0]!)!.group;
    const r = h.run('dual.dissolve', { group });
    expect(r.ok).toBe(true);
    for (const id of ids) expect(dualOf(h, id)).toBeNull();
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('refuses notFound for an unknown group', () => {
    const h = commandHarness();
    h.replaceBody([['st_character', 'ALICE'], ['st_dialogue', 'Hello.']]);
    expect(h.run('dual.dissolve', { group: newDualGroupId(h.ids) })).toEqual({ ok: false, index: 0, reason: 'notFound' });
  });
});
