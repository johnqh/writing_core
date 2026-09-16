import type * as Y from 'yjs';
import { documentLanguage } from '../commands/element-ops.js';
import { LOCALE_SCRIPT_WORDS } from '../templates/script-words.js';

const EXTENSION_RE = /\s*(\([^()]*\))\s*$/;
/** Spec 01 §7.1 step 2: a trailing CONT'D in any locale's `cont` text. */
const ALL_CONT_TEXTS: readonly string[] = [...new Set(Object.values(LOCALE_SCRIPT_WORDS).map((w) => w.cont))];
/**
 * Case- and NFKC-insensitive default known-extension set, used only when a caller doesn't supply
 * its own list: every locale's fixed `extensions` words (V.O., O.S., …) plus every locale's
 * `cont` word. `entityNameKey` never relies on this default — it always passes the document's own
 * `smartType.extensions` list (spec 01 §7.1) so a template's custom extensions are honored too.
 */
const DEFAULT_KNOWN_EXTENSIONS: readonly string[] = [
  ...new Set(Object.values(LOCALE_SCRIPT_WORDS).flatMap((w) => w.extensions)),
  ...ALL_CONT_TEXTS,
];

const foldExtension = (s: string) => s.normalize('NFKC').toUpperCase();

/**
 * Splits a trailing parenthetical off `name`, but only when its content is a *known* extension —
 * an arbitrary parenthetical (`MAYA (YOUNG)`) is part of the name, not an extension (spec 01
 * §7.1). `knownExtensions` defaults to every locale's built-in extension and CONT'D words; a
 * caller with a document (e.g. `entityNameKey`) should pass that document's own list instead.
 */
export function stripExtension(name: string, knownExtensions: Iterable<string> = DEFAULT_KNOWN_EXTENSIONS): { name: string; extension: string | null } {
  const match = EXTENSION_RE.exec(name);
  if (!match) return { name: name.trim(), extension: null };
  const candidate = match[1]!;
  const folded = foldExtension(candidate);
  let known = false;
  for (const k of knownExtensions) if (foldExtension(k) === folded) { known = true; break; }
  if (!known) return { name: name.trim(), extension: null };
  return { name: name.slice(0, match.index).trim(), extension: candidate };
}

/** Spec 01 §7.1. */
export function normalizeKey(
  input: string,
  options: { language?: string; speaker?: boolean; contTexts?: readonly string[]; extensions?: readonly string[] } = {},
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
    s = stripExtension(s, options.extensions ?? DEFAULT_KNOWN_EXTENSIONS).name;
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
 * - **Only a *known* extension collapses.** `MAYA (V.O.)`/`MAYA (CONT'D)` key to `maya`, but
 *   `MAYA (YOUNG)` does not — "known" means the document's own `smartType.extensions` SmartType
 *   list (so a template's custom extensions are honored) plus every locale's CONT'D word.
 */
function documentExtensions(doc: Y.Doc): string[] {
  const entries = doc.getMap<unknown>('smartType').get('extensions') as Y.Map<{ text: string }> | undefined;
  return entries ? [...entries.values()].map((e) => e.text) : [];
}

export function entityNameKey(kind: string, name: string, doc: Y.Doc): string {
  const speaker = kind === 'character';
  return normalizeKey(name, {
    language: documentLanguage(doc),
    speaker,
    extensions: speaker ? [...documentExtensions(doc), ...ALL_CONT_TEXTS] : undefined,
  });
}
