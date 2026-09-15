import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { fromPortablePos, isPortablePos, toPortablePos } from './portable-pos.js';

const { btoa, atob } = globalThis as unknown as { btoa(data: string): string; atob(data: string): string };

function textDoc(plain: string): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  const text = doc.getMap('m').set('t', new Y.Text());
  text.insert(0, plain);
  return { doc, text };
}

describe('isPortablePos', () => {
  it('accepts the `o:<offset>` form', () => {
    expect(isPortablePos('o:0')).toBe(true);
    expect(isPortablePos('o:42')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isPortablePos('o:')).toBe(false);
    expect(isPortablePos('o:-1')).toBe(false);
    expect(isPortablePos('x:5')).toBe(false);
    expect(isPortablePos('')).toBe(false);
  });
});

describe('toPortablePos / fromPortablePos round trip', () => {
  it('round-trips an offset through a relative position and back', () => {
    const { doc, text } = textDoc('hello world');
    const rel = fromPortablePos(text, 'o:5');
    const portable = toPortablePos(doc, text, rel);
    expect(portable).toBe('o:5');
  });

  it('is a no-op when the value is already portable', () => {
    const { doc, text } = textDoc('hello');
    expect(toPortablePos(doc, text, 'o:3')).toBe('o:3');
  });
});

describe('fromPortablePos: invalid input', () => {
  it('throws a clear error for a value not in the `o:<offset>` form, instead of passing it through', () => {
    const { text } = textDoc('hello');
    expect(() => fromPortablePos(text, 'not-a-portable-pos')).toThrow(/portable position/);
  });

  it('throws for a raw (non-portable) relative-position base64 string', () => {
    const { doc, text } = textDoc('hello');
    const rel = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 2));
    let raw = '';
    for (const b of rel) raw += String.fromCharCode(b);
    expect(() => fromPortablePos(text, btoa(raw))).toThrow(/portable position/);
    void doc;
  });

  it('throws for an empty string', () => {
    const { text } = textDoc('hello');
    expect(() => fromPortablePos(text, '')).toThrow(/portable position/);
  });
});

describe('fromPortablePos: out-of-range offset', () => {
  it('clamps an offset beyond the text length to the end, rather than throwing', () => {
    // Documents the chosen behaviour (clamp, not throw): a stale portable position whose
    // anchoring text has since shrunk is still a meaningful "at the end" position, consistent
    // with toPortablePos mapping an unresolvable relative position to a defined point (o:0).
    const { doc, text } = textDoc('hi');
    const rel = fromPortablePos(text, 'o:999');
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(atobBytes(rel)), doc);
    expect(abs?.index).toBe(text.length);
  });
});

function atobBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
