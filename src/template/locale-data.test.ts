import { describe, expect, it } from 'vitest';
import { defaultLocaleData } from './locale-data.js';

describe('defaultLocaleData.spellOut', () => {
  it('spells out English cardinals (§20.2 example)', () => {
    expect(defaultLocaleData.spellOut(2, 'en')).toBe('two');
  });

  it('falls back to digits for a language it has no table for', () => {
    expect(defaultLocaleData.spellOut(2, 'ja')).toBe('2');
  });

  it('handles zero, teens and hyphenated tens-ones', () => {
    expect(defaultLocaleData.spellOut(0, 'en')).toBe('zero');
    expect(defaultLocaleData.spellOut(13, 'en')).toBe('thirteen');
    expect(defaultLocaleData.spellOut(21, 'en')).toBe('twenty-one');
    expect(defaultLocaleData.spellOut(90, 'en')).toBe('ninety');
  });

  it('handles hundreds and thousands, American style (no "and")', () => {
    expect(defaultLocaleData.spellOut(100, 'en')).toBe('one hundred');
    expect(defaultLocaleData.spellOut(101, 'en')).toBe('one hundred one');
    expect(defaultLocaleData.spellOut(1000, 'en')).toBe('one thousand');
    expect(defaultLocaleData.spellOut(1234, 'en')).toBe('one thousand two hundred thirty-four');
  });

  it('spells out up to 9 999 (§17\'s stated range) and falls back to digits just past it', () => {
    expect(defaultLocaleData.spellOut(9999, 'en')).toBe('nine thousand nine hundred ninety-nine');
    expect(defaultLocaleData.spellOut(10000, 'en')).toBe('10000');
  });

  it('recognizes English regional variants by primary subtag, case-insensitively', () => {
    expect(defaultLocaleData.spellOut(2, 'en-US')).toBe('two');
    expect(defaultLocaleData.spellOut(2, 'EN-GB')).toBe('two');
  });

  it('is deterministic: repeated calls with the same input give the same output', () => {
    const a = defaultLocaleData.spellOut(4321, 'en');
    const b = defaultLocaleData.spellOut(4321, 'en');
    expect(a).toBe(b);
    expect(a).toBe('four thousand three hundred twenty-one');
  });
});

describe('defaultLocaleData.formatDate', () => {
  it('formats the default M/d/yy pattern in English (§20.2 example)', () => {
    expect(defaultLocaleData.formatDate(0, 'M/d/yy', 'en')).toBe('1/1/70');
  });

  it('falls back to ISO-8601 for a language it has no pattern table for', () => {
    expect(defaultLocaleData.formatDate(0, 'M/d/yy', 'ja')).toBe('1970-01-01');
  });

  it('uses UTC calendar fields, not host-local time, for determinism across runtimes', () => {
    // A local-time formatter could push epoch 0 into 1969 in a negative-UTC-offset
    // timezone; a platform-free port must not depend on the host's timezone at all.
    expect(defaultLocaleData.formatDate(0, 'yyyy-MM-dd', 'en')).toBe('1970-01-01');
  });

  it('renders full month and weekday names from the bundled table', () => {
    const epoch = Date.UTC(2024, 2, 5); // 2024-03-05 is a Tuesday
    expect(defaultLocaleData.formatDate(epoch, 'MMMM d, yyyy', 'en')).toBe('March 5, 2024');
    expect(defaultLocaleData.formatDate(epoch, 'EEEE, MMM d', 'en')).toBe('Tuesday, Mar 5');
  });

  it('round-trips an unimplemented CLDR field letter verbatim instead of guessing', () => {
    expect(defaultLocaleData.formatDate(0, 'HH:mm', 'en')).toBe('HH:mm');
  });

  it('is deterministic: repeated calls with the same input give the same output', () => {
    const a = defaultLocaleData.formatDate(0, 'M/d/yy', 'en');
    const b = defaultLocaleData.formatDate(0, 'M/d/yy', 'en');
    expect(a).toBe(b);
  });
});
