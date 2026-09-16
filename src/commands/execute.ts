import * as Y from 'yjs';
import type { ContentHash } from '../hash/content.js';
import type { IdSource } from '../ids/id-source.js';
import { newId } from '../ids/ids.js';
import type { Actor } from '../model/origins.js';
import { type DocumentModel, openDocument } from '../read-model/open.js';
import type { ModelChangeBatch } from '../read-model/views.js';
import type { TransactionOrigin } from './origin.js';
import { getCommand } from './registry.js';
import type { Capability, CommandContext, CommandInvocation, CommandResult, ReasonCode } from './types.js';

export interface BatchRequest {
  doc: Y.Doc;
  model: DocumentModel;
  commands: readonly CommandInvocation[];
  actor: Actor;
  origin: TransactionOrigin;
  capabilities: ReadonlySet<Capability>;
  ids: IdSource;
  clock?: () => number;
  expectedHashes?: Readonly<Record<string, ContentHash>>;
  dryRun?: boolean;
  readOnly?: boolean;
}

export type BatchResult =
  | { ok: true; results: CommandResult[]; effects: { inserted: string[]; removed: string[]; changed: string[]; hashes: Record<string, ContentHash> } }
  | { ok: false; index: number; reason: ReasonCode; detail?: Record<string, unknown> };

type Prepared = { spec: NonNullable<ReturnType<typeof getCommand>>; params: unknown };

function prepare(req: BatchRequest): { ok: true; prepared: Prepared[] } | Extract<BatchResult, { ok: false }> {
  const prepared: Prepared[] = [];
  for (const [index, inv] of req.commands.entries()) {
    const spec = getCommand(inv.id);
    if (!spec) return { ok: false, index, reason: 'unknownCommand', detail: { id: inv.id } };
    const parsed = spec.params.safeParse(inv.params);
    if (!parsed.success) return { ok: false, index, reason: 'invalidParams', detail: { issues: parsed.error.issues } };
    if (spec.mutates && req.readOnly) return { ok: false, index, reason: 'readOnly' };
    const missing = spec.requires.filter((c) => !req.capabilities.has(c));
    if (missing.length > 0) return { ok: false, index, reason: 'capabilityMissing', detail: { missing } };
    prepared.push({ spec, params: parsed.data });
  }
  if (req.expectedHashes) {
    const stale = Object.entries(req.expectedHashes)
      .filter(([id, hash]) => !req.model.element(id as never) || req.model.elementContentHash(id as never) !== hash)
      .map(([id]) => id);
    if (stale.length > 0) return { ok: false, index: -1, reason: 'contentChanged', detail: { elementIds: stale } };
  }
  return { ok: true, prepared };
}

function run(req: BatchRequest, doc: Y.Doc, model: DocumentModel, prepared: Prepared[], clock: () => number): BatchResult {
  const results: CommandResult[] = [];
  const inserted = new Set<string>();
  const removed = new Set<string>();
  const changed = new Set<string>();
  // Asserted so control-flow analysis does not narrow it to `null` across the transact callback.
  let failure = null as Extract<BatchResult, { ok: false }> | null;
  const unsubscribe = model.subscribe((batch: ModelChangeBatch) => {
    for (const c of batch.changes) {
      if (c.kind !== 'elements') continue;
      c.inserted.forEach((id) => inserted.add(id));
      c.removed.forEach((id) => removed.add(id));
      c.changed.forEach((id) => changed.add(id));
    }
  });
  try {
    doc.transact(() => {
      for (const [index, { spec, params }] of prepared.entries()) {
        const ctx: CommandContext = {
          doc, model, actor: req.actor, origin: req.origin, capabilities: req.capabilities, ids: req.ids, clock,
          changeId: newId('chg', req.ids), readOnly: req.readOnly ?? false,
        };
        const availability = spec.isEnabled(ctx, params);
        if (!availability.enabled) {
          failure = { ok: false, index, reason: availability.reason };
          return;
        }
        const result = spec.run(ctx, params);
        if (!result.ok) {
          failure = { ok: false, index, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
          return;
        }
        results.push(result);
      }
    }, req.origin);
  } finally {
    unsubscribe();
  }
  if (failure) return failure;
  const hashes: Record<string, ContentHash> = {};
  for (const id of new Set([...inserted, ...changed])) {
    if (!removed.has(id) && model.element(id as never)) hashes[id] = model.elementContentHash(id as never);
  }
  return {
    ok: true,
    results,
    effects: {
      inserted: [...inserted].filter((id) => !removed.has(id)).sort(),
      removed: [...removed].sort(),
      changed: [...changed].filter((id) => !inserted.has(id) && !removed.has(id)).sort(),
      hashes,
    },
  };
}

function rehearse(req: BatchRequest, prepared: Prepared[], clock: () => number): BatchResult {
  const replica = new Y.Doc({ gc: false });
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(req.doc));
  const model = openDocument(replica, req.model.deps);
  // Rehearsal mints ids too (a command's `run` may call `ctx.ids`, and `run()` always
  // mints one `changeId`). Forking here means the rehearsal pass draws from a throwaway
  // copy of the id stream, so it can never advance `req.ids`: the real apply that follows
  // mints exactly the ids it would have minted had rehearsal not run at all.
  const rehearsalReq: BatchRequest = { ...req, ids: req.ids.fork() };
  try {
    return run(rehearsalReq, replica, model, prepared, clock);
  } finally {
    model.dispose();
    replica.destroy();
  }
}

export function executeBatch(req: BatchRequest): BatchResult {
  const p = prepare(req);
  if (!p.ok) return p;
  // Resolved once so a rehearsal pass and the real apply always see the same
  // instant (spec 08 §3.3 item 4) — a clock-gated command must not be able to
  // pass rehearsal and then fail (or behave differently) for the real apply.
  const now = (req.clock ?? Date.now)();
  const clock = (): number => now;
  if (req.dryRun) return rehearse(req, p.prepared, clock);
  // Single commands rehearse by default, same as multi-command batches: a
  // command that writes and then refuses must not leave a partial write
  // committed. `fastPath` opts a single command out of the extra replica
  // clone for the typing hot path; it never applies to a multi-command batch.
  const singleFastPath = p.prepared.length === 1 && p.prepared[0]!.spec.fastPath === true;
  if (!singleFastPath) {
    const rehearsal = rehearse(req, p.prepared, clock);
    if (!rehearsal.ok) return rehearsal;
  }
  return run(req, req.doc, req.model, p.prepared, clock);
}

export function executeCommand(req: Omit<BatchRequest, 'commands'> & { command: CommandInvocation }): BatchResult {
  const { command, ...rest } = req;
  return executeBatch({ ...rest, commands: [command] });
}
