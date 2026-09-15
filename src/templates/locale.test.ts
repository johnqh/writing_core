import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../template/resolve.js';
import { validateTemplate } from '../template/validate.js';
import type { StyleId } from '../ids/ids.js';
import { screenplayStandard } from './builtin/screenplay-standard.js';
import { LOCALE_SCRIPT_WORDS, SCRIPT_LOCALES, localizeTemplate, mirrorTemplate } from './locale.js';

describe('LOCALE_SCRIPT_WORDS', () => {
  it('covers every script locale with spec 01 §3.9 terms', () => {
    expect(Object.keys(LOCALE_SCRIPT_WORDS).sort()).toEqual([...SCRIPT_LOCALES].sort());
    expect(LOCALE_SCRIPT_WORDS.de.more).toBe('(WEITER)');
    expect(LOCALE_SCRIPT_WORDS['zh-Hans'].sceneBottom).toBe('（续下页）');
    expect(LOCALE_SCRIPT_WORDS.fr.cont).toBe('(SUITE)');
    expect(LOCALE_SCRIPT_WORDS.ja.introSeparator).toBe('');
  });
});

describe('localizeTemplate', () => {
  it('replaces conventions and keeps geometry', () => {
    const es = localizeTemplate(screenplayStandard, 'es');
    expect(es.key).toBe('screenplay-standard-es');
    expect(es.locale).toBe('es');
    expect(es.continueds).toMatchObject({ more: '(MÁS)', cont: '(CONT.)', omitted: 'OMITIDA' });
    expect(es.smartType.times[0]).toBe('DÍA');
    expect(es.titlePage.find((e) => e.titleField === 'credit')!.text).toBe('Escrito por');
    expect(es.page).toEqual(screenplayStandard.page);
    expect(es.id).not.toBe(screenplayStandard.id);
    expect(es.macros).toEqual([]);
    expect(validateTemplate(es)).toEqual([]);
  });
  it('is the identity for English', () => {
    expect(localizeTemplate(screenplayStandard, 'en')).toBe(screenplayStandard);
  });
});

describe('mirrorTemplate', () => {
  it('swaps indents, alignment, header slots and number sides', () => {
    const rtl = mirrorTemplate(screenplayStandard, 'screenplay-standard-rtl', 'Screenplay (Right-to-Left)');
    const S = (s: string) => s as StyleId;
    const ltrChar = resolveStyle(screenplayStandard, S('st_character'));
    const rtlChar = resolveStyle(rtl, S('st_character'));
    expect([rtlChar.indentLeft, rtlChar.indentRight]).toEqual([ltrChar.indentRight, ltrChar.indentLeft]);
    expect(resolveStyle(rtl, S('st_transition')).align).toBe('left');
    expect(rtl.header).toMatchObject({ left: '{page}.', right: '' });
    expect(rtl.direction).toBe('rtl');
    expect(rtl.page.margins).toMatchObject({ left: screenplayStandard.page.margins.right, right: screenplayStandard.page.margins.left });
    expect(validateTemplate(rtl)).toEqual([]);
  });
});
