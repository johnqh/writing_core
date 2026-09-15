import { describe, expect, it } from 'vitest';
import { TemplateJSON } from '../../schema/template.js';
import { resolveStyle } from '../../template/resolve.js';
import { validateTemplate } from '../../template/validate.js';
import { inchesToEmu } from '../../units.js';
import type { StyleId } from '../../ids/ids.js';
import { queryLetter } from './query-letter.js';
import { screenplayStandard } from './screenplay-standard.js';
import { textOutline } from './text-outline.js';
import { treatment } from './treatment.js';
import { verticalDrama } from './vertical-drama.js';

const S = (s: string) => s as StyleId;
const all = { screenplayStandard, treatment, textOutline, queryLetter, verticalDrama };

describe('authored templates', () => {
  it.each(Object.entries(all))('%s is valid', (_name, t) => {
    expect(TemplateJSON.safeParse(t).error?.issues ?? []).toEqual([]);
    expect(validateTemplate(t)).toEqual([]);
  });

  it('screenplay standard matches spec 01 §4.3', () => {
    const t = screenplayStandard;
    expect(t.key).toBe('screenplay-standard');
    expect(t.page.margins).toEqual({ top: inchesToEmu(1), bottom: inchesToEmu(1), left: inchesToEmu(1.5), right: inchesToEmu(1) });
    expect(resolveStyle(t, S('st_parenthetical'))).toMatchObject({ indentLeft: inchesToEmu(1.5), indentRight: inchesToEmu(2), indentFirstLine: inchesToEmu(-0.1) });
    expect(resolveStyle(t, S('st_character')).flow).toMatchObject({ onEnter: 'st_dialogue', onTabEmpty: 'st_transition', onTabText: 'st_parenthetical' });
    expect(resolveStyle(t, S('st_lyrics'))).toMatchObject({ indentLeft: inchesToEmu(1), splitRule: 'sentences' });
    expect(resolveStyle(t, S('st_lyrics')).font.italic).toBe(true);
    expect(resolveStyle(t, S('st_summary'))).toMatchObject({ hiddenInScript: true, printable: false });
    expect(t.styles.map((s) => s.id)).toHaveLength(18);
    expect(t.pagination.sceneContinueds.bottom).toBe(false);
  });

  it('vertical drama adds four styles and an episode counter', () => {
    expect(verticalDrama.styles).toHaveLength(screenplayStandard.styles.length + 4);
    expect(verticalDrama.styles.find((s) => s.id === 'st_episode')!.numbering).toMatchObject({ enabled: true, format: 'EPISODE {n}', position: 'inline' });
  });

  it('query letter walks the letter on blank Enter', () => {
    expect(resolveStyle(queryLetter, S('st_sender')).flow.onEnterEmpty).toBe('st_letter_date');
    expect(resolveStyle(queryLetter, S('st_normal')).font.family).toBe('times');
  });

  it('text outline and treatment start on their first styles', () => {
    expect(textOutline.body).toEqual([{ styleKey: 'st_outline_1', text: '' }]);
    expect(treatment.body).toEqual([{ styleKey: 'st_paragraph', text: '' }]);
    expect(treatment.pagination.dialogue.allowBreaks).toBe(false);
  });
});
