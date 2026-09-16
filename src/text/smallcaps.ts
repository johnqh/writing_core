/**
 * Small caps, spec 02 §7.2 (task 10): synthesized, not a real font feature this engine relies
 * on — "lowercase letters are uppercased and set at 0.8× size ... uppercase unchanged. Baseline
 * unchanged." This module only *segments*: it tells a caller which stretches of a run need the
 * uppercase-and-shrink treatment. The actual uppercasing (language-tailored, cluster-mapped) is
 * `./casing.js`'s job — a caller applies `upperCaseWithMap` to each `synthesize: true` run's
 * text itself; `smallCapsRuns` has no `lang` parameter (task 10 brief's exact signature) because
 * classifying a code point as cased-lowercase-or-not needs no language tailoring, only General
 * Category.
 *
 * **Why grapheme clusters, not code points.** A lowercase base letter followed by a
 * General_Category=Mn combining mark (e.g. `a` + COMBINING ACUTE ACCENT) is one visual unit.
 * Classifying code point by code point would put the base in a `synthesize: true` run and its
 * own combining mark in a separate `synthesize: false` run immediately after it — two style
 * runs for one grapheme cluster, which would let the mark render at full size stacked on a
 * shrunk base. Classifying whole grapheme clusters by their first (base) code point keeps a
 * cluster's accent in the same run as its letter.
 */
import { generalCategory } from './ucd.generated.js';
import { graphemeClusters } from './grapheme.js';

export interface SmallCapsRun {
  /** UTF-16 start offset into `text` (inclusive), matching `grapheme.ts`/`linebreak.ts`'s indexing. */
  start: number;
  /** UTF-16 end offset into `text` (exclusive). */
  end: number;
  /** True: this run is lowercase letters that must be uppercased and drawn at 0.8× size. False: drawn unchanged, at full size (already-uppercase letters, digits, punctuation, spaces, …). */
  synthesize: boolean;
}

/** General_Category=Ll (lowercase letter) on the cluster's first code point decides the whole cluster. */
function clusterNeedsSynthesis(text: string, clusterStart: number): boolean {
  const cp = text.codePointAt(clusterStart);
  return cp !== undefined && generalCategory(cp) === 'Ll';
}

/**
 * Segments `text` into maximal runs sharing the same small-caps synthesis need (spec 02 §7.2).
 * Task 10 brief's exact interface. Runs are contiguous and exhaustive: `runs[0].start === 0`,
 * `runs[runs.length-1].end === text.length`, and `runs[i].end === runs[i+1].start` for every i.
 */
export function smallCapsRuns(text: string): SmallCapsRun[] {
  if (text.length === 0) return [];
  const starts = graphemeClusters(text);
  const runs: SmallCapsRun[] = [];
  let runStart = starts[0] as number;
  let runSynth = clusterNeedsSynthesis(text, runStart);
  for (let i = 1; i < starts.length; i++) {
    const clusterStart = starts[i] as number;
    const synth = clusterNeedsSynthesis(text, clusterStart);
    if (synth !== runSynth) {
      runs.push({ start: runStart, end: clusterStart, synthesize: runSynth });
      runStart = clusterStart;
      runSynth = synth;
    }
  }
  runs.push({ start: runStart, end: text.length, synthesize: runSynth });
  return runs;
}
