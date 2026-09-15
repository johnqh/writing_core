import { describe, expect, it } from 'vitest';
import { builtinStyleSlug, camelKey, roleForImportedStyle } from './role-table.js';

describe('roleForImportedStyle', () => {
  it('maps built-in slots by index', () => {
    expect(roleForImportedStyle({ name: 'Scene Heading', builtinIndex: 1, actBreak: false, baseRole: null }).role).toBe('sceneHeading');
    expect(roleForImportedStyle({ name: 'Shot', builtinIndex: 7, actBreak: false, baseRole: null }).role).toBe('shot');
  });
  it('lets names override renamed slots (Novel Manuscript)', () => {
    expect(roleForImportedStyle({ name: 'Chapter Heading', builtinIndex: 1, actBreak: false, baseRole: null }).role).toBe('chapter');
    expect(roleForImportedStyle({ name: 'Subheading', builtinIndex: 3, actBreak: false, baseRole: null }).role).toBe('subheading');
  });
  it('maps named styles, outline levels and act breaks', () => {
    expect(roleForImportedStyle({ name: 'Teaser/Act One', builtinIndex: null, actBreak: true, baseRole: 'shot' }).role).toBe('actStart');
    expect(roleForImportedStyle({ name: 'Outline 2', builtinIndex: null, actBreak: false, baseRole: null })).toEqual({ role: 'outline', outlineLevel: 2 });
    expect(roleForImportedStyle({ name: 'Sound Effects/Music', builtinIndex: null, actBreak: false, baseRole: null }).role).toBe('soundCue');
    expect(roleForImportedStyle({ name: 'Mystery', builtinIndex: null, actBreak: true, baseRole: 'action' }).role).toBe('actStart');
  });
  it('never inherits sceneHeading or character from an unknown name', () => {
    expect(roleForImportedStyle({ name: 'Slug Two', builtinIndex: null, actBreak: false, baseRole: 'sceneHeading' }).role).toBe('normal');
    expect(roleForImportedStyle({ name: 'Voice', builtinIndex: null, actBreak: false, baseRole: 'dialogue' }).role).toBe('dialogue');
  });
});

describe('slugs', () => {
  it('produces fixed built-in style slugs', () => {
    expect(builtinStyleSlug('Scene Heading')).toBe('scene_heading');
    expect(builtinStyleSlug('Teaser/Act One')).toBe('teaser_act_one');
    expect(builtinStyleSlug('Chapter Heading')).toBe('chapter');
    expect(builtinStyleSlug('Normal Text')).toBe('normal');
    expect(camelKey('Makeup/Hair')).toBe('makeupHair');
  });
});
