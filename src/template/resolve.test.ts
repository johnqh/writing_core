import { describe, expect, it } from 'vitest';
import type { StyleId } from '../ids/ids.js';
import { minimalTemplate } from '../test-fixtures/minimal-template.js';
import { inchesToEmu } from '../units.js';
import { resolveStyle, styleChain } from './resolve.js';

const S = (s: string) => s as StyleId;

describe('resolveStyle', () => {
  const t = minimalTemplate();
  it('folds root to leaf with nearest definition winning', () => {
    const r = resolveStyle(t, S('st_character'));
    expect(r.indentLeft).toBe(inchesToEmu(2));
    expect(r.allCaps).toBe(true);
    expect(r.font.family).toBe('courier-screenplay');
    expect(r.flow.onEnter).toBe('st_dialogue');
    expect(r.flow.onEnterEmpty).toBe('picker');
  });
  it('merges font field by field', () => {
    const styles = t.styles.map((s) => (s.id === 'st_action' ? { ...s, font: { italic: true } } : s));
    const r = resolveStyle({ ...t, styles }, S('st_action'));
    expect(r.font.italic).toBe(true);
    expect(r.font.size).toBe(12);
  });
  it('uses role default split rules unless a non-root style sets one', () => {
    expect(resolveStyle(t, S('st_scene_heading')).splitRule).toBe('never');
    expect(resolveStyle(t, S('st_dialogue')).splitRule).toBe('sentences');
    expect(resolveStyle({ ...t, pagination: { ...t.pagination, breakOnSentences: false } }, S('st_dialogue')).splitRule).toBe('lines');
  });
  it('applies element overrides last, only for override keys', () => {
    const r = resolveStyle(t, S('st_action'), { align: 'center', spaceBefore: 3, leadingAdjust: 12_700 });
    expect(r.align).toBe('center');
    expect(r.spaceBefore).toBe(3);
    expect(r.leadingAdjust).toBe(12_700);
    expect(resolveStyle(t, S('st_action')).leadingAdjust).toBe(0);
  });
  it('borrows pagination rules from paginateAs without visual fields', () => {
    const styles = [
      ...t.styles,
      { id: S('st_lyrics'), name: 'Lyrics', nameKey: null, role: 'lyrics' as const, basedOn: S('st_dialogue'), shortcut: null, font: { italic: true }, paginateAs: S('st_scene_heading') },
    ];
    const r = resolveStyle({ ...t, styles }, S('st_lyrics'));
    expect(r.keepWithNext).toBe(true);
    expect(r.splitRule).toBe('never');
    expect(r.indentLeft).toBe(inchesToEmu(1));
  });
  it('resolves a missing parent as the root and survives cycles', () => {
    const styles = t.styles.map((s) =>
      s.id === 'st_action' ? { ...s, basedOn: S('st_dialogue') } : s.id === 'st_dialogue' ? { ...s, basedOn: S('st_action') } : s,
    );
    expect(styleChain(styles, S('st_action')).map((s) => s.id)).toEqual(['st_action', 'st_dialogue', 'st_normal']);
    const orphan = t.styles.map((s) => (s.id === 'st_action' ? { ...s, basedOn: S('st_missing') } : s));
    expect(resolveStyle({ ...t, styles: orphan }, S('st_action')).font.size).toBe(12);
  });
  it('throws for an unknown style id', () => {
    expect(() => resolveStyle(t, S('st_nope'))).toThrow(/unknown style/);
  });
  it('terminates on a mutual paginateAs pair, borrowing the last resolved values', () => {
    const styles = t.styles.map((s) =>
      s.id === 'st_action' ? { ...s, paginateAs: S('st_character') } : s.id === 'st_character' ? { ...s, paginateAs: S('st_action') } : s,
    );
    expect(() => resolveStyle({ ...t, styles }, S('st_action'))).not.toThrow();
    const r = resolveStyle({ ...t, styles }, S('st_action'));
    expect(r.keepWithNext).toBe(true);
    expect(r.keepTogether).toBe(false);
    expect(r.splitRule).toBe('never');
  });
});

describe('resolveStyle memoization (spec 01 §3.4.2)', () => {
  it('returns the same resolution for the same (template, styleId) and a fresh one per template revision', () => {
    const t = minimalTemplate();
    const first = resolveStyle(t, S('st_character'));
    expect(resolveStyle(t, S('st_character'))).toBe(first);
    expect(resolveStyle(t, S('st_action'))).not.toBe(first);
    // The read model rebuilds its frozen template object on every template mutation, which is what
    // `revision` counts — a new object is a new revision and must not reuse the old resolution.
    const bumped = { ...t, styles: t.styles.map((s) => (s.id === 'st_character' ? { ...s, allCaps: false } : s)) };
    const after = resolveStyle(bumped, S('st_character'));
    expect(after).not.toBe(first);
    expect(first.allCaps).toBe(true);
    expect(after.allCaps).toBe(false);
  });

  it('never hands out a mutable shared resolution, and overrides do not leak into the memo', () => {
    const t = minimalTemplate();
    const base = resolveStyle(t, S('st_action'));
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(base.font)).toBe(true);
    const overridden = resolveStyle(t, S('st_action'), { align: 'center', spaceBefore: 3 });
    expect(overridden).not.toBe(base);
    expect(overridden.align).toBe('center');
    expect(resolveStyle(t, S('st_action'))).toBe(base);
    expect(base.align).not.toBe('center');
  });

  it('memoizes the paginateAs borrow too, not just the direct chain', () => {
    const t = minimalTemplate();
    const styles = t.styles.map((s) => (s.id === 'st_action' ? { ...s, paginateAs: S('st_character') } : s));
    const src = { ...t, styles };
    const first = resolveStyle(src, S('st_action'));
    expect(first.keepWithNext).toBe(true);
    expect(resolveStyle(src, S('st_action'))).toBe(first);
  });
});
