/**
 * The `Shaper` contract (spec 02 §5.2). `Shaper` itself is Task 1's exact spec
 * transcription (`src/layout/types.ts`); this module imports it rather than
 * redeclaring it.
 *
 * `nullShaper` is not a fallback shaping strategy — spec §5.1's "tier-2 runs fall back
 * to tier-1 summation, flagged `approximateShaping`" fallback is the layout engine's
 * concern, applied when `LayoutEngineOptions.shaper` is `null` (see `src/layout/types.ts`),
 * never something a `Shaper` implementation does internally. `nullShaper` exists only as
 * an explicit, loudly-failing placeholder for code that needs *some* `Shaper` value (a
 * test harness wiring, a default parameter) without pulling in the real HarfBuzz backend;
 * calling `.shape()` on it is always a bug, so it throws rather than approximating.
 */
import type { Shaper } from '../layout/types.js';

export const nullShaper: Shaper = {
  version: 'null-shaper',
  shape(): never {
    throw new Error(
      'nullShaper: no Shaper configured. Production code must supply a real shaper ' +
        '(createHarfBuzzShaper, spec 02 §5.2); tier-2 fallback to tier-1 summation is the ' +
        'layout engine\'s responsibility, not this placeholder\'s.',
    );
  },
};
