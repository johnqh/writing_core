import { describe, expect, it } from 'vitest';
import { registerBuiltinCommands } from './builtin.js';
import { listCommands } from './registry.js';

// Queued ruling D: `fastPath: true` skips a command's replica-rehearsal safety net (see
// execute.ts), so only commands that provably refuse before their first write may use it.
// This pins the allowlist to exactly the keyboard hot path; any other command flipping
// `fastPath` on must justify itself by updating this list, not slip in unnoticed.
//
// The three `element.*` entries were added after the M1 rehearsal measurement (spec 08 §15): the
// rehearsal clone is O(document size), so Enter and Tab cost ~46 ms at 3000 elements against a
// 24 ms keystroke budget. `src/commands/cost.bench.test.ts` is the standing guard on that, and
// `element.test.ts` pins that each of the three refuses without writing.
const ALLOWED_FAST_PATH_COMMANDS = [
  'text.insert', 'text.insertSoftReturn', 'text.deleteBackward', 'text.deleteForward',
  'element.split', 'element.setStyle', 'element.cycleStyle',
] as const;

describe('fastPath allowlist', () => {
  it('is set on exactly the keyboard hot-path commands', () => {
    registerBuiltinCommands();
    const fastPathIds = listCommands().filter((c) => c.fastPath === true).map((c) => c.id).sort();
    expect(fastPathIds).toEqual([...ALLOWED_FAST_PATH_COMMANDS].sort());
  });
});
