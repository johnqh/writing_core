import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '../../hash/canonical-json.js';
import { sha256Hex } from '../../hash/sha256.js';
import { TemplateJSON } from '../../schema/template.js';
import { validateTemplate } from '../../template/validate.js';
import { inchesToEmu } from '../../units.js';
import CHECKSUMS from '../builtin/generated/checksums.json' with { type: 'json' };
import { GENERATED_TEMPLATES } from '../builtin/generated/index.js';
import { osfTemplateToJSON } from './osf.js';
import { BUILTIN_SOURCES } from './sources.js';

const explicitDir = process.env.FADEWRIGHT_TEMPLATES_DIR;
const dir = resolve(explicitDir ?? '../screenwriter_plans/research/templates');
const sourcesPresent = existsSync(dir);

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

  /**
   * The drift guard that runs EVERYWHERE, including CI, where the research repo (a separate,
   * private sibling) is not checked out. `checksums.json` is written by
   * `bun run templates:generate` alongside the modules, so hand-editing a file under
   * `builtin/generated/` — which its header forbids — fails here instead of shipping silently.
   * Before this existed, the only protection was the byte-for-byte test below, which quietly
   * skipped whenever the sources were absent: the 14 shipped templates had no CI guard at all.
   */
  it('match their vendored checksums, with or without the research sources', () => {
    const actual = Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, `v1:${sha256Hex(canonicalJSON(GENERATED_TEMPLATES[s.key]!))}`]));
    const expected = Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, (CHECKSUMS as Record<string, { template: string }>)[s.key]?.template]));
    expect(actual).toEqual(expected);
  });

  describe.skipIf(!sourcesPresent)('against the research sources', () => {
    it('read the exact source files the committed modules were generated from', () => {
      const actual = Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, `v1:${sha256Hex(readFileSync(join(dir, s.file, 'document.xml'), 'utf8'))}`]));
      const expected = Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, (CHECKSUMS as Record<string, { source: string }>)[s.key]?.source]));
      expect(actual).toEqual(expected);
    });

    it('are byte-for-byte what the generator produces from the research files', () => {
      for (const source of BUILTIN_SOURCES) {
        const xml = readFileSync(join(dir, source.file, 'document.xml'), 'utf8');
        expect(JSON.parse(JSON.stringify(osfTemplateToJSON(xml, source)))).toEqual(GENERATED_TEMPLATES[source.key]);
      }
    });
  });

  // A silent skip is what hid the gap in the first place. If someone points at a templates
  // directory explicitly, a missing one is their mistake, not a reason to pass quietly.
  it('fail rather than skip when a templates directory was named explicitly', () => {
    expect(explicitDir === undefined || sourcesPresent, `FADEWRIGHT_TEMPLATES_DIR=${explicitDir} does not exist`).toBe(true);
  });
});
