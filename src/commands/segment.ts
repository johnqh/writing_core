import { graphemeClusters } from '../text/grapheme.js';

type Unit = 'char' | 'grapheme' | 'word';

/**
 * Grapheme cluster boundaries from the package's own UAX #29 implementation, not the host's
 * `Intl.Segmenter`: the host's ICU version decides where a caret may land, so the same keystroke
 * would move it differently on Bun, V8 and Hermes (spec 02 §1.1). The platform-free guard used to
 * miss this because it only matched the literal `new Intl.X` shape.
 */
function graphemeBounds(text: string): number[] {
  return graphemeClusters(text).concat(text.length);
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
