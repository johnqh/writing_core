import { describe, expect, it } from 'vitest';
import { aliasFor } from './aliases.js';

describe('font aliases (spec 02 §3.2)', () => {
  it('maps every screenplay Courier name to courier-screenplay', () => {
    for (const name of ['Courier Screenplay', 'Courier Final Draft', 'Courier', 'Courier Prime', 'Courier 10 Pitch', 'Courier Std', 'Final Draft Courier'])
      expect(aliasFor(name)).toBe('courier-screenplay');
  });
  it('maps Courier New to courier-new, NOT to Courier Prime', () => {
    expect(aliasFor('Courier New')).toBe('courier-new');
    expect(aliasFor('Liberation Mono')).toBe('courier-new');
    expect(aliasFor('Cousine')).toBe('courier-new');
  });
  it('is case- and space-insensitive', () => {
    expect(aliasFor('  courier   new ')).toBe('courier-new');
    expect(aliasFor('TIMES NEW ROMAN')).toBe('times');
  });
  it('returns null for an unknown name (the classifier decides)', () => {
    expect(aliasFor('Comic Sans MS')).toBeNull();
  });
});
