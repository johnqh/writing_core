import { describe, expect, it } from 'vitest';
import { matchesPrefix, rankSuggestions } from './suggestions.js';

const s = (text: string, count: number) => ({ text, key: text.toLowerCase(), source: 'list' as const, entityId: null, count });

describe('suggestions', () => {
  it('matches normalized prefixes', () => {
    expect(matchesPrefix('MAYA', 'ma', 'en')).toBe(true);
    expect(matchesPrefix('MAYA', '', 'en')).toBe(true);
    expect(matchesPrefix('MAYA', 'y', 'en')).toBe(false);
    expect(matchesPrefix('MOMENTS LATER', 'moments l', 'en')).toBe(true);
  });
  it('ranks by mode', () => {
    const items = [s('NIGHT', 1), s('DAY', 5), s('DUSK', 0)];
    expect(rankSuggestions(items, 'alphabetical', 'en').map((i) => i.text)).toEqual(['DAY', 'DUSK', 'NIGHT']);
    expect(rankSuggestions(items, 'frequency', 'en').map((i) => i.text)).toEqual(['DAY', 'NIGHT', 'DUSK']);
    expect(rankSuggestions(items, 'custom', 'en', new Map([['night', 'A'], ['dusk', 'B'], ['day', 'C']])).map((i) => i.text)).toEqual(['NIGHT', 'DUSK', 'DAY']);
  });
});
