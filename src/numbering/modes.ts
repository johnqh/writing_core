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
 * Spec 02 §22.3 step 4's corrected AB2/BA2 rule: every `NumberLabel` that sorts strictly below
 * `flat` (a comparison-space prefix array — see `preSeqAB2Prefixed`), enumerated in increasing
 * order. Two kinds of candidate, concatenated in the order that keeps the whole sequence
 * increasing:
 *
 * 1. **Every proper, non-empty prefix of `flat`** — `flat.slice(0, 1), flat.slice(0, 2), …` up to
 *    (but excluding) `flat` itself — each strictly less than the next by §22.2's "a shorter
 *    matching prefix sorts before a longer one" rule, *regardless of what element follows it in
 *    `flat`*. This is what fix round 1 missed: `[1,1]`'s predecessor is `[1]`, the same array
 *    truncated by one, not something computed from whether `[1,1]` is "all ones". A prefix `flat`
 *    of length `L` has `L − 1` of these — `[1,1,1]` (length 3) has exactly two, `[1]` and `[1,1]`,
 *    both real candidates a sufficiently-far-back `P` can land above.
 * 2. **Infinitely many candidates past the last one**, but only when `flat` has a decrementable
 *    position (some element `> 1`): find the last such position, decrement it, and freely extend
 *    further (safe because diverging strictly below `flat`'s own value at a shared position means
 *    every later-appended continuation still compares less than `flat`, regardless of what it is —
 *    this is round 1's `decrementLastPosition` construction, kept, just no longer treated as the
 *    *only* source of candidates). An all-`1`s `flat` has no decrementable position, so this half
 *    contributes nothing and the family is exactly the finite prefix ladder from (1) — which is
 *    correct: there is genuinely nothing between `[1,1]` and `[1,1,1]` (they're parent and
 *    immediate first child), so no amount of cleverness manufactures a third candidate there.
 *
 * Whether this family is finite or infinite is a property of `flat` alone, but whether it contains
 * anything *usable for a given P* is not — `generateBetween`'s own `> P` filter (already correct,
 * unchanged) is what decides that, by scanning this family and taking what clears `P`. Refusal is
 * the caller-visible result of that filter finding nothing, never something this function decides
 * on `flat`'s shape alone: `predecessorFamily([1])` yields nothing (the one truly childless case —
 * length 1, so no proper non-empty prefix exists, and length 1 is never decrementable-then-safe in
 * a way that helps, since `[1]`'s single element is already the minimum), but every longer `flat`
 * yields real candidates regardless of how "minimal" it looks (`[1,1]`, `[1,1,1]`, … all included).
 */
function* predecessorFamily(flat: readonly number[], n: number): Generator<number[]> {
  let lastDecrementable = -1;
  for (let i = flat.length - 1; i >= 0; i -= 1) {
    if (flat[i]! > 1) {
      lastDecrementable = i;
      break;
    }
  }
  const ladderLength = lastDecrementable === -1 ? flat.length - 1 : lastDecrementable;
  for (let len = 1; len <= ladderLength; len += 1) yield flat.slice(0, len);
  if (lastDecrementable === -1) return; // all-ones — the ladder above is the entire family

  const decremented = [...flat.slice(0, lastDecrementable), flat[lastDecrementable]! - 1];
  yield decremented;
  for (let j = 1; ; j += 1) yield [...decremented, ...letterIndexRun(j, n)];
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
 * `1AB`/`1A2`/`romanUpper`/`romanLower`'s prefix comparison (`compareLabels`' non-`AB2`/`BA2`
 * branch) compares `label.prefix` — a *list* of `letters` segments — element by element, "missing
 * < present" on the list's own length. This is `predecessorFamily`'s exact structure one level up:
 * a segment *list* has the same "proper prefix always sorts less, regardless of what follows" and
 * "decrement the last position that has room, then anything after stays less" properties that a
 * flat number array does — `predecessorFamily` already handles the flat case (a single segment's
 * `value`); this handles the list-of-segments case by using `predecessorFamily` *inside* itself,
 * on each segment's own `value`, once a segment position needs to diverge.
 *
 * Enumerates, in increasing order: for each position `i` from `0` to `segs.length - 1` — first the
 * proper prefix `segs.slice(0, i)` (skipped at `i = 0`, since that's the empty list, not a valid
 * *prefixed* candidate — see `preSeqPrependPrefixed`'s caller, which only reaches this function
 * when `label.prefix` is already non-empty), then every candidate `segs.slice(0, i)` followed by a
 * `predecessorFamily` predecessor of `segs[i]`'s own value (possibly none, if that value is itself
 * unpredecessable, e.g. `[1]`). A segment whose value has no predecessor contributes nothing at
 * that position and the loop moves to `i + 1`; if *no* position ever contributes anything, the
 * whole list is a chain of "first child of first child of …" at every level and this yields
 * nothing at all — matching `predecessorFamily`'s own "all-`1`s has no predecessor" base case, one
 * level up.
 */
function* segmentListPredecessorFamily(segs: readonly LabelSegment[], n: number): Generator<LabelSegment[]> {
  for (let i = 0; i < segs.length; i += 1) {
    if (i >= 1) yield segs.slice(0, i);
    const seg = segs[i]!;
    if (seg.kind !== 'letters') {
      throw new RangeError('1AB/1A2/romanUpper/romanLower prefix segment must be a letters segment — got a digits segment');
    }
    for (const predValue of predecessorFamily(seg.value, n)) {
      yield [...segs.slice(0, i), { kind: 'letters', value: predValue }];
    }
  }
}

/**
 * `1AB`/`1A2`/`romanUpper`/`romanLower`, `label.prefix` empty: prepend a brand-new `letters`
 * segment as the new outermost prefix entry, keeping `label`'s own base/suffix untouched
 * underneath it (1→A1,B1…). Always safe regardless of the new segment's value: a *present* prefix
 * always sorts before a *missing* one at the same base (`compareLabels`' hasPrefix-first check),
 * so there's no analogue of `preSeqPrependPrefixed`'s divergence problem here.
 */
function* preSeqPrependPlain(label: NumberLabel, n: number): Generator<NumberLabel> {
  for (let j = 1; ; j += 1) {
    yield { base: label.base, prefix: [lettersSeg(j, n)], suffix: label.suffix };
  }
}

/**
 * `label.prefix` non-empty: **not** a brand-new prepended segment. Fix round 2's Critical
 * (discovered testing round 2's own fix at a deeper derivation than round 1 reached — see
 * `assertGenerateBetweenInvariant` in the test file): prepending a fresh segment *in front of*
 * `label`'s own existing prefix, as this function used to do unconditionally, compares that new
 * segment against `label.prefix`'s own outermost segment at the same list position — if they
 * happen to share the same value (a real, reachable case once a gap-exhausted label has itself
 * been locked and becomes a later call's `R`; spec 23.1's Relock does exactly this), the list
 * lengths differ and `compareSegmentArrays`' "missing < present" rule then says the *longer* one
 * (the newly-prepended one, being one segment deeper) sorts *after* `label`, not before it —
 * `generateBetween` would silently hand back something that fails even the `< R` guarantee §22.3
 * promises for gap-exhausted output. `segmentListPredecessorFamily` is the correct construction:
 * real predecessors of `label.prefix` itself, not a decoration prepended in front of it.
 */
function* preSeqPrependPrefixed(label: NumberLabel, n: number): Generator<NumberLabel> {
  for (const prefix of segmentListPredecessorFamily(label.prefix, n)) {
    yield { base: label.base, prefix, suffix: label.suffix };
  }
}

function* preSeqPrependSegment(label: NumberLabel, n: number): Generator<NumberLabel> {
  if (label.prefix.length === 0) yield* preSeqPrependPlain(label, n);
  else yield* preSeqPrependPrefixed(label, n);
}

/**
 * `AB2`/`BA2`, per spec 02 §22.3's corrected step 4: the refusal condition is "steps 2 and 3
 * produced no candidate", *computed* from **both** endpoints, never inferred from a property of
 * `R` alone — fix round 1's `label.prefix.length > 0 → ∅` and fix round 2's own first attempt
 * (`decrementLastPosition` returning `null` for *any* all-`1`s chain) both made exactly that
 * mistake at a different depth. Two cases:
 *
 * - `label` plain (§22.2: "for a plain base: prefix a new letters segment: 2→A2,B2,…"):
 *   unchanged — any new single-letter prefix sorts before a plain label of the same base
 *   regardless of its value (`compareLabels`' hasPrefix-first rule), so `j=1,2,3,…` all qualify.
 * - `label` prefixed: `predecessorFamily` (comparison space — `label`'s flat prefix as-is for
 *   `AB2`, reversed for `BA2`, matching `orientedRun`'s convention) enumerates *every* candidate
 *   that sorts below `label`, not just one. Whether that family is finite (an all-`1`s prefix) or
 *   infinite is a fact about `label` alone; whether it's *sufficient for a given P* is not this
 *   function's call — `generateBetween`'s `> P` filter decides that by scanning it. This
 *   generator's only refusal is the mathematically forced one: `label`'s prefix exactly `[1]`
 *   (comparison space) yields nothing, because a length-1 array has no proper non-empty prefix and
 *   its single element is already the alphabet minimum.
 *
 * Spec 02 §22.3's own examples, reproduced by `predecessorFamily`: between plain `1` and `AB2`
 * (comparison-space flat `[1,2]`), the first (and spec's own illustrated) candidate is `[1]` =
 * `A2`. Between plain `1` and `AA2` (`[1,1]`), the only candidate is `[1]` = `A2`. Between plain
 * `1` and `AAA2` (`[1,1,1]`), both `[1]` = `A2` and `[1,1]` = `AA2` are candidates, in that order —
 * so a `P` sitting between them (e.g. `P = A2` itself) correctly finds only `AA2` usable, while a
 * `P` further back (e.g. plain `1`) finds both.
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
  const toStorage = (cmp: readonly number[]): number[] => (direction === 'forward' ? [...cmp] : [...cmp].reverse());
  for (const cmp of predecessorFamily(flatCmp, n)) {
    yield { base: label.base, prefix: [{ kind: 'letters', value: toStorage(cmp) }], suffix: label.suffix };
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
 * against `P`. The `< R` guarantee, unlike the `> P` one, is *not* relaxed — and the one case found
 * (fix round 2, testing this fix at a deeper derivation than round 1 reached) where the *old*
 * unconditional-prepend construction could have violated it is exactly why `preSeqPrependSegment`
 * now branches on whether `R` already has a prefix (see `preSeqPrependPrefixed`'s doc comment).
 *
 * `1AB`-family's step 4 below (the `fallback.length < k` check) is not dead code: it throws for
 * real, and correctly, when `R`'s own prefix is itself unpredecessable (`segmentListPredecessorFamily`
 * yields nothing — the `1AB`-family structural analogue of `AB2`/`BA2`'s `[1]` case, one list level
 * up: `R.prefix` reduced to exactly one segment of value `[1]`, i.e. `R` = literal `"A<base>"` with
 * no deeper structure). Spec 02 §22.3 does not currently document this for `1AB`-family — only for
 * `AB2`/`BA2` — since no example in §22.4 or the original step-4 prose reaches it; flagged for the
 * spec owner rather than silently handled, since the code's behaviour (throw, matching `AB2`/`BA2`'s
 * own documented refusal shape and message) is what's provably correct here, independent of whether
 * the prose catches up.
 *
 * `AB2`/`BA2` have no step 4 at all (§22.3: "the prose above … does not generalise") — for these
 * two modes, refusal is exactly "step 2 and the `> P`-*filtered* step 3 produced no candidate",
 * checked below by throwing immediately after step 3 rather than falling through to the unfiltered
 * scan the other modes get. This is *computed from both `P` and `R`*, never inferred from a
 * property of `R` alone: "`R` has a prefix" (fix round 1) and "`R`'s prefix is all `1`s" (fix round
 * 2's first attempt) were each, in turn, a wrong over-generalisation of the one case that's
 * actually unconditional on `R` alone — `R`'s prefix exactly `[1]` (comparison space), the only
 * shape `predecessorFamily` ever yields nothing for. Every longer prefixed `R` has *some* real
 * candidates from `predecessorFamily`, but whether they're *enough for this call* depends on `P`
 * too — e.g. when `P` is `R`'s own immediate parent, `predecessorFamily(R)`'s one candidate at
 * that ladder rung equals `P` itself, so the `> P` filter (correctly) rejects it, and the same `R`
 * against a `P` further back finds it usable. Rather than silently return fewer than `k` labels or
 * a label with no defined relationship to `R` (which falling through to the unfiltered scan below
 * would risk — see the comment at that `if` for the concrete case it would get wrong), that
 * insufficiency throws.
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

  // `AB2`/`BA2` have no step 4 at all (§22.3: "the prose above … does not generalise") — refusal
  // there is exactly "steps 2 and 3 [the `> P`-FILTERED step 3] produced no candidate", full stop.
  // Falling through to the unfiltered scan below for these two modes would be wrong even when
  // `preSeq(R)` (the underlying, unfiltered generator) is non-empty: `predecessorFamily` can yield
  // real candidates that step 3's filter rightly rejected — e.g. `P` = `R`'s own immediate parent,
  // where `preSeq(R)`'s one ladder candidate *equals* `P` itself (§22.2's "nothing sorts between a
  // label and its own immediate first child") — and taking them anyway, unfiltered, would silently
  // hand back a duplicate of `P` instead of refusing. Only `1AB`-family modes get the unfiltered
  // fallback below.
  if (mode === 'AB2' || mode === 'BA2') {
    throw new RangeError(
      `generateBetween: ${mode} numbering has no structural room between the given P and R — the caller must ` +
        'Renumber before inserting here (spec 02 §22.3: AB2/BA2 have no step-4 fallback).',
    );
  }

  // Step 4: gap exhausted — preSeq(R) unfiltered, first k.
  const fallback: NumberLabel[] = [];
  for (const l of preSeq(R, mode, skipIO)) {
    if (fallback.length >= k) break;
    fallback.push(l);
  }
  if (fallback.length < k) {
    throw new RangeError(
      `generateBetween: ${mode} numbering has no structural room between the given P and R (only ` +
        `${fallback.length} of ${k} requested labels could be generated) — the caller must Renumber before ` +
        'inserting here.',
    );
  }
  return { labels: fallback, gapExhausted: true };
}
