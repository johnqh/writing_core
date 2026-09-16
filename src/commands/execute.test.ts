import * as Y from 'yjs';
import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import type { ElementId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { executeBatch, executeCommand } from './execute.js';
import { createSessionOrigins, TransactionOrigin } from './origin.js';
import { getCommand, registerCommand } from './registry.js';

const actor = { userId: 'u1', displayName: 'U', color: '#123456', kind: 'human' as const };
const ids = createSeededIdSource(62);

registerCommand({
  id: 'test.append', params: z.object({ elementId: z.string(), text: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'normal', labelKey: 'writing.command.test.append',
  isEnabled: (ctx, p) => (ctx.doc.getMap('elements').has(p.elementId) ? { enabled: true } : { enabled: false, reason: 'notFound' }),
  run(ctx, p) {
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, p.text);
    return { ok: true };
  },
}, ['test.appendLegacy']);
registerCommand({
  id: 'test.refuse', params: z.object({}), scope: 'document', mutates: true, requires: ['write'], undo: 'normal',
  labelKey: 'writing.command.test.refuse', isEnabled: () => ({ enabled: true }), run: () => ({ ok: false, reason: 'notApplicable' }),
});

function setup() {
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  const id = [...doc.getMap('elements').keys()][0] as ElementId;
  const origins = createSessionOrigins(actor);
  const base = { doc, model, actor, origin: origins.make('local-command'), capabilities: new Set(['write'] as const), ids };
  const textOf = () => ((doc.getMap('elements').get(id) as Y.Map<unknown>).get('text') as Y.Text).toString();
  return { doc, model, id, base, textOf, origins };
}

describe('executeCommand', () => {
  it('runs a command in one transaction carrying the origin', () => {
    const { doc, id, base, textOf } = setup();
    let seen: unknown;
    doc.on('afterTransaction', (tx: Y.Transaction) => { seen = tx.origin; });
    const r = executeCommand({ ...base, command: { id: 'test.append', params: { elementId: id, text: 'INT.' } } });
    expect(r).toMatchObject({ ok: true, effects: { changed: [id] } });
    expect(textOf()).toBe('INT.');
    expect(seen).toBe(base.origin);
    expect((seen as TransactionOrigin).actor.userId).toBe('u1');
  });
  it('resolves aliases and refuses unknown commands, bad params, missing capabilities and read-only documents', () => {
    const { id, base } = setup();
    expect(getCommand('test.appendLegacy')!.id).toBe('test.append');
    expect(executeCommand({ ...base, command: { id: 'nope.nope', params: {} } })).toMatchObject({ ok: false, reason: 'unknownCommand' });
    expect(executeCommand({ ...base, command: { id: 'test.append', params: { elementId: id } } })).toMatchObject({ ok: false, reason: 'invalidParams' });
    expect(executeCommand({ ...base, capabilities: new Set(), command: { id: 'test.append', params: { elementId: id, text: 'x' } } })).toMatchObject({ ok: false, reason: 'capabilityMissing' });
    expect(executeCommand({ ...base, readOnly: true, command: { id: 'test.append', params: { elementId: id, text: 'x' } } })).toMatchObject({ ok: false, reason: 'readOnly' });
    expect(executeCommand({ ...base, command: { id: 'test.append', params: { elementId: 'el_01ARYZ6S410000000000000000', text: 'x' } } })).toMatchObject({ ok: false, reason: 'notFound' });
  });
  it('rejects stale expected hashes', () => {
    const { id, base, model } = setup();
    const hash = model.elementContentHash(id);
    executeCommand({ ...base, command: { id: 'test.append', params: { elementId: id, text: 'A' } } });
    expect(executeCommand({ ...base, expectedHashes: { [id]: hash }, command: { id: 'test.append', params: { elementId: id, text: 'B' } } }))
      .toMatchObject({ ok: false, reason: 'contentChanged', detail: { elementIds: [id] } });
  });
});

describe('executeBatch', () => {
  it('applies all or nothing', () => {
    const { id, base, textOf } = setup();
    const r = executeBatch({ ...base, commands: [{ id: 'test.append', params: { elementId: id, text: 'A' } }, { id: 'test.refuse', params: {} }] });
    expect(r).toEqual({ ok: false, index: 1, reason: 'notApplicable' });
    expect(textOf()).toBe('');
    const ok = executeBatch({ ...base, commands: [{ id: 'test.append', params: { elementId: id, text: 'A' } }, { id: 'test.append', params: { elementId: id, text: 'B' } }] });
    expect(ok.ok).toBe(true);
    expect(textOf()).toBe('AB');
  });
  it('dry runs report effects without writing', () => {
    const { id, base, textOf, model } = setup();
    const r = executeBatch({ ...base, dryRun: true, commands: [{ id: 'test.append', params: { elementId: id, text: 'Z' } }] });
    expect(r.ok && r.effects.changed).toEqual([id]);
    expect(r.ok && r.effects.hashes[id]).not.toBe(model.elementContentHash(id));
    expect(textOf()).toBe('');
  });
  it('marks tracked origins with the per-session class', () => {
    const { origins } = setup();
    expect(origins.make('local-typing')).toBeInstanceOf(origins.Tracked);
    expect(origins.make('mcp')).not.toBeInstanceOf(origins.Tracked);
    expect(createSessionOrigins(actor).make('local-typing')).not.toBeInstanceOf(origins.Tracked);
  });
});
