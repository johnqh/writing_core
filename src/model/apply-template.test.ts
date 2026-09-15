import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import type { StyleId } from '../ids/ids.js';
import { TemplateJSON } from '../schema/template.js';
import { getBuiltinTemplate } from '../templates/catalogue.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { applyTemplate, exportTemplate, mapStyle } from './apply-template.js';
import { createDocument } from './create.js';
import { documentToJSON } from './json.js';
import { readEmbeddedTemplate } from './embed-template.js';

const S = (s: string) => s as StyleId;

describe('mapStyle', () => {
  const stage = getBuiltinTemplate('stage-play-tnr')!;
  it('keeps ids that exist, then maps by role, then falls back', () => {
    expect(mapStyle(screenplayStandard.styles, stage, S('st_dialogue'))).toBe('st_dialogue');
    expect(mapStyle(screenplayStandard.styles, stage, S('st_new_act'))).toBe('st_act_heading');
    expect(mapStyle(screenplayStandard.styles, stage, S('st_summary'))).toBe(stage.defaults.pasteFallback);
    expect(mapStyle(screenplayStandard.styles, stage, S('st_summary'), { st_summary: S('st_notations') })).toBe('st_notations');
  });
});

describe('applyTemplate', () => {
  it('re-styles elements, replaces the embedded template and merges seeds without deleting user data', () => {
    const ids = createSeededIdSource(9);
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
    const elements = doc.getMap('elements');
    const [heading] = [...elements.values()] as Y.Map<unknown>[];
    heading!.set('style', 'st_new_act');
    (doc.getMap('smartType').get('times') as Y.Map<unknown>).set('dusk', { text: 'DUSK', pos: 'z', origin: 'manual', count: 0 });

    const stage = getBuiltinTemplate('stage-play-tnr')!;
    const result = applyTemplate(doc, stage, { ids, uid: 'u' });

    expect(result.remapped).toBe(1);
    expect(heading!.get('style')).toBe('st_act_heading');
    expect(readEmbeddedTemplate(doc).key).toBe('stage-play-tnr');
    expect(readEmbeddedTemplate(doc).revision).toBe(1);
    const times = documentToJSON(doc).smartType.times.map((t) => t.text);
    expect(times).toContain('DUSK');
    expect(documentToJSON(doc).revisions.sets).toHaveLength(20);
    expect((doc.getMap('meta').get('templateOrigin') as { key: string }).key).toBe('stage-play-tnr');
  });
});

describe('exportTemplate', () => {
  it('reconstructs a valid template from a document', () => {
    const doc = createDocument({ template: screenplayStandard, uid: 'u', ids: createSeededIdSource(10) });
    const t = exportTemplate(doc, { ids: createSeededIdSource(11), name: 'My Format' });
    expect(TemplateJSON.safeParse(t).error?.issues ?? []).toEqual([]);
    expect(t).toMatchObject({ name: 'My Format', key: null, category: 'screenplay' });
    expect(t.styles).toEqual(screenplayStandard.styles);
    expect(t.revisionColors).toEqual(screenplayStandard.revisionColors);
    expect(t.macros).toEqual(screenplayStandard.macros);
    expect(t.titlePage.map((e) => e.titleField)).toEqual(screenplayStandard.titlePage.map((e) => e.titleField));
    expect(t.id).not.toBe(screenplayStandard.id);
  });
});
