/**
 * Spec 02 §31.2 (M2 task 31): the paragraph cache. `layoutParagraph` (`paragraph.ts`) already builds
 * the per-paragraph `cacheKey` — every ingredient the spec names except `effectiveStyleHash` (added
 * here, folded into `paragraph.ts`'s own key via `ParagraphInput.styleHash`, since `style.id` alone
 * does not distinguish two elements sharing a style id with different `ov` overrides) — this module is
 * the actual bounded store: get/set, byte-size accounting and LRU-with-pinning eviction.
 */
import { canonicalJSON } from '../hash/canonical-json.js';
import { sha256Hex } from '../hash/sha256.js';
import type { ResolvedStyle } from '../template/resolve.js';
import type { ParagraphCache, ParagraphLayout } from './paragraph.js';

/** §31.2 `effectiveStyleHash`: the fully resolved style (inheritance + `ov` + `paginateAs` already applied). */
export function effectiveStyleHash(style: ResolvedStyle): string {
  return sha256Hex(canonicalJSON(style as unknown as Record<string, unknown>));
}

/** A rough, deterministic byte estimate: dominated by a paragraph's glyph runs' strings and typed arrays. */
export function estimateParagraphBytes(p: ParagraphLayout): number {
  let n = 96;
  for (const line of p.lines) {
    n += 64;
    for (const run of line.runs) {
      n += 128 + run.text.length * 2 + run.clusters.byteLength + run.clusterAdvances.byteLength + run.clusterSource.byteLength;
      if (run.glyphs) n += run.glyphs.ids.byteLength + run.glyphs.clusterOfGlyph.byteLength + run.glyphs.advances.byteLength + run.glyphs.offsets.byteLength;
    }
  }
  return n;
}

/** §31.2's own bound: `min(60 MB, the document's §33 memory budget − the live result's size)`. */
export function paragraphCacheBound(memoryBudgetBytes: number, liveResultBytes: number): number {
  const HARD_CAP = 60 * 1024 * 1024;
  return Math.max(0, Math.min(HARD_CAP, memoryBudgetBytes - liveResultBytes));
}

export interface SizedParagraphCache extends ParagraphCache {
  /** Total estimated bytes currently held. */
  size(): number;
  /** How many entries. */
  count(): number;
  /** Marks these elements' entries as "on or near visible pages" (evicted last); replaces any previous set. */
  pin(elementIds: Iterable<string>): void;
  clear(): void;
}

interface Entry { value: ParagraphLayout; bytes: number; pinned: boolean }

/**
 * An LRU bounded by bytes (not entry count). Recency is insertion order in the underlying `Map` (a
 * `get` hit deletes-and-reinserts its entry, moving it to the back); eviction walks from the front,
 * skipping pinned entries first, then — only if the cache is still over budget with everything
 * pinned — evicting the least-recently-used pinned ones too (the pin is a preference, not a promise
 * that outlasts the cache's own hard ceiling).
 */
export function createParagraphCache(maxBytes: number): SizedParagraphCache {
  const entries = new Map<string, Entry>();
  let bytes = 0;
  let pinned = new Set<string>();

  const evictPass = (skipPinned: boolean): void => {
    for (const [key, entry] of entries) {
      if (bytes <= maxBytes) return;
      if (skipPinned && entry.pinned) continue;
      entries.delete(key);
      bytes -= entry.bytes;
    }
  };

  return {
    get(key) {
      const e = entries.get(key);
      if (!e) return undefined;
      entries.delete(key);
      entries.set(key, e);
      return e.value;
    },
    set(key, value) {
      const existing = entries.get(key);
      if (existing) bytes -= existing.bytes;
      const size = estimateParagraphBytes(value);
      entries.set(key, { value, bytes: size, pinned: pinned.has(value.elementId) });
      bytes += size;
      if (bytes > maxBytes) {
        evictPass(true);
        evictPass(false);
      }
    },
    size: () => bytes,
    count: () => entries.size,
    pin(elementIds) {
      pinned = new Set(elementIds);
      for (const e of entries.values()) e.pinned = pinned.has(e.value.elementId);
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
  };
}
