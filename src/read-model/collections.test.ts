import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { type EntityId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { writeEntity } from '../model/json.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { openDocument } from './open.js';

const ids = createSeededIdSource(51);
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };
const emptyText = { plain: '', runs: [], embeds: [] };

function setup() {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const rows: [string, string][] = [
    ['st_scene_heading', 'INT. DINER - NIGHT'], ['st_character', 'MAYA'], ['st_dialogue', 'Hi.'],
    ['st_character', 'JO'], ['st_dialogue', 'Hey.'], ['st_character', 'MAYA'], ['st_dialogue', 'Coffee?'],
    ['st_action', 'She lifts the GUN.'], ['st_character', ''],
  ];
  const made = rows.map(([style, text], i) => insertElementRecord(elements, { id: newId('el', ids), pos: `B${i}1`, style: style as never, text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta));
  const entity = (kind: 'character' | 'location' | 'prop', name: string, extra: Record<string, unknown> = {}) => {
    const id = newId('ent', ids);
    writeEntity(doc.getMap('entities'), { id, kind, name, nameKey: name.toLowerCase(), aliases: [], color: null, description: emptyText, fields: {}, attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual', ...extra } as never);
    return id as EntityId;
  };
  const maya = entity('character', 'MAYA');
  const jo = entity('character', 'JO');
  const diner = entity('location', 'DINER');
  const gun = entity('prop', 'GUN');
  const ghost = entity('character', 'GHOST', { origin: 'harvested' });
  const old = entity('character', 'MAYA ROSE', { mergedInto: maya });
  const props = [...doc.getMap('tagCategories').values()].map((c) => (c as Y.Map<unknown>).toJSON() as { id: string; key: string }).find((c) => c.key === 'props')!;
  const tagId = newId('tag', ids);
  const tag = doc.getMap('tags').set(tagId, new Y.Map<unknown>());
  for (const [k, v] of Object.entries({ id: tagId, categoryId: props.id, entityId: gun, elementId: made[7]!.get('id'), createdBy: 'u', createdAt: 0 })) tag.set(k, v);
  (made[7]!.get('text') as Y.Text).format(14, 3, { [`t:${tagId}`]: true });
  const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  return { doc, made, model, maya, jo, diner, gun, ghost, old, tagId };
}

describe('entities and occurrences', () => {
  it('resolves names, follows merges and hides unused harvested entities', () => {
    const { model, maya, old, ghost } = setup();
    expect(model.resolveEntity('character', 'maya (v.o.)')!.id).toBe(maya);
    expect(model.entity(old)!.id).toBe(maya);
    expect(model.entities({ kind: 'character' }).map((e) => e.name)).toEqual(['JO', 'MAYA']);
    expect(model.entities({ kind: 'character', includeHidden: true }).map((e) => e.id)).toContain(ghost);
  });
  it('lists speaker, heading and tag occurrences', () => {
    const { model, maya, diner, gun, made } = setup();
    expect(model.occurrences(maya).map((o) => o.source)).toEqual(['speaker', 'speaker']);
    expect(model.occurrences(diner)).toEqual([{ sceneId: made[0]!.get('id'), elementId: made[0]!.get('id'), source: 'heading', range: null }]);
    expect(model.occurrences(gun)).toEqual([{ sceneId: made[0]!.get('id'), elementId: made[7]!.get('id'), source: 'tag', range: { index: 14, length: 3 } }]);
  });
  it('filters tags and reads collections', () => {
    const { model, gun, made, tagId } = setup();
    expect(model.tags({ entityId: gun }).map((t) => t.id)).toEqual([tagId]);
    expect(model.tags({ elementId: made[1]!.get('id') as never })).toEqual([]);
    expect(model.tagCategories()).toHaveLength(29);
    expect(model.revisionState().sets).toHaveLength(20);
    expect(model.macros()).toHaveLength(20);
    expect(model.productionState().scenesLocked).toBe(false);
    expect(model.trackChangesState()).toEqual({ enabled: false, view: 'markup' });
    expect(model.notes()).toEqual([]);
  });
});

describe('entities and occurrences: review fixes', () => {
  it('merges occurrences from multiple sources into true document order', () => {
    const { model, doc, maya, made } = setup();
    const props = [...doc.getMap('tagCategories').values()].map((c) => (c as Y.Map<unknown>).toJSON() as { id: string; key: string }).find((c) => c.key === 'props')!;
    const tagId = newId('tag', ids);
    const tag = doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    const between = made[2]!; // "Hi." dialogue, between MAYA's two speaker cues (made[1], made[5])
    for (const [k, v] of Object.entries({ id: tagId, categoryId: props.id, entityId: maya, elementId: between.get('id'), createdBy: 'u', createdAt: 0 })) tag.set(k, v);
    (between.get('text') as Y.Text).format(0, 2, { [`t:${tagId}`]: true }); // "Hi"

    // Document order is speaker(made[1]) < tag(made[2]) < speaker(made[5]); a naive per-source
    // concatenation (speaker pass, then heading, then tag) would instead return both speaker
    // occurrences before the tag one.
    expect(model.occurrences(maya).map((o) => ({ source: o.source, elementId: o.elementId }))).toEqual([
      { source: 'speaker', elementId: made[1]!.get('id') },
      { source: 'tag', elementId: made[2]!.get('id') },
      { source: 'speaker', elementId: made[5]!.get('id') },
    ]);
  });

  it('follows a live merge when filtering tags and computing occurrences', () => {
    const { model, doc, maya, made } = setup();
    const rose = (() => {
      const id = newId('ent', ids);
      writeEntity(doc.getMap('entities'), {
        id, kind: 'character', name: 'ROSE', nameKey: 'rose', aliases: [], color: null, description: emptyText,
        fields: {}, attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual',
      } as never);
      return id as EntityId;
    })();
    const props = [...doc.getMap('tagCategories').values()].map((c) => (c as Y.Map<unknown>).toJSON() as { id: string; key: string }).find((c) => c.key === 'props')!;
    const tagId = newId('tag', ids);
    const tag = doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    const coffee = made[6]!; // "Coffee?" dialogue
    for (const [k, v] of Object.entries({ id: tagId, categoryId: props.id, entityId: rose, elementId: coffee.get('id'), createdBy: 'u', createdAt: 0 })) tag.set(k, v);
    (coffee.get('text') as Y.Text).format(0, 6, { [`t:${tagId}`]: true }); // "Coffee"

    expect(model.tags({ entityId: maya }).map((t) => t.id)).toEqual([]);
    expect(model.occurrences(maya).some((o) => o.source === 'tag')).toBe(false);

    (doc.getMap('entities').get(rose) as Y.Map<unknown>).set('mergedInto', maya);

    expect(model.tags({ entityId: maya }).map((t) => t.id)).toEqual([tagId]);
    expect(model.occurrences(maya)).toContainEqual({ sceneId: made[0]!.get('id'), elementId: coffee.get('id'), source: 'tag', range: { index: 0, length: 6 } });
  });

  it('computes hidden the same way for a direct fetch and a merged-id hop', () => {
    const { model, doc, ghost } = setup();
    // Direct fetch: harvested, unretained, unused -> hidden, matching entities()'s computation.
    expect(model.entity(ghost)!.hidden).toBe(true);

    const shadow = (() => {
      const id = newId('ent', ids);
      writeEntity(doc.getMap('entities'), {
        id, kind: 'character', name: 'SHADOW OLD', nameKey: 'shadow old', aliases: [], color: null, description: emptyText,
        fields: {}, attributes: {}, categoryId: null, retain: false, mergedInto: ghost, createdBy: 'u', createdAt: 0, origin: 'manual',
      } as never);
      return id as EntityId;
    })();
    // Merged-id hop lands on `ghost`, which is hidden; the hop must compute `hidden` too, not
    // just pass through the raw record (whose JSON has no `hidden` key at all).
    expect(model.entity(shadow)!.hidden).toBe(true);
  });

  it('does not invalidate the occurrences cache for a collection unrelated to occurrences', () => {
    const { model, maya, doc } = setup();
    const before = model.occurrences(maya);
    doc.getMap('notes').set('n1', new Y.Map<unknown>()); // 'notes' cannot affect occurrences
    expect(model.occurrences(maya)).toBe(before);
  });
});

describe('SmartType suggestions', () => {
  it('suggests characters from entities and times from the list', () => {
    const { model } = setup();
    expect(model.smartTypeSuggestions('characters', 'm').map((s) => s.text)).toEqual(['MAYA']);
    expect(model.smartTypeSuggestions('times', 'n').map((s) => s.text)).toEqual(['NIGHT']);
    expect(model.smartTypeSuggestions('locations', '').map((s) => s.text)).toEqual(['DINER']);
  });
  it('omits dismissed entries', () => {
    const { model, doc } = setup();
    (doc.getMap('smartType').get('dismissed') as Y.Map<unknown>).set('times:night', true);
    expect(model.smartTypeSuggestions('times', 'n')).toEqual([]);
  });
  it('guesses the speaker from two blocks ago', () => {
    const { model, made } = setup();
    expect(model.guessNextCharacter(made[8]!.get('id') as never)).toBe('JO');
  });
});
