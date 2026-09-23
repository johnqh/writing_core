import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { createCommandRegistry, defineCommand, getCommand, listCommands, registerCommand } from './registry.js';
import type { CommandContext } from './types.js';

describe('defineCommand', () => {
  it('applies the scope, mutates, requires, undo and labelKey defaults', () => {
    const spec = defineCommand('test.defDefaults', z.object({}), () => ({ ok: true }));
    expect(spec.scope).toBe('document');
    expect(spec.mutates).toBe(true);
    expect(spec.requires).toEqual(['write']);
    expect(spec.undo).toBe('normal');
    expect(spec.labelKey).toBe('writing.command.test.defDefaults');
    expect(spec.isEnabled({} as CommandContext, undefined as never)).toEqual({ enabled: true });
  });

  it('accepts an explicit override of each default', () => {
    const spec = defineCommand('test.defOverrides', z.object({}), () => ({ ok: true }), {
      scope: 'titlePage',
      mutates: false,
      requires: ['comment'],
      undo: 'standalone',
      labelKey: 'writing.command.custom.key',
    });
    expect(spec.scope).toBe('titlePage');
    expect(spec.mutates).toBe(false);
    expect(spec.requires).toEqual(['comment']);
    expect(spec.undo).toBe('standalone');
    expect(spec.labelKey).toBe('writing.command.custom.key');
  });

  it('overriding one option leaves the others at their default', () => {
    const spec = defineCommand('test.defPartialOverride', z.object({}), () => ({ ok: true }), { undo: 'none' });
    expect(spec.undo).toBe('none');
    expect(spec.scope).toBe('document');
    expect(spec.mutates).toBe(true);
    expect(spec.requires).toEqual(['write']);
    expect(spec.labelKey).toBe('writing.command.test.defPartialOverride');
  });

  it('produces a spec the registry can register and resolve', () => {
    registerCommand(defineCommand('test.defRegistered', z.object({}), () => ({ ok: true })));
    expect(getCommand('test.defRegistered')?.id).toBe('test.defRegistered');
  });
});

describe('createCommandRegistry', () => {
  it('gives an isolated instance: the same id registered with two different specs in two instances does not throw', () => {
    const a = createCommandRegistry();
    const b = createCommandRegistry();
    const specA = defineCommand('test.isolated', z.object({ x: z.number() }), () => ({ ok: true }));
    const specB = defineCommand('test.isolated', z.object({ y: z.string() }), () => ({ ok: true }));
    a.registerCommand(specA);
    expect(() => b.registerCommand(specB)).not.toThrow();
    expect(a.getCommand('test.isolated')).toBe(specA);
    expect(b.getCommand('test.isolated')).toBe(specB);
    expect(a.listCommands()).toEqual([specA]);
    expect(b.listCommands()).toEqual([specB]);
    // Neither instance leaks into the shared default registry used by registerCommand/getCommand.
    expect(getCommand('test.isolated')).toBeUndefined();
  });

  it('re-registering the exact same spec object on one instance is idempotent, a different one still throws', () => {
    const r = createCommandRegistry();
    const spec = defineCommand('test.reReg', z.object({}), () => ({ ok: true }));
    r.registerCommand(spec);
    expect(() => r.registerCommand(spec)).not.toThrow();
    const other = defineCommand('test.reReg', z.object({}), () => ({ ok: true }));
    expect(() => r.registerCommand(other)).toThrow(/already registered/);
  });

  it('module-level registerCommand/getCommand/listCommands accept an explicit registry, defaulting to the shared one', () => {
    const r = createCommandRegistry();
    const spec = defineCommand('test.explicitRegistry', z.object({}), () => ({ ok: true }));
    registerCommand(spec, [], r);
    expect(getCommand('test.explicitRegistry', r)?.id).toBe('test.explicitRegistry');
    expect(getCommand('test.explicitRegistry')).toBeUndefined(); // not on the default
    expect(listCommands(r)).toEqual([spec]);
  });
});
