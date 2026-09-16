import * as Y from 'yjs';
import { sortedRecords } from '../model/ymap.js';

export function readCollection<T extends { id: string; pos?: string }>(doc: Y.Doc, key: string, read: (m: Y.Map<unknown>) => T): T[] {
  return sortedRecords([...doc.getMap<unknown>(key).values()].filter((v): v is Y.Map<unknown> => v instanceof Y.Map).map(read));
}
