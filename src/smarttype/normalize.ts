import type * as Y from 'yjs';
import { documentLanguage } from '../commands/element-ops.js';
import { LOCALE_SCRIPT_WORDS } from '../templates/script-words.js';

const EXTENSION_RE = /\s*(\([^()]*\))\s*$/;
/** Spec 01 §7.1 step 2: a trailing CONT'D in any locale's `cont` text. */
const ALL_CONT_TEXTS: readonly string[] = [...new Set(Object.values(LOCALE_SCRIPT_WORDS).map((w) => w.cont))];

export function stripExtension(name: string): { name: string; extension: string | null } {
  const match = EXTENSION_RE.exec(name);
  if (!match) return { name: name.trim(), extension: null };
  return { name: name.slice(0, match.index).trim(), extension: match[1]! };
}

/** Spec 01 §7.1. */
export function normalizeKey(
  input: string,
  options: { language?: string; speaker?: boolean; contTexts?: readonly string[] } = {},
): string {
  let s = input.normalize('NFKC');
  if (options.speaker) {
    // Plain (non-locale) case fold: the CONT'D/extension marker is a fixed ASCII/CJK token from
    // the template, not user prose, so matching it must not depend on the host's default locale
    // (toLocaleUpperCase() with no argument would, e.g. dotted capital I in a Turkish locale).
    for (const cont of options.contTexts ?? ALL_CONT_TEXTS) {
      const i = s.toUpperCase().lastIndexOf(cont.normalize('NFKC').toUpperCase());
      if (i >= 0 && s.slice(i + cont.length).trim() === '') s = s.slice(0, i);
    }
    s = stripExtension(s).name;
  }
  s = s.trim().replace(/\s+/g, ' ');
  while (/[.,:;]$/.test(s)) s = s.slice(0, -1).trimEnd();
  const folded = s.toLocaleLowerCase(options.language ?? 'en');
  // Turkish dotted capital I lower-cases to i + U+0307; drop the combining dot for keys.
  return folded.replace(/i̇/g, 'i');
}

/**
 * The single rule for `entities.nameKey` (spec 01 §7.1), used by every producer and consumer of
 * that key: `entity.create`/`update`/`merge`/`addAlias`/`removeAlias`, harvesting (§7.2) and the
 * read model's `resolveEntity`.
 *
 * Two things it fixes by being one function rather than three near-copies:
 * - **Speaker normalization applies to characters and only to characters.** A cue reads
 *   `MAYA (V.O.)` or `MAYA (CONT'D)`; both key to `maya`. A prop called `GUN (PROP)` keeps its
 *   parenthetical, which is part of its name.
 * - **The language is the document's `meta.language`**, never the host locale the read model
 *   happened to be opened with: case folding is locale-sensitive (Turkish dotted/dotless I), so
 *   keying a lookup on a different language than the write used makes the entity unreachable.
 */
export function entityNameKey(kind: string, name: string, doc: Y.Doc): string {
  return normalizeKey(name, { language: documentLanguage(doc), speaker: kind === 'character' });
}
