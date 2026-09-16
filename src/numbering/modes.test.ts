import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LabelSegment, NumberLabel } from '../schema/template.js';
import { NUMBER_MODES, type NumberMode } from '../schema/vocab.js';
import { compareLabels, formatNumberLabel } from '../read-model/number-label.js';
import { childSeq, generateBetween, preSeq } from './modes.js';

// ─── Test-local label builders (same shape as src/read-model/number-label.test.ts's, redefined
// here rather than imported: they're test-only conveniences, not part of either file's contract) ─
function letterSeg(...value: number[]): LabelSegment {
  return { kind: 'letters', value };
}
function digitSeg(value: number): LabelSegment {
  return { kind: 'digits', value };
}
function plain(base: number): NumberLabel {
  return { base, prefix: [], suffix: [] };
}
function label(base: number, prefix: LabelSegment[] = [], suffix: LabelSegment[] = []): NumberLabel {
  return { base, prefix, suffix };
}
function render(l: NumberLabel, mode: NumberMode, skipIO = false): string {
  return formatNumberLabel(l, { skipIO, mode });
}

// ─── §22.4 worked mode examples — normative test vectors, transcribed verbatim ────────────────
//
// NOTE: per spec 02 §22.4's own header, this whole table is "subject to verification task V-02-1"
// (§37.7) — these are writing_core's reading of Fade In's actual generation behaviour, not
// something derived from Fade In documentation (which names the modes but not their algorithm).
// If V-02-1 finds Fade In disagrees with a row, the row changes and `LAYOUT_ENGINE_VERSION`
// bumps — this table is not to be treated as unconditionally authoritative forever.
//
// The `skipIO` row is the arithmetically correct one (spec 02 §22.4 was corrected to match it,
// not the other way round): with I and O removed from the alphabet, the 10th generated label is
// `10K` (A B C D E F G H J K — J is the 9th surviving letter, K the 10th).
const VECTORS: ReadonlyArray<{
  name: string;
  mode: NumberMode;
  skipIO?: boolean;
  P: NumberLabel | null;
  R: NumberLabel | null;
  k: number;
  want: string[];
  gapExhausted?: boolean;
}> = [
  { name: '1AB | 10 | 11 | 3', mode: '1AB', P: plain(10), R: plain(11), k: 3, want: ['10A', '10B', '10C'] },
  {
    name: '1AB | 10A | 10B | 2', mode: '1AB', P: label(10, [], [letterSeg(1)]), R: label(10, [], [letterSeg(2)]), k: 2,
    want: ['10AA', '10AB'],
  },
  {
    name: '1AB | 10 | 10A | 1 (gap exhausted)', mode: '1AB', P: plain(10), R: label(10, [], [letterSeg(1)]), k: 1,
    want: ['A10A'], gapExhausted: true,
  },
  {
    name: '1AB skipIO | 10 | 11 | 10', mode: '1AB', skipIO: true, P: plain(10), R: plain(11), k: 10,
    want: ['10A', '10B', '10C', '10D', '10E', '10F', '10G', '10H', '10J', '10K'],
  },
  {
    name: '1A2 | 10A | 10B | 2', mode: '1A2', P: label(10, [], [letterSeg(1)]), R: label(10, [], [letterSeg(2)]), k: 2,
    want: ['10A1', '10A2'],
  },
  {
    name: '1A2 | 10A1 | 10A2 | 1', mode: '1A2',
    P: label(10, [], [letterSeg(1), digitSeg(1)]), R: label(10, [], [letterSeg(1), digitSeg(2)]), k: 1,
    want: ['10A1A'],
  },
  { name: 'AB2 | 1 | 2 | 2', mode: 'AB2', P: plain(1), R: plain(2), k: 2, want: ['A2', 'B2'] },
  {
    name: 'AB2 | A2 | B2 | 2', mode: 'AB2', P: label(2, [letterSeg(1)]), R: label(2, [letterSeg(2)]), k: 2,
    want: ['AA2', 'AB2'],
  },
  {
    name: 'BA2 | A2 | B2 | 2', mode: 'BA2', P: label(2, [letterSeg(1)]), R: label(2, [letterSeg(2)]), k: 2,
    want: ['AA2', 'BA2'],
  },
  { name: 'romanUpper | I | II | 2', mode: 'romanUpper', P: plain(1), R: plain(2), k: 2, want: ['I(A)', 'I(B)'] },
  {
    name: 'romanLower | i(a) | i(b) | 1', mode: 'romanLower',
    P: label(1, [], [letterSeg(1)]), R: label(1, [], [letterSeg(2)]), k: 1, want: ['i(a)(1)'],
  },
  {
    name: '1AB | 10Z | 11 | 2', mode: '1AB', P: label(10, [], [letterSeg(26)]), R: plain(11), k: 2,
    want: ['10ZA', '10ZB'],
  },
  { name: 'any | 42 | null | 2', mode: '1AB', P: plain(42), R: null, k: 2, want: ['43', '44'] },
];

describe('generateBetween — §22.4 normative vectors', () => {
  it.each(VECTORS)('$name', ({ mode, skipIO, P, R, k, want, gapExhausted }) => {
    const result = generateBetween(P, R, k, mode, skipIO ?? false);
    expect(result.labels.map((l) => render(l, mode, skipIO ?? false))).toEqual(want);
    expect(result.gapExhausted).toBe(gapExhausted ?? false);
  });

  // The "any" row (P=42, R=null) is normative for every mode, not just 1AB — R === null short
  // circuits to plain integers before mode-specific generation ever runs (§22.3 step 1), so the
  // *structured* result (base, no prefix, no suffix) is identical across modes. The vector's
  // rendered "43","44" strings assume 1AB-family/AB2/BA2 (arabic) display; romanUpper/romanLower
  // render that same structure as Roman numerals, per those modes' own rendering rule (§22.1) —
  // display, not generation, is what differs, so this checks the structure, not the string.
  it.each(NUMBER_MODES)('any | 42 | null | 2 also holds for mode %s (structurally)', (mode) => {
    const result = generateBetween(plain(42), null, 2, mode, false);
    expect(result.labels).toEqual([plain(43), plain(44)]);
    expect(result.gapExhausted).toBe(false);
  });
});

// ─── Regression coverage the vectors above don't reach ─────────────────────────────────────────

describe('generateBetween — gap-exhausted diagnostics beyond the §22.4 table', () => {
  it('1AB: A10A sorts before P, not between P and R — gap-exhausted output is a placeholder, not a guarantee', () => {
    const P = plain(10);
    const R = label(10, [], [letterSeg(1)]); // 10A
    const { labels, gapExhausted } = generateBetween(P, R, 1, '1AB', false);
    expect(gapExhausted).toBe(true);
    expect(compareLabels(labels[0]!, P, '1AB')).toBeLessThan(0); // NOT > P — documented in modes.ts
    expect(compareLabels(labels[0]!, R, '1AB')).toBeLessThan(0); // still < R
  });

  // Fix round 1 (Critical, partially addressed): §22.3 was corrected — the refusal condition is
  // "steps 2 and 3 produced no candidate", computed, never inferred from a property of R alone.
  // Round 1's fix (`decrementLastPosition` returning `null` for *any* all-`1`s chain) was itself
  // still a predicate on R alone, just a narrower wrong one — `[1,1]`, `[1,1,1]`, … all *do* have
  // predecessors (`[1]`, `[1,1]`, … — the same array truncated by one; see `predecessorFamily`'s
  // doc comment in modes.ts), it's just that whether a given `P` can reach one depends on how far
  // back `P` sits. Fix round 2 replaces the single-predecessor guess with the *full* predecessor
  // family and lets the real `> P` filter decide sufficiency. These two tests are the exact review
  // counterexamples (round 2); the full depth-1/2/3, both-sides-of-the-boundary matrix follows.
  it('AB2 counterexample: plain P=1, R=AB2 (prefix [1,2], not minimal) — A2 sorts strictly between, does not throw', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(1, 2)]); // AB2
    const { labels, gapExhausted } = generateBetween(P, R, 1, 'AB2', false);
    expect(gapExhausted).toBe(false);
    expect(compareLabels(labels[0]!, P, 'AB2')).toBeGreaterThan(0);
    expect(compareLabels(labels[0]!, R, 'AB2')).toBeLessThan(0);
    expect(render(labels[0]!, 'AB2')).toBe('A2'); // matches spec 02 §22.3's own illustration exactly
  });

  it('BA2 counterexample: plain P=1, R=BA2 (prefix [2,1], not minimal) — A2 sorts strictly between, does not throw', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(2, 1)]); // BA2
    const { labels, gapExhausted } = generateBetween(P, R, 1, 'BA2', false);
    expect(gapExhausted).toBe(false);
    expect(compareLabels(labels[0]!, P, 'BA2')).toBeGreaterThan(0);
    expect(compareLabels(labels[0]!, R, 'BA2')).toBeLessThan(0);
    // "AA2" was the pre-fix-round-2 spec's illustration for this exact pair (superseded — that
    // text predates the depth rule); "A2" is what predecessorFamily's ladder finds first, and is
    // itself the same shape as the AB2 case above (both reduce to the length-1 ladder entry).
    expect(render(labels[0]!, 'BA2')).toBe('A2');
  });

  it('AB2 childSeq(plain) and preSeq(minimally-prefixed) are both ∅, per §22.2 / corrected §22.3', () => {
    const take = <T>(it: Iterable<T>, n: number): T[] => {
      const out: T[] = [];
      for (const v of it) {
        if (out.length >= n) break;
        out.push(v);
      }
      return out;
    };
    expect(take(childSeq(plain(2), 'AB2', false), 3)).toEqual([]);
    expect(take(preSeq(label(2, [letterSeg(1)]), 'AB2', false), 3)).toEqual([]);
  });

  it('AB2/BA2 preSeq of a non-minimally-prefixed R is NOT ∅ — the corrected, narrower refusal', () => {
    const take = <T>(it: Iterable<T>, n: number): T[] => {
      const out: T[] = [];
      for (const v of it) {
        if (out.length >= n) break;
        out.push(v);
      }
      return out;
    };
    expect(take(preSeq(label(2, [letterSeg(1, 2)]), 'AB2', false), 1)).toHaveLength(1); // AB2
    expect(take(preSeq(label(2, [letterSeg(2, 1)]), 'BA2', false), 1)).toHaveLength(1); // BA2
  });

  it('childSeqAB2 throws on a digits prefix segment (defensive — no generator here ever builds one)', () => {
    const malformed = label(2, [digitSeg(1)]); // a label this module never builds, handed in directly
    const take = <T>(it: Iterable<T>): T => {
      const { value } = it[Symbol.iterator]().next();
      return value as T;
    };
    expect(() => take(childSeq(malformed, 'AB2', false))).toThrow(RangeError);
    expect(() => take(childSeq(malformed, 'BA2', false))).toThrow(RangeError);
    expect(() => take(preSeq(malformed, 'AB2', false))).toThrow(RangeError);
    expect(() => take(preSeq(malformed, 'BA2', false))).toThrow(RangeError);
  });

  it('1AB: Z-extension continuation under large k (letterIndexRun overflow, not letters()\'s repeat-based one)', () => {
    const { labels } = generateBetween(plain(1), plain(2), 30, '1AB', false);
    expect(render(labels[24]!, '1AB')).toBe('1Y'); // 25th child
    expect(render(labels[25]!, '1AB')).toBe('1Z'); // 26th child — last single letter
    expect(render(labels[26]!, '1AB')).toBe('1ZA'); // 27th — Z-extension begins
    expect(render(labels[27]!, '1AB')).toBe('1ZB'); // 28th
  });

  // `n` (the alphabet length `childSeq`/`preSeq` pass to `letterIndexRun`) is only *observable* in
  // a label's rendered string once `k` exceeds the alphabet — below that, `letterIndexRun(k, 24)`
  // and `letterIndexRun(k, 26)` produce the identical single-element `[k]`, and skipIO's own
  // letter *mapping* (A..H,J,K…) happens entirely inside `formatNumberLabel`/`letters()` (task
  // 12), independent of what `n` this module used to build the index. This is exactly why the
  // §22.4 skipIO vector (k=10) alone can't prove `skipIO` is threaded into `n`: a build that
  // silently hardcoded `alphabetFor(false)` here (ignoring the caller's `skipIO`) would still pass
  // that row. This test forces `k` past the 24-letter skipIO band boundary, where the two diverge:
  // with `skipIO` correctly threaded, the 25th generated label is the first to need Z-extension
  // (`ZA`, using this module's `letterIndexRun`, since the skipIO alphabet has only 24 letters);
  // with it dropped, the same index instead falls into `letters()`'s own out-of-range *repeat*
  // quirk (task 13 brief note 1: `letters([25])` under a 24-letter alphabet wraps to `'AA'`).
  it('1AB skipIO: the 25th child needs Z-extension (24-letter band), not letters()\'s repeat quirk', () => {
    const { labels } = generateBetween(plain(10), plain(11), 25, '1AB', true);
    // skipIO alphabet (24 letters, I and O removed): A B C D E F G H J K L M N P Q R S T U V W X Y Z
    // — the 24th surviving letter is Z, so the 24th child is "10Z" and the 25th needs Z-extension.
    expect(render(labels[23]!, '1AB', true)).toBe('10Z'); // 24th — last single letter
    expect(render(labels[24]!, '1AB', true)).toBe('10ZA'); // 25th — the skipIO alphabet only has 24
  });
});

// ─── Fix round 2: the depth rule, tested from both sides at depths 1/2/3 ───────────────────────
//
// Round 1's fix over-generalised: it proved `[1]` (depth 1) has no predecessor and shipped code
// that refused for *any* all-`1`s chain, at any depth. But `[1,1]` (depth 2) and `[1,1,1]`
// (depth 3) both have real predecessors (`[1]` and `[1,1]` respectively — the same array
// truncated by one, §22.2's "shorter matching prefix sorts before a longer one"). The bug only
// showed up with a `P` further back than the chain's own immediate parent — round 1's own
// verification used `P = A2, R = AA2` (where refusal genuinely is correct) and never tried
// `P` further back, which is exactly where "no property of R alone" bites: the same `R` must
// refuse against one `P` and generate against another.
//
// `buildAllOnesChain` constructs the depth-N all-`1`s prefix directly (not by composing
// generateBetween calls) so each test pins an exact, known structure — for an all-`1`s comparison-
// space array, `AB2`'s (forward) and `BA2`'s (reversed) storage encodings coincide (reversing
// `[1,1,…,1]` doesn't change it), so one builder serves both modes.
describe('generateBetween — AB2/BA2 depth rule (fix round 2): refusal depends on BOTH endpoints', () => {
  function buildAllOnesChain(depth: number): NumberLabel {
    return label(2, [letterSeg(...Array<number>(depth).fill(1))]);
  }

  const MODES_AND_SKIPIO = [
    ['AB2', false], ['AB2', true], ['BA2', false], ['BA2', true],
  ] as const;

  it.each(MODES_AND_SKIPIO)('%s skipIO=%s — depth 1 (R=A2): refuses for every P, since [1] has no predecessor at all', (mode, skipIO) => {
    const R = buildAllOnesChain(1); // A2
    expect(() => generateBetween(plain(1), R, 1, mode, skipIO)).toThrow(RangeError);
    expect(() => generateBetween(null, R, 1, mode, skipIO)).toThrow(RangeError);
  });

  it.each(MODES_AND_SKIPIO)('%s skipIO=%s — depth 2 (R=AA2): P=A2 (immediate parent) refuses, P=1 (further back) generates A2', (mode, skipIO) => {
    const R = buildAllOnesChain(2); // AA2
    const immediateParent = buildAllOnesChain(1); // A2

    expect(() => generateBetween(immediateParent, R, 1, mode, skipIO)).toThrow(RangeError);

    const { labels, gapExhausted } = generateBetween(plain(1), R, 1, mode, skipIO);
    expect(gapExhausted).toBe(false);
    expect(compareLabels(labels[0]!, plain(1), mode)).toBeGreaterThan(0);
    expect(compareLabels(labels[0]!, R, mode)).toBeLessThan(0);
    expect(render(labels[0]!, mode, skipIO)).toBe('A2');
  });

  it.each(MODES_AND_SKIPIO)('%s skipIO=%s — depth 3 (R=AAA2): P=AA2 (immediate parent) refuses; P=A2 and P=1 (further back) generate', (mode, skipIO) => {
    const R = buildAllOnesChain(3); // AAA2
    const immediateParent = buildAllOnesChain(2); // AA2
    const oneLevelFurtherBack = buildAllOnesChain(1); // A2

    expect(() => generateBetween(immediateParent, R, 1, mode, skipIO)).toThrow(RangeError);

    const fromOneBack = generateBetween(oneLevelFurtherBack, R, 1, mode, skipIO);
    expect(fromOneBack.gapExhausted).toBe(false);
    expect(compareLabels(fromOneBack.labels[0]!, oneLevelFurtherBack, mode)).toBeGreaterThan(0);
    expect(compareLabels(fromOneBack.labels[0]!, R, mode)).toBeLessThan(0);
    expect(render(fromOneBack.labels[0]!, mode, skipIO)).toBe('AA2');

    // Further back still (plain 1): BOTH ladder candidates ([1]="A2", [1,1]="AA2") are usable.
    const fromPlain = generateBetween(plain(1), R, 2, mode, skipIO);
    expect(fromPlain.gapExhausted).toBe(false);
    expect(fromPlain.labels.map((l) => render(l, mode, skipIO))).toEqual(['A2', 'AA2']);
  });
});

// ─── Property test: the point of this task ──────────────────────────────────────────────────────
//
// Table vectors prove the cases someone thought of. This proves the general rule holds for cases
// nobody enumerated: for a random sorted locked sequence of plain integer labels, a random
// insertion point (including the two open ends), a random k, mode and skipIO — every label
// generateBetween returns sorts strictly between P and R under compareLabels(mode), and the
// returned labels strictly increase among themselves.
//
// Fix round 1 (Important): P and R here are always DISTINCT-base plain integers, so
// compareLabels' base-first comparison makes `below`/`above` (modes.ts's per-candidate filters)
// vacuously true across the whole domain this generator reaches — disabling both filters produces
// zero failures across all 300 runs of *this* property. It still earns its keep for the
// monotonicity half (childSeq/preSeq strictly increasing — the BA2 overflow bug above was caught
// here), so it stays, but it does not exercise the filters at all. The second property below
// (same-base, varying-prefix-depth P/R) is what does that — see its own comment for the disabled-
// filter mutation run that failed under it.
//
// Seeded so a failure reproduces deterministically (spec 02 §1.1 forbids ambient inputs in
// shipping code; this is a test file, but a seeded property is good practice regardless and the
// brief asks for it explicitly).
const PROPERTY_SEED = 20260916;

describe('generateBetween — property (fast-check)', () => {
  it('every generated label sorts strictly between P and R, and strictly increases among itself', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 500 }), { minLength: 2, maxLength: 12 })
          .map((a) => [...a].sort((x, y) => x - y)),
        fc.nat(),
        fc.integer({ min: 1, max: 60 }),
        fc.constantFrom(...NUMBER_MODES),
        fc.boolean(),
        (bases, idxSeed, k, mode, skipIO) => {
          const idx = idxSeed % (bases.length + 1);
          const P = idx > 0 ? plain(bases[idx - 1]!) : null;
          const R = idx < bases.length ? plain(bases[idx]!) : null;

          const { labels, gapExhausted } = generateBetween(P, R, k, mode, skipIO);

          expect(gapExhausted).toBe(false);
          expect(labels).toHaveLength(k);
          for (let i = 0; i < labels.length; i += 1) {
            if (P !== null) expect(compareLabels(labels[i]!, P, mode)).toBeGreaterThan(0);
            if (R !== null) expect(compareLabels(labels[i]!, R, mode)).toBeLessThan(0);
            if (i > 0) expect(compareLabels(labels[i]!, labels[i - 1]!, mode)).toBeGreaterThan(0);
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: 300 },
    );
  });
});

// ─── Property test 2: P and R derived from a random DEPTH of generateBetween's own output ─────────
//
// Fix round 1 (Important, addressed then): a single level of derivation
// (`[P0, ...generateBetween(P0, P0+1, k1, ...).labels, R0]`, picking a random adjacent pair as the
// new P/R) was enough to make `below`/`above` non-vacuous and to fail the reviewer's
// disable-both-filters mutation — see the "fix round 1" note kept below for that result.
//
// Fix round 2 (Critical): one level was NOT enough to reach the bug that round. `generateBetween`
// only ever recurses to depth 1 from a single derivation step (children of a depth-0 P are
// depth-1), so a one-level property can only ever construct P/R pairs where at least one side is
// plain or depth-1 — it structurally cannot build a depth-2 `R` like `AA2`, and so could never
// have exercised "`P` = `R`'s immediate parent" vs. "`P` further back than that" for a depth-2+
// `R`, which is exactly where fix round 2's Critical (`decrementLastPosition` over-refusing any
// all-`1`s chain) lived. Iterating the derivation to a random DEPTH (2 or 3 levels, each level
// feeding the previous level's own output back in as the next P/R — the real lock/insert/relock
// cycle, repeated) reaches those deeper shapes, because a pair drawn from a depth-N level's own
// `mid` sequence is itself depth-(N+1) once childSeq/preSeq has grown it further.
//
// Every level's own `generateBetween` call is asserted (not just the deepest), so a single trial
// exercises the invariant at every depth it derives through, not only at the end.
//
// Running this deeper property (with fix round 2's `predecessorFamily`/`segmentListPredecessorFamily`
// fix in place) surfaced a THIRD, previously undiscovered bug, of the same shape as the Critical
// this round fixes but on the `1AB`-family side: `preSeqPrependSegment` unconditionally prepended a
// brand-new segment in front of `R`'s own existing prefix, which is unsafe once `R` already has a
// prefix (a real, reachable case — a gap-exhausted label, once locked, becomes a later call's real
// `R`, spec 23.1's Relock). If the new segment's value happened to equal `R.prefix`'s own outermost
// segment, `compareSegmentArrays`' "missing < present" rule made the *deeper* (newly-prepended) one
// sort *after* `R`, silently violating the `< R` guarantee §22.3 promises even for gap-exhausted
// output. Fixed the same way as the Critical: `segmentListPredecessorFamily` finds real predecessors
// of `R.prefix` itself (see modes.ts) instead of decorating it. One consequence, confirmed
// mathematically and with a standalone check before relying on it here: `1AB`-family now *can*
// legitimately throw too — not only `AB2`/`BA2` — in the exact structural analogue of their minimal
// case (`R.prefix` reduced to a single segment of value `[1]`, i.e. `R` = literal `"A<base>"` with no
// deeper structure). `isRefusable` below accepts a `RangeError` from `generateBetween` for *any*
// mode now, matched by message rather than blanket-caught, so an unrelated thrown `RangeError`
// elsewhere would still fail the test rather than being silently absorbed.
const PROPERTY_SEED_2 = 20260917;
const PROPERTY_2_LEVELS = 3; // matches the `ks`/`idxSeeds` array lengths below — see fc.array

function isRefusal(e: unknown): boolean {
  return e instanceof RangeError && e.message.includes('has no structural room between the given P and R');
}

function assertGenerateBetweenInvariant(
  P: NumberLabel, R: NumberLabel, k: number, mode: NumberMode, skipIO: boolean,
): NumberLabel[] | undefined {
  let result: { labels: NumberLabel[]; gapExhausted: boolean };
  try {
    result = generateBetween(P, R, k, mode, skipIO);
  } catch (e) {
    if (isRefusal(e)) return undefined; // a genuine, expected refusal — see the comment above
    throw e;
  }
  expect(result.labels).toHaveLength(k);
  for (let j = 0; j < result.labels.length; j += 1) {
    expect(compareLabels(result.labels[j]!, R, mode)).toBeLessThan(0);
    if (!result.gapExhausted) expect(compareLabels(result.labels[j]!, P, mode)).toBeGreaterThan(0);
    if (j > 0) expect(compareLabels(result.labels[j]!, result.labels[j - 1]!, mode)).toBeGreaterThan(0);
  }
  return result.labels;
}

describe('generateBetween — property 2 (fast-check): P/R derived from a random depth of the system\'s own output', () => {
  it('every generated label sorts correctly against R (and against P when not gap-exhausted), at every derived depth', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 2, max: 3 }), // depth: iterate 2 or 3 levels deep
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: PROPERTY_2_LEVELS, maxLength: PROPERTY_2_LEVELS }),
        fc.array(fc.nat(), { minLength: PROPERTY_2_LEVELS, maxLength: PROPERTY_2_LEVELS }),
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(...NUMBER_MODES),
        fc.boolean(),
        (base, depth, ks, idxSeeds, kFinal, mode, skipIO) => {
          let P = plain(base);
          let R = plain(base + 1);

          for (let level = 0; level < depth; level += 1) {
            const mid = assertGenerateBetweenInvariant(P, R, ks[level]!, mode, skipIO);
            if (mid === undefined) return; // this level's own call refused (AB2/BA2) — nothing deeper to derive
            const seq = [P, ...mid, R];
            const i = idxSeeds[level]! % (seq.length - 1);
            P = seq[i]!;
            R = seq[i + 1]!;
          }

          // The final probe: the deepest pair this trial derived, tested directly. This is what
          // reaches fix round 2's Critical shape — an "immediate parent" boundary pair can be
          // picked at any level above, making P and R here exactly that relationship at whatever
          // depth this trial happened to reach.
          assertGenerateBetweenInvariant(P, R, kFinal, mode, skipIO);
        },
      ),
      { seed: PROPERTY_SEED_2, numRuns: 300 },
    );
  });
});
