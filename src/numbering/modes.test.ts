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

  // Fix round 1 (Critical): §22.3 was corrected — the refusal condition is "steps 2 and 3 produced
  // no candidate", computed, never inferred from `R.prefix.length > 0`. Only a *minimally* prefixed
  // R (prefix exactly `[1]`, or — generalizing to a deeper chain — every position `1`) leaves no
  // room; the previous `if (label.prefix.length > 0) return` guard refused far more than that.
  // These three tests pin the boundary from both sides: the two review counterexamples that must
  // now generate real candidates, and the minimal case that must still refuse.
  it('AB2: minimally-prefixed R (prefix exactly [1]) — no structural room, throws rather than returning misleading data', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(1)]); // A2 — already minimally prefixed
    expect(() => generateBetween(P, R, 1, 'AB2', false)).toThrow(RangeError);
  });

  it('BA2: same minimal-prefix dead end as AB2', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(1)]); // A2
    expect(() => generateBetween(P, R, 1, 'BA2', false)).toThrow(RangeError);
  });

  it('AB2 counterexample: plain P=1, R=AB2 (prefix [1,2], not minimal) — A2 sorts strictly between, does not throw', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(1, 2)]); // AB2
    const { labels, gapExhausted } = generateBetween(P, R, 1, 'AB2', false);
    expect(gapExhausted).toBe(false);
    expect(compareLabels(labels[0]!, P, 'AB2')).toBeGreaterThan(0);
    expect(compareLabels(labels[0]!, R, 'AB2')).toBeLessThan(0);
    // Spec 02 §22.3 illustrates "A2" for this exact pair; this generator's own predecessor
    // construction produces "AA2" instead — a *different*, also-valid candidate (both sort
    // strictly between P and R), not a mismatch with the spec's illustration.
    expect(render(labels[0]!, 'AB2')).toBe('AA2');
  });

  it('BA2 counterexample: plain P=1, R=BA2 (prefix [2,1], not minimal) — AA2 sorts strictly between, does not throw', () => {
    const P = plain(1);
    const R = label(2, [letterSeg(2, 1)]); // BA2
    const { labels, gapExhausted } = generateBetween(P, R, 1, 'BA2', false);
    expect(gapExhausted).toBe(false);
    expect(compareLabels(labels[0]!, P, 'BA2')).toBeGreaterThan(0);
    expect(compareLabels(labels[0]!, R, 'BA2')).toBeLessThan(0);
    expect(render(labels[0]!, 'BA2')).toBe('AA2'); // matches spec 02 §22.3's own illustration exactly
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

// ─── Property test 2: P and R sharing a base, with prefixes/suffixes of varying depth ─────────────
//
// Fix round 1 (Important). Built by generating ONE level via generateBetween itself (locking,
// inserting, "relocking" by treating the results as the new neighbours, exactly spec 02 §23.1's
// real workflow) rather than hand-picked structures: pick a random adjacent pair from
// `[P0, ...generateBetween(P0, P0+1, k1, mode, skipIO).labels, R0]` as the new P2/R2. Because P2
// and R2 routinely share P0's base (differing only in suffix/prefix depth), `below`/`above` are no
// longer vacuous — childSeq(P2) filtered `< R2` genuinely runs dry for several of these pairs
// (e.g. P2=P0, R2=P0's own first generated child, the exact `1AB | 10 | 10A` shape from §22.4),
// forcing reliance on preSeq(R2)/the gap-exhausted fallback, and for AB2/BA2 this also reaches the
// narrowed-refusal path fixed above (a RangeError is an accepted outcome only for those two
// modes). `< R2` holds even for gap-exhausted output here (R2 always has an empty prefix in this
// construction, so the hasPrefix-first rule always puts a gap-exhausted candidate below it); `> P2`
// is asserted only when NOT gap-exhausted, per generateBetween's documented relaxation.
//
// Disabling both filters (`below`/`above` both hard-coded `true`, matching the review's mutation)
// against this property, run for real: **"Property failed after 4 tests"** (fast-check's own
// count, `numRuns: 300`, seed below), shrunk 6 times to counterexample
// `[base=0, k1=1, idxSeed=0, k2=1, mode="1AB", skipIO=false]` — i.e. P0=0, R0=1, the one-item
// first-level insertion gives mid=[0A], so P2=0, R2=0A (exactly `1AB`'s `10/10A` shape from
// §22.4). With `below` disabled, step 2 (childSeq(P2), now unfiltered) hands back its very first
// candidate, `0A`, for k2=1 — `compareLabels(0A, R2=0A, '1AB')` is `0`, not negative, which is
// exactly what the disabled `below` filter existed to reject (`AssertionError: expected 0 to be
// less than 0`, at the `< R2` line below). This is the placement-half counterexample the first
// property's generator could never reach (mutation restored before committing; do not
// re-introduce it).
const PROPERTY_SEED_2 = 20260917;

describe('generateBetween — property 2 (fast-check): same-base P/R with varying prefix/suffix depth', () => {
  it('every generated label still sorts correctly against R (and against P when not gap-exhausted), even when childSeq(P) alone cannot supply it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 6 }),
        fc.nat(),
        fc.integer({ min: 1, max: 10 }),
        fc.constantFrom(...NUMBER_MODES),
        fc.boolean(),
        (base, k1, idxSeed, k2, mode, skipIO) => {
          const P0 = plain(base);
          const R0 = plain(base + 1);
          const { labels: mid } = generateBetween(P0, R0, k1, mode, skipIO); // always satisfiable — property 1

          const seq = [P0, ...mid, R0];
          const i = idxSeed % (seq.length - 1);
          const P2 = seq[i]!;
          const R2 = seq[i + 1]!;

          let result: { labels: NumberLabel[]; gapExhausted: boolean };
          try {
            result = generateBetween(P2, R2, k2, mode, skipIO);
          } catch (e) {
            if ((mode === 'AB2' || mode === 'BA2') && e instanceof RangeError) return;
            throw e;
          }

          expect(result.labels).toHaveLength(k2);
          for (let j = 0; j < result.labels.length; j += 1) {
            expect(compareLabels(result.labels[j]!, R2, mode)).toBeLessThan(0);
            if (!result.gapExhausted) expect(compareLabels(result.labels[j]!, P2, mode)).toBeGreaterThan(0);
            if (j > 0) expect(compareLabels(result.labels[j]!, result.labels[j - 1]!, mode)).toBeGreaterThan(0);
          }
        },
      ),
      { seed: PROPERTY_SEED_2, numRuns: 300 },
    );
  });
});
