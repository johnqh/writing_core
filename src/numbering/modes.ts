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
 * `AB2`/`BA2` (§22.2: "for a plain base: prefix a new letters segment: 2→A2,B2,…; for a prefixed
 * label: ∅"). Only a plain `label` yields candidates — inserting before an *already*-prefixed
 * label has no representable slot in AB2/BA2's single-run model (see `generateBetween`'s step 4
 * comment for what that means for the gap-exhausted fallback in these two modes). `direction`
 * picks the same forward/reversed orientation `childSeqAB2` uses — see `orientedRun`.
 */
function* preSeqAB2(label: NumberLabel, n: number, direction: 'forward' | 'reversed'): Generator<NumberLabel> {
  if (label.prefix.length > 0) return;
  for (let j = 1; ; j += 1) {
    yield { base: label.base, prefix: [{ kind: 'letters', value: orientedRun(j, n, direction) }], suffix: label.suffix };
  }
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

function collect(gen: Iterable<NumberLabel>, passes: (l: NumberLabel) => boolean, limit: number): NumberLabel[] {
  const out: NumberLabel[] = [];
  let scanned = 0;
  for (const l of gen) {
    if (out.length >= limit) break;
    if (passes(l)) out.push(l);
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
 * against `P`. For `AB2`/`BA2`, `preSeq(R)` is `∅` whenever `R` already carries a prefix — there
 * is provably no `NumberLabel` under these two modes' single-run, flattened-comparison scheme
 * (`compareLabels`'s `AB2`/`BA2` branch) that sorts before an already-minimally-prefixed `R`
 * (its own prefix letter is already the alphabet's first, and comparing shorter-common-prefix
 * favours the *existing* label, never a longer one) while sharing `R`'s base, and no other base is
 * available between two consecutive locked integers. Rather than silently return fewer than `k`
 * labels or labels with no defined relationship to `R`, that specific case throws.
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
  const step2 = P === null ? [] : collect(childSeq(P, mode, skipIO), below, k);
  if (step2.length >= k) return { labels: step2.slice(0, k), gapExhausted: false };

  // Step 3 (also step 5's first half, with `above` always true when P === null).
  const step3 = collect(preSeq(R, mode, skipIO), above, k);
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
