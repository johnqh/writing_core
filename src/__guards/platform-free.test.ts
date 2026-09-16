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

const CLOCK_REASON = 'host clock — forbidden except beside a platform-free-allow-clock marker (spec 02 §1.1)';

/**
 * The exemption for a clock call is a marker at the *call site*, never a `file:line`
 * pair (spec 02 §1.1, amended after review found the line-based version fails two
 * ways: an unrelated edit above a seam shifts it off its listed line and the guard
 * reddens on correct code, and — worse — a *new* ambient call that happens to land on
 * the listed line silently inherits the exemption. A marker travels with the code it
 * exempts, so neither failure is possible: `isMarkedClockCall` only looks at the two
 * lines physically adjacent to the flagged call, never a remembered line number.
 */
const CLOCK_MARKER = 'platform-free-allow-clock:';

const DATE_NOW_PATTERN = /\bDate\.now\(\)/;
const NEW_DATE_NO_ARG_PATTERN = /\bnew Date\(\s*\)/;
const CLOCK_CALL_PATTERNS: readonly RegExp[] = [DATE_NOW_PATTERN, NEW_DATE_NO_ARG_PATTERN];

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bglobalThis\.(window|document|navigator|process|Buffer|Bun|localStorage)/, reason: 'globalThis escape hatch' },
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
  // `toLocaleUpperCase()`, `toLocaleLowerCase()`, `toLocaleString()` and `localeCompare(` called
  // with NO argument fall back to the host's default locale, which this platform-free package
  // must never depend on (see src/smarttype/normalize.ts for the ASCII-vs-locale distinction).
  // Called *with* an explicit locale argument (e.g. `s.toLocaleLowerCase(language)`) is fine and
  // must not be flagged, so each pattern requires a `)` immediately after the opening `(`.
  { pattern: /\.toLocaleUpperCase\(\s*\)/, reason: 'locale-dependent case fold with no explicit locale' },
  { pattern: /\.toLocaleLowerCase\(\s*\)/, reason: 'locale-dependent case fold with no explicit locale' },
  { pattern: /\.toLocaleString\(\s*\)/, reason: 'locale-dependent formatting with no explicit locale' },
  { pattern: /\.localeCompare\(\s*\)/, reason: 'locale-dependent comparison with no argument' },
  { pattern: /\bnew Intl\./, reason: 'host-locale-dependent Intl API' },
  // A clock is a host dependency of exactly the same kind as a host locale (spec 02
  // §1.1's "no ambient inputs" rule): `Date.now()` and no-argument `new Date()` read
  // the *current* time from the host, so the same input can render differently run
  // to run. `new Date(epochMs)` — an explicit, caller-supplied epoch — is fine and
  // must not be flagged (used by src/template/locale-data.ts to format an injected
  // `LocaleDataPort` argument), so this pattern requires a `)` immediately after the
  // opening `(`, same convention as the `toLocale*` patterns above. The two legitimate
  // ambient-clock reads in this package (`IdSource.now`'s default, `createDocument`'s
  // `options.clock` default) are *defaults of injectable seams* that tests and
  // rehearsal freeze — not violations — and are exempted below by a
  // `platform-free-allow-clock:` marker at the call site, never by remembering where
  // the call happens to live.
  { pattern: DATE_NOW_PATTERN, reason: CLOCK_REASON },
  { pattern: NEW_DATE_NO_ARG_PATTERN, reason: CLOCK_REASON },
];

/** `${lineNumber} ...` → the 1-based line number, as `findViolations` formats each entry. */
function violationLineNumber(violation: string): number {
  const match = /^(\d+) /.exec(violation);
  return match ? Number(match[1]) : -1;
}

function lineHasClockMarker(line: string): boolean {
  return line.includes(CLOCK_MARKER);
}

/** The text after `platform-free-allow-clock:` on `line`, trimmed — '' when the line has no marker or the marker has no reason. */
function markerReason(line: string): string {
  const idx = line.indexOf(CLOCK_MARKER);
  return idx === -1 ? '' : line.slice(idx + CLOCK_MARKER.length).trim();
}

function lineHasClockCall(line: string): boolean {
  return CLOCK_CALL_PATTERNS.some((p) => p.test(line));
}

/**
 * True when the clock call on `lines[callLine0]` (0-based) is exempted: a
 * `platform-free-allow-clock:` marker on that same line (a trailing comment after the
 * call) or on the line immediately before it (a leading comment above the call).
 * Deliberately does not look further than one line either way — "adjacent", not
 * "somewhere nearby" — so a marker can never drift onto an unrelated call.
 */
function isMarkedClockCall(lines: readonly string[], callLine0: number): boolean {
  return lineHasClockMarker(lines[callLine0] ?? '') || lineHasClockMarker(lines[callLine0 - 1] ?? '');
}

/**
 * True when the marker on `lines[markerLine0]` (0-based) is valid: it names a
 * non-empty reason, and there is a clock call on that same line or the next line. A
 * marker that fails either check is stale — it exempts nothing, so it must not be
 * allowed to sit in the tree looking like it does (spec 02 §1.1's stale-marker rule).
 */
function isValidClockMarker(lines: readonly string[], markerLine0: number): boolean {
  const line = lines[markerLine0] ?? '';
  const hasReason = markerReason(line).length > 0;
  const hasAdjacentCall = lineHasClockCall(line) || lineHasClockCall(lines[markerLine0 + 1] ?? '');
  return hasReason && hasAdjacentCall;
}

/**
 * One file's platform-free violations: every `FORBIDDEN` pattern, with the marker
 * rule applied to clock violations specifically — an ambient `Date.now()`/`new Date()`
 * with no adjacent marker is kept, one with a valid adjacent marker is dropped, and
 * any marker that is itself stale (§1.1) is reported even where the call it should
 * have exempted is otherwise fine. Factored out of the repo-wide test so it can also
 * be driven directly against small fixtures below, proving each of the three required
 * clock-marker behaviours (and the reviewer's mode-B probe) as permanent tests, not
 * one-off manual checks.
 */
function findGuardViolations(relPath: string, fileText: string): string[] {
  const violations: string[] = [];
  const lines = fileText.split('\n');
  for (const violation of findViolations(fileText)) {
    if (violation.includes(CLOCK_REASON)) {
      const lineNum = violationLineNumber(violation);
      if (lineNum > 0 && isMarkedClockCall(lines, lineNum - 1)) continue;
    }
    violations.push(`${relPath}:${violation}`);
  }
  lines.forEach((line, idx) => {
    if (lineHasClockMarker(line) && !isValidClockMarker(lines, idx)) {
      violations.push(`${relPath}:${idx + 1} stale platform-free-allow-clock marker (needs a reason and a clock call on this line or the next): ${line.trim()}`);
    }
  });
  return violations;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__guards' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * Strips a trailing `//` comment from a line, so a violation mentioned only
 * in prose (`// see window.location for context`) doesn't get flagged,
 * while a `//` inside a string literal (e.g. a protocol-relative URL like
 * `'//cdn.example.com'`) is left alone — otherwise the rest of the line,
 * including a real violation after the string, would silently go
 * unscanned. Walks the line tracking whether it is inside a `'`, `"` or
 * backtick string (honouring `\` escapes); only a `//` seen outside any
 * such string is treated as a comment start.
 *
 * This is still a single-line, best-effort scan, not a real tokenizer:
 * quote tracking does not carry across lines (a multi-line template
 * literal is not modelled), and a regex literal containing an unescaped
 * `//` (e.g. `/a\/\/b/`) is not recognised as a literal — the `/` and `/`
 * delimiters aren't tracked as a quote type, so such a line would still be
 * truncated at that `//`. Acceptable for a guard whose job is to catch real
 * host-API usage in this repo's source, not to fully parse the language.
 */
function stripTrailingComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i += 1; // skip the escaped character, whatever it is
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
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

  it('still flags a violation after a string literal containing an unescaped //', () => {
    expect(findViolations(`const cdn = '//cdn.example.com'; require('utils');`)).toHaveLength(1);
  });

  it('still flags a violation after a short string literal containing //', () => {
    expect(findViolations(`const s = 'a//b'; require('utils');`)).toHaveLength(1);
  });

  it('flags toLocaleUpperCase() called with no locale argument', () => {
    expect(findViolations(`const s = x.toLocaleUpperCase();`)).toHaveLength(1);
  });

  it('does not flag toLocaleUpperCase(locale) called with an explicit locale', () => {
    expect(findViolations(`const s = x.toLocaleUpperCase('en');`)).toEqual([]);
  });

  it('flags toLocaleLowerCase() called with no locale argument', () => {
    expect(findViolations(`const s = x.toLocaleLowerCase();`)).toHaveLength(1);
  });

  it('does not flag toLocaleLowerCase(language) called with an explicit locale', () => {
    expect(findViolations(`const s = x.toLocaleLowerCase(language);`)).toEqual([]);
  });

  it('flags toLocaleString() called with no locale argument', () => {
    expect(findViolations(`const s = n.toLocaleString();`)).toHaveLength(1);
  });

  it('does not flag toLocaleString(locale) called with an explicit locale', () => {
    expect(findViolations(`const s = n.toLocaleString('en-US');`)).toEqual([]);
  });

  it('flags localeCompare() called with no argument', () => {
    expect(findViolations(`const c = a.localeCompare();`)).toHaveLength(1);
  });

  it('does not flag localeCompare(b) called with an argument', () => {
    expect(findViolations(`const c = a.localeCompare(b);`)).toEqual([]);
  });

  it('flags bare `new Intl.` usage', () => {
    expect(findViolations(`const f = new Intl.Collator('en');`)).toHaveLength(1);
  });

  it('does not flag a real violation only when it is truly in a trailing comment, even next to a // in a string', () => {
    expect(findViolations(`const u = 'https://x.y'; // window.location`)).toEqual([]);
  });

  it('flags Date.now()', () => {
    expect(findViolations(`const t = Date.now();`)).toHaveLength(1);
  });

  it('flags new Date() with no argument', () => {
    expect(findViolations(`const d = new Date();`)).toHaveLength(1);
  });

  it('does not flag new Date(epochMs) with an explicit, caller-supplied epoch', () => {
    expect(findViolations(`const d = new Date(epochMs);`)).toEqual([]);
  });
});

describe('clock guard: platform-free-allow-clock marker (spec 02 §1.1)', () => {
  // Behaviour 1: an ambient call with no marker fails, naming file and line.
  it('an ambient clock call with no marker fails, naming the file and line', () => {
    const fileText = ['line one', 'const t = Date.now();', 'line three'].join('\n');
    expect(findGuardViolations('some/file.ts', fileText)).toEqual([`some/file.ts:2 ${CLOCK_REASON}: const t = Date.now();`]);
  });

  it('an ambient new Date() with no marker also fails', () => {
    const fileText = 'const d = new Date();';
    expect(findGuardViolations('some/file.ts', fileText)).toEqual([`some/file.ts:1 ${CLOCK_REASON}: const d = new Date();`]);
  });

  // Behaviour 2: both legitimate seams pass with their markers.
  it('a marker trailing the call on the same line passes', () => {
    const fileText = 'now: () => Date.now(), // platform-free-allow-clock: IdSource.now default — ULID timestamps';
    expect(findGuardViolations('ids/id-source.ts', fileText)).toEqual([]);
  });

  it('a marker leading the call on the line above passes', () => {
    const fileText = [
      '// platform-free-allow-clock: options.clock default — freezable by callers',
      'const clock = options.clock ?? (() => Date.now());',
    ].join('\n');
    expect(findGuardViolations('model/create.ts', fileText)).toEqual([]);
  });

  it('a marker two lines away (not adjacent) does not exempt the call', () => {
    const fileText = ['// platform-free-allow-clock: too far away', '', 'const t = Date.now();'].join('\n');
    const violations = findGuardViolations('some/file.ts', fileText);
    expect(violations.some((v) => v.startsWith('some/file.ts:3 '))).toBe(true);
  });

  // Behaviour 3: a marker with no clock call beside it fails.
  it('a marker with no clock call on the same or next line is a stale-marker failure', () => {
    const fileText = ['// platform-free-allow-clock: nothing clock-related follows', 'const x = 1;'].join('\n');
    const violations = findGuardViolations('some/file.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('stale platform-free-allow-clock marker');
    expect(violations[0]).toContain('some/file.ts:1');
  });

  it('a marker with no reason text is also invalid, even sitting right next to a real call', () => {
    const fileText = 'const t = Date.now(); // platform-free-allow-clock:';
    const violations = findGuardViolations('some/file.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('stale platform-free-allow-clock marker');
  });

  // The reviewer's two probes, reproduced as permanent regression tests.
  it("mode A (previously reddened on correct code): an unrelated edit above the seam doesn't move the exemption off a line number, because there is no line number", () => {
    const fileText = [
      '// a totally unrelated comment inserted above the seam',
      '// another unrelated line, pushing everything further down',
      'now: () => Date.now(), // platform-free-allow-clock: IdSource.now default',
    ].join('\n');
    expect(findGuardViolations('ids/id-source.ts', fileText)).toEqual([]);
  });

  it('mode B (previously silently authorised): a new unmarked Date.now() that lands where the old line-based exemption used to live is still caught, while the legitimate marked seam still passes', () => {
    const fileText = [
      '// unrelated comment inserted above, shifting everything down',
      'export function newHelper() {',
      '  return Date.now(); // no marker on this call — must be caught',
      '}',
      '',
      'now: () => Date.now(), // platform-free-allow-clock: IdSource.now default — legitimate seam',
    ].join('\n');
    const violations = findGuardViolations('ids/id-source.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('ids/id-source.ts:3 ');
    expect(violations[0]).toContain('return Date.now()');
  });
});

describe('platform-free guard', () => {
  it('finds source files to check', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });

  it('no shipping source references a host-specific API, except a clock call carrying a valid platform-free-allow-clock marker', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relPath = relative(SRC, file);
      violations.push(...findGuardViolations(relPath, readFileSync(file, 'utf8')));
    }
    expect(violations).toEqual([]);
  });
});
