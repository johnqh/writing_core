/**
 * M2 task 32, step 3/4. Compares each `GOLDEN_CASES` entry against its committed
 * `test/golden/<case>/fadewright.layout.json` (regenerate with `bun run golden:update` after an
 * intentional change — review the diff, and bump `LAYOUT_ENGINE_VERSION` if the change is output-
 * affecting). `it.skipIf` guards each case on its own snapshot existing, and the last test guards
 * against a vacuous suite: every case must actually have one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES } from './golden-cases.js';
import { compactSnapshot } from './golden-snapshot.js';

const DIR = join(import.meta.dirname, '..', '..', 'test', 'golden');

describe('golden rule cases (M2 task 32)', () => {
  for (const c of GOLDEN_CASES) {
    const file = join(DIR, c.key, 'fadewright.layout.json');
    it.skipIf(!existsSync(file))(`${c.key}: ${c.description}`, () => {
      const { layout } = c.build();
      const got = compactSnapshot(layout);
      const want = JSON.parse(readFileSync(file, 'utf8'));
      expect(got).toEqual(want);
    });
  }

  it('guards against a vacuous suite: every declared case has a committed snapshot', () => {
    const missing = GOLDEN_CASES.filter((c) => !existsSync(join(DIR, c.key, 'fadewright.layout.json')));
    expect(missing.map((c) => c.key)).toEqual([]);
  });
});
