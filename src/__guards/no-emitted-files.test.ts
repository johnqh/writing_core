import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A compiled `.js` or `.d.ts` beside a `.ts` source silently shadows it: Bun
 * and Vite prefer a real file over mapping a `.js` specifier to its `.ts`, so
 * edits to the source are ignored by every consumer. This happened once when a
 * sibling repo's failing `tsc` build emitted 430 files into `src/`.
 */
const SRC = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe('no compiled output in src/', () => {
  it('has no .js, .d.ts or map files beside the TypeScript sources', () => {
    const stray = walk(SRC).filter((f) => /\.(js|js\.map|d\.ts|d\.ts\.map)$/.test(f));
    expect(stray, `compiled files shadow their sources: ${stray.slice(0, 5).join(', ')}`).toEqual([]);
  });
});
