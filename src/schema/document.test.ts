import { describe, expect, it } from 'vitest';
import { FIXTURE_ACTION_ID, minimalDocumentJSON } from '../test-fixtures/minimal-document-json.js';
import { BookmarkJSON, DOC_TOP_LEVEL_KEYS, DocumentJSON, ElementJSON } from './document.js';
import { EntityJSON } from './entities.js';
import { TextJSON, isMarkKey } from './text.js';

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
