import { normalizeKey } from '../smarttype/normalize.js';

export interface HeadingVocabulary {
  sceneIntros: readonly string[];
  times: readonly string[];
  introSeparator: string;
  timeSeparator: string;
  language?: string;
}

export interface ParsedSceneHeading {
  intro: string | null;
  location: string;
  subLocations: string[];
  time: string | null;
  raw: string;
  nonstandardSeparator: boolean;
}

export const INTRO_VARIANTS: Readonly<Record<string, string>> = { 'I/E': 'I/E', 'INT/EXT': 'INT/EXT', 'EXT./INT.': 'EXT./INT.' };

/** Spec 01 §7.3. */
export function parseSceneHeading(text: string, vocab: HeadingVocabulary): ParsedSceneHeading {
  const raw = text;
  const lang = vocab.language ?? 'en';
  const intros = [...vocab.sceneIntros, ...Object.keys(INTRO_VARIANTS)].sort((a, b) => b.length - a.length);
  let intro: string | null = null;
  let rest = text.trim();
  for (const candidate of intros) {
    if (!rest.toLocaleUpperCase(lang).startsWith(candidate.toLocaleUpperCase(lang))) continue;
    const after = rest.slice(candidate.length);
    const boundary = vocab.introSeparator === '' || after === '' || /^[\s.]/.test(after) || candidate.endsWith('.');
    if (!boundary) continue;
    intro = candidate;
    rest = vocab.introSeparator === '' ? after.trim() : after.replace(/^[\s.]+/, '');
    break;
  }

  const timeKeys = new Map(vocab.times.map((t) => [normalizeKey(t, { language: lang }), t] as const));
  let time: string | null = null;
  let nonstandardSeparator = false;
  const sep = vocab.timeSeparator.trim();
  const lastSep = sep ? rest.lastIndexOf(sep) : -1;
  if (lastSep >= 0) {
    const candidate = normalizeKey(rest.slice(lastSep + sep.length), { language: lang });
    if (timeKeys.has(candidate)) {
      time = timeKeys.get(candidate)!;
      rest = rest.slice(0, lastSep);
    }
  }
  if (time === null) {
    const comma = rest.lastIndexOf(', ');
    if (comma >= 0) {
      const candidate = normalizeKey(rest.slice(comma + 2), { language: lang });
      if (timeKeys.has(candidate)) {
        time = timeKeys.get(candidate)!;
        rest = rest.slice(0, comma);
        nonstandardSeparator = true;
      }
    }
  }
  const location = rest.trim();
  // Sub-locations split on the full separator (' - ', spec 01 §7.2), so WILKES-BARRE stays one place.
  const subLocations = sep ? location.split(vocab.timeSeparator).map((s) => s.trim()).filter(Boolean) : [location];
  return { intro, location, subLocations, time, raw, nonstandardSeparator };
}
