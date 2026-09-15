import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * writing_core runs unchanged in browsers, Hermes (React Native) and Bun.
 * Any reference to a host-specific global or module makes that false on at
 * least one of them, and the failure only shows up on the platform nobody
 * tested. `tsconfig.json` (lib ES2022, `types: []`, no DOM lib) is the first
 * line of defence: a bare `window`, `document`, `Buffer` etc. is already a
 * type error there. This guard is the second line — it catches the escape
 * hatches typechecking can't see, such as `globalThis.window` or a dynamic
 * `import('node:fs')`, by reading every shipping source file as text.
 */
const SRC = join(import.meta.dirname, '..');

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /globalThis\.(window|document|navigator|process|Buffer|Bun|localStorage)/, reason: 'globalThis escape hatch' },
  { pattern: /\bimport\(\s*['"]node:/, reason: 'dynamic Node built-in import' },
  { pattern: /from ['"]node:/, reason: 'Node built-in' },
  { pattern: /\brequire\(/, reason: 'CommonJS' },
  { pattern: /\bimport\.meta\b/, reason: 'unsupported by Hermes/Metro' },
  { pattern: /\bprocess\.env\b/, reason: 'host environment' },
  { pattern: /\bBuffer\./, reason: 'Node global' },
  { pattern: /\bBun\./, reason: 'Bun global' },
  { pattern: /\blocalStorage\b/, reason: 'browser storage' },
  { pattern: /\bnavigator\./, reason: 'browser global' },
  {
    pattern: /\bwindow\.(document|location|addEventListener|removeEventListener|navigator|localStorage|sessionStorage|innerWidth|innerHeight|requestAnimationFrame|getComputedStyle)\b/,
    reason: 'browser global',
  },
  {
    pattern: /\bdocument\.(createElement|getElementById|querySelector|querySelectorAll|body|head|addEventListener|fonts|activeElement)\b/,
    reason: 'DOM global',
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__guards' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * Strips a trailing `//` comment from a line, so a violation mentioned only
 * in prose (`// see window.location for context`) doesn't get flagged.
 * `://` (as in `https://example.com`) is deliberately not treated as a
 * comment start — only a `//` not immediately preceded by `:` counts.
 * This is a line-based heuristic, not a full tokenizer: it doesn't know
 * about string literals, so `const s = '// not a comment';` would also be
 * stripped. That's an acceptable false-negative for a guard whose job is to
 * catch real host-API usage, not to fully understand the language.
 */
function stripTrailingComment(line: string): string {
  for (let i = 0; i < line.length - 1; i += 1) {
    if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Pure scanner: given one file's full text, returns one message per
 * violating line as `${lineNumber} ${reason}: ${trimmedLine}`. Exercised
 * directly against fixtures below, and used by the repo-wide guard test
 * further down (which prefixes each message with the relative file path).
 */
function findViolations(fileText: string): string[] {
  const violations: string[] = [];
  fileText.split('\n').forEach((rawLine, i) => {
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const line = stripTrailingComment(rawLine);
    for (const { pattern, reason } of FORBIDDEN) {
      if (pattern.test(line)) violations.push(`${i + 1} ${reason}: ${line.trim()}`);
    }
  });
  return violations;
}

describe('findViolations', () => {
  it('flags globalThis.window / .document / .process / etc.', () => {
    expect(findViolations(`const w = globalThis.window;`)).toHaveLength(1);
  });

  it('flags a dynamic import of a node: built-in', () => {
    expect(findViolations(`const fs = await import('node:fs');`)).toHaveLength(1);
  });

  it('flags a static import from a node: built-in', () => {
    expect(findViolations(`import { readFileSync } from 'node:fs';`)).toHaveLength(1);
  });

  it('flags require(...)', () => {
    expect(findViolations(`const fs = require('fs');`)).toHaveLength(1);
  });

  it('flags import.meta', () => {
    expect(findViolations(`const dir = import.meta.dirname;`)).toHaveLength(1);
  });

  it('flags process.env', () => {
    expect(findViolations(`const key = process.env.API_KEY;`)).toHaveLength(1);
  });

  it('flags Buffer.<member>', () => {
    expect(findViolations(`const b = Buffer.from('x');`)).toHaveLength(1);
  });

  it('flags Bun.<member>', () => {
    expect(findViolations(`const f = Bun.file('x');`)).toHaveLength(1);
  });

  it('flags localStorage', () => {
    expect(findViolations(`localStorage.setItem('a', 'b');`)).toHaveLength(1);
  });

  it('flags navigator.<member>', () => {
    expect(findViolations(`navigator.clipboard.writeText('x');`)).toHaveLength(1);
  });

  it('flags window.<real browser member>', () => {
    expect(findViolations(`window.location.href = '/x';`)).toHaveLength(1);
  });

  it('flags document.<real DOM member>', () => {
    expect(findViolations(`document.getElementById('app');`)).toHaveLength(1);
  });

  it('does not flag a local variable named window used as an ordinary layout term', () => {
    expect(findViolations(`const window = { start: 0 }; window.start;`)).toEqual([]);
  });

  it('does not flag a forbidden term mentioned only in a trailing comment', () => {
    expect(findViolations(`const x = 1; // window.location`)).toEqual([]);
  });
});

describe('platform-free guard', () => {
  it('finds source files to check', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it('no shipping source references a host-specific API', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const fileText = readFileSync(file, 'utf8');
      for (const violation of findViolations(fileText)) {
        violations.push(`${relative(SRC, file)}:${violation}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
