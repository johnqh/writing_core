import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TemplateJSON } from '../../schema/template.js';
import { validateTemplate } from '../../template/validate.js';
import { inchesToEmu } from '../../units.js';
import { GENERATED_TEMPLATES } from '../builtin/generated/index.js';
import { osfTemplateToJSON } from './osf.js';
import { BUILTIN_SOURCES } from './sources.js';

const dir = resolve(process.env.FADEWRIGHT_TEMPLATES_DIR ?? '../screenwriter_plans/research/templates');

describe('generated built-in templates', () => {
  it('are all present, schema-valid and consistent', () => {
    expect(Object.keys(GENERATED_TEMPLATES).sort()).toEqual(BUILTIN_SOURCES.map((s) => s.key).sort());
    for (const t of Object.values(GENERATED_TEMPLATES)) {
      expect(TemplateJSON.safeParse(t).error?.issues ?? []).toEqual([]);
      expect(validateTemplate(t)).toEqual([]);
    }
  });

  it('match spec 01 Appendix A spot values', () => {
    const tv = GENERATED_TEMPLATES['tv-one-hour']!;
    expect(tv.page.margins).toEqual({ top: inchesToEmu(1.25), bottom: inchesToEmu(0.87), left: inchesToEmu(1.25), right: inchesToEmu(1.25) });
    expect(tv.styles.find((s) => s.name === 'Teaser/Act One')).toMatchObject({ role: 'actStart', basedOn: 'st_shot', actBreak: true });
    const av = GENERATED_TEMPLATES['av-two-column']!;
    expect(av.styles.find((s) => s.id === 'st_dialogue')).toMatchObject({ column: 2, lineSpacing: 2 });
    const bbc = GENERATED_TEMPLATES['stage-play-bbc']!;
    expect(bbc.continueds.more).toBe('MORE');
    expect(bbc.page.paper).toBe('a4');
    expect([bbc.page.width, bbc.page.height]).toEqual([7_560_000, 10_692_000]);
    const novel = GENERATED_TEMPLATES['novel-manuscript']!;
    expect(novel.styles.find((s) => s.id === 'st_paragraph')).toMatchObject({ indentFirstLine: inchesToEmu(0.5), lineSpacing: 2 });
    expect(novel.header.right).toBe('{field:author} / {field:title} / {page}');
    expect(novel.titlePage.map((e) => e.titleField)).toContain('wordCount');
    const gn = GENERATED_TEMPLATES['graphic-novel']!;
    expect(gn.layoutMode).toBe('panels');
    expect(gn.smartType.characters).toEqual(['CAPTION:', 'SFX:']);
  });

  it.skipIf(!existsSync(dir))('are byte-for-byte what the generator produces from the research files', () => {
    for (const source of BUILTIN_SOURCES) {
      const xml = readFileSync(join(dir, source.file, 'document.xml'), 'utf8');
      expect(JSON.parse(JSON.stringify(osfTemplateToJSON(xml, source)))).toEqual(GENERATED_TEMPLATES[source.key]);
    }
  });
});
