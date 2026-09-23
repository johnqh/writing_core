// M2 task 32, step 3/4: regenerates `test/golden/<case>/fadewright.layout.json` from `GOLDEN_CASES`
// (`src/layout/golden-cases.ts`). Any change requires this explicit run and review — never written by
// the test suite itself.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GOLDEN_CASES } from '../src/layout/golden-cases.js';
import { compactSnapshot } from '../src/layout/golden-snapshot.js';

for (const c of GOLDEN_CASES) {
  const { layout } = c.build();
  const dir = resolve('test/golden', c.key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fadewright.layout.json'), `${JSON.stringify(compactSnapshot(layout), null, 2)}\n`);
  console.log(`wrote ${c.key}`);
}
