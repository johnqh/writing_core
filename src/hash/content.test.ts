import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TextJSON } from '../schema/text.js';
import {
  type HashVector, canonicalElementText, computeHashVector, elementContentHash, entityContentHash, packetHash, sceneContentHash,
  shotContentHash, sliceTextJSON,
} from './content.js';

const T = (plain: string, attrs: TextJSON['runs'][number]['attrs'] = {}): TextJSON => ({ plain, runs: plain ? [{ text: plain, attrs }] : [], embeds: [] });
const el = (text: TextJSON, over: Partial<Parameters<typeof elementContentHash>[0]> = {}) =>
  elementContentHash({ role: 'action', style: 'st_action', text, dual: null, ...over });

describe('canonicalElementText', () => {
  it('drops tracked deletions, keeps insertions and trims trailing whitespace', () => {
    const text: TextJSON = {
      plain: 'Hello cruel world  \r\nnext ',
      runs: [
        { text: 'Hello ', attrs: { b: true } },
        { text: 'cruel ', attrs: { del: { changeId: 'chg_x', by: 'u', at: 1 } } },
        { text: 'world  \r\nnext ', attrs: { ins: { changeId: 'chg_y', by: 'u', at: 1 }, i: true } },
      ],
      embeds: [],
    };
    expect(canonicalElementText(text)).toEqual({ text: 'Hello world\nnext', runs: [[0, 6, { b: true }], [6, 16, { i: true }]], embeds: [] });
  });
  it('places image embeds by text offset and ignores revDel embeds and alt text', () => {
    const text: TextJSON = {
      plain: 'ab',
      runs: [{ text: 'ab', attrs: {} }],
      embeds: [
        { at: 1, embed: { type: 'image', assetId: 'asset_1' as never, widthEmu: 10, heightEmu: 20, alt: 'x' } },
        { at: 3, embed: { type: 'revDel', rev: 'rev_1' as never, by: 'u', at: 1 } },
      ],
    };
    expect(canonicalElementText(text).embeds).toEqual([{ at: 1, assetId: 'asset_1', widthEmu: 10, heightEmu: 20 }]);
  });
});

describe('elementContentHash', () => {
  it('has the versioned form', () => {
    expect(el(T('Maya waits.'))).toMatch(/^v1:[0-9a-f]{64}$/);
  });
  it('ignores presentation-only marks, tags, notes and revisions', () => {
    const base = el(T('Maya waits.'));
    expect(el(T('Maya waits.', { fc: '#FF0000', hl: '#FFFF00', 't:tag_x': true, 'n:note_x': true, rev: 'rev_x', lang: 'en' }))).toBe(base);
    expect(el(T('Maya waits.', { b: true }))).not.toBe(base);
  });
  it('is neutral to built-in style ids but not custom ones', () => {
    expect(el(T('x'), { style: 'st_action' })).toBe(el(T('x'), { style: 'st_scene_heading', role: 'action' }));
    expect(el(T('x'), { style: 'st_01ARYZ6S410000000000000000' })).not.toBe(el(T('x')));
  });
  it('does not apply caps and distinguishes roles', () => {
    expect(el(T('maya'))).not.toBe(el(T('MAYA')));
    expect(el(T('x'), { role: 'dialogue' })).not.toBe(el(T('x')));
  });
  it('references the dual partner by hash', () => {
    const partner = el(T('Hey.'), { role: 'character' });
    expect(el(T('Hi.'), { dual: { side: 'left', partnerHash: partner } })).not.toBe(el(T('Hi.')));
  });
});

describe('scene, shot, entity and packet hashes', () => {
  const a = el(T('A'));
  const b = el(T('B'));
  it('scene hash covers printing elements and omission', () => {
    const s = sceneContentHash({ omitted: false, elements: [{ hash: a, role: 'sceneHeading', printable: true }, { hash: b, role: 'action', printable: true }] });
    expect(sceneContentHash({ omitted: false, elements: [{ hash: a, role: 'sceneHeading', printable: true }, { hash: el(T('note')), role: 'note', printable: false }, { hash: b, role: 'action', printable: true }] })).toBe(s);
    expect(sceneContentHash({ omitted: true, elements: [{ hash: a, role: 'sceneHeading', printable: true }, { hash: b, role: 'action', printable: true }] })).not.toBe(s);
  });
  it('slices text for partial shot ranges', () => {
    expect(sliceTextJSON(T('Hello world', { b: true }), 6, 11)).toEqual(T('world', { b: true }));
    expect(shotContentHash([a, b])).not.toBe(shotContentHash([b, a]));
  });
  it('entity hash ignores alias order and ui attributes', () => {
    const e = {
      id: 'ent_1', kind: 'character', name: 'MAYA', nameKey: 'maya', aliases: ['M', 'MAY'], color: null,
      description: T('Tall.'), fields: { age: '30', traits: { trt_1: 'x' } }, attributes: { 'video.styleRef': 'a', 'fw.ui.expanded': true },
      categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual',
    } as never;
    const h = entityContentHash(e);
    expect(entityContentHash({ ...(e as object), aliases: ['MAY', 'M'], attributes: { 'video.styleRef': 'a' }, color: '#FF0000', createdAt: 9 } as never)).toBe(h);
    expect(entityContentHash({ ...(e as object), name: 'MAYA R' } as never)).not.toBe(h);
  });
  it('packet hash ignores generatedAt, hash and signed URLs', () => {
    const p = { generatedAt: 1, hash: 'x', scene: { id: 'el_1' }, assets: [{ id: 'asset_1', url: 'https://a', urlExpiresAt: 5 }] };
    expect(packetHash(p)).toBe(packetHash({ ...p, generatedAt: 2, hash: 'y', assets: [{ id: 'asset_1', url: 'https://b', urlExpiresAt: 9 }] }));
  });
});

describe('pinned vectors', () => {
  it('match src/hash/vectors.json', () => {
    const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('./vectors.json', import.meta.url)), 'utf8')) as HashVector[];
    expect(vectors.map((v) => v.fn)).toEqual(expect.arrayContaining(['element', 'scene', 'shot']));
    for (const v of vectors) expect(computeHashVector(v), v.name).toBe(v.hash);
  });
});
