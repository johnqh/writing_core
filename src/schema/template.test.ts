import { describe, expect, it } from 'vitest';
import { minimalTemplate } from '../test-fixtures/minimal-template.js';
import { NumberLabel, StyleDef, TemplateJSON } from './template.js';

describe('TemplateJSON', () => {
  it('accepts the minimal template', () => {
    const r = TemplateJSON.safeParse(minimalTemplate());
    expect(r.error?.issues ?? []).toEqual([]);
  });
  it('rejects unknown roles and non-EMU indents', () => {
    const t = minimalTemplate();
    expect(TemplateJSON.safeParse({ ...t, styles: [{ ...t.styles[1]!, role: 'hero' }] }).success).toBe(false);
    expect(StyleDef.safeParse({ ...t.styles[1]!, indentLeft: 1.25 }).success).toBe(false);
  });
  it('requires at least one style and a known schema version', () => {
    expect(TemplateJSON.safeParse({ ...minimalTemplate(), styles: [] }).success).toBe(false);
    expect(TemplateJSON.safeParse({ ...minimalTemplate(), schemaVersion: 2 }).success).toBe(false);
  });
  it('parses structured number labels', () => {
    expect(NumberLabel.parse({ base: 12, prefix: [], suffix: [{ kind: 'letters', value: [1] }] })).toBeTruthy();
    expect(NumberLabel.safeParse({ base: 12, prefix: [], suffix: [{ kind: 'letters', value: [0] }] }).success).toBe(false);
  });
});
