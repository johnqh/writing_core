import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { defineCommand, getCommand, registerCommand } from './registry.js';
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
