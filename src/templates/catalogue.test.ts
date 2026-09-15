import { describe, expect, it } from 'vitest';
import { TemplateJSON } from '../schema/template.js';
import { validateTemplate } from '../template/validate.js';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_KEY, getBuiltinTemplate, listBuiltinTemplates } from './catalogue.js';

describe('built-in catalogue', () => {
  it('has 14 generated + 5 authored + 35 localized + 1 RTL templates, all valid and uniquely identified', () => {
    const all = Object.values(BUILTIN_TEMPLATES);
    expect(all).toHaveLength(55);
    expect(new Set(all.map((t) => t.id)).size).toBe(55);
    for (const t of all) {
      expect(TemplateJSON.safeParse(t).success).toBe(true);
      expect(validateTemplate(t)).toEqual([]);
      expect(BUILTIN_TEMPLATES[t.key!]).toBe(t);
    }
  });
  it('resolves the default and filters by locale and category', () => {
    expect(getBuiltinTemplate(DEFAULT_TEMPLATE_KEY)!.name).toBe('Screenplay (Standard)');
    expect(listBuiltinTemplates({ locale: 'ko' }).map((t) => t.key).sort()).toEqual([
      'screenplay-standard-ko', 'stage-play-ko', 'treatment-ko', 'tv-half-hour-ko', 'tv-one-hour-ko',
    ]);
    expect(listBuiltinTemplates({ category: 'radio' })).toHaveLength(2);
  });
});
