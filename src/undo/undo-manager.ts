import * as Y from 'yjs';
import { getCommand } from '../commands/registry.js';
import type { TransactionOrigin } from '../commands/origin.js';
import { DOC_TOP_LEVEL_KEYS } from '../schema/document.js';

export const UNDO_CLEAR_REASONS = ['undoClearedBySnapshotOpen', 'undoClearedByUser'] as const;
export type UndoClearReason = (typeof UNDO_CLEAR_REASONS)[number];

export interface SessionUndo {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  noteCaret(elementId: string | null): void;
  clear(reason: UndoClearReason): void;
  readonly lastClearReason: UndoClearReason | null;
  onStackItemAdded(listener: (event: { stackItem: { meta: Map<string, unknown> }; type: 'undo' | 'redo' }) => void): () => void;
  destroy(): void;
}

export function createSessionUndo(
  doc: Y.Doc,
  origins: { Tracked: abstract new (...args: never[]) => TransactionOrigin },
  options: { clock?: () => number; captureMs?: number } = {},
): SessionUndo {
  const clock = options.clock ?? Date.now;
  const captureMs = options.captureMs ?? 500;
  const scope = DOC_TOP_LEVEL_KEYS.map((k) => doc.getMap<unknown>(k));
  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set<unknown>([origins.Tracked]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });

  let last: { kind: string; groupKey: string | undefined; at: number; caret: string | null } | null = null;
  let caret: string | null = null;
  let caretMoved = false;
  let lastClearReason: UndoClearReason | null = null;

  const isTracked = (origin: unknown): origin is TransactionOrigin => origin instanceof origins.Tracked;

  const before = (tx: Y.Transaction) => {
    if (!isTracked(tx.origin)) return;
    const o = tx.origin;
    const now = clock();
    const standalone = o.commandId ? getCommand(o.commandId)?.undo === 'standalone' : false;
    const newStep =
      last === null ||
      standalone ||
      last.kind !== o.kind ||
      (o.kind === 'local-command' && !o.groupKey) ||
      (o.groupKey !== undefined && o.groupKey !== last.groupKey) ||
      (o.groupKey === undefined && last.groupKey !== undefined) ||
      (o.groupKey === undefined && now - last.at >= captureMs) ||
      caretMoved;
    if (newStep) manager.stopCapturing();
    caretMoved = false;
    last = { kind: o.kind, groupKey: o.groupKey, at: now, caret };
  };

  const after = (tx: Y.Transaction) => {
    if (!isTracked(tx.origin)) return;
    const o = tx.origin;
    if (o.commandId && getCommand(o.commandId)?.undo === 'standalone') {
      manager.stopCapturing();
      last = null;
    }
  };

  doc.on('beforeTransaction', before);
  doc.on('afterTransaction', after);

  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    noteCaret(elementId) {
      if (elementId !== caret) caretMoved = last !== null;
      caret = elementId;
    },
    clear(reason) {
      manager.clear();
      last = null;
      lastClearReason = reason;
    },
    get lastClearReason() {
      return lastClearReason;
    },
    onStackItemAdded(listener) {
      const handler = (event: { stackItem: { meta: Map<string, unknown> }; type: 'undo' | 'redo' }) => listener(event);
      manager.on('stack-item-added', handler as never);
      return () => manager.off('stack-item-added', handler as never);
    },
    destroy() {
      doc.off('beforeTransaction', before);
      doc.off('afterTransaction', after);
      manager.destroy();
    },
  };
}
