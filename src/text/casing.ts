/**
 * Case transforms, spec 02 §7.1 (task 10): all-caps display text with the cluster map that
 * lets carets, selection and hit-testing survive a length-changing transform (`ß`→`SS`,
 * Lithuanian `i̇`→`I`).
 *
 * **Content comes from the whole-string transform, not per-cluster ones — fix round 1.** An
 * earlier version of this module built `display` by uppercasing one source grapheme cluster at
 * a time and concatenating the results, reasoning that no uppercase-relevant SpecialCasing.txt
 * condition depends on neighbouring characters. That reasoning was wrong: CLDR's Greek `el-Upper`
 * transform (the same transform spec 02 §7.1 cites for tonos removal) also inserts a dialytika
 * on ι/υ to disambiguate what would otherwise misread as a diphthong once accents are stripped —
 * e.g. `νεράιδα` → `ΝΕΡΑΪΔΑ` whole-string, but the wrong `ΝΕΡΑΙΔΑ` (no dialytika) if the accented
 * vowel and the following ι are cased independently, because the dialytika is a property of the
 * *pair*, not of either cluster alone. This is systematic (any accented-vowel-then-ι/υ sequence
 * in running Greek text), not an edge case.
 *
 * The fix keeps the whole-string transform's content — `text.toLocaleUpperCase(lang)`, called
 * once, so cross-cluster rules like this one are handled by the same code ICU itself uses — and
 * derives the cluster map by *counting*, not concatenating: for each source cluster, a
 * throwaway per-cluster transform still runs only to learn how many display grapheme clusters
 * that source cluster is expected to contribute (a **structural** question, which — empirically,
 * for every case this module is tested against, including all six Greek dialytika words, `ß`,
 * `ﬁ`/`ﬄ`, standalone and mid-word final sigma, and combining sequences — the dialytika-style
 * content differences never change). Those counts are then used to partition the whole-string
 * transform's *actual* grapheme clusters among the source clusters, in order: content is always
 * `whole`'s, correct for cross-cluster rules; structure (which display cluster maps to which
 * source cluster, and which one is the non-caret second half of an expansion) is exactly what
 * the previous, verified-correct per-cluster method already computed. If the two ever disagree
 * in total count (not observed for any tested input, but not provably impossible for every
 * script), the code falls back to the old fully-per-cluster construction rather than emit a
 * map that doesn't match `display`'s own length.
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
 * tonos removal/dialytika insertion are all language-gated: silently defaulting would produce
 * plausible-looking but wrong output for exactly the scripts this function exists to get right.
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
    // identity and building it below would recompute what string equality already proved.
    return { display: whole, clusterSource: Uint32Array.from(graphemeClusters(text)) };
  }

  const srcStarts = graphemeClusters(text);
  // Per-source-cluster display text (content) and cluster COUNT (structure), from transforming
  // each source cluster in isolation. Content is discarded on the happy path below (`whole`'s
  // own content is used instead, to get cross-cluster rules like Greek dialytika insertion
  // right); the count is what tells the map which of `whole`'s actual clusters belong to which
  // source cluster, and is kept as a fallback's content too.
  const perClusterText: string[] = new Array(srcStarts.length);
  const counts: number[] = new Array(srcStarts.length);
  for (let i = 0; i < srcStarts.length; i++) {
    const srcStart = srcStarts[i] as number;
    const srcEnd = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : text.length;
    const upperCluster = text.slice(srcStart, srcEnd).toLocaleUpperCase(lang);
    perClusterText[i] = upperCluster;
    counts[i] = upperCluster.length > 0 ? graphemeClusters(upperCluster).length : 0;
  }

  const wholeDisplayClusterCount = graphemeClusters(whole).length;
  const totalCounts = counts.reduce((a, b) => a + b, 0);

  const map: number[] = [];
  if (totalCounts === wholeDisplayClusterCount) {
    // Happy path: `whole`'s own clustering has exactly as many display clusters as the
    // per-cluster structural count predicts, so `whole`'s clusters can be handed out to source
    // clusters `counts[i]` at a time, in order — content comes from `whole` (correct for
    // cross-cluster rules), boundaries from the per-cluster structural count (verified correct
    // by the cluster-map regression proof and round-trip test in casing.test.ts).
    for (let i = 0; i < srcStarts.length; i++) {
      const srcStart = srcStarts[i] as number;
      const srcEnd = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : text.length;
      for (let j = 0; j < (counts[i] as number); j++) map.push(j === 0 ? srcStart : srcEnd);
    }
    return { display: whole, clusterSource: Uint32Array.from(map) };
  }

  // Fallback (structural mismatch between the whole-string and per-cluster transforms — not
  // observed for any tested language/script, kept so a future exotic case degrades to the
  // previous, structurally-guaranteed-consistent behaviour instead of an inconsistent map).
  for (let i = 0; i < srcStarts.length; i++) {
    const srcStart = srcStarts[i] as number;
    const srcEnd = i + 1 < srcStarts.length ? (srcStarts[i + 1] as number) : text.length;
    for (let j = 0; j < (counts[i] as number); j++) map.push(j === 0 ? srcStart : srcEnd);
  }
  return { display: perClusterText.join(''), clusterSource: Uint32Array.from(map) };
}
