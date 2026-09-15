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
