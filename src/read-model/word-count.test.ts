// Spec 02 §19: the body word count is what PRINTS.
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { openDocument } from './open.js';

const ids = createSeededIdSource(57);
const deps = { ids, clock: () => 0, locale: 'en' };
const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };
const omit = { at: 1, by: 'u', rev: null };

function build(rows: [style: string, text: string][], opts: { sceneOmit?: number[]; elementOmit?: number[] } = {}) {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const made = rows.map(([style, text], i) => {
    const el = insertElementRecord(elements, { id: newId('el', ids), pos: String(i).padStart(5, '0'), style: style as never, text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
    if (style === 'st_scene_heading') el.set('scene', new Y.Map<unknown>());
    return el;
  });
  for (const i of opts.sceneOmit ?? []) (made[i]!.get('scene') as Y.Map<unknown>).set('omit', omit);
  for (const i of opts.elementOmit ?? []) made[i]!.set('omit', omit);
  return { doc, made, model: openDocument(doc, deps) };
}

// heading (2), action (6), note (5), omitted action (4), outline (3) | omitted scene: heading (2), action (7)
const FIXTURE: [string, string][] = [
  ['st_scene_heading', 'INT. DINER'],
  ['st_action', 'Maya waits for the late bus'],
  ['st_note', 'ask the director about this'],
  ['st_action', 'this line is cut'],
  ['st_outline_1', 'Act one begins'],
  ['st_scene_heading', 'EXT. ROOFTOP'],
  ['st_action', 'seven words in an omitted scene here'],
];
const fixture = () => build(FIXTURE, { sceneOmit: [5], elementOmit: [3] });
const count = (m: ReturnType<typeof build>['model']) => m.titlePage().computed.wordCount;

describe('body word count follows what prints (spec 02 §19)', () => {
  it('counts 8 on the review fixture', () => {
    expect(count(fixture().model)).toBe(8);
  });

  it('a restyle to a note removes the words, and back restores them', () => {
    const { model, made } = fixture();
    expect(count(model)).toBe(8);
    made[1]!.set('style', 'st_note');
    expect(count(model)).toBe(2);
    made[1]!.set('style', 'st_action');
    expect(count(model)).toBe(8);
  });

  it('element omit toggles the words', () => {
    const { model, made } = fixture();
    made[1]!.set('omit', omit);
    expect(count(model)).toBe(2);
    made[1]!.delete('omit');
    made[3]!.delete('omit'); // the fixture's already-omitted action prints again: +4
    expect(count(model)).toBe(12);
  });

  it('scene omit toggles the words of the whole scene, heading included', () => {
    const { model, made } = fixture();
    (made[0]!.get('scene') as Y.Map<unknown>).set('omit', omit);
    expect(count(model)).toBe(0);
    (made[5]!.get('scene') as Y.Map<unknown>).delete('omit');
    expect(count(model)).toBe(9);
    (made[0]!.get('scene') as Y.Map<unknown>).delete('omit');
    expect(count(model)).toBe(9 + 8);
  });

  it('scene membership: restyling an omitted scene heading pulls its elements into the previous scene', () => {
    const { model, made } = fixture();
    made[5]!.set('style', 'st_action'); // "EXT. ROOFTOP" is now printed action in the first scene, and so is what followed
    expect(count(model)).toBe(8 + 2 + 7);
    made[5]!.set('style', 'st_scene_heading');
    expect(count(model)).toBe(8);
  });

  it('text edits and inserted or removed elements adjust the total', () => {
    const { doc, model, made } = fixture();
    (made[1]!.get('text') as Y.Text).insert(0, 'Extra ');
    expect(count(model)).toBe(9);
    (made[6]!.get('text') as Y.Text).insert(0, 'hidden ');
    expect(count(model)).toBe(9);
    doc.getMap('elements').delete(made[1]!.get('id') as string);
    expect(count(model)).toBe(2);
  });

  it('a template change (a style stops printing) is picked up', () => {
    const { doc, model } = fixture();
    expect(count(model)).toBe(8);
    const style = (doc.getMap('template').get('styles') as Y.Map<Y.Map<unknown>>).get('st_action')!;
    style.set('printable', false);
    expect(count(model)).toBe(2);
    style.set('printable', true);
    expect(count(model)).toBe(8);
  });

  it('does not rescan per edit: reads stay proportional to the change in a 3000-element document', () => {
    const rows: [string, string][] = [];
    for (let s = 0; s < 300; s++) {
      rows.push(['st_scene_heading', `INT. PLACE ${s}`]);
      for (let i = 0; i < 9; i++) rows.push(['st_action', `line ${i} of scene ${s}`]);
    }
    const { doc, model, made } = build(rows);
    expect(made).toHaveLength(3000);
    expect(count(model)).toBe(300 * (3 + 9 * 5));
    const elements = doc.getMap('elements');
    const get = vi.spyOn(elements, 'get');
    const reads = (edit: () => void): number => {
      get.mockClear();
      edit();
      count(model);
      return get.mock.calls.length;
    };
    try {
      const textEdit = reads(() => (made[1500]!.get('text') as Y.Text).insert(0, 'Extra '));
      const restyle = reads(() => made[1501]!.set('style', 'st_note'));
      const sceneOmit = reads(() => (made[1500 - (1500 % 10)]!.get('scene') as Y.Map<unknown>).set('omit', omit));
      // Measured 2026-09-21: text=2, restyle=3, sceneOmit=84 (a 10-element scene) reads of `elements` per edit.
      // +1 for 'Extra' in scene 150's heading, -5 for the restyled line, then that whole scene (4 + 8 * 5) is omitted.
      expect(count(model)).toBe(300 * 48 + 1 - 5 - (4 + 8 * 5));
      expect(textEdit).toBeLessThan(30);
      expect(restyle).toBeLessThan(60);
      expect(sceneOmit).toBeLessThan(100);
    } finally {
      get.mockRestore();
    }
  });
});
