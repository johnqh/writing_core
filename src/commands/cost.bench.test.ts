import { describe, expect, it } from 'vitest';
import type { ElementId } from '../ids/ids.js';
import { scaleDocument } from '../test-fixtures/scale-document.js';
import { registerBuiltinCommands } from './builtin.js';
import { executeCommand } from './execute.js';
import { createSessionOrigins } from './origin.js';
import { TEST_ACTOR } from './test-harness.js';

/**
 * Spec 08 §15 budgets a keystroke at 24 ms on a slower device. The dominant per-invocation cost is
 * `executeBatch`'s rehearsal pass, which clones the whole document — so it is O(document size),
 * not O(edit size), and the keyboard commands (Enter → `element.split`, Tab → `element.cycleStyle`
 * and `element.setStyle`) blew that budget on a feature-length script until they joined the
 * `fastPath` allowlist.
 *
 * This is a regression guard, not a benchmark. The absolute ceiling is far above any plausible
 * healthy figure so a loaded CI box cannot make it flake, and the ratio against `text.insert`
 * (always on the fast path, same document) is what actually catches a command silently falling
 * back to whole-document rehearsal — that costs an order of magnitude, not a few per cent.
 */
const SIZE = 3000;
const REPS = 20;
const WARMUP = 3;
const ABSOLUTE_CEILING_MS = 12;
const RATIO_CEILING = 8;

/** Action elements: index % 5 === 1 in the fixture's repeating cycle. */
const actionIndex = (i: number) => ((i * 5) % SIZE) + 1;

function measure(commandId: string, params: (ids: readonly ElementId[], i: number) => unknown): number {
  registerBuiltinCommands();
  const { doc, model, ids, elementIds } = scaleDocument(SIZE);
  const origins = createSessionOrigins(TEST_ACTOR);
  const run = (i: number) =>
    executeCommand({
      doc, model, ids, actor: TEST_ACTOR, origin: origins.make('local-command', { commandId }),
      capabilities: new Set(['write'] as const), clock: () => 1_000, command: { id: commandId, params: params(elementIds, i) },
    });
  try {
    for (let i = 0; i < WARMUP; i++) expect(run(i), `${commandId} warmup ${i}`).toMatchObject({ ok: true });
    const started = performance.now();
    for (let i = WARMUP; i < WARMUP + REPS; i++) expect(run(i), `${commandId} rep ${i}`).toMatchObject({ ok: true });
    return (performance.now() - started) / REPS;
  } finally {
    model.dispose();
    doc.destroy();
  }
}

describe(`command cost at ${SIZE} elements (spec 08 §15)`, () => {
  it('keeps the keyboard commands within an order of magnitude of text.insert', () => {
    const report: Record<string, number> = {
      'text.insert': measure('text.insert', (ids, i) => ({ at: { elementId: ids[actionIndex(i)], offset: 1 }, text: 'x' })),
      'element.split': measure('element.split', (ids, i) => ({ at: { elementId: ids[actionIndex(i)], offset: 1 } })),
      'element.setStyle': measure('element.setStyle', (ids, i) => ({ elements: [ids[actionIndex(i)]], style: i % 2 === 0 ? 'st_shot' : 'st_action' })),
      'element.cycleStyle': measure('element.cycleStyle', (ids, i) => ({ element: ids[actionIndex(i)], direction: 'tabForward', caretAtEnd: true })),
    };
    const baseline = report['text.insert']!;
    const summary = Object.entries(report).map(([k, v]) => `${k}=${v.toFixed(2)}ms`).join(' ');
    for (const [id, ms] of Object.entries(report)) {
      expect(ms, `${id} ${summary}`).toBeLessThan(ABSOLUTE_CEILING_MS);
      expect(ms / baseline, `${id} is ${(ms / baseline).toFixed(1)}x text.insert — ${summary}`).toBeLessThan(RATIO_CEILING);
    }
  });
});
