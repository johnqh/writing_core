/**
 * Case transforms, spec 02 §7.1 (task 10): all-caps display text with the cluster map that
 * lets carets, selection and hit-testing survive a length-changing transform (`ß`→`SS`,
 * Lithuanian `i̇`→`I`).
 *
 * **Why per-cluster, not one `toLocaleUpperCase` call.** Unicode's case-mapping conditions that
 * matter for *uppercasing* (as opposed to lowercasing, which has the Final_Sigma condition) are
 * all either unconditional (German `ß`→`SS`) or gated purely on the resolved language (Turkish/
 * Azerbaijani `i`→`İ`, Lithuanian `i̇`→`I`, Greek tonos removal) — none of them depend on
 * *neighbouring* characters the way lowercasing's Final_Sigma does. That means transforming one
 * source grapheme cluster at a time and concatenating the results is equivalent to transforming
 * the whole string at once (verified empirically for every case this module is tested against),
 * and doing it per-cluster is what makes the cluster map constructible at all: the map has to
 * know, for every piece of *display* text, which slice of *source* text produced it, and that
 * correspondence only exists at cluster granularity once a transform stops being 1:1 in length.
 *
 * One known gap from this approach, flagged rather than hidden (task 10 report): ICU's Greek
 * uppercasing algorithm has at least one genuinely cross-character rule beyond tonos removal —
 * inserting a dialytika to disambiguate a diphthong that would otherwise misread once accents
 * are stripped (e.g. a "artificial diphthong" case). That rule needs the letter *after* the
 * vowel being cased, which per-cluster processing cannot see. Spec 02 §7.1 names only tonos
 * removal, which this module reproduces exactly (proven by test); the diphthong-disambiguation
 * edge case is not implemented and is out of this task's named scope.
 *
 * **Indexing.** `clusterSource` is UTF-16 code-unit indexed, matching `grapheme.ts`/
 * `linebreak.ts`'s convention (not `bidi.ts`'s code-point convention) — deliberately, because
 * its one real consumer is `GlyphRun.clusterSource` (spec 02 §29.3/§29.4), which spec 02 itself
 * documents as "UTF-16 offset into element source text". `clusterSource[i]` is a UTF-16 offset
 * into `text` (this function's `text` argument), not into `display`.
 */
import { graphemeClusters } from './grapheme.js';

/**
 * All-caps display text (spec 02 §7.1: Unicode full case mapping, language-tailored) plus its
 * cluster map (spec 02 §29.4). `lang` is a BCP 47 language tag — the resolved element language,
 * required (not optional) because Turkish/Azerbaijani `i`→`İ`, Lithuanian `i̇`→`I` and Greek
 * tonos removal are all language-gated: silently defaulting would produce plausible-looking but
 * wrong output for exactly the scripts this function exists to get right.
 *
 * `clusterSource.length === graphemeClusters(display).length`: one entry per *display* grapheme
 * cluster, giving the UTF-16 offset of that cluster's source range start. Per spec 02 §29.4, a
 * cluster's source length is `clusterSource[i+1] − clusterSource[i]` (or `text.length` for the
 * last entry) — a display cluster produced by a length-changing expansion (`ß`→`SS`'s second
 * `S`) is assigned the *end* of its source range rather than a fresh start, so that difference
 * comes out to zero and the caret can never land inside the expansion, only at its start and its
 * true end.
 */
export function upperCaseWithMap(text: string, lang: string): { display: string; clusterSource: Uint32Array } {
  if (text.length === 0) return { display: '', clusterSource: new Uint32Array(0) };

  const whole = text.toLocaleUpperCase(lang);
  if (whole === text) {
    // Fast path (the common case: most screenplay character names are already ASCII upper-case,
    // and this runs on every character-name element on every relayout — spec 02 §33 budget).
    // Nothing changed, so display clusters are exactly source clusters: the map is the
    // identity and building it per-cluster below would recompute what string equality already
    // proved.
    return { display: whole, clusterSource: Uint32Array.from(graphemeClusters(text)) };
  }

  const srcStarts = graphemeClusters(text);
  const displayParts: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < srcStarts.length; i++) {
    const srcStart = srcStarts[i] as number;
    const srcEnd = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : text.length;
    const upperCluster = text.slice(srcStart, srcEnd).toLocaleUpperCase(lang);
    displayParts.push(upperCluster);
    if (upperCluster.length === 0) continue; // a transform that empties a cluster contributes no display cluster
    const displayClusterCount = graphemeClusters(upperCluster).length;
    for (let j = 0; j < displayClusterCount; j++) map.push(j === 0 ? srcStart : srcEnd);
  }
  return { display: displayParts.join(''), clusterSource: Uint32Array.from(map) };
}
