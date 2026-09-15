import * as Y from 'yjs';

export type YMap = Y.Map<unknown>;

/** Every `[key, record]` entry of a collection map whose value is itself a Y.Map (skips tombstones/scalars). */
export const records = (map: YMap): [string, YMap][] => [...map.entries()].filter((e): e is [string, YMap] => e[1] instanceof Y.Map);

/** Membership check against a closed-vocabulary role/kind list, tolerant of a `null` value (e.g. `roleOf` finding no role). */
export const has = <T extends readonly string[]>(list: T, v: string | null): boolean => v !== null && (list as readonly string[]).includes(v);
