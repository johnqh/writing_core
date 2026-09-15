import { deterministicId } from '../ids/ids.js';
import type { StyleDef, TemplateJSON } from '../schema/template.js';
import { LOCALE_SCRIPT_WORDS, type ScriptLocale } from './script-words.js';

export { LOCALE_SCRIPT_WORDS, SCRIPT_LOCALES, type ScriptLocale, type ScriptWords } from './script-words.js';

export const LOCALIZED_TEMPLATE_KEYS = ['screenplay-standard', 'tv-one-hour', 'tv-half-hour', 'stage-play', 'treatment'] as const;

/**
 * Macro texts are English (" - DAY"), so localized variants ship without macros;
 * writers add their own or apply macros from another document.
 */
export function localizeTemplate(template: TemplateJSON, locale: ScriptLocale): TemplateJSON {
  if (locale === 'en') return template;
  const w = LOCALE_SCRIPT_WORDS[locale];
  const key = `${template.key}-${locale.toLowerCase()}`;
  const keepList = (list: string[], words: string[]) => (list.length > 0 ? [...words] : []);
  return {
    ...template,
    id: deterministicId('tpl', ['builtin', key]),
    key,
    name: `${template.name} (${locale})`,
    locale,
    direction: w.direction,
    continueds: {
      ...template.continueds,
      more: w.more, cont: w.cont, sceneBottom: w.sceneBottom, sceneTop: w.sceneTop,
      sceneTopNumbered: `${w.sceneTop} (#)`, omitted: w.omitted,
    },
    smartType: {
      ...template.smartType,
      sceneIntros: keepList(template.smartType.sceneIntros, w.sceneIntros),
      times: keepList(template.smartType.times, w.times),
      extensions: keepList(template.smartType.extensions, w.extensions),
      transitions: keepList(template.smartType.transitions, w.transitions),
      timeSeparator: w.timeSeparator,
      introSeparator: w.introSeparator,
    },
    macros: [],
    titlePage: template.titlePage.map((e) => (e.titleField === 'credit' ? { ...e, text: w.credit } : e)),
  };
}

const mirrorAlign = (a: StyleDef['align']) => (a === 'left' ? 'right' : a === 'right' ? 'left' : a);

function mirrorStyle(s: StyleDef): StyleDef {
  const out: StyleDef = { ...s };
  delete out.indentLeft;
  delete out.indentRight;
  if (s.indentRight !== undefined) out.indentLeft = s.indentRight;
  if (s.indentLeft !== undefined) out.indentRight = s.indentLeft;
  if (s.align !== undefined) out.align = mirrorAlign(s.align);
  if (s.numbering) {
    const p = s.numbering.position;
    out.numbering = { ...s.numbering, position: p === 'left' ? 'right' : p === 'right' ? 'left' : p };
  }
  return out;
}

export function mirrorTemplate(template: TemplateJSON, key: string, name: string): TemplateJSON {
  const m = template.page.margins;
  return {
    ...template,
    id: deterministicId('tpl', ['builtin', key]),
    key,
    name,
    direction: 'rtl',
    page: { ...template.page, margins: { ...m, left: m.right, right: m.left } },
    header: { ...template.header, left: template.header.right, right: template.header.left },
    footer: { ...template.footer, left: template.footer.right, right: template.footer.left },
    styles: template.styles.map(mirrorStyle),
    titlePageStyles: template.titlePageStyles.map(mirrorStyle),
  };
}
