import type { z } from 'zod/v4';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

export const COMMAND_ID_RE = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

const specs = new Map<string, CommandSpec<unknown>>();
const aliasTo = new Map<string, string>();

export function registerCommand<P>(spec: CommandSpec<P>, aliases: readonly string[] = []): void {
  for (const id of [spec.id, ...aliases]) {
    if (!COMMAND_ID_RE.test(id)) throw new Error(`invalid command id ${id}`);
    if (specs.has(id) || aliasTo.has(id)) {
      if (specs.get(id) === (spec as CommandSpec<unknown>)) continue;
      throw new Error(`command id ${id} is already registered`);
    }
  }
  specs.set(spec.id, spec as CommandSpec<unknown>);
  for (const alias of aliases) aliasTo.set(alias, spec.id);
}

export function getCommand(id: string): CommandSpec<unknown> | undefined {
  return specs.get(aliasTo.get(id) ?? id);
}

export function listCommands(): readonly CommandSpec<unknown>[] {
  return [...specs.values()];
}

/** A mutating, write-capability, always-enabled built-in command; erased to `CommandSpec<never>` for heterogeneous lists. */
export function defineCommand<P>(
  id: string,
  params: z.ZodType<P>,
  run: (ctx: CommandContext, p: P) => CommandResult,
  options: { scope?: CommandSpec<P>['scope']; undo?: CommandSpec<P>['undo'] } = {},
): CommandSpec<never> {
  const spec: CommandSpec<P> = {
    id, params, scope: options.scope ?? 'document', mutates: true, requires: ['write'], undo: options.undo ?? 'normal',
    labelKey: `writing.command.${id}`, isEnabled: () => ({ enabled: true }), run,
  };
  return spec as unknown as CommandSpec<never>;
}
