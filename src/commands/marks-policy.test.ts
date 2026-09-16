import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { newId, type ChangeId, type RevisionSetId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { createSessionOrigins } from './origin.js';
import { policyDelete, policyInsert, touchElement, writePolicy, type WritePolicy } from './marks-policy.js';
import type { CommandContext } from './types.js';

const REV = 'rev_01ARYZ6S410000000000000000' as RevisionSetId;
const CHG = 'chg_01ARYZ6S410000000000000000' as ChangeId;
const text = (content = '') => {
  const doc = new Y.Doc();
  const t = doc.getMap('m').set('t', new Y.Text());
  if (content) t.insert(0, content);
  return t;
};
const policy = (over: Partial<WritePolicy> = {}): WritePolicy => ({ revisionSetId: null, track: null, actorId: 'u1', now: 100, ...over });

describe('revision mode', () => {
  it('marks inserts and leaves a revDel embed for deleted old text', () => {
    const t = text('Hello world');
    const p = policy({ revisionSetId: REV });
    policyInsert(p, t, 5, ',', {});
    expect(t.toDelta()).toEqual([{ insert: 'Hello' }, { insert: ',', attributes: { rev: REV } }, { insert: ' world' }]);
    expect(policyDelete(p, t, 7, 5)).toEqual({ removed: 5, revDelInserted: true });
    expect(t.toDelta()).toEqual([{ insert: 'Hello' }, { insert: ',', attributes: { rev: REV } }, { insert: ' ' }, { insert: { type: 'revDel', rev: REV, by: 'u1', at: 100 } }]);
  });
  it('removes its own fresh revision without a trace', () => {
    const t = text('ab');
    const p = policy({ revisionSetId: REV });
    policyInsert(p, t, 1, 'XY', {});
    expect(policyDelete(p, t, 1, 2)).toEqual({ removed: 2, revDelInserted: false });
    expect(t.toDelta()).toEqual([{ insert: 'ab' }]);
  });
});

describe('track changes', () => {
  const track = { changeId: CHG, by: 'u1', at: 100 };
  it('keeps deleted text with a del mark and withdraws own insertions', () => {
    const t = text('Hello');
    const p = policy({ track });
    policyInsert(p, t, 5, '!', { b: true });
    expect(t.toDelta()).toEqual([{ insert: 'Hello' }, { insert: '!', attributes: { b: true, ins: track } }]);
    expect(policyDelete(p, t, 3, 3)).toEqual({ removed: 1, revDelInserted: false });
    expect(t.toDelta()).toEqual([{ insert: 'Hel' }, { insert: 'lo', attributes: { del: track } }]);
  });
  it('keeps another writer\'s insertion as a tracked deletion', () => {
    const t = text('');
    policyInsert(policy({ track: { ...track, by: 'u2' }, actorId: 'u2' }), t, 0, 'hi', {});
    policyDelete(policy({ track }), t, 0, 2);
    expect(t.toDelta()).toEqual([{ insert: 'hi', attributes: { ins: { ...track, by: 'u2' }, del: track } }]);
  });
  it('skips characters already marked del, leaving the original mark untouched', () => {
    const t = text('Hello');
    expect(policyDelete(policy({ track }), t, 3, 2)).toEqual({ removed: 0, revDelInserted: false });
    expect(t.toDelta()).toEqual([{ insert: 'Hel' }, { insert: 'lo', attributes: { del: track } }]);
    // A second delete over the same already-del span (e.g. by another writer) must not overwrite the original mark.
    const laterTrack = { changeId: CHG, by: 'u2', at: 200 };
    expect(policyDelete(policy({ track: laterTrack, actorId: 'u2' }), t, 3, 2)).toEqual({ removed: 0, revDelInserted: false });
    expect(t.toDelta()).toEqual([{ insert: 'Hel' }, { insert: 'lo', attributes: { del: track } }]);
  });
});

describe('writePolicy(ctx)', () => {
  const actor = { userId: 'u1', displayName: 'U', color: '#123456', kind: 'human' as const };

  function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
    const ids = createSeededIdSource(70);
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
    const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
    const origins = createSessionOrigins(actor);
    return {
      doc, model, actor, origin: origins.make('local-command'), capabilities: new Set(['write']),
      ids, clock: () => 100, changeId: newId('chg', ids), readOnly: false,
      ...overrides,
    };
  }

  it('yields no policy for an unmarked origin kind', () => {
    const ctx = makeCtx({ origin: createSessionOrigins(actor).make('remote') });
    expect(writePolicy(ctx)).toEqual({ revisionSetId: null, track: null, actorId: 'u1', now: 100 });
  });

  it('yields the active revision set id for a marked origin when revisions.mode is on', () => {
    const ctx = makeCtx();
    const sets = ctx.doc.getMap('revisions').get('sets') as Y.Map<unknown>;
    const setId = [...sets.keys()][0] as string;
    ctx.doc.getMap('revisions').set('mode', true);
    ctx.doc.getMap('revisions').set('activeSetId', setId);
    expect(writePolicy(ctx)).toEqual({ revisionSetId: setId, track: null, actorId: 'u1', now: 100 });
  });

  it('yields a track record when trackChanges.enabled is on', () => {
    const ctx = makeCtx();
    ctx.doc.getMap('trackChanges').set('enabled', true);
    expect(writePolicy(ctx)).toEqual({ revisionSetId: null, track: { changeId: ctx.changeId, by: 'u1', at: 100 }, actorId: 'u1', now: 100 });
  });

  it('reads the real revisions/trackChanges keys, not lookalikes', () => {
    const ctx = makeCtx();
    // Setting anything under the wrong key names must not activate the policy —
    // this pins the exact key names `writePolicy` is documented to read.
    ctx.doc.getMap('revisions').set('active', true);
    ctx.doc.getMap('revisions').set('revisionMode', true);
    ctx.doc.getMap('trackChanges').set('on', true);
    ctx.doc.getMap('trackChanges').set('trackChangesEnabled', true);
    expect(writePolicy(ctx)).toEqual({ revisionSetId: null, track: null, actorId: 'u1', now: 100 });
    // Now flip the real keys and confirm the policy does react, proving the
    // assertion above is load-bearing rather than vacuously true.
    ctx.doc.getMap('revisions').set('mode', true);
    ctx.doc.getMap('revisions').set('activeSetId', 'rev_01ARYZ6S410000000000000000');
    ctx.doc.getMap('trackChanges').set('enabled', true);
    const policy = writePolicy(ctx);
    expect(policy.revisionSetId).toBe('rev_01ARYZ6S410000000000000000');
    expect(policy.track).toEqual({ changeId: ctx.changeId, by: 'u1', at: 100 });
  });
});

describe('touchElement', () => {
  it('updates editedBy at most every 10 seconds per user', () => {
    const doc = new Y.Doc();
    const el = doc.getMap('e');
    el.set('meta', { createdBy: 'a', createdAt: 0, editedBy: 'a', editedAt: 0 });
    touchElement(el, policy({ now: 20_000 }));
    expect(el.get('meta')).toMatchObject({ editedBy: 'u1', editedAt: 20_000 });
    touchElement(el, policy({ now: 25_000 }));
    expect((el.get('meta') as { editedAt: number }).editedAt).toBe(20_000);
    touchElement(el, policy({ now: 25_000, actorId: 'u2' }));
    expect(el.get('meta')).toMatchObject({ editedBy: 'u2', editedAt: 25_000 });
  });
});
