import * as Y from 'yjs';

// Present in browsers, Bun and Hermes but not in `lib: ES2022`; typed locally so no DOM/Node types are needed.
const { btoa, atob } = globalThis as unknown as { btoa(data: string): string; atob(data: string): string };

const PORTABLE_RE = /^o:(\d+)$/;

export function isPortablePos(value: string): boolean {
  return PORTABLE_RE.test(value);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeRelativePosition(rel: Y.RelativePosition): string {
  return toBase64(Y.encodeRelativePosition(rel));
}

export function decodeRelativePosition(b64: string): Y.RelativePosition {
  return Y.decodeRelativePosition(fromBase64(b64));
}

/** Resolve a stored relative position to `o:<offset>`; an unresolvable position maps to the start. */
export function toPortablePos(doc: Y.Doc, ytext: Y.Text, relB64: string): string {
  if (isPortablePos(relB64)) return relB64;
  const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(relB64), doc);
  return `o:${abs && abs.type === ytext ? abs.index : 0}`;
}

/**
 * `portable` must already be in the `o:<offset>` form written by `toPortablePos`; anything else
 * (a raw relative-position base64 string, an empty string, garbage) is a caller bug, not a value
 * to silently pass through, so it throws.
 *
 * An offset beyond the text's current length (e.g. the anchoring element shrank since the JSON
 * was captured) is clamped to the end rather than thrown: it is a legitimate, if stale, position
 * — the same "unresolvable maps to a defined point" tolerance `toPortablePos` applies when a
 * relative position can no longer be resolved (it maps to the start, `o:0`).
 */
export function fromPortablePos(ytext: Y.Text, portable: string, assoc: -1 | 0 = 0): string {
  const match = PORTABLE_RE.exec(portable);
  if (!match) throw new Error(`fromPortablePos: not a portable position ("o:<offset>"): ${JSON.stringify(portable)}`);
  const index = Math.min(Number(match[1]), ytext.length);
  return encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index, assoc));
}
