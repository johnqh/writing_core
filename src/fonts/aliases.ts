/**
 * Spec 02 §3.2's import-time name mapping: source font names (as importers, spec 04,
 * see them in DOCX/RTF/FDX/etc.) to spec 01's `FontFamilyId`. The paginator never sees
 * raw names — only `aliasFor`'s result or a name the classifier already turned into
 * `serif`/`sans`/`mono` (spec 01 §3.4.3), which this table does not attempt.
 */
import type { FontFamilyId } from '../schema/primitives.js';

/** Collapse whitespace and case so `"  Courier   New "` and `"courier new"` are the same key. */
function normalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Keyed by the normalized (lowercase, whitespace-collapsed) source name. Case folding uses
 * `toLowerCase()`, never `toLocaleLowerCase()` — this table has no locale-dependent casing
 * rule to preserve, and the platform-free guard rejects the locale-dependent form.
 */
export const FONT_ALIASES: Record<string, FontFamilyId> = Object.fromEntries(
  (
    [
      [
        'courier-screenplay',
        [
          'Courier Screenplay',
          'Courier Final Draft',
          'Courier',
          'Courier Prime',
          'Courier 10 Pitch',
          'Courier Std',
          'Final Draft Courier',
        ],
      ],
      ['courier-new', ['Courier New', 'Liberation Mono', 'Cousine']],
      ['times', ['Times New Roman', 'Times', 'Tinos', 'Liberation Serif']],
      ['arial', ['Arial', 'Helvetica', 'Helvetica Neue', 'Arimo', 'Liberation Sans']],
      ['calibri', ['Calibri']],
      ['cambria', ['Cambria']],
      ['georgia', ['Georgia']],
    ] as const satisfies readonly (readonly [FontFamilyId, readonly string[]])[]
  ).flatMap(([familyId, names]) => names.map((name) => [normalize(name), familyId] as const)),
);

/**
 * Resolves a raw source font name to a `FontFamilyId`, or `null` when this table does not
 * know it — in that case spec 01 §3.4.3's classifier decides `serif`/`sans`/`mono`, not this
 * module.
 */
export function aliasFor(sourceName: string): FontFamilyId | null {
  return FONT_ALIASES[normalize(sourceName)] ?? null;
}
