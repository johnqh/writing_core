import { describe, expect, it } from 'vitest';
import type { StyleId } from '../ids/ids.js';
import { minimalTemplate } from '../test-fixtures/minimal-template.js';
import { validateTemplate } from './validate.js';

const S = (s: string) => s as StyleId;
const codes = (t: ReturnType<typeof minimalTemplate>) => validateTemplate(t).map((i) => i.code).sort();

describe('validateTemplate', () => {
  it('accepts the minimal template', () => {
    expect(validateTemplate(minimalTemplate())).toEqual([]);
  });
  it('reports cycles, missing parents and duplicate ids', () => {
    const t = minimalTemplate();
    t.styles[2] = { ...t.styles[2]!, basedOn: S('st_character') };
    t.styles[3] = { ...t.styles[3]!, basedOn: S('st_action') };
    t.styles.push({ ...t.styles[4]!, basedOn: S('st_ghost') });
    expect(codes(t)).toEqual(['basedOnCycle', 'duplicateStyleId', 'missingParent']);
  });
  it('reports an incomplete root and dangling references', () => {
    const t = minimalTemplate();
    const { lineSpacing: _drop, ...root } = t.styles[0]!;
    t.styles[0] = root;
    t.defaults = { ...t.defaults, pasteFallback: S('st_gone') };
    t.styles[1] = { ...t.styles[1]!, flow: { onEnter: S('st_gone') }, paginateAs: S('st_gone') };
    expect(codes(t)).toEqual(['danglingDefault', 'danglingFlow', 'danglingPaginateAs', 'incompleteRoot']);
  });
  it('requires exactly one root and that it is defaults.root', () => {
    const t = minimalTemplate();
    t.styles[1] = { ...t.styles[1]!, basedOn: null };
    expect(codes(t)).toContain('multipleRoots');
    const u = minimalTemplate();
    u.defaults = { ...u.defaults, root: S('st_action') };
    expect(codes(u)).toContain('rootMismatch');
  });
  it('reports a mutual paginateAs pair as a cycle, keyed on its members', () => {
    const t = minimalTemplate();
    t.styles = t.styles.map((s) =>
      s.id === 'st_action' ? { ...s, paginateAs: S('st_character') } : s.id === 'st_character' ? { ...s, paginateAs: S('st_action') } : s,
    );
    const issues = validateTemplate(t);
    expect(issues.map((i) => i.code)).toEqual(['paginateAsCycle']);
    expect(['st_action', 'st_character']).toContain(issues[0]?.styleId);
  });
});
