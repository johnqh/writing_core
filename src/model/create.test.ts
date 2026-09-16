import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { isId } from '../ids/ids.js';
import { DOC_TOP_LEVEL_KEYS } from '../schema/document.js';
import { NoteTypeSeed, RevisionColorSeed, TagCategorySeed, TraitDefSeed } from '../schema/template.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { verticalDrama } from '../templates/builtin/vertical-drama.js';
import { createDocument, titleFromKey } from './create.js';
import { readEmbeddedTemplate } from './embed-template.js';

describe('createDocument', () => {
  const doc = createDocument({ template: screenplayStandard, uid: 'uid-1', ids: createSeededIdSource(5), clock: () => 1000 });

  it('creates exactly the spec 01 top-level maps', () => {
    for (const key of DOC_TOP_LEVEL_KEYS) expect(doc.share.has(key)).toBe(true);
    expect(doc.share.size).toBe(DOC_TOP_LEVEL_KEYS.length);
  });
  it('writes meta', () => {
    const meta = doc.getMap('meta');
    expect(meta.get('schemaVersion')).toBe(1);
    expect(isId('doc', meta.get('docId'))).toBe(true);
    expect(meta.get('createdBy')).toBe('uid-1');
    expect(meta.get('kind')).toBe('script');
    expect((meta.get('templateOrigin') as { hash: string }).hash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(meta.has('epoch')).toBe(false);
  });
  it('embeds the template so it reads back identically', () => {
    const { smartType: _a, revisionColors: _b, tagCategories: _c, noteTypes: _d, traitDefs: _e, macros: _f, titlePage: _g, body: _h, ...rest } = screenplayStandard;
    expect(readEmbeddedTemplate(doc)).toEqual({ ...rest, revision: 0 });
  });
  it('copies seeds into live collections with fresh ids', () => {
    const sets = doc.getMap('revisions').get('sets') as Y.Map<Y.Map<unknown>>;
    expect(sets.size).toBe(20);
    expect([...sets.keys()].every((k) => isId('rev', k))).toBe(true);
    expect(doc.getMap('revisions').get('activeSetId')).toBeNull();
    expect(doc.getMap('tagCategories').size).toBe(29);
    expect(doc.getMap('macros').size).toBe(20);
    const intros = doc.getMap('smartType').get('sceneIntros') as Y.Map<{ text: string }>;
    expect(intros.get('int')!.text).toBe('INT.');
  });
  it('creates body and title page elements from seeds', () => {
    const elements = doc.getMap('elements');
    expect(elements.size).toBe(1);
    const [first] = [...elements.values()] as Y.Map<unknown>[];
    expect(first!.get('style')).toBe('st_scene_heading');
    expect((first!.get('text') as Y.Text).toString()).toBe('');
    const tp = doc.getMap('titlePage');
    expect((tp.get('elements') as Y.Map<unknown>).size).toBe(6);
    expect((tp.get('fields') as Y.Map<string>).get('title')).toMatch(/^el_/);
    const named = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(8), authorName: 'Maya Lin' });
    const ntp = named.getMap('titlePage');
    const authorId = (ntp.get('fields') as Y.Map<string>).get('author')!;
    const author = (ntp.get('elements') as Y.Map<Y.Map<unknown>>).get(authorId)!;
    expect((author.get('text') as Y.Text).toString()).toBe('Maya Lin');
  });
  it('sets category-specific settings', () => {
    const vd = createDocument({ template: verticalDrama, uid: 'u', ids: createSeededIdSource(6) });
    expect(vd.getMap('settings').get('targetEpisodeSeconds')).toBe(90);
    expect(doc.getMap('settings').get('targetEpisodeSeconds')).toBeNull();
  });
});

describe('titleFromKey', () => {
  it('title-cases a camelCase key and survives an empty one', () => {
    expect(titleFromKey('productionDraft')).toBe('Production Draft');
    expect(titleFromKey('blue')).toBe('Blue');
    // Used to throw on `spaced[0]!.toUpperCase()`.
    expect(titleFromKey('')).toBe('');
  });
  it('is protected upstream too: every seed key a template can carry is non-empty', () => {
    for (const seed of [RevisionColorSeed, TagCategorySeed, NoteTypeSeed, TraitDefSeed]) {
      expect(seed.shape.key.safeParse('').success).toBe(false);
      expect(seed.shape.key.safeParse('blue').success).toBe(true);
    }
  });
});
