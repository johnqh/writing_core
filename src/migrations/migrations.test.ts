import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { createDocument } from '../model/create.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { DOC_SCHEMA_VERSION, type MigrationStep, isNewerThanCode, migrateDocument } from './index.js';

const addFlag: MigrationStep = {
  id: 'm0002-test-flag',
  from: 1,
  to: 2,
  isApplied: (doc) => doc.getMap('settings').get('testFlag') === true,
  apply: (doc) => doc.getMap('settings').set('testFlag', true),
};

const fresh = () => createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(1) });

describe('migrateDocument', () => {
  it('is current for a new document', () => {
    expect(DOC_SCHEMA_VERSION).toBe(1);
    expect(migrateDocument(fresh(), { by: 'server', codeVersion: '1.0.0' }).status).toBe('current');
  });

  it('applies steps in order and records them', () => {
    const doc = fresh();
    const r = migrateDocument(doc, { by: 'server', codeVersion: '1.1.0', steps: [addFlag], targetVersion: 2, clock: () => 7 });
    expect(r).toEqual({ status: 'migrated', from: 1, to: 2, applied: ['m0002-test-flag'] });
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
    expect((doc.getMap('meta').get('migrations') as Y.Map<unknown>).get('m0002-test-flag')).toEqual({ at: 7, by: 'server', codeVersion: '1.1.0' });
  });

  it('is idempotent twice and across concurrently migrating replicas', () => {
    const a = fresh();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    migrateDocument(a, { by: 'server', codeVersion: '1', steps: [addFlag], targetVersion: 2, clock: () => 1 });
    migrateDocument(b, { by: 'client', codeVersion: '1', steps: [addFlag], targetVersion: 2, clock: () => 1 });
    expect(migrateDocument(a, { by: 'server', codeVersion: '1', steps: [addFlag], targetVersion: 2 }).status).toBe('current');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getMap('settings').toJSON()).toEqual(b.getMap('settings').toJSON());
    expect(a.getMap('meta').get('schemaVersion')).toBe(2);
  });

  it('refuses to touch a document newer than the code', () => {
    const doc = fresh();
    doc.getMap('meta').set('schemaVersion', 5);
    expect(isNewerThanCode(doc)).toBe(true);
    expect(migrateDocument(doc, { by: 's', codeVersion: '1' })).toEqual({ status: 'newer', from: 5, to: 1, applied: [] });
  });

  it('throws when a step chain has a gap', () => {
    expect(() => migrateDocument(fresh(), { by: 's', codeVersion: '1', steps: [{ ...addFlag, from: 2, to: 3 }], targetVersion: 3 })).toThrow(/no migration from version 1/);
  });
});
