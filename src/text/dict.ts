/**
 * Southeast Asian dictionary word segmentation (spec 02 §6.4, task 9): Thai, Lao, Khmer and
 * Myanmar longest-matching segmentation over the ICU break-iterator dictionaries, compiled
 * to a compact DAWG by `scripts/build-dictionaries.ts` (see that file's header comment for
 * the construction algorithm, the serialized format, the license finding — the brief's
 * blanket "Unicode License v3" is wrong for two of the four files, `dict/LICENSES.md` has
 * the detail — and measured sizes vs spec 02 §6.4's approximate figures).
 *
 * **Laziness is load-bearing, not incidental (context item 5).** `loadDictionary` for any
 * language other than `th`/`lo`/`km`/`my` returns `null` *before* touching a single dynamic
 * `import()` expression — the `switch` below only ever evaluates the one `import()` whose
 * `case` actually matched, so a Latin-only screenplay's call graph never reaches any of the
 * four `./generated/dict-*.js` modules, which is exactly what `dict.test.ts` proves (with
 * `vi.doMock` throwing if a payload module is ever touched for `lang: 'en'`), not merely
 * asserts.
 */
import { nextCluster } from './grapheme.js';
import type { DictionarySegmenter } from './linebreak.js';

export type { DictionarySegmenter } from './linebreak.js';

// ─── Base64 decode (platform-free: no `atob`/`Buffer`, both forbidden in shipping src by
// src/__guards/platform-free.test.ts — see that guard's FORBIDDEN list). ──────────────────

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) t[B64_CHARS.charCodeAt(i)] = i;
  return t;
})();

function base64Decode(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 0x3d /* '=' */) len--;
  const out = new Uint8Array(Math.floor((len * 6) / 8));
  let o = 0;
  let bits = 0;
  let value = 0;
  for (let i = 0; i < len; i++) {
    const c = b64.charCodeAt(i);
    const v = c < 128 ? (B64_LOOKUP[c] as number) : -1;
    if (v < 0) continue; // tolerate stray whitespace, defensively
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >>> bits) & 0xff;
    }
  }
  return out;
}

// ─── DAWG decode (mirrors scripts/build-dictionaries.ts's `serializeDawg`) ─────────────────

interface DecodedDawg {
  nodeCount: number;
  rootId: number;
  wide: boolean;
  alphabet: Uint16Array; // sorted code points, index = transition char-index
  finalFlags: Uint8Array;
  childOffset: Uint32Array; // length nodeCount + 1, derived by prefix-summing childCount
  transCharIdx: Uint8Array;
  transTarget16: Uint16Array | null;
  transTarget32: Uint32Array | null;
}

function decodeDawg(bytes: Uint8Array): DecodedDawg {
  // header: 5 x u32 (nodeCount, transitionCount, rootId, wideFlag, alphabetLen)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nodeCount = dv.getUint32(0, true);
  const transitionCount = dv.getUint32(4, true);
  const rootId = dv.getUint32(8, true);
  const wide = dv.getUint32(12, true) === 1;
  const alphabetLen = dv.getUint32(16, true);
  let off = 20;

  const alphabet = new Uint16Array(alphabetLen);
  for (let i = 0; i < alphabetLen; i++) alphabet[i] = dv.getUint16(off + i * 2, true);
  off += alphabetLen * 2;

  const finalFlags = bytes.subarray(off, off + nodeCount);
  off += nodeCount;
  const childCount = bytes.subarray(off, off + nodeCount);
  off += nodeCount;

  const childOffset = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) childOffset[i + 1] = (childOffset[i] as number) + (childCount[i] as number);

  const transCharIdx = bytes.subarray(off, off + transitionCount);
  off += transitionCount;

  let transTarget16: Uint16Array | null = null;
  let transTarget32: Uint32Array | null = null;
  if (wide) {
    transTarget32 = new Uint32Array(transitionCount);
    for (let i = 0; i < transitionCount; i++) transTarget32[i] = dv.getUint32(off + i * 4, true);
  } else {
    transTarget16 = new Uint16Array(transitionCount);
    for (let i = 0; i < transitionCount; i++) transTarget16[i] = dv.getUint16(off + i * 2, true);
  }

  return { nodeCount, rootId, wide, alphabet, finalFlags, childOffset, transCharIdx, transTarget16, transTarget32 };
}

/** Binary search for `cp` in the sorted alphabet table; -1 if absent (character outside this dictionary's alphabet). */
function alphabetIndexOf(alphabet: Uint16Array, cp: number): number {
  let lo = 0;
  let hi = alphabet.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = alphabet[mid] as number;
    if (v === cp) return mid;
    if (v < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Binary search for `charIdx` among node `node`'s transitions (already sorted ascending by construction). Returns the target node id, or -1. */
function childOf(d: DecodedDawg, node: number, charIdx: number): number {
  let lo = d.childOffset[node] as number;
  let hi = (d.childOffset[node + 1] as number) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = d.transCharIdx[mid] as number;
    if (v === charIdx) return d.wide ? ((d.transTarget32 as Uint32Array)[mid] as number) : ((d.transTarget16 as Uint16Array)[mid] as number);
    if (v < charIdx) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function isFinalNode(d: DecodedDawg, node: number): boolean {
  return d.finalFlags[node] === 1;
}

/**
 * Longest-match segmentation over one decoded DAWG. At each position, walks the automaton
 * as far as possible, remembering the longest point at which a final (word-ending) node was
 * reached; consumes that many characters. When no dictionary entry matches at all (not even
 * length 1), falls back to consuming one grapheme cluster (spec 02 §6.4: "unknown sequences
 * fall back to grapheme-cluster break opportunities"), reusing `grapheme.ts`'s `nextCluster`
 * rather than reimplementing cluster boundaries here.
 */
function makeSegmenter(d: DecodedDawg): DictionarySegmenter {
  return {
    segment(text: string): number[] {
      const offsets: number[] = [];
      let pos = 0;
      while (pos < text.length) {
        let node = d.rootId;
        let bestEnd = -1;
        let cursor = pos;
        while (cursor < text.length) {
          const cp = text.codePointAt(cursor);
          if (cp === undefined) break;
          const charIdx = alphabetIndexOf(d.alphabet, cp);
          if (charIdx < 0) break;
          const next = childOf(d, node, charIdx);
          if (next < 0) break;
          node = next;
          cursor += cp > 0xffff ? 2 : 1;
          if (isFinalNode(d, node)) bestEnd = cursor;
        }
        // `bestEnd` is the sentinel `-1` exactly when no dictionary entry matched at all (the
        // inner loop above only ever assigns it `cursor`, which is always > pos >= 0 whenever
        // it runs — but checking the sentinel explicitly, rather than relying on that always
        // being positive, is the actual "did we find a match" condition this line means).
        const end = bestEnd === -1 ? nextCluster(text, pos) : bestEnd;
        pos = end;
        if (pos < text.length) offsets.push(pos);
      }
      return offsets;
    },
  };
}

// ─── Public loader ──────────────────────────────────────────────────────────────────────

const CACHE = new Map<string, DictionarySegmenter>();

/**
 * Loads the dictionary segmenter for `lang`'s primary subtag, or resolves `null` for any
 * language without one. Lazy: the payload module for a language is only ever
 * dynamically imported inside the one matching `case`, so `loadDictionary('en')` never
 * touches `./generated/dict-th.js` etc. at all (proven, not just asserted — dict.test.ts).
 * Cached per process after first successful load (the DAWG decode is pure, immutable data).
 */
export async function loadDictionary(lang: string): Promise<DictionarySegmenter | null> {
  const primary = (lang.split('-')[0] ?? '').toLowerCase();
  const cached = CACHE.get(primary);
  if (cached) return cached;

  let base64: string;
  switch (primary) {
    case 'th':
      base64 = (await import('./generated/dict-th.js')).DICT_TH_BASE64;
      break;
    case 'lo':
      base64 = (await import('./generated/dict-lo.js')).DICT_LO_BASE64;
      break;
    case 'km':
      base64 = (await import('./generated/dict-km.js')).DICT_KM_BASE64;
      break;
    case 'my':
      base64 = (await import('./generated/dict-my.js')).DICT_MY_BASE64;
      break;
    default:
      return null;
  }

  const decoded = decodeDawg(base64Decode(base64));
  const segmenter = makeSegmenter(decoded);
  CACHE.set(primary, segmenter);
  return segmenter;
}
