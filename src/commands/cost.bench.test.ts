import { describe, expect, it } from 'vitest';
import type { ElementId } from '../ids/ids.js';
import { scaleDocument } from '../test-fixtures/scale-document.js';
import { registerBuiltinCommands } from './builtin.js';
import { executeCommand } from './execute.js';
import { createSessionOrigins } from './origin.js';
import { TEST_ACTOR } from './test-harness.js';

/**
 * Spec 08 §15 budgets a keystroke at 24 ms on a slower device. The dominant per-invocation cost is
 * `executeBatch`'s rehearsal pass, which clones the whole document — so a command costs
 * O(document size), not O(edit size), and the keyboard commands (Enter → `element.split`,
 * Tab → `element.cycleStyle`, style shortcuts → `element.setStyle`) blew that budget on a
 * feature-length script until they joined the `fastPath` allowlist: measured 46 ms, 46 ms and
 * 36 ms respectively at 3000 elements, against 0.36 ms for the already-fast `text.insert`.
 *
 * This is a regression guard, not a benchmark, and it has to survive a loaded CI box:
 * - it reports the **fastest** of many invocations, which is the statistic least disturbed by the
 *   scheduler (a mean is dominated by whatever else the machine was doing);
 * - the ceiling is an order of magnitude above a healthy figure (~0.1-1 ms) and an order of
 *   magnitude below both the broken figures above and the 24 ms budget it exists to defend.
 *
 * There is deliberately no "cost must not grow with document size" assertion: `element.split`
 * inserts an element, and `positionAfter` scans every element to find the next `pos`, so it is
 * legitimately O(n) at ~0.9 ms per call at 3000 — small, but the same shape as the regression this
 * guards against. The small-document figure is reported for diagnosis only.
 */
const BIG = 3000;
const SMALL = 500;
const REPS = 25;
const WARMUP = 3;
const CEILING_MS = 10;

/** Action elements are at index % 5 === 1 in the fixture's repeating cycle. */
const actionIndex = (i: number, size: number) => ((i * 5) % size) + 1;

type Params = (ids: readonly ElementId[], i: number, size: number) => unknown;

/** Fastest observed milliseconds for one invocation of `commandId` on a `size`-element document. */
function fastestCall(commandId: string, params: Params, size: number): number {
  registerBuiltinCommands();
  const { doc, model, ids, elementIds } = scaleDocument(size);
  const origins = createSessionOrigins(TEST_ACTOR);
  const run = (i: number) =>
    executeCommand({
      doc, model, ids, actor: TEST_ACTOR, origin: origins.make('local-command', { commandId }),
      capabilities: new Set(['write'] as const), clock: () => 1_000, command: { id: commandId, params: params(elementIds, i, size) },
    });
  try {
    for (let i = 0; i < WARMUP; i++) expect(run(i), `${commandId} warmup ${i}`).toMatchObject({ ok: true });
    let best = Infinity;
    for (let i = WARMUP; i < WARMUP + REPS; i++) {
      const started = performance.now();
      const result = run(i);
      const elapsed = performance.now() - started;
      expect(result, `${commandId} rep ${i}`).toMatchObject({ ok: true });
      if (elapsed < best) best = elapsed;
    }
    return best;
  } finally {
    model.dispose();
    doc.destroy();
  }
}

const CASES: [id: string, params: Params][] = [
  ['text.insert', (ids, i, size) => ({ at: { elementId: ids[actionIndex(i, size)], offset: 1 }, text: 'x' })],
  ['element.split', (ids, i, size) => ({ at: { elementId: ids[actionIndex(i, size)], offset: 1 } })],
  ['element.setStyle', (ids, i, size) => ({ elements: [ids[actionIndex(i, size)]], style: i % 2 === 0 ? 'st_shot' : 'st_action' })],
  ['element.cycleStyle', (ids, i, size) => ({ element: ids[actionIndex(i, size)], direction: 'tabForward', caretAtEnd: true })],
];

describe(`keyboard command cost (spec 08 §15)`, () => {
  it(`stays well inside the keystroke budget at ${BIG} elements`, () => {
    const lines: string[] = [];
    for (const [id, params] of CASES) {
      const small = fastestCall(id, params, SMALL);
      const big = fastestCall(id, params, BIG);
      lines.push(`${id}: ${small.toFixed(3)}ms@${SMALL} ${big.toFixed(3)}ms@${BIG}`);
      const detail = lines.join(' | ');
      expect(big, `${id} costs ${big.toFixed(2)} ms at ${BIG} elements — ${detail}`).toBeLessThan(CEILING_MS);
    }
  });
});
