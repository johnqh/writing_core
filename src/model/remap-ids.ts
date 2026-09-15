import type { IdSource } from '../ids/id-source.js';
import { type DocId, type IdPrefix, idKind, newId } from '../ids/ids.js';
import type { DocumentJSON } from '../schema/document.js';

/** Prefixes scoped to one document (spec 01 §2.2); global records (assets, jobs, snapshots, AI sets) keep their ids. */
export const REMAPPED_PREFIXES: ReadonlySet<IdPrefix> = new Set<IdPrefix>([
  'el', 'fld', 'ent', 'trt', 'cat', 'tag', 'note', 'rep', 'ntp', 'rev', 'chg', 'alt', 'sv', 'beat', 'lnk', 'col', 'stl',
  'lane', 'bin', 'shot', 'bm', 'plk', 'mac',
]);

const ID_TOKEN_RE = /[a-z]+_[0-9A-HJKMNP-TV-Z]{26}/g;

export function remapDocumentIds(json: DocumentJSON, ids: IdSource, docId: DocId): DocumentJSON {
  const table = new Map<string, string>();
  const mapToken = (token: string): string => {
    const kind = idKind(token);
    if (!kind || !REMAPPED_PREFIXES.has(kind)) return token;
    let next = table.get(token);
    if (!next) {
      next = newId(kind, ids);
      table.set(token, next);
    }
    return next;
  };
  // Strings may be a bare id or an anchor mark key such as "t:tag_…".
  const mapString = (s: string) => s.replace(ID_TOKEN_RE, mapToken);
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return mapString(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[mapString(k)] = walk(v);
      return out;
    }
    return value;
  };
  const { template, meta, ...rest } = json;
  const remapped = walk(rest) as Omit<DocumentJSON, 'template' | 'meta'>;
  return { ...remapped, template, meta: { ...meta, docId } };
}
