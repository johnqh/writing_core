import type { TemplateJSON } from '../schema/template.js';
import type { TemplateCategory } from '../schema/vocab.js';
import { queryLetter } from './builtin/query-letter.js';
import { screenplayStandard } from './builtin/screenplay-standard.js';
import { textOutline } from './builtin/text-outline.js';
import { treatment } from './builtin/treatment.js';
import { verticalDrama } from './builtin/vertical-drama.js';
import { GENERATED_TEMPLATES } from './builtin/generated/index.js';
import { LOCALIZED_TEMPLATE_KEYS, SCRIPT_LOCALES, localizeTemplate, mirrorTemplate } from './locale.js';

export const DEFAULT_TEMPLATE_KEY = 'screenplay-standard';

function build(): Record<string, TemplateJSON> {
  const base: Record<string, TemplateJSON> = {
    ...GENERATED_TEMPLATES,
    [screenplayStandard.key!]: screenplayStandard,
    [treatment.key!]: treatment,
    [textOutline.key!]: textOutline,
    [queryLetter.key!]: queryLetter,
    [verticalDrama.key!]: verticalDrama,
  };
  const out: Record<string, TemplateJSON> = { ...base };
  for (const key of LOCALIZED_TEMPLATE_KEYS) {
    for (const locale of SCRIPT_LOCALES) {
      if (locale === 'en') continue;
      const t = localizeTemplate(base[key]!, locale);
      out[t.key!] = t;
    }
  }
  const rtl = mirrorTemplate(screenplayStandard, 'screenplay-standard-rtl', 'Screenplay (Right-to-Left)');
  out[rtl.key!] = rtl;
  return out;
}

export const BUILTIN_TEMPLATES: Readonly<Record<string, TemplateJSON>> = Object.freeze(build());

export function getBuiltinTemplate(key: string): TemplateJSON | undefined {
  return BUILTIN_TEMPLATES[key];
}

export function listBuiltinTemplates(filter: { locale?: string; category?: TemplateCategory } = {}): TemplateJSON[] {
  return Object.values(BUILTIN_TEMPLATES).filter(
    (t) => (filter.locale === undefined || t.locale === filter.locale) && (filter.category === undefined || t.category === filter.category),
  );
}
