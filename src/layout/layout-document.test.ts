import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { builtinStyleId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { layoutDocument } from './layout-document.js';

const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };

function setup() {
  const ids = createSeededIdSource(11);
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  let i = 0;
  const add = (slug: string, text = '') =>
    insertElementRecord(elements, { id: newId('el', ids), pos: `B${String(i++).padStart(4, '0')}B`, style: builtinStyleId(slug), text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  const idOf = (m: Y.Map<unknown>) => m.get('id') as never;
  const model = () => openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  return { add, idOf, model };
}

describe('layoutDocument', () => {
  it('lays out a small screenplay on one page with source ranges, positions and page numbers', () => {
    const { add, idOf, model } = setup();
    const heading = add('scene_heading', 'INT. KITCHEN - DAY');
    add('action', 'Rain on the window.');
    const cue = add('character', 'MILLER');
    add('dialogue', 'Is anyone home?');
    const layout = layoutDocument(model());
    expect(layout.pages).toHaveLength(1);
    const lines = layout.pages[0]!.lines;
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.pageNumber === 1)).toBe(true);
    expect(lines[0]!.elementId).toBe(idOf(heading));
    expect(lines[0]!.y).toBe(layout.bodyTop); // space before suppressed at the page top
    expect(lines[0]!.sourceStart).toBe(0);
    expect(lines[0]!.sourceEnd).toBe('INT. KITCHEN - DAY'.length);
    expect(lines[0]!.x).toBe(1_371_600); // left margin 1.5 in
    const cueLine = lines.find((l) => l.elementId === idOf(cue))!;
    expect(cueLine.x).toBe(1_371_600 + 1_828_800);
    expect(lines[1]!.y).toBeGreaterThan(lines[0]!.y);
    expect(lines[1]!.runs.map((r) => r.text).join('')).toBe('Rain on the window.');
  });

  it('breaks a long document onto a second page at the 54-line boundary', () => {
    const { add, idOf, model } = setup();
    add('scene_heading', 'INT. HOUSE - DAY');
    const actions = Array.from({ length: 30 }, (_, i) => add('action', `Beat ${i}.`));
    const layout = layoutDocument(model());
    expect(layout.pages).toHaveLength(2);
    // Heading (1 line) + 26 one-line actions each preceded by a blank line = 53 of 54 rows.
    expect(layout.pages[0]!.lines).toHaveLength(27);
    expect(layout.pages[1]!.lines).toHaveLength(4);
    expect(layout.pages[1]!.lines[0]!.elementId).toBe(idOf(actions[26]!));
    expect(layout.pages[1]!.lines[0]!.y).toBe(layout.bodyTop);
    expect(layout.pages[1]!.lines[0]!.pageNumber).toBe(2);
  });
});
