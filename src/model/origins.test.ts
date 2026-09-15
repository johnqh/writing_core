import { describe, expect, it } from 'vitest';
import { systemOrigin } from './origins.js';

describe('systemOrigin', () => {
  it('is identity-stable per name across calls, so Y.UndoManager and listeners can compare by reference', () => {
    expect(systemOrigin('create')).toBe(systemOrigin('create'));
    expect(systemOrigin('migrate')).toBe(systemOrigin('migrate'));
  });

  it('returns a distinct, frozen origin per name that shares the same system actor', () => {
    const create = systemOrigin('create');
    const repair = systemOrigin('repair');
    expect(create).not.toBe(repair);
    expect(create.name).toBe('create');
    expect(repair.name).toBe('repair');
    expect(create.actor).toBe(repair.actor);
    expect(create.actor.kind).toBe('system');
    expect(Object.isFrozen(create)).toBe(true);
  });

  it('is identity-stable across every SystemOriginName', () => {
    const names = ['create', 'repair', 'rebalance', 'migrate', 'applyTemplate', 'fromJSON', 'ai'] as const;
    for (const name of names) expect(systemOrigin(name)).toBe(systemOrigin(name));
  });
});
