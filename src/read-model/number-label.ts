import type { NumberLabel } from '../schema/template.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Each letter index is 1-based (1 = A); spec 02 §22.1 owns the generation of these indices. */
export function letters(indices: readonly number[]): string {
  return indices.map((i) => ALPHABET[(i - 1) % 26]!.repeat(Math.floor((i - 1) / 26) + 1)).join('');
}

export function formatNumberLabel(label: NumberLabel): string {
  if (label.custom !== undefined && label.custom !== '') return label.custom;
  const seg = (s: NumberLabel['prefix'][number]) => (s.kind === 'letters' ? letters(s.value) : String(s.value));
  return `${label.prefix.map(seg).join('')}${label.base}${label.suffix.map(seg).join('')}`;
}
