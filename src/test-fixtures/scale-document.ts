import * as Y from 'yjs';
import { createSeededIdSource } from '../ids/id-source.js';
import { type ElementId, newId } from '../ids/ids.js';
import { insertElementRecord } from '../model/element-record.js';
import { createDocument } from '../model/create.js';
import { generatePositions } from '../model/positions.js';
import { openDocument } from '../read-model/open.js';
import type { DocumentModel } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';

/**
 * A realistically shaped screenplay of `size` body elements: repeating scene heading / action /
 * character / parenthetical / dialogue, so scenes, dialogue blocks, entities and SmartType all
 * have real work to do. Used both by the ~300-element scale coverage and by the command
 * cost benchmark at 3000.
 */
const CYCLE: [style: string, text: (i: number) => string][] = [
  ['st_scene_heading', (i) => `INT. ROOM ${i} - DAY`],
  ['st_action', (i) => `Maya crosses the room and checks the window, again, for the ${i}th time.`],
  ['st_character', (i) => (i % 2 === 0 ? 'MAYA' : 'JONAH')],
  ['st_parenthetical', () => '(quietly)'],
  ['st_dialogue', (i) => `Nobody is coming. Not tonight, not on day ${i}.`],
];

export interface ScaleDocument {
  doc: Y.Doc;
  model: DocumentModel;
  ids: ReturnType<typeof createSeededIdSource>;
  elementIds: ElementId[];
}

export function scaleDocument(size: number, seed = 7): ScaleDocument {
  const ids = createSeededIdSource(seed);
  const doc = createDocument({ template: screenplayStandard, uid: 'u1', ids, clock: () => 1_000 });
  const elements = doc.getMap<unknown>('elements');
  const elementIds: ElementId[] = [];
  doc.transact(() => {
    for (const k of [...elements.keys()]) elements.delete(k);
    const positions = generatePositions(size, null, null, null);
    for (let i = 0; i < size; i++) {
      const [style, text] = CYCLE[i % CYCLE.length]!;
      const plain = text(i);
      const id = newId('el', ids);
      insertElementRecord(
        elements,
        { id, pos: positions[i]!, style: style as never, text: { plain, runs: [{ text: plain, attrs: {} }], embeds: [] } },
        { createdBy: 'u1', createdAt: 1_000, editedBy: 'u1', editedAt: 1_000 },
      );
      elementIds.push(id);
    }
  });
  return { doc, model: openDocument(doc, { ids, clock: () => 1_000, locale: 'en' }), ids, elementIds };
}
