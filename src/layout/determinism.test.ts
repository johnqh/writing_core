/**
 * M2 task 35, step 5 (spec 02 §37.3 invariant 6). "The same input produces byte-identical serialized
 * results" across runtimes — a single-runtime assertion (this file alone, run once) would not be a
 * determinism test at all, so this exact file is run under TWO genuinely different JS engines:
 * `vitest run` (Node, V8) and `bun run test:bun` (Bun, JavaScriptCore) both assert against the SAME
 * committed digest below. Hermes (React Native) and a native JavaScriptCore CI runner are spec 12's
 * own CI responsibility (`writing_ui`/the mobile shell own those runners, not this headless package).
 *
 * Regenerate the digest (a real, deliberate output change, e.g. `LAYOUT_ENGINE_VERSION` bumped) with:
 *   bun -e "import('./src/layout/determinism.test.ts')" # prints the computed digest on a mismatch
 * or just read the failure message — it names it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '../hash/canonical-json.js';
import { sha256Hex } from '../hash/sha256.js';
import { createSeededIdSource } from '../ids/id-source.js';
import { materializeDocument } from '../model/json.js';
import { openDocument } from '../read-model/open.js';
import { layoutDocument } from './layout-document.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'test', 'fixtures');
const COMMITTED_DIGEST = 'd6449bc1155ea20b041765a2db644688bd1189a1a05c84d57dc428f8af03ee9a';

function layoutDigest(): string {
  const json = JSON.parse(readFileSync(join(FIXTURES_DIR, 'feature-120.doc.json'), 'utf8'));
  const ids = createSeededIdSource(1);
  const doc = materializeDocument(json, { preserveIds: true, ids });
  const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  const layout = layoutDocument(model);
  return sha256Hex(canonicalJSON(layout as unknown as Record<string, unknown>));
}

describe('determinism across runtimes (spec 02 §37.3 invariant 6)', () => {
  it('feature-120 lays out to the exact committed digest under THIS runtime', () => {
    const digest = layoutDigest();
    expect(digest, `computed ${digest}, committed ${COMMITTED_DIGEST} — regenerate if this is a deliberate output change`).toBe(COMMITTED_DIGEST);
  });
});
