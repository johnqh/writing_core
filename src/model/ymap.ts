import * as Y from 'yjs';
import type { DocTopLevelKey } from '../schema/document.js';
import { comparePositions } from './positions.js';

export function getMap(doc: Y.Doc, key: DocTopLevelKey): Y.Map<unknown> {
  return doc.getMap(key);
}

/** A flat Y.Map whose values are plain JSON (concurrent edits of different fields merge). */
export function setJSONMap(parent: Y.Map<unknown>, key: string, value: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  parent.set(key, map);
  for (const [k, v] of Object.entries(value)) if (v !== undefined) map.set(k, v);
  return map;
}

export function readJSONMap<T>(map: Y.Map<unknown>): T {
  return map.toJSON() as T;
}

export function childMap(map: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const child = map.get(key);
  if (!(child instanceof Y.Map)) throw new Error(`expected Y.Map at ${key}`);
  return child as Y.Map<unknown>;
}

/** Y.Map records of a keyed collection in document order (`pos`, then id). */
export function orderElements(map: Y.Map<unknown>): Y.Map<unknown>[] {
  return [...map.values()]
    .filter((v): v is Y.Map<unknown> => v instanceof Y.Map)
    .sort((a, b) => {
      const byPos = comparePositions(String(a.get('pos') ?? ''), String(b.get('pos') ?? ''));
      return byPos !== 0 ? byPos : String(a.get('id')) < String(b.get('id')) ? -1 : 1;
    });
}

/** Greatest `pos` among a map's records (Y.Map records or plain `{ pos }` JSON values). */
export function lastPosition(map: Y.Map<unknown>): string | null {
  let last: string | null = null;
  for (const v of map.values()) {
    const pos = v instanceof Y.Map ? v.get('pos') : (v as { pos?: unknown } | null)?.pos;
    if (typeof pos === 'string' && (last === null || comparePositions(pos, last) > 0)) last = pos;
  }
  return last;
}

export function sortedRecords<T extends { id: string; pos?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.pos !== undefined && b.pos !== undefined && a.pos !== b.pos ? comparePositions(a.pos, b.pos) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
