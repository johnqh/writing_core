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
