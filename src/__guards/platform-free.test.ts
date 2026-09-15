import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * writing_core runs unchanged in browsers, Hermes (React Native) and Bun.
 * Any reference to a host-specific global or module makes that false on at
 * least one of them, and the failure only shows up on the platform nobody
 * tested. This guard reads every shipping source file and refuses them.
 */
const SRC = join(import.meta.dirname, '..');

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bwindow\./, reason: 'browser global' },
  { pattern: /\bdocument\.(?!id\b)/, reason: 'DOM global' },
  { pattern: /\bnavigator\./, reason: 'browser global' },
  { pattern: /\blocalStorage\b/, reason: 'browser storage' },
  { pattern: /\bimport\.meta\b/, reason: 'unsupported by Hermes/Metro' },
  { pattern: /from ['"]node:/, reason: 'Node built-in' },
  { pattern: /\brequire\(/, reason: 'CommonJS' },
  { pattern: /\bprocess\.env\b/, reason: 'host environment' },
  { pattern: /\bBuffer\b/, reason: 'Node global' },
  { pattern: /\bBun\./, reason: 'Bun global' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__guards' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('platform-free guard', () => {
  it('finds source files to check', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it('no shipping source references a host-specific API', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
        for (const { pattern, reason } of FORBIDDEN) {
          if (pattern.test(line)) violations.push(`${relative(SRC, file)}:${i + 1} ${reason}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
