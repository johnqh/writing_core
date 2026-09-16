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
  it('includes each hashed mark (u, s, sc, va) so removing one from HASHED_MARKS would go undetected without this', () => {
    const base = el(T('Maya waits.'));
    expect(el(T('Maya waits.', { u: 'single' }))).not.toBe(base);
    expect(el(T('Maya waits.', { s: true }))).not.toBe(base);
    expect(el(T('Maya waits.', { sc: true }))).not.toBe(base);
    expect(el(T('Maya waits.', { va: 'super' }))).not.toBe(base);
  });
});

describe('canonicalElementText NFC composition across a formatting boundary', () => {
  it('composes a base character with a combining mark in the NEXT run the same as a precomposed character', () => {
    // "e" (plain) + combining acute (U+0301, bold) + "x" (bold) must read as the same content as
    // "é" (plain, precomposed) + "x" (bold): the base character's own formatting is what a reader
    // sees, so the composed "é" belongs with "e"'s (plain) attrs, not the combining mark's (bold).
    const split: TextJSON = {
      plain: 'éx',
      runs: [
        { text: 'e', attrs: {} },
        { text: '́x', attrs: { b: true } },
      ],
      embeds: [],
    };
    const precomposed: TextJSON = {
      plain: 'éx',
      runs: [
        { text: 'é', attrs: {} },
        { text: 'x', attrs: { b: true } },
      ],
      embeds: [],
    };
    expect(canonicalElementText(split)).toEqual(canonicalElementText(precomposed));
    expect(el(split)).toBe(el(precomposed));
  });
});

describe('scene, shot, entity and packet hashes', () => {
  const a = el(T('A'));
  const b = el(T('B'));
  it('scene hash covers printing elements and omission', () => {
    const s = sceneContentHash({ omitted: false, elements: [{ hash: a, printable: true }, { hash: b, printable: true }] });
    expect(sceneContentHash({ omitted: false, elements: [{ hash: a, printable: true }, { hash: el(T('note')), printable: false }, { hash: b, printable: true }] })).toBe(s);
    expect(sceneContentHash({ omitted: true, elements: [{ hash: a, printable: true }, { hash: b, printable: true }] })).not.toBe(s);
  });
  it('excludes a printing-role element whose style is printable:false', () => {
    const s = sceneContentHash({ omitted: false, elements: [{ hash: a, printable: true }, { hash: b, printable: true }] });
    const withUnprintableAction = sceneContentHash({
      omitted: false,
      elements: [{ hash: a, printable: true }, { hash: el(T('hidden')), printable: false }, { hash: b, printable: true }],
    });
    expect(withUnprintableAction).toBe(s);
  });
  it('INCLUDES outline/synopsis/note-role elements whose style is printable (spec 11 §4.2)', () => {
    // In the text-outline template the outline and synopsis styles ARE the printed body. Excluding
    // them by role (rather than by `printable`) let an outline scene hash identically with its whole
    // body deleted.
    const heading = { hash: a, printable: true } as const;
    const empty = sceneContentHash({ omitted: false, elements: [heading] });
    const withBody = sceneContentHash({
      omitted: false,
      elements: [heading, { hash: el(T('Act one'), { role: 'outline' }), printable: true }, { hash: el(T('Maya arrives.'), { role: 'synopsis' }), printable: true }],
    });
    expect(withBody).not.toBe(empty);
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
  it('includes a non-fw.ui. attribute VALUE, not just its presence', () => {
    const e = {
      id: 'ent_1', kind: 'character', name: 'MAYA', nameKey: 'maya', aliases: [], color: null,
      description: T('Tall.'), fields: {}, attributes: { 'video.styleRef': 'a' },
      categoryId: null, retain: false, mergedInto: null, createdBy: 'u', createdAt: 0, origin: 'manual',
    } as never;
    const h = entityContentHash(e);
    expect(entityContentHash({ ...(e as object), attributes: { 'video.styleRef': 'b' } } as never)).not.toBe(h);
  });
  it('packet hash ignores generatedAt, hash and every signed-URL field (previewUrl, originalUrl, urlExpiresAt), and nothing else', () => {
    // A realistic scene-packet fixture (spec 11 §7.2–§7.3): the common envelope plus AssetSummary's
    // actual signed-URL fields, nested under body.cast[].assets[] — not the invented `url`/`signedUrl`
    // fields the previous fixture used, which happened to match the bug in PACKET_STRIP.
    const asset = {
      assetId: 'asset_1',
      versionId: 'asv_1',
      role: 'headshot',
      kind: 'image',
      title: 'Maya headshot',
      mime: 'image/webp',
      media: { width: 1600, height: 2000 },
      previewUrl: 'https://r2.example/preview-abc?sig=1',
      originalUrl: undefined,
      urlExpiresAt: '2027-03-02T18:55:11Z',
      staleness: 'fresh',
      rights: { ownership: 'owned', containsLikenessOf: [], aiTrainingAllowed: false, consentOnFile: false },
    };
    const castMember = { entityId: 'ent_1', name: 'MAYA', assets: [asset] };
    const packet = {
      packetVersion: 1,
      kind: 'scene',
      documentId: 'doc_1',
      documentTitle: 'NIGHT SHIFT',
      snapshotId: null,
      templateId: 'screenplay.fade_in',
      language: 'en-US',
      generatedAt: '2027-03-02T18:40:11Z',
      hash: 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      body: {
        scene: { id: 'el_1', number: '123', contentHash: 'v1:bbbb' },
        cast: [castMember],
      },
    };
    const refetched = {
      ...packet,
      generatedAt: '2027-03-02T19:10:00Z',
      hash: 'v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      body: {
        ...packet.body,
        cast: [
          {
            ...castMember,
            assets: [
              {
                ...asset,
                previewUrl: 'https://r2.example/preview-xyz?sig=2',
                originalUrl: 'https://r2.example/original-xyz?sig=3',
                urlExpiresAt: '2027-03-02T19:25:00Z',
              },
            ],
          },
        ],
      },
    };
    expect(packetHash(packet)).toBe(packetHash(refetched));

    const edited = { ...packet, body: { ...packet.body, scene: { ...packet.body.scene, number: '124' } } };
    expect(packetHash(edited)).not.toBe(packetHash(packet));
  });
});

describe('pinned vectors', () => {
  it('match src/hash/vectors.json', () => {
    const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('./vectors.json', import.meta.url)), 'utf8')) as HashVector[];
    expect(vectors.map((v) => v.fn)).toEqual(expect.arrayContaining(['element', 'scene', 'shot']));
    for (const v of vectors) expect(computeHashVector(v), v.name).toBe(v.hash);
  });
});
