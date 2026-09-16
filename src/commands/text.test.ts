import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids/ids.js';
import { validateDocument } from '../model/validate/index.js';
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

  it('keeps both elements under Track Changes instead of hard-merging across a paragraph boundary', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'She runs'], ['st_dialogue', ' fast.']]);
    h.doc.getMap('trackChanges').set('enabled', true);
    const backward = h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' });
    expect(backward).toMatchObject({ ok: true });
    // Both elements survive, untouched, so the merge can still be rejected.
    expect(h.body()).toEqual([
      { id: a, style: 'st_action', text: 'She runs' },
      { id: b, style: 'st_dialogue', text: ' fast.' },
    ]);
    const bRecord = h.doc.getMap('elements').get(b!) as Y.Map<unknown>;
    expect(bRecord.get('tc')).toMatchObject({ kind: 'delete', by: 'u1' });

    const [c, d] = h.replaceBody([['st_action', 'One'], ['st_action', 'Two']]);
    const forward = h.run('text.deleteForward', { at: at(c!, h.textMap(c!).length), unit: 'char' });
    expect(forward).toMatchObject({ ok: true });
    expect(h.body()).toEqual([
      { id: c, style: 'st_action', text: 'One' },
      { id: d, style: 'st_action', text: 'Two' },
    ]);
    const dRecord = h.doc.getMap('elements').get(d!) as Y.Map<unknown>;
    expect(dRecord.get('tc')).toMatchObject({ kind: 'delete', by: 'u1' });
  });

  it('records mergeInto on the tracked delete standing in for a merge, but not on a genuine tracked element delete', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'She runs'], ['st_dialogue', ' fast.']]);
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' });
    const bRecord = h.doc.getMap('elements').get(b!) as Y.Map<unknown>;
    expect(bRecord.get('tc')).toMatchObject({ kind: 'delete', by: 'u1', mergeInto: a });

    const [c, d] = h.replaceBody([['st_action', 'One'], ['st_action', 'Two']]);
    h.run('text.deleteForward', { at: at(c!, h.textMap(c!).length), unit: 'char' });
    const dRecord = h.doc.getMap('elements').get(d!) as Y.Map<unknown>;
    expect(dRecord.get('tc')).toMatchObject({ kind: 'delete', by: 'u1', mergeInto: c });

    // A genuine whole-element delete under Track Changes is not a merge stand-in: no mergeInto.
    const [e] = h.replaceBody([['st_action', 'Whole element']]);
    h.run('text.deleteBackward', { at: at(e!, 0), unit: 'element' });
    const eRecord = h.doc.getMap('elements').get(e!) as Y.Map<unknown>;
    const eTc = eRecord.get('tc') as { kind: string; mergeInto?: string };
    expect(eTc.kind).toBe('delete');
    expect(eTc.mergeInto).toBeUndefined();
    expect('mergeInto' in eTc).toBe(false);
  });

  it('reports elementRemoved only when Track Changes did not keep the element (controller ruling B)', () => {
    const h = commandHarness();

    // unit: 'element', tracking off — real removal, effect reported.
    const [x] = h.replaceBody([['st_action', 'Gone']]);
    const untracked = h.run('text.deleteBackward', { at: at(x!, 0), unit: 'element' });
    expect(untracked.ok).toBe(true);
    if (untracked.ok) expect(untracked.results[0]).toEqual({ ok: true, effects: [{ kind: 'elementRemoved', id: x }] });
    expect(h.doc.getMap('elements').has(x!)).toBe(false);

    h.doc.getMap('trackChanges').set('enabled', true);

    // unit: 'element', tracking on — element kept (marked tc), no effect reported.
    const [y] = h.replaceBody([['st_action', 'Kept']]);
    const trackedElement = h.run('text.deleteBackward', { at: at(y!, 0), unit: 'element' });
    expect(trackedElement.ok).toBe(true);
    if (trackedElement.ok) expect(trackedElement.results[0]).toEqual({ ok: true });
    expect(h.doc.getMap('elements').has(y!)).toBe(true);

    // deleteForward, unit: 'element', tracking on — same check.
    const [z] = h.replaceBody([['st_action', 'Kept too']]);
    const trackedElementFwd = h.run('text.deleteForward', { at: at(z!, 0), unit: 'element' });
    expect(trackedElementFwd.ok).toBe(true);
    if (trackedElementFwd.ok) expect(trackedElementFwd.results[0]).toEqual({ ok: true });
    expect(h.doc.getMap('elements').has(z!)).toBe(true);

    // Empty-current-element branch (backspace), tracking on — kept, no effect.
    const [, empty] = h.replaceBody([['st_action', 'Prev'], ['st_action', '']]);
    const trackedEmptyBack = h.run('text.deleteBackward', { at: at(empty!, 0), unit: 'char' });
    expect(trackedEmptyBack.ok).toBe(true);
    if (trackedEmptyBack.ok) expect(trackedEmptyBack.results[0]).toEqual({ ok: true });
    expect(h.doc.getMap('elements').has(empty!)).toBe(true);

    // Empty-next-element branch (forward delete), tracking on — kept, no effect.
    const [cur, emptyNext] = h.replaceBody([['st_action', 'Cur'], ['st_action', '']]);
    const trackedEmptyFwd = h.run('text.deleteForward', { at: at(cur!, h.textMap(cur!).length), unit: 'char' });
    expect(trackedEmptyFwd.ok).toBe(true);
    if (trackedEmptyFwd.ok) expect(trackedEmptyFwd.results[0]).toEqual({ ok: true });
    expect(h.doc.getMap('elements').has(emptyNext!)).toBe(true);

    h.doc.getMap('trackChanges').set('enabled', false);

    // Same two empty-element branches, tracking off — real removal, effect reported.
    const [, empty2] = h.replaceBody([['st_action', 'Prev'], ['st_action', '']]);
    const untrackedEmptyBack = h.run('text.deleteBackward', { at: at(empty2!, 0), unit: 'char' });
    expect(untrackedEmptyBack.ok).toBe(true);
    if (untrackedEmptyBack.ok) expect(untrackedEmptyBack.results[0]).toEqual({ ok: true, effects: [{ kind: 'elementRemoved', id: empty2 }] });

    const [cur2, empty3] = h.replaceBody([['st_action', 'Cur'], ['st_action', '']]);
    const untrackedEmptyFwd = h.run('text.deleteForward', { at: at(cur2!, h.textMap(cur2!).length), unit: 'char' });
    expect(untrackedEmptyFwd.ok).toBe(true);
    if (untrackedEmptyFwd.ok) expect(untrackedEmptyFwd.results[0]).toEqual({ ok: true, effects: [{ kind: 'elementRemoved', id: empty3 }] });
  });

  it('still hard-merges across a paragraph boundary with Track Changes off', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'She runs'], ['st_dialogue', ' fast.']]);
    h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' });
    expect(h.body()).toEqual([{ id: a, style: 'st_action', text: 'She runs fast.' }]);

    const [c, d] = h.replaceBody([['st_action', 'One'], ['st_action', 'Two']]);
    h.run('text.deleteForward', { at: at(c!, h.textMap(c!).length), unit: 'char' });
    expect(h.body()).toEqual([{ id: c, style: 'st_action', text: 'OneTwo' }]);
    void d;
  });

  it('refuses to merge across the left/right seam of a dual-dialogue pair, leaving validateDocument clean', () => {
    const h = commandHarness();
    const [charL, dialL, charR, dialR] = h.replaceBody([
      ['st_character', 'ALEX'],
      ['st_dialogue', 'Hi there'],
      ['st_character', 'JO'],
      ['st_dialogue', 'Hello'],
    ]);
    const group = 'dd_01ARYZ6S410000000000000000';
    const elements = h.doc.getMap('elements');
    (elements.get(charL!) as Y.Map<unknown>).set('dual', { group, side: 'left' });
    (elements.get(dialL!) as Y.Map<unknown>).set('dual', { group, side: 'left' });
    (elements.get(charR!) as Y.Map<unknown>).set('dual', { group, side: 'right' });
    (elements.get(dialR!) as Y.Map<unknown>).set('dual', { group, side: 'right' });
    expect(validateDocument(h.doc).issues).toEqual([]);

    // Backspace at the right side's start must not merge dialL into charR.
    const backward = h.run('text.deleteBackward', { at: at(charR!, 0), unit: 'char' });
    expect(backward).toMatchObject({ ok: true });
    expect(h.body().map((x) => x.text)).toEqual(['ALEX', 'Hi there', 'JO', 'Hello']);
    expect(validateDocument(h.doc).issues).toEqual([]);

    // Delete at the left side's end must not merge charR into dialL.
    const forward = h.run('text.deleteForward', { at: at(dialL!, h.textMap(dialL!).length), unit: 'char' });
    expect(forward).toMatchObject({ ok: true });
    expect(h.body().map((x) => x.text)).toEqual(['ALEX', 'Hi there', 'JO', 'Hello']);
    expect(validateDocument(h.doc).issues).toEqual([]);
  });
});

describe('replace and transform', () => {
  it('replaces a range atomically', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'The cat sat.']]);
    h.run('text.replaceRange', { range: range(a!, 4, a!, 7), text: 'dog' });
    expect(h.textMap(a!).toString()).toBe('The dog sat.');
  });
  it('inserts the replacement after the revDel mark the deletion left, under revision mode', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'The cat sat.']]);
    const setId = [...(h.doc.getMap('revisions').get('sets') as Y.Map<unknown>).keys()][1]!;
    h.doc.getMap('revisions').set('mode', true);
    h.doc.getMap('revisions').set('activeSetId', setId);
    h.run('text.replaceRange', { range: range(a!, 4, a!, 7), text: 'dog' });
    expect(h.delta(a!)).toEqual([
      { insert: 'The ' },
      { insert: { type: 'revDel', rev: setId, by: 'u1', at: h.now() } },
      { insert: 'dog', attributes: { rev: setId } },
      { insert: ' sat.' },
    ]);
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
