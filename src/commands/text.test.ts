import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids/ids.js';
import { commandHarness } from './test-harness.js';

const at = (elementId: string, offset: number) => ({ elementId, offset });
const range = (a: string, ao: number, b: string, bo: number) => ({ anchor: at(a, ao), head: at(b, bo) });

describe('text.insert', () => {
  it('inherits formatting from the preceding character and normalizes to NFC', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Hello']]);
    h.textMap(a!).format(0, 5, { b: true, 't:tag_01ARYZ6S410000000000000000': true });
    expect(h.run('text.insert', { at: at(a!, 5), text: ' café' })).toMatchObject({ ok: true, effects: { changed: [a] } });
    expect(h.delta(a!)).toEqual([{ insert: 'Hello', attributes: { b: true, 't:tag_01ARYZ6S410000000000000000': true } }, { insert: ' café', attributes: { b: true } }]);
  });
  it('uses explicit marks when given and refuses invalid positions', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Hi']]);
    h.run('text.insert', { at: at(a!, 2), text: '!', marks: { i: true } });
    expect(h.delta(a!)).toEqual([{ insert: 'Hi' }, { insert: '!', attributes: { i: true } }]);
    expect(h.run('text.insert', { at: at(a!, 99), text: 'x' })).toMatchObject({ ok: false, reason: 'invalidPosition' });
  });
  it('marks inserts in revision mode', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Hi']]);
    const setId = [...(h.doc.getMap('revisions').get('sets') as Y.Map<unknown>).keys()][1]!;
    h.doc.getMap('revisions').set('mode', true);
    h.doc.getMap('revisions').set('activeSetId', setId);
    h.run('text.insert', { at: at(a!, 2), text: '!' });
    expect(h.delta(a!)).toEqual([{ insert: 'Hi' }, { insert: '!', attributes: { rev: setId } }]);
  });
});

describe('deleting', () => {
  it('deletes backward by char, grapheme and word', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Go now 👩‍👩‍👧']]);
    h.run('text.deleteBackward', { at: at(a!, h.textMap(a!).length), unit: 'grapheme' });
    expect(h.textMap(a!).toString()).toBe('Go now ');
    h.run('text.deleteBackward', { at: at(a!, 7), unit: 'word' });
    expect(h.textMap(a!).toString()).toBe('Go ');
    h.run('text.deleteBackward', { at: at(a!, 3), unit: 'char' });
    expect(h.textMap(a!).toString()).toBe('Go');
    expect(h.run('text.deleteBackward', { at: at(a!, 2), unit: 'line' })).toMatchObject({ ok: false, reason: 'notApplicable' });
  });

  it('deletes forward by grapheme, word and char', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '👩‍👩‍👧 now Go']]);
    h.run('text.deleteForward', { at: at(a!, 0), unit: 'grapheme' });
    expect(h.textMap(a!).toString()).toBe(' now Go');
    h.run('text.deleteForward', { at: at(a!, 0), unit: 'word' });
    expect(h.textMap(a!).toString()).toBe(' Go');
    h.run('text.deleteForward', { at: at(a!, 0), unit: 'char' });
    expect(h.textMap(a!).toString()).toBe('Go');
    expect(h.run('text.deleteForward', { at: at(a!, 0), unit: 'line' })).toMatchObject({ ok: false, reason: 'notApplicable' });
  });

  it('merges into the previous element at its start, keeping the previous style and re-pointing tags', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'She runs'], ['st_dialogue', ' fast.']]);
    const tagId = newId('tag', h.ids);
    const tag = h.doc.getMap('tags').set(tagId, new Y.Map<unknown>());
    tag.set('id', tagId);
    tag.set('elementId', b);
    h.textMap(b!).format(1, 4, { [`t:${tagId}`]: true });
    const r = h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' });
    expect(r).toMatchObject({ ok: true, effects: { removed: [b], changed: [a] } });
    expect(h.body()).toEqual([{ id: a, style: 'st_action', text: 'She runs fast.' }]);
    expect(tag.get('elementId')).toBe(a);
    expect(h.delta(a!)).toEqual([{ insert: 'She runs ' }, { insert: 'fast', attributes: { [`t:${tagId}`]: true } }, { insert: '.' }]);
  });

  it('removes an empty element on backspace and merges the next element on delete', () => {
    const h = commandHarness();
    const [a, b, c] = h.replaceBody([['st_action', 'One'], ['st_action', ''], ['st_character', 'MAYA']]);
    expect(h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' })).toMatchObject({ ok: true, effects: { removed: [b] } });
    h.run('text.deleteForward', { at: at(a!, 3), unit: 'char' });
    expect(h.body()).toEqual([{ id: a, style: 'st_action', text: 'OneMAYA' }]);
    expect(h.run('text.deleteBackward', { at: at(a!, 0), unit: 'char' })).toMatchObject({ ok: false, reason: 'notApplicable' });
    void c;
  });

  it('deletes a range across elements, joining same-style ends and trimming different ones', () => {
    const h = commandHarness();
    const [a, b, c] = h.replaceBody([['st_action', 'Alpha beta'], ['st_action', 'gamma'], ['st_action', 'delta epsilon']]);
    h.run('text.deleteRange', { range: range(c!, 6, a!, 6) });
    expect(h.body()).toEqual([{ id: a, style: 'st_action', text: 'Alpha epsilon' }]);
    const [d, e] = h.replaceBody([['st_action', 'Walk in'], ['st_dialogue', 'Hello there']]);
    h.run('text.deleteRange', { range: range(d!, 4, e!, 6) });
    expect(h.body().map((x) => x.text)).toEqual(['Walk', 'there']);
    void b;
  });

  it('removes fully covered first and last elements of a range', () => {
    const h = commandHarness();
    const [a, b, c] = h.replaceBody([['st_action', 'One'], ['st_action', 'Two'], ['st_action', 'Three']]);
    h.run('text.deleteRange', { range: range(a!, 0, c!, 2) });
    expect(h.body()).toEqual([{ id: c, style: 'st_action', text: 'ree' }]);
    void b;
  });

  it('keeps deleted text under Track Changes', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Keep this']]);
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('text.deleteRange', { range: range(a!, 4, a!, 9) });
    const delta = h.delta(a!) as { insert: string; attributes?: { del?: { by: string } } }[];
    expect(delta.map((d) => d.insert).join('')).toBe('Keep this');
    expect(delta[1]!.attributes!.del!.by).toBe('u1');
  });
});

describe('replace and transform', () => {
  it('replaces a range atomically', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'The cat sat.']]);
    h.run('text.replaceRange', { range: range(a!, 4, a!, 7), text: 'dog' });
    expect(h.textMap(a!).toString()).toBe('The dog sat.');
  });
  it('transforms case preserving marks', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'maya waits']]);
    h.textMap(a!).format(0, 4, { b: true });
    h.run('text.transformCase', { range: range(a!, 0, a!, 10), to: 'title' });
    expect(h.delta(a!)).toEqual([{ insert: 'Maya', attributes: { b: true } }, { insert: ' Waits' }]);
    h.run('text.insertSoftReturn', { at: at(a!, 4) });
    h.run('text.insertSpecial', { at: at(a!, 0), char: 'nbsp' });
    expect(h.textMap(a!).toString()).toBe(' Maya\n Waits');
  });
});
