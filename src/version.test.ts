import { describe, expect, it } from 'vitest';
import { WRITING_CORE_VERSION } from './index.js';
import pkg from '../package.json' with { type: 'json' };

describe('WRITING_CORE_VERSION', () => {
  it('matches package.json', () => {
    expect(WRITING_CORE_VERSION).toBe(pkg.version);
  });
});
