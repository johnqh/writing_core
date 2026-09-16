import type { LabelSegment, NumberLabel } from '../schema/template.js';
import type { NumberMode } from '../schema/vocab.js';

const FULL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Spec 02 §22.1: `A`–`Z` (26), or with `skipIO` `A`–`Z` without `I` and `O` (24) — production
 * scripts skip letters that read as digits on a printed page. Index 1 = the first entry.
 */
export function alphabetFor(skipIO: boolean): readonly string[] {
  const chars = skipIO ? FULL_ALPHABET.replace(/[IO]/g, '') : FULL_ALPHABET;
  return Object.freeze(chars.split(''));
}

/**
 * Each letter index is 1-based (1 = first letter of the alphabet); spec 02 §22.1 owns the
 * generation of these indices. An index below 1 has no letter — 0 used to index `alphabet[-1]`
 * and throw on `.repeat` — so it contributes nothing rather than crashing the whole label on one
 * out-of-range segment. `opts.skipIO` selects the 24-letter alphabet (spec 02 §22.1); omitted or
 * false keeps the original 26-letter behaviour so no M1 caller changes.
 */
export function letters(indices: readonly number[], opts?: { skipIO?: boolean }): string {
  const alphabet = alphabetFor(opts?.skipIO ?? false);
  const n = alphabet.length;
  return indices
    .filter((i) => Number.isInteger(i) && i >= 1)
    .map((i) => alphabet[(i - 1) % n]!.repeat(Math.floor((i - 1) / n) + 1))
    .join('');
}

/**
 * Inverse of `indicesToLetters`: parses a rendered letter run (e.g. `"ZA"`) into the per-character
 * 1-based alphabet indices it was built from (`[26, 1]`). Case-insensitive. Throws on a character
 * outside the selected alphabet (`opts.skipIO`) rather than silently dropping it, since a caller
 * parsing typed input wants to know it was invalid.
 */
export function lettersToIndices(text: string, opts?: { skipIO?: boolean }): number[] {
  const skipIO = opts?.skipIO ?? false;
  const alphabet = alphabetFor(skipIO);
  const out: number[] = [];
  for (const ch of text.toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new RangeError(`letter '${ch}' is not in the ${skipIO ? 'skipIO' : 'standard'} alphabet`);
    out.push(idx + 1);
  }
  return out;
}

/**
 * Inverse of `lettersToIndices`: joins per-character 1-based alphabet indices into a letter run.
 * Spec 02 §22.1's Z-extension (`ZA, ZB, …, ZZ, ZZA …`) is generated elsewhere (§22.3) as a
 * multi-index `LabelSegment.value` array — `[26, 1]` for `"ZA"` — so this is a direct, non-repeating
 * character-by-character join (unlike `letters`, which additionally repeats a single out-of-range
 * index for its own, pre-existing overflow convention). An index outside `1..alphabet.length` is
 * dropped rather than thrown, matching `letters`' tolerance of out-of-range input.
 */
export function indicesToLetters(indices: readonly number[], opts?: { skipIO?: boolean }): string {
  const alphabet = alphabetFor(opts?.skipIO ?? false);
  const n = alphabet.length;
  return indices
    .filter((i) => Number.isInteger(i) && i >= 1 && i <= n)
    .map((i) => alphabet[i - 1]!)
    .join('');
}

// ─── Roman numerals (romanUpper/romanLower base rendering, spec 02 §22.1/§22.2) ───────────────
//
// Kept local rather than imported from `template/tokens.ts`'s private `toRoman`: that module
// already imports `letters` from here, so the reverse import would cycle. Both fall back to the
// plain integer outside the classical 1–3999 range rather than guessing.

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRomanUpper(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 3999) return String(n);
  let x = n;
  let out = '';
  for (const [value, sym] of ROMAN_TABLE) {
    while (x >= value) {
      out += sym;
      x -= value;
    }
  }
  return out;
}

/**
 * Spec 02 §22.1: labels are stored structured and rendered on demand. `opts.skipIO` (default
 * false) threads through to `letters`; `opts.mode` (default undefined) selects `romanUpper`/
 * `romanLower` base + parenthesized-segment rendering — every other mode, and no mode at all,
 * renders as before. Both defaults preserve exact M1 output so no M1 caller changes.
 */
export function formatNumberLabel(label: NumberLabel, opts?: { skipIO?: boolean; mode?: NumberMode }): string {
  if (label.custom !== undefined && label.custom !== '') return label.custom;
  const skipIO = opts?.skipIO ?? false;
  const mode = opts?.mode;
  const seg = (s: LabelSegment): string => (s.kind === 'letters' ? letters(s.value, { skipIO }) : String(s.value));

  if (mode === 'romanUpper' || mode === 'romanLower') {
    const lower = mode === 'romanLower';
    const roman = toRomanUpper(label.base);
    const base = lower ? roman.toLowerCase() : roman;
    const wrapped = (s: LabelSegment): string => `(${lower ? seg(s).toLowerCase() : seg(s)})`;
    return `${label.prefix.map(wrapped).join('')}${base}${label.suffix.map(wrapped).join('')}`;
  }

  return `${label.prefix.map(seg).join('')}${label.base}${label.suffix.map(seg).join('')}`;
}

// ─── Ordering (spec 02 §22.2) ──────────────────────────────────────────────────────────────────

function compareNumberSeq(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function compareSegment(a: LabelSegment, b: LabelSegment): number {
  if (a.kind === 'letters' && b.kind === 'letters') return compareNumberSeq(a.value, b.value);
  if (a.kind === 'digits' && b.kind === 'digits') return a.value - b.value;
  // Mixed kinds shouldn't arise for two labels of the same style, but stay deterministic.
  return a.kind === 'letters' ? -1 : 1;
}

/** A missing segment (array exhausted) sorts before any present segment — spec's `suffixKey` rule. */
function compareSegmentArrays(a: readonly LabelSegment[], b: readonly LabelSegment[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = compareSegment(a[i]!, b[i]!);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function flattenLetterIndices(segments: readonly LabelSegment[]): number[] {
  const out: number[] = [];
  for (const s of segments) if (s.kind === 'letters') out.push(...s.value);
  return out;
}

/**
 * Spec 02 §22.2's per-mode ordering, for validating "strictly between". `custom` (a free-text
 * display override) never participates: the structured `base`/`prefix`/`suffix` fields still
 * carry the label's position (spec 02 §23.1's Edit Number writes both).
 *
 * - `1AB`, `1A2`, `romanUpper`, `romanLower`: `(base, prefixKey, suffixKey)` where prefixKey sorts
 *   a prefixed label *before* the same base's plain label (opposite of suffixKey's "missing <
 *   present" — a prefix sorts before its base, a suffix sorts after it), and among two prefixed
 *   labels a shorter matching prefix sorts before a deeper one, same rule as suffixKey.
 * - `AB2`: equal base, prefixed < plain; between two prefixed labels, compare the flattened prefix
 *   letter-index sequence left-to-right (shorter-is-less on a common run).
 * - `BA2`: as `AB2` but right-to-left — implemented by comparing the sequences reversed, which is
 *   the fix for the shipped-bug regression: comparing left-to-right here breaks `BA2 < B2`
 *   (`BA2`=[B,A] vs `B2`=[B] compare equal on their first/only shared element left-to-right, so a
 *   naive comparator calls the shorter `B2` less — backwards).
 */
export function compareLabels(a: NumberLabel, b: NumberLabel, mode: NumberMode): number {
  if (mode === 'AB2' || mode === 'BA2') {
    if (a.base !== b.base) return a.base - b.base;
    const aHasPrefix = a.prefix.length > 0;
    const bHasPrefix = b.prefix.length > 0;
    if (aHasPrefix !== bHasPrefix) return aHasPrefix ? -1 : 1;
    if (!aHasPrefix) return 0;
    const aFlat = flattenLetterIndices(a.prefix);
    const bFlat = flattenLetterIndices(b.prefix);
    return mode === 'AB2'
      ? compareNumberSeq(aFlat, bFlat)
      : compareNumberSeq([...aFlat].reverse(), [...bFlat].reverse());
  }

  // 1AB, 1A2, romanUpper, romanLower
  if (a.base !== b.base) return a.base - b.base;
  const aHasPrefix = a.prefix.length > 0;
  const bHasPrefix = b.prefix.length > 0;
  if (aHasPrefix !== bHasPrefix) return aHasPrefix ? -1 : 1;
  if (aHasPrefix && bHasPrefix) {
    const p = compareSegmentArrays(a.prefix, b.prefix);
    if (p !== 0) return p;
  }
  return compareSegmentArrays(a.suffix, b.suffix);
}
