import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import type { ElementId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { orderRange, relPos, resolveWirePos } from './positions.js';

describe('wire positions', () => {
  const ids = createSeededIdSource(61);
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const [id, el] = [...doc.getMap('elements').entries()][0] as [ElementId, Y.Map<unknown>];
  const text = el.get('text') as Y.Text;
  text.insert(0, 'INT. DINER - NIGHT');

  it('resolves offsets and relative positions, tracking concurrent inserts', () => {
    expect(resolveWirePos(doc, { elementId: id, offset: 5 })!.index).toBe(5);
    const rel = relPos(text, id, 5);
    text.insert(0, 'EXT/');
    expect(resolveWirePos(doc, rel)!.index).toBe(9);
  });
  it('rejects out-of-range offsets and unknown elements', () => {
    expect(resolveWirePos(doc, { elementId: id, offset: 999 })).toBeNull();
    expect(resolveWirePos(doc, { elementId: 'el_01ARYZ6S410000000000000000' as ElementId, offset: 0 })).toBeNull();
  });
  it('orders a backwards range', () => {
    const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
    const a = resolveWirePos(doc, { elementId: id, offset: 7 })!;
    const b = resolveWirePos(doc, { elementId: id, offset: 2 })!;
    expect(orderRange(model, a, b).map((p) => p.index)).toEqual([2, 7]);
  });
});

describe('wire positions: deleted elements, rel-form null branches and titlePage scope', () => {
  it('rejects both wire forms once the element has been deleted', () => {
    const doc2 = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(64) });
    const elements = doc2.getMap('elements');
    const [delId, delEl] = [...elements.entries()][0] as [ElementId, Y.Map<unknown>];
    const delText = delEl.get('text') as Y.Text;
    delText.insert(0, 'to be deleted');
    const rel = relPos(delText, delId, 3);
    const offsetPos = { elementId: delId, offset: 3 };
    elements.delete(delId);
    expect(resolveWirePos(doc2, offsetPos)).toBeNull();
    expect(resolveWirePos(doc2, rel)).toBeNull();
  });

  it('rejects a rel position that cannot resolve in this document (unrelated doc)', () => {
    const doc2 = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(65) });
    const anyId = [...doc2.getMap('elements').keys()][0] as ElementId;
    const otherDoc = new Y.Doc();
    const otherText = new Y.Text();
    otherDoc.getMap<unknown>('scratch').set('t', otherText);
    otherText.insert(0, 'unrelated content');
    const foreignRel = relPos(otherText, anyId, 2);
    expect(resolveWirePos(doc2, foreignRel)).toBeNull();
  });

  it("rejects a rel position that resolves into a different element's text", () => {
    const doc2 = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(66) });
    const entries = [...(doc2.getMap('titlePage').get('elements') as Y.Map<unknown>).entries()] as [ElementId, Y.Map<unknown>][];
    const [idA] = entries[0]!;
    const [idB, elB] = entries[1]!;
    const textB = elB.get('text') as Y.Text;
    const relIntoB = relPos(textB, idB, 2) as { elementId: ElementId; rel: string };
    // Wrap a rel encoded against B's text with A's elementId: the resolved
    // type belongs to B's Y.Text, which is not the text looked up for A.
    expect(resolveWirePos(doc2, { elementId: idA, rel: relIntoB.rel }, 'titlePage')).toBeNull();
  });

  it('resolves positions in titlePage scope and rejects the wrong scope', () => {
    const doc2 = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(67) });
    const [tpId] = [...(doc2.getMap('titlePage').get('elements') as Y.Map<unknown>).keys()] as [ElementId];
    expect(resolveWirePos(doc2, { elementId: tpId, offset: 3 }, 'titlePage')!.index).toBe(3);
    expect(resolveWirePos(doc2, { elementId: tpId, offset: 3 }, 'body')).toBeNull();
    expect(resolveWirePos(doc2, { elementId: tpId, offset: 3 })).toBeNull();
  });
});
