export interface Actor {
  userId: string;
  displayName: string;
  color: string;
  kind: 'human' | 'ai' | 'mcp' | 'system';
}

export const SYSTEM_ACTOR: Actor = Object.freeze({ userId: 'system', displayName: 'Fadewright', color: '#000000', kind: 'system' });

export type SystemOriginName = 'create' | 'repair' | 'rebalance' | 'migrate' | 'applyTemplate' | 'fromJSON' | 'ai';
export interface SystemOrigin {
  readonly kind: 'system';
  readonly name: SystemOriginName;
  readonly actor: Actor;
}

const cache = new Map<SystemOriginName, SystemOrigin>();

/** Identity-stable so Y.UndoManager and listeners can compare origins by reference. */
export function systemOrigin(name: SystemOriginName): SystemOrigin {
  let origin = cache.get(name);
  if (!origin) {
    origin = Object.freeze({ kind: 'system', name, actor: SYSTEM_ACTOR });
    cache.set(name, origin);
  }
  return origin;
}
