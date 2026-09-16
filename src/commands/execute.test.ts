import * as Y from 'yjs';
import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId, type ElementId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { executeBatch, executeCommand } from './execute.js';
import { createSessionOrigins, TransactionOrigin } from './origin.js';
import { getCommand, registerCommand } from './registry.js';

const actor = { userId: 'u1', displayName: 'U', color: '#123456', kind: 'human' as const };
const ids = createSeededIdSource(62);

let appendRunCount = 0;
registerCommand({
  id: 'test.append', params: z.object({ elementId: z.string(), text: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'normal', labelKey: 'writing.command.test.append',
  isEnabled: (ctx, p) => (ctx.doc.getMap('elements').has(p.elementId) ? { enabled: true } : { enabled: false, reason: 'notFound' }),
  run(ctx, p) {
    appendRunCount++;
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, p.text);
    return { ok: true };
  },
}, ['test.appendLegacy']);
registerCommand({
  id: 'test.refuse', params: z.object({}), scope: 'document', mutates: true, requires: ['write'], undo: 'normal',
  labelKey: 'writing.command.test.refuse', isEnabled: () => ({ enabled: true }), run: () => ({ ok: false, reason: 'notApplicable' }),
});
// A misbehaving command that writes and only then refuses — used to prove that
// single commands are rehearsed by default (finding A) and that `fastPath`
// skips that safety net.
registerCommand({
  id: 'test.writeThenRefuse', params: z.object({ elementId: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'normal', labelKey: 'writing.command.test.writeThenRefuse', isEnabled: () => ({ enabled: true }),
  run(ctx, p) {
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, 'LEAK');
    return { ok: false, reason: 'notApplicable' };
  },
});
registerCommand({
  id: 'test.fastWriteThenRefuse', params: z.object({ elementId: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'normal', labelKey: 'writing.command.test.fastWriteThenRefuse', fastPath: true,
  isEnabled: () => ({ enabled: true }),
  run(ctx, p) {
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, 'LEAK');
    return { ok: false, reason: 'notApplicable' };
  },
});
let fastAppendRunCount = 0;
registerCommand({
  id: 'test.fastAppend', params: z.object({ elementId: z.string(), text: z.string() }), scope: 'document', mutates: true,
  requires: ['write'], undo: 'normal', labelKey: 'writing.command.test.fastAppend', fastPath: true,
  isEnabled: (ctx, p) => (ctx.doc.getMap('elements').has(p.elementId) ? { enabled: true } : { enabled: false, reason: 'notFound' }),
  run(ctx, p) {
    fastAppendRunCount++;
    const text = (ctx.doc.getMap('elements').get(p.elementId) as Y.Map<unknown>).get('text') as Y.Text;
    text.insert(text.length, p.text);
    return { ok: true };
  },
});
// Records the ctx.clock() value it sees each time it runs, used to prove
// rehearsal and the real apply share one resolved clock value (finding B).
const clockSeen: number[] = [];
registerCommand({
  id: 'test.clockProbe', params: z.object({}), scope: 'document', mutates: false, requires: [], undo: 'none',
  labelKey: 'writing.command.test.clockProbe', isEnabled: () => ({ enabled: true }),
  run(ctx) {
    clockSeen.push(ctx.clock());
    return { ok: true };
  },
});

// Mints an id from ctx.ids and records it (appending, never overwriting), without otherwise
// touching the doc — used to prove a rehearsal pass never advances the real IdSource's
// stream (queued ruling C). Since a batch runs this command once per pass (rehearsal, then
// the real apply), appending to an array lets a single execution's two mints be told apart.
let mintedIds: string[] = [];
registerCommand({
  id: 'test.mintId', params: z.object({}), scope: 'document', mutates: true, requires: ['write'], undo: 'normal',
  labelKey: 'writing.command.test.mintId', fastPath: true, isEnabled: () => ({ enabled: true }),
  run(ctx) {
    mintedIds.push(newId('el', ctx.ids));
    return { ok: true };
  },
});
registerCommand({
  id: 'test.noop', params: z.object({}), scope: 'document', mutates: false, requires: [], undo: 'none',
  labelKey: 'writing.command.test.noop', isEnabled: () => ({ enabled: true }), run: () => ({ ok: true }),
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

  it('resolves the clock once and shares it between the rehearsal pass and the real apply', () => {
    const { id, base } = setup();
    clockSeen.length = 0;
    let ticks = 500;
    const clock = () => ticks++;
    const r = executeBatch({
      ...base,
      clock,
      commands: [{ id: 'test.append', params: { elementId: id, text: 'A' } }, { id: 'test.clockProbe', params: {} }],
    });
    expect(r.ok).toBe(true);
    // One push from the rehearsal pass, one from the real apply.
    expect(clockSeen).toHaveLength(2);
    expect(clockSeen[0]).toBe(clockSeen[1]);
  });
});

describe('single-command rehearsal (fastPath)', () => {
  it('rehearses a single command by default, so a command that writes then refuses leaves the document untouched', () => {
    const { id, base, textOf } = setup();
    const r = executeCommand({ ...base, command: { id: 'test.writeThenRefuse', params: { elementId: id } } });
    expect(r).toMatchObject({ ok: false, reason: 'notApplicable' });
    expect(textOf()).toBe('');
  });

  it('a fastPath command skips rehearsal: a write-then-refuse fastPath command leaks its write', () => {
    const { id, base, textOf } = setup();
    const r = executeCommand({ ...base, command: { id: 'test.fastWriteThenRefuse', params: { elementId: id } } });
    expect(r).toMatchObject({ ok: false, reason: 'notApplicable' });
    expect(textOf()).toBe('LEAK');
  });

  it('a well-behaved fastPath command still applies directly', () => {
    const { id, base, textOf } = setup();
    fastAppendRunCount = 0;
    const r = executeCommand({ ...base, command: { id: 'test.fastAppend', params: { elementId: id, text: 'F' } } });
    expect(r).toMatchObject({ ok: true });
    expect(textOf()).toBe('F');
    expect(fastAppendRunCount).toBe(1);
  });

  it('a non-fastPath single command runs twice (rehearsal + real), a fastPath one runs once', () => {
    const { id, base } = setup();
    appendRunCount = 0;
    executeCommand({ ...base, command: { id: 'test.append', params: { elementId: id, text: 'A' } } });
    expect(appendRunCount).toBe(2);
    fastAppendRunCount = 0;
    executeCommand({ ...base, command: { id: 'test.fastAppend', params: { elementId: id, text: 'F' } } });
    expect(fastAppendRunCount).toBe(1);
  });
});

describe('rehearsal and the id stream (queued ruling C)', () => {
  it('mints the same id for the rehearsal pass and the real apply within one execution', () => {
    // A 2-command batch always rehearses first (fastPath only exempts a solo single-command
    // batch), so `test.mintId` runs twice in this one executeBatch call: once against the
    // throwaway replica (via a forked IdSource) and once for the real apply (via the
    // original, unforked IdSource). Recording into an array — instead of overwriting a
    // scalar — lets us observe both mints from this single execution and compare them
    // directly, rather than inferring equivalence from two separately seeded programs.
    const ids = createSeededIdSource(4242);
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
    const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
    const origins = createSessionOrigins(actor);
    mintedIds = [];
    const r = executeBatch({
      doc, model, actor, origin: origins.make('local-command'),
      capabilities: new Set(['write'] as const), ids,
      commands: [{ id: 'test.mintId', params: {} }, { id: 'test.noop', params: {} }],
    });
    expect(r.ok).toBe(true);
    expect(mintedIds).toHaveLength(2);
    const [rehearsalMintedId, realMintedId] = mintedIds;
    expect(rehearsalMintedId).not.toBe('');
    expect(realMintedId).toBe(rehearsalMintedId);
  });

  it('a seeded IdSource assigns a command the same id whether or not it is rehearsed', () => {
    const actorForTest = actor;

    // Path 1: a single fastPath command — no rehearsal at all.
    const idsSolo = createSeededIdSource(4242);
    const docSolo = createDocument({ template: screenplayStandard, uid: 'u', ids: idsSolo });
    const modelSolo = openDocument(docSolo, { ids: idsSolo, clock: () => 0, locale: 'en' });
    const originsSolo = createSessionOrigins(actorForTest);
    mintedIds = [];
    executeCommand({
      doc: docSolo, model: modelSolo, actor: actorForTest, origin: originsSolo.make('local-command'),
      capabilities: new Set(['write'] as const), ids: idsSolo, command: { id: 'test.mintId', params: {} },
    });
    expect(mintedIds).toHaveLength(1);
    const idWithoutRehearsal = mintedIds[0];
    expect(idWithoutRehearsal).not.toBe('');

    // Path 2: the same command inside a 2-command batch, which always rehearses first —
    // starting from an identically seeded (and so far identically advanced) IdSource.
    const idsBatched = createSeededIdSource(4242);
    const docBatched = createDocument({ template: screenplayStandard, uid: 'u', ids: idsBatched });
    const modelBatched = openDocument(docBatched, { ids: idsBatched, clock: () => 0, locale: 'en' });
    const originsBatched = createSessionOrigins(actorForTest);
    mintedIds = [];
    const r = executeBatch({
      doc: docBatched, model: modelBatched, actor: actorForTest, origin: originsBatched.make('local-command'),
      capabilities: new Set(['write'] as const), ids: idsBatched,
      commands: [{ id: 'test.mintId', params: {} }, { id: 'test.noop', params: {} }],
    });
    expect(r.ok).toBe(true);
    const idWithRehearsal = mintedIds[mintedIds.length - 1];

    expect(idWithRehearsal).toBe(idWithoutRehearsal);
  });
});
