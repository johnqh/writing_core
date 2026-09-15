import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { TextJSON } from '../schema/text.js';
import { readTextJSON, writeTextJSON } from './ytext.js';

function roundTrip(t: TextJSON): TextJSON {
  const doc = new Y.Doc();
  const text = doc.getMap('m').set('t', new Y.Text());
  writeTextJSON(text, t);
  return readTextJSON(text);
}

describe('TextJSON ↔ Y.Text', () => {
  it('round-trips runs with marks', () => {
    const t: TextJSON = { plain: 'MAYA waits.', runs: [{ text: 'MAYA', attrs: { b: true } }, { text: ' waits.', attrs: {} }], embeds: [] };
    expect(roundTrip(t)).toEqual(t);
  });
  it('places embeds at Y.Text indices and splits runs around them', () => {
    const t: TextJSON = {
      plain: 'ab',
      runs: [{ text: 'ab', attrs: { i: true } }],
      embeds: [
        { at: 0, embed: { type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000' as never, by: 'u', at: 1 } },
        { at: 2, embed: { type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000' as never, by: 'u', at: 2 } },
      ],
    };
    const doc = new Y.Doc();
    const text = doc.getMap('m').set('t', new Y.Text());
    writeTextJSON(text, t);
    expect(text.length).toBe(4);
    expect(readTextJSON(text)).toEqual(t);
  });
  it('merges adjacent runs with equal marks on read', () => {
    const doc = new Y.Doc();
    const text = doc.getMap('m').set('t', new Y.Text());
    text.insert(0, 'ab', { b: true });
    text.insert(2, 'cd', { b: true });
    expect(readTextJSON(text).runs).toEqual([{ text: 'abcd', attrs: { b: true } }]);
  });
  it('handles astral characters by UTF-16 length', () => {
    const t: TextJSON = { plain: '😀x', runs: [{ text: '😀x', attrs: {} }], embeds: [{ at: 2, embed: { type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000' as never, by: 'u', at: 1 } }] };
    expect(roundTrip(t)).toEqual(t);
  });
});
