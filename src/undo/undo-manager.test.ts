import * as Y from 'yjs';
import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { registerCommand } from '../commands/registry.js';
import { commandHarness } from '../commands/test-harness.js';
import { documentToJSON } from '../model/json.js';
import { createSessionUndo } from './undo-manager.js';

const at = (elementId: string, offset: number) => ({ elementId, offset });

registerCommand({
  id: 'test.standaloneAppend', params: z.object({ elementId: z.string(), text: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'standalone', labelKey: 'writing.command.test.standaloneAppend', isEnabled: () => ({ enabled: true }),
  run(ctx, p) {
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, p.text);
    return { ok: true };
  },
});

describe('createSessionUndo', () => {
  it('undoes only this session\'s edits and keeps a collaborator\'s concurrent typing', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Maya waits.']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 11), text: ' Long.' }, 'local-typing');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(h.doc));
    ((remote.getMap('elements').get(a!) as Y.Map<unknown>).get('text') as Y.Text).insert(0, 'Still, ');
    Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(h.doc)));
    expect(h.textMap(a!).toString()).toBe('Still, Maya waits. Long.');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('Still, Maya waits.');
    expect(undo.redo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('Still, Maya waits. Long.');
  });

  it('groups typing within 500 ms and splits on pauses, caret jumps and commands', () => {
    const h = commandHarness();
    const [a, b] = h.replaceBody([['st_action', ''], ['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'H' }, 'local-typing');
    h.tick(100);
    h.run('text.insert', { at: at(a!, 1), text: 'i' }, 'local-typing');
    h.tick(700);
    h.run('text.insert', { at: at(a!, 2), text: '!' }, 'local-typing');
    undo.noteCaret(b!);
    h.tick(10);
    h.run('text.insert', { at: at(b!, 0), text: 'X' }, 'local-typing');
    h.run('mark.toggle', { range: { anchor: at(a!, 0), head: at(a!, 3) }, mark: 'b' });
    expect(undo.undo()).toBe(true);
    expect(h.delta(a!)).toEqual([{ insert: 'Hi!' }]);
    undo.undo();
    expect(h.textMap(b!).toString()).toBe('');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe('Hi');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('keeps a groupKey together across pauses and ignores untracked origins', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'dic' }, 'local-typing', 'dictation-1');
    h.tick(5_000);
    h.run('text.insert', { at: at(a!, 3), text: 'tated' }, 'local-typing', 'dictation-1');
    h.run('text.insert', { at: at(a!, 8), text: ' by MCP' }, 'mcp');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe(' by MCP');
    expect(undo.canUndo()).toBe(false);
  });

  it('keeps a standalone command in its own step even inside a groupKey', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'a' }, 'local-typing', 'g');
    h.run('test.standaloneAppend', { elementId: a, text: 'b' }, 'local-typing', 'g');
    h.run('text.insert', { at: at(a!, 2), text: 'c' }, 'local-typing', 'g');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe('ab');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe('a');
    undo.undo();
    expect(h.textMap(a!).toString()).toBe('');
  });

  it('clears with a reason', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'x' }, 'local-typing');
    undo.clear('undoClearedBySnapshotOpen');
    expect(undo.canUndo()).toBe(false);
    expect(undo.lastClearReason).toBe('undoClearedBySnapshotOpen');
  });

  it('keeps consecutive ungrouped commands as separate undo steps even with no pause between them', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', 'Alpha beta']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('mark.toggle', { range: { anchor: at(a!, 0), head: at(a!, 5) }, mark: 'b' });
    h.run('mark.toggle', { range: { anchor: at(a!, 6), head: at(a!, 10) }, mark: 'i' });
    expect(undo.undo()).toBe(true);
    expect(h.delta(a!)).toEqual([{ insert: 'Alpha', attributes: { b: true } }, { insert: ' beta' }]);
    expect(undo.undo()).toBe(true);
    expect(h.delta(a!)).toEqual([{ insert: 'Alpha beta' }]);
    expect(undo.canUndo()).toBe(false);
  });

  it('splits into a new step when the origin kind changes even with a matching groupKey and no pause', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'a' }, 'local-typing', 'g');
    h.run('text.insert', { at: at(a!, 1), text: 'b' }, 'ai-suggestion', 'g');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('splits into a new step when the groupKey changes to a different defined key with no pause', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'a' }, 'local-typing', 'g1');
    h.run('text.insert', { at: at(a!, 1), text: 'b' }, 'local-typing', 'g2');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('splits into a new step when a groupKey ends (next op is ungrouped) with no pause', () => {
    const h = commandHarness();
    const [a] = h.replaceBody([['st_action', '']]);
    const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
    h.run('text.insert', { at: at(a!, 0), text: 'a' }, 'local-typing', 'g1');
    h.run('text.insert', { at: at(a!, 1), text: 'b' }, 'local-typing');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(h.textMap(a!).toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('every core mutating command undoes to an identical document and redoes back', () => {
    const cases: [string, (ids: string[]) => unknown][] = [
      ['text.insert', ([a]) => ({ at: at(a!, 2), text: 'zz' })],
      ['text.deleteRange', ([a, b]) => ({ range: { anchor: at(a!, 2), head: at(b!, 1) } })],
      ['text.deleteBackward', ([, b]) => ({ at: at(b!, 0), unit: 'char' })],
      ['text.transformCase', ([a]) => ({ range: { anchor: at(a!, 0), head: at(a!, 4) }, to: 'upper' })],
      ['element.split', ([a]) => ({ at: at(a!, 3) })],
      ['element.setStyle', ([a]) => ({ elements: [a], style: 'st_character' })],
      ['element.move', ([a, b]) => ({ elements: [a], to: { after: b } })],
      ['element.duplicate', ([a]) => ({ elements: [a] })],
      ['element.setOverride', ([a]) => ({ elements: [a], key: 'align', value: 'center' })],
      ['mark.toggle', ([a]) => ({ range: { anchor: at(a!, 0), head: at(a!, 3) }, mark: 'i' })],
      ['entity.create', () => ({ kind: 'character', name: 'NEW' })],
      ['smartType.addEntry', () => ({ list: 'times', text: 'DUSK' })],
    ];
    for (const [id, params] of cases) {
      const h = commandHarness();
      const rows = h.replaceBody([['st_action', 'Alpha beta'], ['st_action', 'gamma']]);
      const undo = createSessionUndo(h.doc, h.origins, { clock: h.now });
      const before = JSON.stringify(documentToJSON(h.doc));
      const r = h.run(id, params(rows));
      expect(r.ok, id).toBe(true);
      const after = JSON.stringify(documentToJSON(h.doc));
      expect(undo.undo(), id).toBe(true);
      expect(JSON.stringify(documentToJSON(h.doc)), id).toBe(before);
      expect(undo.redo(), id).toBe(true);
      expect(JSON.stringify(documentToJSON(h.doc)), id).toBe(after);
    }
  });
});
