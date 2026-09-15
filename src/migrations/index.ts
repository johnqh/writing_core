import * as Y from 'yjs';
import { systemOrigin } from '../model/origins.js';

export const DOC_SCHEMA_VERSION = 1;

export interface MigrationStep {
  id: string;
  from: number;
  to: number;
  /** Postcondition check: a step that already holds does nothing (spec 01 §8). */
  isApplied(doc: Y.Doc): boolean;
  /** Writes only deterministic values; created records use deterministicId. */
  apply(doc: Y.Doc): void;
}

/** Released steps are never edited; fix a bad step with a later step. */
export const MIGRATION_STEPS: readonly MigrationStep[] = [];

export type MigrationStatus = 'current' | 'migrated' | 'newer';
export interface MigrationResult {
  status: MigrationStatus;
  from: number;
  to: number;
  applied: string[];
}

const versionOf = (doc: Y.Doc) => (doc.getMap('meta').get('schemaVersion') as number | undefined) ?? 1;

export function isNewerThanCode(doc: Y.Doc, targetVersion = DOC_SCHEMA_VERSION): boolean {
  return versionOf(doc) > targetVersion;
}

export function migrateDocument(
  doc: Y.Doc,
  options: { by: string; codeVersion: string; clock?: () => number; steps?: readonly MigrationStep[]; targetVersion?: number },
): MigrationResult {
  const steps = options.steps ?? MIGRATION_STEPS;
  const target = options.targetVersion ?? DOC_SCHEMA_VERSION;
  const clock = options.clock ?? Date.now;
  const from = versionOf(doc);
  if (from > target) return { status: 'newer', from, to: target, applied: [] };
  const applied: string[] = [];
  let version = from;
  while (version < target) {
    const step = steps.find((s) => s.from === version);
    if (!step) throw new Error(`no migration from version ${version} (target ${target})`);
    doc.transact(() => {
      const meta = doc.getMap<unknown>('meta');
      let migrations = meta.get('migrations') as Y.Map<unknown> | undefined;
      if (!migrations) migrations = meta.set('migrations', new Y.Map<unknown>());
      if (!step.isApplied(doc)) step.apply(doc);
      if (!migrations.has(step.id)) migrations.set(step.id, { at: clock(), by: options.by, codeVersion: options.codeVersion });
      meta.set('schemaVersion', step.to);
    }, systemOrigin('migrate'));
    applied.push(step.id);
    version = step.to;
  }
  return { status: applied.length > 0 ? 'migrated' : 'current', from, to: version, applied };
}
