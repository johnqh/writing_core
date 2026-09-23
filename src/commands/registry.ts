import type { z } from 'zod/v4';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

export const COMMAND_ID_RE = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

/**
 * M2 task 34: a per-instance registry, so two callers registering the same test command id in one
 * process (today: `bun test`, one shared process for every file, unlike `vitest run`'s one process
 * per file) no longer collide — each gets its own instance via `createCommandRegistry()`. The module
 * level functions below keep working exactly as before: they operate on one shared default instance,
 * so no M1 caller changes.
 */
export interface CommandRegistry {
  registerCommand<P>(spec: CommandSpec<P>, aliases?: readonly string[]): void;
  getCommand(id: string): CommandSpec<unknown> | undefined;
  listCommands(): readonly CommandSpec<unknown>[];
}

export function createCommandRegistry(): CommandRegistry {
  const specs = new Map<string, CommandSpec<unknown>>();
  const aliasTo = new Map<string, string>();
  return {
    registerCommand<P>(spec: CommandSpec<P>, aliases: readonly string[] = []): void {
      for (const id of [spec.id, ...aliases]) {
        if (!COMMAND_ID_RE.test(id)) throw new Error(`invalid command id ${id}`);
        if (specs.has(id) || aliasTo.has(id)) {
          if (specs.get(id) === (spec as CommandSpec<unknown>)) continue;
          throw new Error(`command id ${id} is already registered`);
        }
      }
      specs.set(spec.id, spec as CommandSpec<unknown>);
      for (const alias of aliases) aliasTo.set(alias, spec.id);
    },
    getCommand(id: string): CommandSpec<unknown> | undefined {
      return specs.get(aliasTo.get(id) ?? id);
    },
    listCommands(): readonly CommandSpec<unknown>[] {
      return [...specs.values()];
    },
  };
}

const defaultRegistry = createCommandRegistry();

export function registerCommand<P>(spec: CommandSpec<P>, aliases: readonly string[] = [], registry: CommandRegistry = defaultRegistry): void {
  registry.registerCommand(spec, aliases);
}

export function getCommand(id: string, registry: CommandRegistry = defaultRegistry): CommandSpec<unknown> | undefined {
  return registry.getCommand(id);
}

export function listCommands(registry: CommandRegistry = defaultRegistry): readonly CommandSpec<unknown>[] {
  return registry.listCommands();
}

/**
 * A mutating, write-capability, always-enabled built-in command by default; every
 * default (`scope`, `mutates`, `requires`, `undo`, `labelKey`) can be overridden
 * explicitly via `options`. Erased to `CommandSpec<never>` for heterogeneous lists.
 */
export function defineCommand<P>(
  id: string,
  params: z.ZodType<P>,
  run: (ctx: CommandContext, p: P) => CommandResult,
  options: {
    scope?: CommandSpec<P>['scope'];
    mutates?: CommandSpec<P>['mutates'];
    requires?: CommandSpec<P>['requires'];
    undo?: CommandSpec<P>['undo'];
    labelKey?: CommandSpec<P>['labelKey'];
  } = {},
): CommandSpec<never> {
  const spec: CommandSpec<P> = {
    id, params,
    scope: options.scope ?? 'document',
    mutates: options.mutates ?? true,
    requires: options.requires ?? ['write'],
    undo: options.undo ?? 'normal',
    labelKey: options.labelKey ?? `writing.command.${id}`,
    isEnabled: () => ({ enabled: true }), run,
  };
  return spec as unknown as CommandSpec<never>;
}
