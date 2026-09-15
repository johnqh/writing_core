import { describe, expect, it, vi } from 'vitest';
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
  it('matches the CONT\'D marker by plain ASCII case-folding, not the host default locale', () => {
    // In the Turkish locale 'i'.toLocaleUpperCase('tr') is 'İ' (dotted capital I, U+0130), not
    // ASCII 'I'; a host whose default locale is Turkish would silently break matching if
    // normalizeKey used toLocaleUpperCase() with no explicit locale. Plain toUpperCase() is
    // locale-independent, so 'i'.toUpperCase() is always 'I' regardless of the host.
    expect('i'.toLocaleUpperCase('tr')).toBe('İ');
    expect('i'.toUpperCase()).toBe('I');
    // A name containing 'i'/'I' immediately before the marker must normalize identically
    // whichever case the marker itself is written in.
    const withMarker = normalizeKey("Mira (CONT'D)", { speaker: true, contTexts: ["(cont'd)"] });
    const withoutMarker = normalizeKey('Mira', { speaker: true });
    expect(withMarker).toBe(withoutMarker);
    expect(withMarker).toBe('mira');
  });
  it("never calls toLocaleUpperCase() while matching the CONT'D/extension marker (regression guard for the fix above)", () => {
    // The test above pins native JS semantics (`'i'.toLocaleUpperCase('tr')` vs `.toUpperCase()`)
    // but does not itself exercise normalizeKey in a way that fails if the implementation reverts
    // to a bare `toLocaleUpperCase()` for the marker match: that match finds an index in the
    // *uppercased* string and then slices the *original, untransformed* string, so a length- and
    // position-preserving substitution (Turkish dotted/dotless I is exactly that) never changes
    // the final sliced-and-lower-folded output — confirmed empirically by reverting normalize.ts
    // to bare toLocaleUpperCase() and re-running an output-equality version of this test: it still
    // passed. A spy on `toLocaleUpperCase` is the assertion that actually has teeth: it fails the
    // moment the marker match calls the locale-dependent form at all, regardless of whether that
    // particular call happens to produce an observably different final key in this environment.
    const spy = vi.spyOn(String.prototype, 'toLocaleUpperCase');
    try {
      normalizeKey("Mira (CONTINUING)", { speaker: true, contTexts: ['(CONTINUING)'] });
      normalizeKey('SAM (DEVAMI)', { speaker: true, contTexts: ['(DEVAMI)'] });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
