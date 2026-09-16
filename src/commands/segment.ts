type Unit = 'char' | 'grapheme' | 'word';

interface SegmenterLike {
  segment(input: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }>;
}
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => SegmenterLike }).Segmenter;

function graphemeBounds(text: string): number[] {
  if (SegmenterCtor) return [...new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.index).concat(text.length);
  const out: number[] = [];
  let i = 0;
  for (const cp of text) {
    out.push(i);
    i += cp.length;
  }
  return out.concat(text.length);
}

export function previousBoundary(text: string, index: number, unit: Unit): number {
  if (index <= 0) return 0;
  if (unit === 'char') {
    const code = text.charCodeAt(index - 1);
    return code >= 0xdc00 && code <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  }
  if (unit === 'grapheme') return [...graphemeBounds(text)].reverse().find((b) => b < index) ?? 0;
  // word: skip whitespace/punctuation before the caret, then the word itself
  const before = text.slice(0, index);
  const match = /[\p{L}\p{N}_'’]+[^\p{L}\p{N}_'’]*$|[^\p{L}\p{N}_'’]+$/u.exec(before);
  return match ? match.index : 0;
}

export function nextBoundary(text: string, index: number, unit: Unit): number {
  if (index >= text.length) return text.length;
  if (unit === 'char') {
    const code = text.charCodeAt(index);
    return code >= 0xd800 && code <= 0xdbff && index + 2 <= text.length ? index + 2 : index + 1;
  }
  if (unit === 'grapheme') return graphemeBounds(text).find((b) => b > index) ?? text.length;
  const after = text.slice(index);
  const match = /^[^\p{L}\p{N}_'’]*[\p{L}\p{N}_'’]+|^[^\p{L}\p{N}_'’]+/u.exec(after);
  return index + (match ? match[0].length : after.length);
}
