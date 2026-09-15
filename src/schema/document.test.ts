import { describe, expect, it } from 'vitest';
import { minimalDocumentJSON } from '../test-fixtures/minimal-document-json.js';
import { DOC_TOP_LEVEL_KEYS, DocumentJSON, ElementJSON } from './document.js';
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
});
