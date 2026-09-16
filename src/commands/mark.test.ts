import { describe, expect, it } from 'vitest';
import { commandHarness } from './test-harness.js';

const range = (a: string, ao: number, b: string, bo: number) => ({ anchor: { elementId: a, offset: ao }, head: { elementId: b, offset: bo } });

describe('mark commands', () => {
  it('toggles on when any character lacks the mark and off when all have it, across elements', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', 'Hello'], ['st_action', 'World']]);
    h.textMap(a!).format(0, 5, { b: true });
    h.run('mark.toggle', { range: range(a!, 3, b!, 2), mark: 'b' });
    expect(h.delta(b!)).toEqual([{ insert: 'Wo', attributes: { b: true } }, { insert: 'rld' }]);
    h.run('mark.toggle', { range: range(a!, 3, b!, 2), mark: 'b' });
    expect(h.delta(a!)).toEqual([{ insert: 'Hel', attributes: { b: true } }, { insert: 'lo' }]);
    expect(h.delta(b!)).toEqual([{ insert: 'World' }]);
    h.run('mark.toggle', { range: range(a!, 0, a!, 2), mark: 'va:super' });
    expect(h.delta(a!)[0]).toEqual({ insert: 'He', attributes: { b: true, va: 'super' } });
  });
  it('sets valued marks and clears only formatting', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Colour']]);
    h.textMap(a!).format(0, 6, { rev: 'rev_01ARYZ6S410000000000000000', 't:tag_01ARYZ6S410000000000000000': true, i: true });
    h.run('mark.set', { range: range(a!, 0, a!, 6), mark: 'hl', value: '#FFFF00' });
    h.run('mark.set', { range: range(a!, 0, a!, 6), mark: 'u', value: 'double' });
    expect(h.delta(a!)).toEqual([{ insert: 'Colour', attributes: { rev: 'rev_01ARYZ6S410000000000000000', 't:tag_01ARYZ6S410000000000000000': true, i: true, hl: '#FFFF00', u: 'double' } }]);
    h.run('mark.clear', { range: range(a!, 0, a!, 6) });
    expect(h.delta(a!)).toEqual([{ insert: 'Colour', attributes: { rev: 'rev_01ARYZ6S410000000000000000', 't:tag_01ARYZ6S410000000000000000': true } }]);
    expect(h.run('mark.set', { range: range(a!, 0, a!, 6), mark: 'fc', value: 'red' })).toMatchObject({ ok: false, reason: 'invalidParams' });
  });
  it('records a fmt mark under Track Changes', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Bold']]);
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('mark.toggle', { range: range(a!, 0, a!, 4), mark: 'b' });
    const attrs = (h.delta(a!)[0] as { attributes: Record<string, { before?: unknown }> }).attributes;
    expect(attrs.b).toBe(true);
    expect(attrs.fmt!.before).toEqual({ b: null });
  });
  it('mark.clear records a fmt mark under Track Changes too, instead of formatting raw', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Bold']]);
    h.textMap(a!).format(0, 4, { b: true, hl: '#FFFF00' });
    h.doc.getMap('trackChanges').set('enabled', true);
    h.run('mark.clear', { range: range(a!, 0, a!, 4) });
    const attrs = (h.delta(a!)[0] as { attributes: Record<string, { before?: unknown }> }).attributes;
    expect(attrs.b).toBeUndefined();
    expect(attrs.hl).toBeUndefined();
    expect(attrs.fmt!.before).toEqual({ b: true, hl: '#FFFF00' });
  });
  it('mark.clear clears every FORMAT_MARK, including ln, lang and nospell', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Colour']]);
    h.textMap(a!).format(0, 6, { ln: 'https://example.test', lang: 'fr-FR', nospell: true, b: true });
    h.run('mark.clear', { range: range(a!, 0, a!, 6) });
    expect(h.delta(a!)).toEqual([{ insert: 'Colour' }]);
  });
});
