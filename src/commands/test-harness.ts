import * as Y from 'yjs';
import { createSeededIdSource } from '../ids/id-source.js';
import { type ElementId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { generatePositions } from '../model/positions.js';
import { openDocument } from '../read-model/open.js';
import type { TemplateJSON } from '../schema/template.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { registerBuiltinCommands } from './builtin.js';
import { executeCommand } from './execute.js';
import { type OriginKind, createSessionOrigins } from './origin.js';

export const TEST_ACTOR = { userId: 'u1', displayName: 'Writer', color: '#224466', kind: 'human' as const };

export function commandHarness(template: TemplateJSON = screenplayStandard, seed = 90) {
  registerBuiltinCommands();
  let clock = 1_000;
  const ids = createSeededIdSource(seed);
  const doc = createDocument({ template, uid: TEST_ACTOR.userId, ids, clock: () => clock });
  const model = openDocument(doc, { ids, clock: () => clock, locale: 'en' });
  const origins = createSessionOrigins(TEST_ACTOR);
  const elements = doc.getMap<unknown>('elements');
  return {
    doc, model, ids, origins,
    now: () => clock,
    tick: (ms: number) => { clock += ms; },
    run: (id: string, params: unknown, kind: OriginKind = 'local-command', groupKey?: string) =>
      executeCommand({ doc, model, ids, actor: TEST_ACTOR, origin: origins.make(kind, { commandId: id, ...(groupKey ? { groupKey } : {}) }), capabilities: new Set(['write', 'comment', 'lockAdmin', 'revisionAdmin'] as const), clock: () => clock, command: { id, params } }),
    body: () => model.elements().map((e) => ({ id: e.id, style: e.style as string, text: e.text.plain })),
    replaceBody(rows: [string, string][]): ElementId[] {
      const made: ElementId[] = [];
      doc.transact(() => {
        for (const k of [...elements.keys()]) elements.delete(k);
        const pos = generatePositions(rows.length, null, null, null);
        rows.forEach(([style, text], i) => {
          const id = newId('el', ids);
          insertElementRecord(elements, { id, pos: pos[i]!, style: style as never, text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, { createdBy: 'u1', createdAt: 0, editedBy: 'u1', editedAt: 0 });
          made.push(id);
        });
      });
      return made;
    },
    textMap: (id: ElementId) => (elements.get(id) as Y.Map<unknown>).get('text') as Y.Text,
    delta: (id: ElementId) => ((elements.get(id) as Y.Map<unknown>).get('text') as Y.Text).toDelta(),
  };
}
