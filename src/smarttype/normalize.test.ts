import { describe, expect, it } from 'vitest';
import { normalizeKey, stripExtension } from './normalize.js';

describe('normalizeKey', () => {
  it('collapses the list pollution seen in real Fade In documents', () => {
    expect(normalizeKey('miller')).toBe(normalizeKey('Miller.'));
    expect(normalizeKey('  MILLER ,')).toBe('miller');
    expect(normalizeKey('Mrs.  Robinson')).toBe('mrs. robinson');
  });
  it('strips speaker extensions and CONT\'D texts', () => {
    expect(normalizeKey("MAYA (V.O.)", { speaker: true })).toBe('maya');
    expect(normalizeKey("MAYA (CONT'D)", { speaker: true, contTexts: ["(CONT'D)"] })).toBe('maya');
    expect(normalizeKey('MAYA (V.O.)')).toBe('maya (v.o.)');
  });
  it('keeps accents distinct and applies NFKC', () => {
    expect(normalizeKey('MÉLANIE')).not.toBe(normalizeKey('MELANIE'));
    expect(normalizeKey('ＭＡＹＡ')).toBe('maya');
    expect(normalizeKey('İSTANBUL', { language: 'tr' })).toBe('istanbul');
  });
  it('splits an extension off a name', () => {
    expect(stripExtension('MAYA (V.O.)')).toEqual({ name: 'MAYA', extension: '(V.O.)' });
    expect(stripExtension('MAYA')).toEqual({ name: 'MAYA', extension: null });
  });
});
