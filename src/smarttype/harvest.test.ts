import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { validateDocument } from '../model/validate/index.js';

describe('smartType.rebuild (harvest)', () => {
  it('creates character and location entities and counts list entries idempotently', () => {
    const h = commandHarness();
    h.replaceBody([
      ['st_scene_heading', 'INT. DINER - KITCHEN - NIGHT'],
      ['st_character', 'MAYA (V.O.)'],
      ['st_dialogue', 'Hi.'],
      ['st_character', 'maya.'],
      ['st_dialogue', 'Again.'],
      ['st_transition', 'SMASH CUT TO:'],
      ['st_scene_heading', 'EXT. STREET - DUSK'],
    ]);
    expect(h.run('smartType.rebuild', {})).toMatchObject({ ok: true });
    const names = h.model.entities().map((e) => [e.kind, e.name, e.origin]);
    expect(names).toEqual([['location', 'DINER', 'harvested'], ['character', 'MAYA', 'harvested'], ['location', 'STREET', 'harvested']].sort((a, b) => a[1]!.localeCompare(b[1]!)));
    const st = h.doc.getMap('smartType');
    expect((st.get('extensions') as Y.Map<{ count: number }>).get('(v.o.)')!.count).toBe(1);
    expect((st.get('times') as Y.Map<{ count: number }>).get('night')!.count).toBe(1);
    expect((st.get('transitions') as Y.Map<{ text: string; origin: string }>).get('smash cut to')).toMatchObject({ text: 'SMASH CUT TO:', origin: 'harvested' });
    const diner = h.model.entities({ kind: 'location' }).find((e) => e.name === 'DINER')!;
    const kitchen = h.model.entities({ kind: 'location', includeHidden: true }).find((e) => e.name === 'KITCHEN');
    expect(kitchen?.fields).toEqual({ parentId: diner.id });
    h.run('smartType.rebuild', {});
    expect(h.model.entities()).toHaveLength(3);
    expect(h.model.entities({ includeHidden: true }).map((e) => e.name)).toEqual(['DINER', 'DUSK', 'KITCHEN', 'MAYA', 'STREET']);
    expect((st.get('extensions') as Y.Map<{ count: number }>).get('(v.o.)')!.count).toBe(1);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });

  it('skips dismissed entries', () => {
    const h = commandHarness();
    h.replaceBody([['st_transition', 'WHIP PAN TO:']]);
    (h.doc.getMap('smartType').get('dismissed') as Y.Map<unknown>).set('transitions:whip pan to', true);
    h.run('smartType.rebuild', {});
    expect((h.doc.getMap('smartType').get('transitions') as Y.Map<unknown>).has('whip pan to')).toBe(false);
  });

  it('does not recreate an entity the user deleted; explicit re-creation clears the tombstone (review finding A)', () => {
    const h = commandHarness();
    h.replaceBody([['st_character', 'MAYA'], ['st_dialogue', 'Hi.']]);
    h.run('smartType.rebuild', {});
    const maya = h.model.resolveEntity('character', 'MAYA')!.id;
    h.run('entity.delete', { entityId: maya });
    expect(h.model.resolveEntity('character', 'MAYA')).toBeUndefined();
    expect((h.doc.getMap('smartType').get('entityTombstones') as Y.Map<unknown>).has('character:maya')).toBe(true);
    // The cue text ("MAYA") is still sitting in the document, so a later debounced harvest must
    // not silently mint the entity back.
    h.run('smartType.rebuild', {});
    expect(h.model.resolveEntity('character', 'MAYA')).toBeUndefined();
    expect(h.model.entities({ kind: 'character', includeHidden: true })).toHaveLength(0);
    // Explicitly creating the name again clears the tombstone, so harvesting resumes normally.
    const r = h.run('entity.create', { kind: 'character', name: 'MAYA' });
    expect(r.ok).toBe(true);
    const recreated = h.model.resolveEntity('character', 'MAYA')!.id;
    expect(recreated).not.toBe(maya);
    expect((h.doc.getMap('smartType').get('entityTombstones') as Y.Map<unknown>).has('character:maya')).toBe(false);
    h.run('smartType.rebuild', {});
    expect(h.model.entities({ kind: 'character' })).toHaveLength(1);
  });
});
