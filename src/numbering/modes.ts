import type { LabelSegment, NumberLabel } from '../schema/template.js';
import type { NumberMode } from '../schema/vocab.js';
import { alphabetFor, compareLabels } from '../read-model/number-label.js';

// ─── Spec 02 §22.3: insertion-mode generation ──────────────────────────────────────────────────
//
// `childSeq`/`preSeq` are per-mode INFINITE, STRICTLY INCREASING (under `compareLabels(mode)`)
// generators of candidate labels — §22.2's table, made concrete. `generateBetween` is §22.3's
// four/five-step algorithm built on top of them. Every helper here builds `NumberLabel` values
// directly (no string parsing) and never touches `custom` (Edit Number's free-text override is a
// display concern, not a generation concern — spec 02 §23.1).

/**
 * §22.1's Z-extension, generalized to any starting index: the k-th (1-based) letter position,
 * returned as the `LabelSegment.value` array it renders from — `[r]` while `k <= alphabetLen`
 * (a single letter), then `Z`-repeated `q` times followed by the wrapped remainder once `k`
 * overflows the alphabet (`k = alphabetLen + 1` → `[n, 1]` → "ZA", …), exactly the continuation
 * spec 02 §22.1 describes. Every element of the returned array is within `1..alphabetLen`, so
 * feeding it to `letters()` never hits that function's own overflow-repeat quirk (task 12 note 1
 * in the task 13 brief) — this is a *different*, deliberate multi-element encoding of overflow,
 * not the same code path.
 */
function letterIndexRun(k: number, alphabetLen: number): number[] {
  const q = Math.floor((k - 1) / alphabetLen);
  const r = ((k - 1) % alphabetLen) + 1;
  return [...Array(q).fill(alphabetLen), r];
}

function lettersSeg(k: number, n: number): LabelSegment {
  return { kind: 'letters', value: letterIndexRun(k, n) };
}

/**
 * `letterIndexRun` oriented for the direction its array will be read in at comparison time.
 * `'forward'` (every mode except a `BA2` prefix) stores it as-is. `'reversed'` (`BA2`'s prefix:
 * `compareLabels`'s `BA2` branch compares the *whole flattened prefix reversed*, right-to-left)
 * stores it pre-reversed, so the reversal `compareLabels` applies at comparison time cancels back
 * to the plain, already-monotonic `letterIndexRun` sequence in that position.
 *
 * This only changes anything beyond one alphabet band (`k > alphabetLen`): within a band
 * `letterIndexRun` is a single element and reversing it is a no-op, so every §22.4 vector (none
 * needs more than 10 letters) renders identically either way. It matters once `k` overflows — the
 * property test's random `k` (up to 60) is what surfaced this: without the pre-reversal, `BA2`'s
 * childSeq/preSeq stopped being strictly increasing right at the alphabet-band boundary (e.g.
 * `k=26`'s "Z" would compare *greater* than `k=27`'s "ZA"-shaped run under the mode's own reversed
 * comparator), which a table vector capped at 10 letters could never have caught.
 */
function orientedRun(k: number, n: number, direction: 'forward' | 'reversed'): number[] {
  const run = letterIndexRun(k, n);
  return direction === 'forward' ? run : [...run].reverse();
}

function lastSegmentKind(segs: readonly LabelSegment[]): 'none' | 'letters' | 'digits' {
  return segs.length === 0 ? 'none' : segs[segs.length - 1]!.kind;
}

/**
 * Spec 02 §22.3 step 4's corrected AB2/BA2 rule: the lexicographic predecessor of `flat`, found by
 * scanning from the end for the last position that isn't already the alphabet's first letter (`1`),
 * decrementing it and truncating everything after — the standard "borrow" construction for finding
 * what sorts immediately before a sequence when it can be freely extended with more elements
 * (`[1,2]` → `[1,1]`; `[2,1,1]` → `[1]`, borrowing across two trailing `1`s). Returns `null` when
 * every element is already `1` (`flat` is a chain of "first child of first child of …" down to the
 * base) — there is no shorter or lexicographically-earlier sequence at this base, which is exactly
 * §22.3's "only a *minimally* prefixed R … leaves no room" (generalized: not just `[1]` itself, but
 * any all-`1`s chain, since each level is itself a minimal-child case one level up).
 */
function decrementLastPosition(flat: readonly number[]): number[] | null {
  for (let i = flat.length - 1; i >= 0; i -= 1) {
    if (flat[i]! > 1) return [...flat.slice(0, i), flat[i]! - 1];
  }
  return null;
}

// ─── childSeq ───────────────────────────────────────────────────────────────────────────────────

/** `1AB`: append a brand-new `letters` segment to the suffix each step (1→1A,1B…; 1A→1AA,1AB…). */
function* childSeq1AB(label: NumberLabel, n: number): Generator<NumberLabel> {
  for (let j = 1; ; j += 1) {
    yield { base: label.base, prefix: label.prefix, suffix: [...label.suffix, lettersSeg(j, n)] };
  }
}

/**
 * `1A2` (and, structurally, `romanUpper`/`romanLower` — §22.2: "as `1A2`"; only *rendering*
 * differs, via `formatNumberLabel`'s `mode` option, not the `NumberLabel` shape built here):
 * append a segment whose kind alternates with the current last suffix segment (none/digits →
 * letters; letters → digits).
 */
function* childSeq1A2(label: NumberLabel, n: number): Generator<NumberLabel> {
  const nextIsLetters = lastSegmentKind(label.suffix) !== 'letters';
  for (let j = 1; ; j += 1) {
    const seg: LabelSegment = nextIsLetters ? lettersSeg(j, n) : { kind: 'digits', value: j };
    yield { base: label.base, prefix: label.prefix, suffix: [...label.suffix, seg] };
  }
}

/**
 * `AB2`/`BA2`: both model the prefix as a single accumulated `letters` run (never more than one
 * segment — `preSeqAB2` below is the only place a prefix segment is created, and it always
 * creates exactly one). A plain base (`prefix.length === 0`) has no children (§22.2: "for a
 * plain base: ∅") — AB2/BA2 attach only to the *next* integer, never grow a base's own suffix.
 * `side` picks growth at the right end (`AB2`: A2→AA2,AB2…) or the left end (`BA2`: A2→AA2,BA2,
 * CA2…, i.e. prepend, not append — `letterIndexRun`'s whole multi-element run is prepended as one
 * block so a later overflow still reads as a single contiguous Z-run). Throws if a prefix segment
 * is ever anything but `letters`: no generator here or in `preSeqAB2` can produce a `digits`
 * prefix segment for these two modes, so hitting one means an upstream caller handed in a label
 * this module never built — better to fail loudly than to silently feed
 * `compareLabels`'s `flattenLetterIndices` (which drops non-letters segments) a value it was
 * never meant to see.
 */
function* childSeqAB2(label: NumberLabel, n: number, side: 'right' | 'left'): Generator<NumberLabel> {
  if (label.prefix.length === 0) return;
  const seg0 = label.prefix[0]!;
  if (seg0.kind !== 'letters') {
    throw new RangeError('AB2/BA2 prefix segment must be a letters segment — got a digits segment');
  }
  for (let j = 1; ; j += 1) {
    const run = orientedRun(j, n, side === 'right' ? 'forward' : 'reversed');
    const value = side === 'right' ? [...seg0.value, ...run] : [...run, ...seg0.value];
    yield { base: label.base, prefix: [{ kind: 'letters', value }], suffix: label.suffix };
  }
}

/**
 * Dispatches on mode. `skipIO` selects the 24- vs 26-letter alphabet (§22.1) that every
 * letters-segment step draws from.
 */
export function* childSeq(label: NumberLabel, mode: NumberMode, skipIO: boolean): Iterable<NumberLabel> {
  const n = alphabetFor(skipIO).length;
  switch (mode) {
    case '1AB':
      yield* childSeq1AB(label, n);
      return;
    case '1A2':
    case 'romanUpper':
    case 'romanLower':
      yield* childSeq1A2(label, n);
      return;
    case 'AB2':
      yield* childSeqAB2(label, n, 'right');
      return;
    case 'BA2':
      yield* childSeqAB2(label, n, 'left');
      return;
  }
}

// ─── preSeq ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `1AB`/`1A2`/`romanUpper`/`romanLower`: prepend a brand-new `letters` segment as the new
 * outermost prefix entry, keeping `label`'s own base/prefix/suffix untouched underneath it
 * (1→A1,B1…). This is also, unfiltered, exactly §22.3 step 4's "prefix fallback … prefixed to
 * R's full label" — `generateBetween` reuses this same generator for both steps 3 and 4, only the
 * `> P` filter differs.
 */
function* preSeqPrependSegment(label: NumberLabel, n: number): Generator<NumberLabel> {
  for (let j = 1; ; j += 1) {
    yield { base: label.base, prefix: [lettersSeg(j, n), ...label.prefix], suffix: label.suffix };
  }
}

/**
 * `AB2`/`BA2`, generalized per spec 02 §22.3's corrected step 4: the refusal condition is
 * "steps 2 and 3 produced no candidate", *computed*, never inferred from whether `R` has a
 * prefix. Two cases:
 *
 * - `label` plain (§22.2: "for a plain base: prefix a new letters segment: 2→A2,B2,…"):
 *   unchanged — any new single-letter prefix sorts before a plain label of the same base
 *   regardless of its value (`compareLabels`' hasPrefix-first rule), so `j=1,2,3,…` all qualify.
 * - `label` prefixed: find `label`'s lexicographic predecessor at this base via
 *   `decrementLastPosition` (run in *comparison space* — `label`'s flat prefix as-is for `AB2`,
 *   reversed for `BA2`, matching `orientedRun`'s convention) and yield it as the first candidate,
 *   then keep extending it further (still in comparison space, so the extension is monotonic
 *   under the mode's own comparator) for every candidate after that. `null` (every comparison-space
 *   element is already `1` — `label` is a chain of first-children down to the base) means no
 *   predecessor exists at all: yields nothing, `∅`, which is the only case these two modes
 *   genuinely have no step 4 for (see `generateBetween`'s doc comment on the resulting throw).
 *
 * Spec 02 §22.3's own examples: between plain `1` and `AB2` (comparison-space flat `[1,2]`), the
 * predecessor is `[1,1]` = `AA2` (spec illustrates `A2`, a *different* valid candidate — both sort
 * strictly between; this generator doesn't need to match spec's illustration verbatim, only to
 * produce *a* correct one). Between plain `1` and `BA2` (stored `[2,1]`, comparison-space
 * `reverse([2,1]) = [1,2]`), the predecessor in comparison space is also `[1,1]`, converted back to
 * storage space (`reverse` again, self-inverse here) as `[1,1]` = `AA2` — matching spec exactly.
 */
function* preSeqAB2Plain(label: NumberLabel, n: number, direction: 'forward' | 'reversed'): Generator<NumberLabel> {
  for (let j = 1; ; j += 1) {
    yield { base: label.base, prefix: [{ kind: 'letters', value: orientedRun(j, n, direction) }], suffix: label.suffix };
  }
}

function* preSeqAB2Prefixed(label: NumberLabel, n: number, direction: 'forward' | 'reversed'): Generator<NumberLabel> {
  const seg0 = label.prefix[0]!;
  if (seg0.kind !== 'letters') {
    throw new RangeError('AB2/BA2 prefix segment must be a letters segment — got a digits segment');
  }
  const flatCmp = direction === 'forward' ? seg0.value : [...seg0.value].reverse();
  const predCmp = decrementLastPosition(flatCmp);
  if (predCmp === null) return; // label is an all-minimal chain — genuinely no predecessor at this base

  const toStorage = (cmp: readonly number[]): number[] => (direction === 'forward' ? [...cmp] : [...cmp].reverse());
  yield { base: label.base, prefix: [{ kind: 'letters', value: toStorage(predCmp) }], suffix: label.suffix };
  for (let j = 1; ; j += 1) {
    const grown = [...predCmp, ...letterIndexRun(j, n)];
    yield { base: label.base, prefix: [{ kind: 'letters', value: toStorage(grown) }], suffix: label.suffix };
  }
}

function* preSeqAB2(label: NumberLabel, n: number, direction: 'forward' | 'reversed'): Generator<NumberLabel> {
  if (label.prefix.length === 0) yield* preSeqAB2Plain(label, n, direction);
  else yield* preSeqAB2Prefixed(label, n, direction);
}

export function* preSeq(label: NumberLabel, mode: NumberMode, skipIO: boolean): Iterable<NumberLabel> {
  const n = alphabetFor(skipIO).length;
  switch (mode) {
    case '1AB':
    case '1A2':
    case 'romanUpper':
    case 'romanLower':
      yield* preSeqPrependSegment(label, n);
      return;
    case 'AB2':
      yield* preSeqAB2(label, n, 'forward');
      return;
    case 'BA2':
      yield* preSeqAB2(label, n, 'reversed');
      return;
  }
}

// ─── generateBetween ────────────────────────────────────────────────────────────────────────────

/**
 * A candidate/filter scan is capped rather than run to exhaustion: both `childSeq` and `preSeq`
 * are infinite, and while every case reachable from a real locked sequence resolves within a
 * handful of steps, an unbounded scan would hang instead of failing loudly on a future mode or
 * caller bug. 5000 comfortably covers any k this engine's document sizes call for.
 */
const SCAN_CAP = 5000;

/**
 * `gen` is always a strictly-increasing sequence (childSeq/preSeq) and `passes` always compares
 * each candidate against one fixed label (`< R` for step 2, `> P` for step 3) — a fixed threshold
 * against an increasing sequence crosses at most once, so `passes` is monotonic. Which direction
 * it's monotonic in depends on which side of the comparison the increasing sequence sits on:
 * `< R` (step 2) starts `true` and goes `false` forever once it does (the sequence has grown past
 * `R`), so scanning can stop the instant it first fails — no later candidate can pass again.
 * `> P` (step 3) is the mirror image (starts `false`, becomes `true` forever) — a failure there
 * does *not* mean every later candidate fails too. Example: mode `1AB`, `P = {base:10, prefix:
 * [{letters:[1]}]}` ("A10"), `R = {base:10}` ("10", plain) — `preSeq(R)`'s j=1 candidate is also
 * "A10" itself (equal to `P`, `> P` fails), but j=2 ("B10") passes and every later `j` keeps
 * passing. So a step-3 scan still needs the `SCAN_CAP` bound rather than an early exit on failure.
 */
function collect(
  gen: Iterable<NumberLabel>,
  passes: (l: NumberLabel) => boolean,
  limit: number,
  onFailure: 'stop' | 'keep-scanning',
): NumberLabel[] {
  const out: NumberLabel[] = [];
  let scanned = 0;
  for (const l of gen) {
    if (out.length >= limit) break;
    if (passes(l)) {
      out.push(l);
    } else if (onFailure === 'stop') {
      break;
    }
    scanned += 1;
    if (scanned >= SCAN_CAP) break;
  }
  return out;
}

/**
 * §22.3: `k` new labels between locked `P` (previous, or `null` at the start) and `R` (next, or
 * `null` at the end).
 *
 * Step 4 (gap exhausted) reuses `preSeq(R)` unfiltered — §22.3's "prefix fallback … prefixed to
 * R's full label" is exactly `preSeqPrependSegment`/`preSeqAB2` without the `> P` requirement, so
 * no separate generator exists for it. The returned labels are a *last-resort placeholder*, not a
 * guaranteed position: spec 02 §22.4's own worked example (`1AB | 10 | 10A | 1 → A10A`) sorts
 * *before* `P` under `compareLabels` (a prefixed label sorts before a same-base plain one), so
 * gap-exhausted output is diagnosed via the returned `gapExhausted` flag, not guaranteed ordering
 * against `P`.
 *
 * `AB2`/`BA2` have no step 4 in the `1AB`-style sense (§22.3: "the prose above … does not
 * generalise"), but the refusal is *narrow* and *computed*, never inferred from whether `R` has a
 * prefix: `preSeqAB2` (see its doc comment) generates real candidates for any `R` whose prefix
 * isn't an all-first-child chain (`[1]`, `[1,1]`, …) at every level — only that specific case has
 * provably no `NumberLabel` under these two modes' single-run, flattened-comparison scheme that
 * sorts before it while sharing `R`'s base, with no other base available between two consecutive
 * locked integers. Rather than silently return fewer than `k` labels or labels with no defined
 * relationship to `R`, that specific case throws.
 */
export function generateBetween(
  P: NumberLabel | null,
  R: NumberLabel | null,
  k: number,
  mode: NumberMode,
  skipIO: boolean,
): { labels: NumberLabel[]; gapExhausted: boolean } {
  if (k <= 0) return { labels: [], gapExhausted: false };

  // Step 1: R === null — continue integers from P.base + 1, no suffixes (Final Draft behaviour).
  if (R === null) {
    const startBase = (P?.base ?? 0) + 1;
    const labels = Array.from({ length: k }, (_, i) => ({ base: startBase + i, prefix: [], suffix: [] }));
    return { labels, gapExhausted: false };
  }

  const below = (l: NumberLabel): boolean => compareLabels(l, R, mode) < 0;
  const above = (l: NumberLabel): boolean => P === null || compareLabels(l, P, mode) > 0;

  // Step 2 (and step 5's "P === null" skips straight past this — childSeq(null) has no meaning).
  const step2 = P === null ? [] : collect(childSeq(P, mode, skipIO), below, k, 'stop');
  if (step2.length >= k) return { labels: step2.slice(0, k), gapExhausted: false };

  // Step 3 (also step 5's first half, with `above` always true when P === null).
  const step3 = collect(preSeq(R, mode, skipIO), above, k, 'keep-scanning');
  if (step3.length >= k) return { labels: step3.slice(0, k), gapExhausted: false };

  // Step 4: gap exhausted — preSeq(R) unfiltered, first k.
  const fallback: NumberLabel[] = [];
  for (const l of preSeq(R, mode, skipIO)) {
    if (fallback.length >= k) break;
    fallback.push(l);
  }
  if (fallback.length < k) {
    throw new RangeError(
      `generateBetween: ${mode} numbering has no structural room between the given P and R (R is already ` +
        'prefixed, so no label can be generated that sorts before it) — the caller must Renumber before inserting here.',
    );
  }
  return { labels: fallback, gapExhausted: true };
}
