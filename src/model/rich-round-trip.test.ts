import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { idKind } from '../ids/ids.js';
import { DocumentJSON } from '../schema/document.js';
import {
  RICH_ACTION_PLAIN, RICH_DUAL_GROUP, RICH_NOTE1_ID, RICH_TAG1_ID, richDocumentJSON,
} from '../test-fixtures/rich-document-json.js';
import { documentFromJSON, documentToJSON, materializeDocument } from './json.js';
import { comparePositions } from './positions.js';
import { REMAPPED_PREFIXES } from './remap-ids.js';

const ids = () => createSeededIdSource(909);

/** Independently re-checks the (pos, then id/key) ordering guarantee — not via the production `sortedRecords`/`comparePositions`-based sort itself, but by walking the already-sorted output and asserting it is monotonically increasing. */
function assertAscending<T>(items: readonly T[], posOf: (t: T) => string | undefined, tieOf: (t: T) => string): void {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const cur = items[i]!;
    const p = posOf(prev);
    const q = posOf(cur);
    if (p !== undefined && q !== undefined && p !== q) expect(comparePositions(p, q)).toBeLessThan(0);
    else expect(tieOf(prev) < tieOf(cur)).toBe(true);
  }
}

function mustFind<T>(items: readonly T[], pred: (t: T) => boolean, what: string): T {
  const found = items.find(pred);
  if (!found) throw new Error(`dangling reference: no ${what} found`);
  return found;
}

const SMART_TYPE_LISTS = ['sceneIntros', 'times', 'extensions', 'transitions', 'soundCues'] as const;
const MIN2_COLLECTIONS = ['folders', 'entities', 'tags', 'tagCategories', 'notes', 'beats', 'beatLinks', 'plotColumns', 'storylines', 'lanes', 'bin', 'shots', 'bookmarks'] as const;

describe('richDocumentJSON fixture', () => {
  it('is schema-valid and rich: every listed collection has at least two entries', () => {
    const json = richDocumentJSON();
    expect(DocumentJSON.safeParse(json).error?.issues ?? []).toEqual([]);
    for (const key of MIN2_COLLECTIONS) expect(json[key].length).toBeGreaterThanOrEqual(2);
    expect(json.revisions.sets.length).toBeGreaterThanOrEqual(2);
    for (const list of SMART_TYPE_LISTS) expect(json.smartType[list].length).toBeGreaterThanOrEqual(2);
    expect(json.elements.length).toBeGreaterThanOrEqual(2);
  });
});

describe('documentToJSON round trip on the rich fixture', () => {
  it('documentToJSON -> materializeDocument -> documentToJSON is deep-equal, and every collection is ordered by (pos, id/key)', () => {
    const json = richDocumentJSON();
    const out = documentToJSON(materializeDocument(json, { preserveIds: true, ids: ids() }));
    expect(out).toEqual(json);

    // ElementJSON carries no `pos` field; prove ordering via each element's distinctive text.
    expect(out.elements.map((e) => e.text.plain)).toEqual([
      'INT. DINER - NIGHT', RICH_ACTION_PLAIN, 'MAYA', 'Where were you?', 'SAM', 'Getting coffee.',
    ]);

    assertAscending(out.folders, (r) => r.pos, (r) => r.id);
    assertAscending(out.entities, () => undefined, (r) => r.id);
    assertAscending(out.tagCategories, (r) => r.pos, (r) => r.id);
    assertAscending(out.tags, () => undefined, (r) => r.id);
    assertAscending(out.notes, () => undefined, (r) => r.id);
    assertAscending(out.noteTypes, (r) => r.pos, (r) => r.id);
    assertAscending(out.revisions.sets, (r) => r.pos, (r) => r.id);
    assertAscending(out.beats, () => undefined, (r) => r.id);
    assertAscending(out.beatLinks, () => undefined, (r) => r.id);
    assertAscending(out.plotColumns, (r) => r.pos, (r) => r.id);
    assertAscending(out.storylines, (r) => r.pos, (r) => r.id);
    assertAscending(out.lanes, (r) => r.pos, (r) => r.id);
    assertAscending(out.bin, (r) => r.pos, (r) => r.id);
    assertAscending(out.shots, (r) => r.pos, (r) => r.id);
    assertAscending(out.bookmarks, () => undefined, (r) => r.id);
    assertAscending(out.production.pageLocks, () => undefined, (r) => r.id);
    for (const list of SMART_TYPE_LISTS) assertAscending(out.smartType[list], (r) => r.pos, (r) => r.key);
  });

  it('returns a Yjs update that any empty doc can apply', () => {
    const update = documentFromJSON(richDocumentJSON(), { preserveIds: true, ids: ids() });
    const other = new Y.Doc();
    Y.applyUpdate(other, update);
    expect(documentToJSON(other)).toEqual(richDocumentJSON());
  });
});

const ID_TOKEN_RE = /[a-z]+_[0-9A-HJKMNP-TV-Z]{26}/g;

describe('materializeDocument(preserveIds: false) / remapDocumentIds on the rich fixture', () => {
  it('changes every document-scoped id and leaves no dangling reference', () => {
    const base = richDocumentJSON();
    const baseStr = JSON.stringify(base);
    const originalIds = new Set(
      (baseStr.match(ID_TOKEN_RE) ?? []).filter((token) => {
        const kind = idKind(token);
        return kind !== null && REMAPPED_PREFIXES.has(kind);
      }),
    );
    // Sanity: the fixture really is rich enough for this to be a meaningful test.
    expect(originalIds.size).toBeGreaterThan(30);

    const out = documentToJSON(materializeDocument(base, { preserveIds: false, ids: ids() }));
    const outStr = JSON.stringify(out);

    expect(out.meta.docId).not.toBe(base.meta.docId);
    for (const oldId of originalIds) expect(outStr.includes(oldId)).toBe(false);

    // --- elements, found by their stable plain text (ids all changed, per the deep scan above) ---
    const heading = mustFind(out.elements, (e) => e.text.plain === 'INT. DINER - NIGHT', 'heading element');
    const action = mustFind(out.elements, (e) => e.text.plain === RICH_ACTION_PLAIN, 'action element');
    const charLeft = mustFind(out.elements, (e) => e.text.plain === 'MAYA', 'left character element');
    const charRight = mustFind(out.elements, (e) => e.text.plain === 'SAM', 'right character element');

    // --- anchors: t:/n:/s: marks on the action element's text are still id-shaped. s: (a
    // suggestion id) is deliberately NOT remapped — aiSuggestions are a global record kind
    // (see remap-ids.ts), so only t: and n: are checked against a real, remapped record. ---
    const lastRun = action.text.runs[action.text.runs.length - 1]!;
    const anchorKeys = Object.keys(lastRun.attrs);
    expect(anchorKeys).toHaveLength(3);
    const tagAnchor = mustFind(anchorKeys, (k) => k.startsWith('t:'), 'tag anchor mark');
    const noteAnchor = mustFind(anchorKeys, (k) => k.startsWith('n:'), 'note anchor mark');
    expect(tagAnchor.slice('t:'.length)).not.toBe(RICH_TAG1_ID);
    expect(noteAnchor.slice('n:'.length)).not.toBe(RICH_NOTE1_ID);

    // --- dual dialogue group: `dd_` ids are not a registered id prefix, so unchanged by remap,
    // but must still tie the two sides together. ---
    expect(charLeft.dual!.group).toBe(RICH_DUAL_GROUP);
    expect(charRight.dual!.group).toBe(RICH_DUAL_GROUP);
    expect(charLeft.dual!.group).toBe(charRight.dual!.group);

    // --- folderId / shotId ---
    const folder = mustFind(out.folders, (f) => f.title === 'Act One', 'folder');
    expect(action.folderId).toBe(folder.id);
    const shot = mustFind(out.shots, (s) => s.label === 'Wide', 'shot');
    expect(charRight.shotId).toBe(shot.id);

    // --- tags: elementId / entityId / categoryId, and the t: anchor, all resolve together ---
    const entity = mustFind(out.entities, (e) => e.name === 'MAYA', 'character entity');
    const location = mustFind(out.entities, (e) => e.name === 'DINER', 'location entity');
    const category = mustFind(out.tagCategories, (c) => c.key === 'cast', 'tag category');
    const tag = mustFind(out.tags, (t) => t.elementId === action.id, 'tag on the action element');
    expect(tag.entityId).toBe(entity.id);
    expect(tag.categoryId).toBe(category.id);
    expect(tagAnchor.slice('t:'.length)).toBe(tag.id);

    // --- notes: n: anchor resolves to a real note whose own anchor resolves to the action
    // element, and a second note anchored on a beat resolves to that beat ---
    const note = mustFind(out.notes, (n) => n.title === 'Continuity note', 'continuity note');
    expect(noteAnchor.slice('n:'.length)).toBe(note.id);
    expect(note.anchor).toEqual({ kind: 'element', elementId: action.id });
    const beat1 = mustFind(out.beats, (b) => b.title.plain === 'Setup', 'Setup beat');
    const beat2 = mustFind(out.beats, (b) => b.title.plain === 'Turn', 'Turn beat');
    const storyNote = mustFind(out.notes, (n) => n.title === 'Story note', 'story note');
    expect(storyNote.anchor).toEqual({ kind: 'beat', beatId: beat1.id });

    // --- beat links, plot/lane/storyline refs, and the beat's own element anchor ---
    const link1 = mustFind(out.beatLinks, (l) => l.label === 'leads to', 'beat link 1');
    const link2 = mustFind(out.beatLinks, (l) => l.label === 'echoes', 'beat link 2');
    expect(link1.from).toBe(beat1.id);
    expect(link1.to).toBe(beat2.id);
    expect(link2.from).toBe(beat2.id);
    expect(link2.to).toBe(beat1.id);
    expect(beat1.anchor).toEqual({ elementId: heading.id });
    const col1 = mustFind(out.plotColumns, (c) => c.title === 'Plot A', 'plot column A');
    const lane1 = mustFind(out.lanes, (l) => l.label === 'Outline Lane', 'lane 1');
    const storyline1 = mustFind(out.storylines, (s) => s.name === 'A-Story', 'storyline A');
    const storyline2 = mustFind(out.storylines, (s) => s.name === 'B-Story', 'storyline B');
    expect(beat1.plot).toEqual({ columnId: col1.id, pos: beat1.plot!.pos });
    expect(beat1.lane).toEqual({ laneId: lane1.id, pos: beat1.lane!.pos, pageBudget: null });
    expect(beat1.storylineIds).toEqual([storyline1.id]);
    expect(Object.keys(beat1.arc)).toEqual([storyline1.id]);

    // --- scene: locationId, arcBeats keys, storylineIds, and nested scene-version content ---
    expect(heading.scene!.locationId).toBe(location.id);
    expect(Object.keys(heading.scene!.arcBeats).sort()).toEqual([entity.id, location.id].sort());
    expect(heading.scene!.storylineIds).toEqual([storyline1.id, storyline2.id]);
    for (const version of heading.scene!.versions) {
      for (const el of version.content) expect(el.id).toMatch(/^el_[0-9A-HJKMNP-TV-Z]{26}$/);
    }

    // --- alternates: still ordered, and distinct from the primary element's id ---
    expect(action.alts?.map((a) => a.label)).toEqual(['Alt A', 'Alt B']);
    for (const alt of action.alts!) expect(alt.id).not.toBe(action.id);

    // --- bin: source.elementIds / sceneId and nested content ---
    const bin1 = mustFind(out.bin, (b) => b.title === 'Cut Scene 1', 'bin item 1');
    expect(bin1.source.elementIds).toEqual([action.id]);
    expect(bin1.source.sceneId).toBe(heading.id);

    // --- revisions, then production.pageLocks using a portable position ---
    const revBlue = mustFind(out.revisions.sets, (r) => r.name === 'Blue Revision', 'Blue revision set');
    expect(out.revisions.activeSetId).toBe(revBlue.id);
    const plk1 = mustFind(out.production.pageLocks, (l) => l.start === 'o:5', 'page lock at o:5');
    expect(plk1.startElementId).toBe(heading.id);
    expect(plk1.revisionSetId).toBe(revBlue.id);

    // --- shots[].range using portable positions ---
    expect(shot.range).toEqual({ startElementId: heading.id, start: 'o:0', endElementId: action.id, end: 'o:3' });

    // --- bookmarks ---
    const bookmark = mustFind(out.bookmarks, (b) => b.name === 'Top', 'Top bookmark');
    expect(bookmark.elementId).toBe(heading.id);
  });

  it('mustFind throws — proving a dangling reference fails the checks above, not just the round trip', () => {
    expect(() => mustFind([{ id: 'a' }], (x) => x.id === 'nonexistent', 'thing')).toThrow(/dangling reference: no thing found/);
  });
});
