import { describe, expect, it } from 'vitest';
import { FIXTURE_ACTION_ID, minimalDocumentJSON } from '../test-fixtures/minimal-document-json.js';
import { BookmarkJSON, DOC_TOP_LEVEL_KEYS, DocumentJSON, ElementJSON } from './document.js';
import { ENTITY_FIELD_SCHEMAS, EntityAttributes, EntityJSON } from './entities.js';
import { ENTITY_KINDS } from './vocab.js';
import { Embed, TextJSON, isMarkKey } from './text.js';

describe('DocumentJSON', () => {
  it('accepts the minimal fixture', () => {
    expect(DocumentJSON.safeParse(minimalDocumentJSON()).error?.issues ?? []).toEqual([]);
  });
  it('lists the 30 top-level keys of spec 01 §5.1', () => {
    expect(DOC_TOP_LEVEL_KEYS).toHaveLength(30);
    expect(Object.keys(minimalDocumentJSON()).sort()).toEqual([...DOC_TOP_LEVEL_KEYS].sort());
  });
});

describe('TextJSON', () => {
  it('requires runs to spell the plain text', () => {
    expect(TextJSON.safeParse({ plain: 'ab', runs: [{ text: 'a', attrs: {} }], embeds: [] }).success).toBe(false);
    expect(TextJSON.safeParse({ plain: 'ab', runs: [{ text: 'ab', attrs: { 't:tag_01ARYZ6S410000000000000000': true } }], embeds: [] }).success).toBe(true);
  });
  it('knows the mark vocabulary', () => {
    expect(isMarkKey('b')).toBe(true);
    expect(isMarkKey('n:note_01ARYZ6S410000000000000000')).toBe(true);
    expect(isMarkKey('bold')).toBe(false);
    expect(isMarkKey('t:')).toBe(false);
  });
});

describe('record schemas', () => {
  it('validates entity fields by kind', () => {
    const base = minimalDocumentJSON().entities[0]!;
    expect(EntityJSON.safeParse({ ...base, fields: { role: 'hero' } }).success).toBe(false);
    expect(EntityJSON.safeParse({ ...base, kind: 'prop', fields: { quantity: 2, hero: true } }).success).toBe(true);
    expect(EntityJSON.safeParse({ ...base, kind: 'unit', fields: { anything: 1 } }).success).toBe(false);
    expect(EntityJSON.safeParse({ ...base, attributes: { 'video.styleRef': 'x' } }).success).toBe(true);
    expect(EntityJSON.safeParse({ ...base, attributes: { 'Bad Key': 1 } }).success).toBe(false);
  });
  it('rejects dual dialogue sides other than left and right', () => {
    const el = minimalDocumentJSON().elements[1]!;
    expect(ElementJSON.safeParse({ ...el, dual: { group: 'dd_01ARYZ6S410000000000000000', side: 'middle' } }).success).toBe(false);
  });
  it('reports the offending key in the path when an entity attribute key is invalid', () => {
    const base = minimalDocumentJSON().entities[0]!;
    const result = EntityJSON.safeParse({ ...base, attributes: { 'Bad Key': 1 } });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'attributes.Bad Key')).toBe(true);
  });
  it('reports the offending key in the path when a text attribute key is unknown', () => {
    const result = TextJSON.safeParse({ plain: 'a', runs: [{ text: 'a', attrs: { bold: true } }], embeds: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'runs.0.attrs.bold')).toBe(true);
  });
});

describe('PortablePos', () => {
  const base = { id: 'bm_01ARYZ6S410000000000000004' as never, name: 'mark', elementId: FIXTURE_ACTION_ID };
  it('accepts the portable o:<offset> form', () => {
    expect(BookmarkJSON.safeParse({ ...base, at: 'o:0' }).success).toBe(true);
    expect(BookmarkJSON.safeParse({ ...base, at: 'o:1234' }).success).toBe(true);
  });
  it('rejects empty strings, malformed offsets and base64-looking relative positions', () => {
    for (const at of ['', 'o:', 'o:-1', 'o:1.5', 'AAAB3ElzQ29kZWMAAAAA']) {
      expect(BookmarkJSON.safeParse({ ...base, at }).success).toBe(false);
    }
  });
});

// Each of these guarded only the accepting direction (or nothing at all) before this fix wave.
describe('text and entity schemas reject malformed records', () => {
  it('TextJSON requires strictly ordered embeds and non-empty runs', () => {
    const run = { text: 'ab', attrs: {} };
    const embed = (at: number) => ({ at, embed: { type: 'revDel' as const, rev: 'rev_01ARYZ6S410000000000000000', by: 'u', at: 0 } });
    expect(TextJSON.safeParse({ plain: 'ab', runs: [run], embeds: [embed(0), embed(1)] }).success).toBe(true);
    expect(TextJSON.safeParse({ plain: 'ab', runs: [run], embeds: [embed(1), embed(1)] }).success).toBe(false);
    expect(TextJSON.safeParse({ plain: 'ab', runs: [run], embeds: [embed(2), embed(1)] }).success).toBe(false);
    expect(TextJSON.safeParse({ plain: 'ab', runs: [run], embeds: [embed(-1)] }).success).toBe(false);
    expect(TextJSON.safeParse({ plain: 'ab', runs: [{ text: '', attrs: {} }, run], embeds: [] }).success).toBe(false);
  });

  it('TextAttrs rejects an unknown mark and a malformed anchor id', () => {
    const attrs = (a: Record<string, unknown>) => TextJSON.safeParse({ plain: 'a', runs: [{ text: 'a', attrs: a }], embeds: [] }).success;
    expect(attrs({ b: true, va: 'super', nospell: true })).toBe(true);
    expect(attrs({ bold: true })).toBe(false);
    expect(attrs({ 't:not-an-id': true })).toBe(false);
    expect(attrs({ 'n:tag_01ARYZ6S410000000000000000': true })).toBe(false);
    expect(isMarkKey('s:sug_01ARYZ6S410000000000000000')).toBe(true);
    expect(isMarkKey('x:sug_01ARYZ6S410000000000000000')).toBe(false);
  });

  it('Embed is a closed union: an image needs its asset and dimensions, a revDel needs its set', () => {
    const asImage = (e: Record<string, unknown>) => Embed.safeParse({ type: 'image', ...e }).success;
    expect(asImage({ assetId: 'asset_01ARYZ6S410000000000000000', widthEmu: 10, heightEmu: 10, alt: '' })).toBe(true);
    expect(asImage({ assetId: 'asset_01ARYZ6S410000000000000000', widthEmu: -1, heightEmu: 10, alt: '' })).toBe(false);
    expect(asImage({ assetId: 'el_01ARYZ6S410000000000000000', widthEmu: 10, heightEmu: 10, alt: '' })).toBe(false);
    expect(Embed.safeParse({ type: 'sticker', assetId: 'asset_01ARYZ6S410000000000000000' }).success).toBe(false);
    expect(Embed.safeParse({ type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000', by: 'u', at: 0 }).success).toBe(true);
    expect(Embed.safeParse({ type: 'revDel', rev: 'rev_01ARYZ6S410000000000000000', by: 'u', at: -1 }).success).toBe(false);
  });

  it('EntityAttributes enforces the dotted lowerCamel key grammar', () => {
    expect(EntityAttributes.safeParse({ 'video.styleRef': 'a', simple: 1 }).success).toBe(true);
    for (const bad of [{ 'Video.styleRef': 1 }, { 'video..styleRef': 1 }, { '.video': 1 }, { 'video.': 1 }, { 'video-style': 1 }, { '1video': 1 }]) {
      expect(EntityAttributes.safeParse(bad).success, `EntityAttributes accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('ENTITY_FIELD_SCHEMAS covers every entity kind and rejects a field belonging to another kind', () => {
    expect(Object.keys(ENTITY_FIELD_SCHEMAS).sort()).toEqual([...ENTITY_KINDS].sort());
    expect(ENTITY_FIELD_SCHEMAS.location.safeParse({ setting: 'int', period: '1970s' }).success).toBe(true);
    // `make` belongs to a vehicle, not a location; every field schema is strict.
    expect(ENTITY_FIELD_SCHEMAS.location.safeParse({ make: 'Ford' }).success).toBe(false);
    expect(ENTITY_FIELD_SCHEMAS.vehicle.safeParse({ make: 'Ford', characterIds: ['ent_01ARYZ6S410000000000000000'] }).success).toBe(true);
    expect(ENTITY_FIELD_SCHEMAS.vehicle.safeParse({ characterIds: ['nope'] }).success).toBe(false);
  });
});
