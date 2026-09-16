import { ELEMENT_COMMANDS } from './element.js';
import { MARK_COMMANDS } from './mark.js';
import { registerCommand } from './registry.js';
import { TEXT_COMMANDS } from './text.js';
import type { CommandSpec } from './types.js';

const BUILTIN: CommandSpec<never>[][] = [TEXT_COMMANDS, MARK_COMMANDS, ELEMENT_COMMANDS];
let registered = false;

export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;
  for (const list of BUILTIN) for (const spec of list) registerCommand(spec as CommandSpec<unknown>);
}

export function addBuiltinCommands(list: CommandSpec<never>[]): void {
  BUILTIN.push(list);
  if (registered) for (const spec of list) registerCommand(spec as CommandSpec<unknown>);
}
