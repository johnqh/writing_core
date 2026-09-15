import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { type ElementId, isId } from '../ids/ids.js';
import { DocumentJSON } from '../schema/document.js';
import { minimalDocumentJSON, FIXTURE_ACTION_ID } from '../test-fixtures/minimal-document-json.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { createDocument } from './create.js';
import { documentFromJSON, documentToJSON, materializeDocument } from './json.js';

const ids = () => createSeededIdSource(77);

describe('documentToJSON', () => {
  it('produces schema-valid JSON for a new document', () => {
    const json = documentToJSON(createDocument({ template: screenplayStandard, uid: 'u', ids: ids(), clock: () => 5 }));
    expect(DocumentJSON.safeParse(json).error?.issues ?? []).toEqual([]);
    expect(json.revisions.sets).toHaveLength(20);
    expect(json.smartType.sceneIntros.map((e) => e.text)).toEqual(['INT.', 'EXT.', 'INT./EXT.']);
  });
});

describe('documentFromJSON', () => {
  it('round-trips exactly with preserveIds', () => {
    const json = minimalDocumentJSON();
    json.tags.push({ id: 'tag_01ARYZ6S410000000000000009' as never, categoryId: 'cat_01ARYZ6S41000000000000000A' as never, entityId: json.entities[0]!.id, elementId: FIXTURE_ACTION_ID, createdBy: 'u', createdAt: 1 });
    json.tagCategories.push({ id: 'cat_01ARYZ6S41000000000000000A' as never, key: 'cast', name: 'Cast', color: '#0000FF', entityKind: 'character', textStyle: { bold: true, underline: false, highlight: false }, visible: true, pos: 'V', fdxGuid: null, osfUuid: null });
    json.elements[1]!.text.runs[0]!.attrs = { b: true, 't:tag_01ARYZ6S410000000000000009': true };
    json.notes.push({
      id: 'note_01ARYZ6S41000000000000000B' as never, anchor: { kind: 'element', elementId: FIXTURE_ACTION_ID }, typeId: 'ntp_01ARYZ6S41000000000000000C' as never,
      title: 'n', body: { plain: 'hi', runs: [{ text: 'hi', attrs: {} }], embeds: [] }, color: null, authorUid: 'u', createdAt: 1, updatedAt: 1,
      resolved: null, includeInPdf: false, mentions: [], replies: [{ id: 'rep_01ARYZ6S41000000000000000D' as never, authorUid: 'v', body: { plain: 'yo', runs: [{ text: 'yo', attrs: {} }], embeds: [] }, createdAt: 2, editedAt: null, mentions: ['u'] }],
    });
    json.noteTypes.push({ id: 'ntp_01ARYZ6S41000000000000000C' as never, key: 'general', name: 'General', color: '#FFD700', marker: '', pos: 'V' });
    json.bookmarks.push({ id: 'bm_01ARYZ6S41000000000000000E' as never, name: 'here', elementId: FIXTURE_ACTION_ID, at: 'o:4' });
    const doc = materializeDocument(json, { preserveIds: true, ids: ids() });
    expect(documentToJSON(doc)).toEqual(json);
  });

  it('mints fresh ids and rewrites every reference without preserveIds', () => {
    const base = minimalDocumentJSON();
    base.elements[1]!.text.runs[0]!.attrs = { 't:tag_01ARYZ6S410000000000000009': true };
    base.tags.push({ id: 'tag_01ARYZ6S410000000000000009' as never, categoryId: 'cat_01ARYZ6S41000000000000000A' as never, entityId: base.entities[0]!.id, elementId: FIXTURE_ACTION_ID, createdBy: 'u', createdAt: 1 });
    base.tagCategories.push({ id: 'cat_01ARYZ6S41000000000000000A' as never, key: 'cast', name: 'Cast', color: '#0000FF', entityKind: 'character', textStyle: { bold: true, underline: false, highlight: false }, visible: true, pos: 'V', fdxGuid: null, osfUuid: null });
    const out = documentToJSON(materializeDocument(base, { preserveIds: false, ids: ids() }));
    expect(out.meta.docId).not.toBe(base.meta.docId);
    const actionId = out.elements[1]!.id as ElementId;
    expect(actionId).not.toBe(FIXTURE_ACTION_ID);
    expect(isId('el', actionId)).toBe(true);
    expect(out.tags[0]!.elementId).toBe(actionId);
    expect(out.tags[0]!.entityId).toBe(out.entities[0]!.id);
    expect(Object.keys(out.elements[1]!.text.runs[0]!.attrs)).toEqual([`t:${out.tags[0]!.id}`]);
    expect(out.template.styles).toEqual(base.template.styles);
  });

  it('returns a Yjs update that any empty doc can apply', () => {
    const update = documentFromJSON(minimalDocumentJSON(), { preserveIds: true, ids: ids() });
    const other = new Y.Doc();
    Y.applyUpdate(other, update);
    expect(documentToJSON(other).elements.map((e) => e.text.plain)).toEqual(['INT. DINER - NIGHT', 'MAYA waits.']);
  });
});
