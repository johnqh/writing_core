import { comparePositions } from '../model/positions.js';
import { normalizeKey } from '../smarttype/normalize.js';
import type { Suggestion } from './views.js';

export function matchesPrefix(candidate: string, prefix: string, language: string): boolean {
  if (prefix.trim() === '') return true;
  const c = candidate.normalize('NFKC').toLocaleLowerCase(language);
  const p = prefix.normalize('NFKC').toLocaleLowerCase(language).replace(/\s+/g, ' ').trimStart();
  return c.startsWith(p) || normalizeKey(candidate, { language }).startsWith(normalizeKey(prefix, { language }));
}

export function rankSuggestions(
  items: Suggestion[],
  sortMode: 'alphabetical' | 'custom' | 'frequency',
  locale: string,
  order: ReadonlyMap<string, string> = new Map(),
): Suggestion[] {
  // `new Intl.Collator` is banned by the platform-free guard (src/__guards/platform-free.test.ts);
  // `localeCompare` with an explicit locale gives the same base-sensitivity comparison.
  const alpha = (a: Suggestion, b: Suggestion) => a.text.localeCompare(b.text, locale, { sensitivity: 'base' });
  const sorted = [...items];
  if (sortMode === 'frequency') sorted.sort((a, b) => b.count - a.count || alpha(a, b));
  else if (sortMode === 'custom') sorted.sort((a, b) => comparePositions(order.get(a.key) ?? '￿', order.get(b.key) ?? '￿') || alpha(a, b));
  else sorted.sort(alpha);
  return sorted;
}
