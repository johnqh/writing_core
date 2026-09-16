import { defineConfig } from 'vitest/config';

// testTimeout (perf round 2, 2026-09-16 — perf-suite-brief.md / perf-suite-report.md "Round
// 2"): Vitest's stock 5000ms was sized for a small, fast suite, not this one — 112k+ tests
// including full UAX conformance corpora (one file expands to 770 241 cases) and seeded
// fast-check property tests (300 runs each, walking a generative tree). Three files were found
// failing this way under ordinary CPU contention (src/text/bidi.test.ts,
// src/text/dict.test.ts, src/numbering/modes.test.ts) and a fourth was reproduced directly
// (src/__guards/platform-free.test.ts) — see perf-suite-report.md's Round 2 section for the
// measurements. Raised to 90000ms: across five separate heavy-synthetic-CPU-contention runs
// (dozens of processes oversubscribing an 8-core machine), the worst duration measured for any
// test in this suite was ~23244ms (the bidi conformance aggregate; the same run ranged
// 15021-23244ms across repeats, so headroom is sized off the max observed, not a single sample).
// 90000ms leaves ~3.9x headroom over that worst observation, not a value tuned to just clear the
// load levels already measured. Cost: a genuinely hung test — not a slow-but-legitimate one —
// now takes up to 90s to fail instead of 5s, an 18x slower failure signal. Accepted deliberately:
// bounded-and-slow beats fast-and-flaky for a suite this size.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 90000,
  },
});
