import { describe, expect, it } from 'vitest';
import type { StyleId } from '../ids/ids.js';
import { minimalTemplate } from '../test-fixtures/minimal-template.js';
import { enterAction, shiftTabAction, tabAction } from './flow.js';

const S = (s: string) => s as StyleId;
const t = minimalTemplate();

describe('enterAction', () => {
  it('inserts the onEnter style at the end of text', () => {
    expect(enterAction(t, S('st_character'), { empty: false, caretAtEnd: true, enterOnBlank: 'template' }))
      .toEqual({ kind: 'insertAfter', style: 'st_dialogue' });
  });
  it('keeps the current style when splitting mid-text', () => {
    expect(enterAction(t, S('st_character'), { empty: false, caretAtEnd: false, enterOnBlank: 'template' }))
      .toEqual({ kind: 'split', style: 'st_character' });
  });
  it('uses onEnter ?? same for an empty element in flow mode and the picker otherwise', () => {
    expect(enterAction(t, S('st_action'), { empty: true, caretAtEnd: true, enterOnBlank: 'template' })).toEqual({ kind: 'openPicker' });
    expect(enterAction(t, S('st_character'), { empty: true, caretAtEnd: true, enterOnBlank: 'flow' }))
      .toEqual({ kind: 'convert', style: 'st_dialogue' });
    expect(enterAction(t, S('st_action'), { empty: true, caretAtEnd: true, enterOnBlank: 'flow' })).toEqual({ kind: 'none' });
  });
});

describe('tabAction', () => {
  it('converts an empty element via onTabEmpty', () => {
    expect(tabAction(t, S('st_action'), { empty: true, caretAtEnd: true })).toEqual({ kind: 'convert', style: 'st_character' });
  });
  it('opens SmartType when there is no onTabEmpty but a list', () => {
    expect(tabAction(t, S('st_character'), { empty: true, caretAtEnd: true })).toEqual({ kind: 'openSmartType', list: 'characters' });
  });
  it('advances segmented completion inside a scene heading', () => {
    expect(tabAction(t, S('st_scene_heading'), { empty: false, caretAtEnd: true })).toEqual({ kind: 'segmentedCompletion' });
  });
  it('inserts a speech member after text at the end instead of converting', () => {
    const styles = t.styles.map((s) => (s.id === 'st_character' ? { ...s, flow: { ...s.flow, onTabText: S('st_dialogue') } } : s));
    expect(tabAction({ ...t, styles }, S('st_character'), { empty: false, caretAtEnd: true })).toEqual({ kind: 'insertAfter', style: 'st_dialogue' });
    expect(tabAction({ ...t, styles }, S('st_character'), { empty: false, caretAtEnd: false })).toEqual({ kind: 'convert', style: 'st_dialogue' });
  });
});

describe('shiftTabAction', () => {
  it('reverses the tab cycle when onShiftTabEmpty is null', () => {
    expect(shiftTabAction(t, S('st_character'), { empty: true })).toEqual({ kind: 'convert', style: 'st_action' });
    expect(shiftTabAction(t, S('st_dialogue'), { empty: true })).toEqual({ kind: 'none' });
  });
});
