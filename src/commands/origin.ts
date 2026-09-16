import type { Actor } from '../model/origins.js';

export const ORIGIN_KINDS = [
  'local-typing', 'local-command', 'remote', 'undo', 'redo', 'ai-suggestion', 'mcp', 'api', 'import', 'snapshot-open', 'normalizer', 'system',
] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export const TRACKED_ORIGIN_KINDS = ['local-typing', 'local-command', 'ai-suggestion'] as const satisfies readonly OriginKind[];

type OriginFields = Partial<Pick<TransactionOrigin, 'commandId' | 'groupKey' | 'batchId' | 'suggestionSetId' | 'suggestionId'>>;

export class TransactionOrigin {
  readonly commandId?: string;
  readonly groupKey?: string;
  readonly batchId?: string;
  readonly suggestionSetId?: string;
  readonly suggestionId?: string;

  constructor(readonly kind: OriginKind, readonly actor: Actor, fields: OriginFields = {}) {
    Object.assign(this, fields);
    Object.freeze(this);
  }
}

export function createSessionOrigins(actor: Actor) {
  /** A distinct subclass per session: Y.UndoManager tracks exactly this session's undoable origins. */
  class Tracked extends TransactionOrigin {}
  return {
    Tracked,
    make(kind: OriginKind, fields: OriginFields = {}): TransactionOrigin {
      return (TRACKED_ORIGIN_KINDS as readonly string[]).includes(kind) ? new Tracked(kind, actor, fields) : new TransactionOrigin(kind, actor, fields);
    },
  };
}
