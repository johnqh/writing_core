import { describe, expect, it } from 'vitest';
import { registerBuiltinCommands } from './builtin.js';
import { listCommands } from './registry.js';

// Queued ruling D: `fastPath: true` skips a command's replica-rehearsal safety net (see
// execute.ts), so only commands that provably refuse before their first write may use it.
// This pins the allowlist to exactly the typing hot path; any other command flipping
// `fastPath` on must justify itself by updating this list, not slip in unnoticed.
const ALLOWED_FAST_PATH_COMMANDS = ['text.insert', 'text.insertSoftReturn', 'text.deleteBackward', 'text.deleteForward'] as const;

describe('fastPath allowlist', () => {
  it('is set on exactly the four typing hot-path commands', () => {
    registerBuiltinCommands();
    const fastPathIds = listCommands().filter((c) => c.fastPath === true).map((c) => c.id).sort();
    expect(fastPathIds).toEqual([...ALLOWED_FAST_PATH_COMMANDS].sort());
  });
});
