import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * writing_core runs unchanged in browsers, Hermes (React Native) and Bun.
 * Any reference to a host-specific global or module makes that false on at
 * least one of them, and the failure only shows up on the platform nobody
 * tested. `tsconfig.json` (lib ES2022, `types: []`, no DOM lib) is the first
 * line of defence: a bare `window`, `document`, `Buffer` etc. is already a
 * type error there. This guard is the second line, and it parses.
 *
 * **The guard parses; it does not scan lines** (spec 02 §1.1). Three
 * successive line-based designs were defeated by review — `file:line`
 * pairs, a marker on the line before the call, then same-line binding with a
 * quote-aware text scanner — the last by four bypasses that needed no marker
 * at all, all sharing one cause: a line scanner cannot distinguish code from
 * string, comment and regex, so every patch relocated the ambiguity instead
 * of removing it.
 *   1. `/* platform-free-allow-clock: x *\/ const t = Date.now();` — a line
 *      beginning `/*` was skipped wholesale by a pre-existing heuristic, so
 *      the real call was never scanned at all.
 *   2. `const t = 2\n  * Date.now();` — the continuation line trims to
 *      `* Date.now();`, and the same heuristic (there to skip JSDoc
 *      continuation lines) skipped it too.
 *   3. `const r = /[a//b]/; const t = Date.now();` — a regex character
 *      class containing `//` needs no escape; the quote-aware scan (which
 *      never modelled regex literals) truncated the line there, hiding the
 *      real call that followed.
 *   4. The same regex trick with the real call *before* it: a marker past
 *      the false truncation point exempted a call it had no comment
 *      relationship to.
 * Bugs 1 and 2 belong to *every* forbidden-API rule this guard has, not
 * only the clock — `Intl` hides behind the same skipped lines. `typescript`
 * is already a devDependency; this guard now walks the real AST (`ts.
 * createSourceFile`) for every forbidden call, and reads a clock exemption
 * from the genuine comment ranges the compiler attaches to the call's own
 * statement, not from line text. A parser has no notion of "line starts
 * with `*`" and no string/comment/regex ambiguity, so this closes all four
 * bypasses (and the false positive from round 3's own quote tracker
 * desyncing on a stray `'` inside a regex) in one move, for every rule.
 */
const SRC = join(import.meta.dirname, '..');

/**
 * The clock exemption is a `platform-free-allow-clock:` marker that must
 * *trail* the offending call — physically read from the comment range(s)
 * following the call's own statement/element in the source text (via
 * `ts.getTrailingCommentRanges`, the same API the compiler itself uses for
 * comment attachment), never from "the same line" as raw text. A leading
 * comment on the same line, or a comment trailing some other statement that
 * merely shares a line with the call, both fail to exempt anything — spec
 * 02 §1.1 records both as historical bypasses of the previous, line-based
 * design. A marker that never validly trails any clock call is itself a
 * guard failure (stale-marker rule): it exempts nothing, so it must not sit
 * in the tree looking like it does.
 */
const CLOCK_MARKER = 'platform-free-allow-clock:';
const CLOCK_REASON = 'host clock — forbidden except beside a platform-free-allow-clock marker (spec 02 §1.1)';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__guards' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

// ─── AST predicates ─────────────────────────────────────────────────────────

function isIdent(node: ts.Node | undefined, name: string): boolean {
  return !!node && ts.isIdentifier(node) && node.text === name;
}

/** `objName.<anything>` — a property access whose base is the bare identifier `objName`. */
function isPropAccessOf(node: ts.Node, objName: string): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && isIdent(node.expression, objName);
}

/**
 * True when `node` (an Identifier) is used as a bare value reference — not a
 * declaration name (`const localStorage = …`, a parameter, a binding) and
 * not the member name of a property access (`x.localStorage`, where
 * `localStorage` is someone's own property, not the global). Scoped to what
 * this guard actually needs: distinguishing a real global reference from
 * the two most plausible false-positive shapes, not full scope analysis.
 */
function isPlainReference(node: ts.Identifier): boolean {
  const p: ts.Node | undefined = node.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return false;
  if (ts.isVariableDeclaration(p) && p.name === node) return false;
  if (ts.isParameter(p) && p.name === node) return false;
  if (ts.isBindingElement(p) && p.name === node) return false;
  if (ts.isFunctionDeclaration(p) && p.name === node) return false;
  if (ts.isClassDeclaration(p) && p.name === node) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return false;
  if (ts.isPropertySignature(p) && p.name === node) return false;
  if (ts.isMethodDeclaration(p) && p.name === node) return false;
  if (ts.isImportSpecifier(p) && (p.name === node || p.propertyName === node)) return false;
  return true;
}

const GLOBALTHIS_MEMBERS = new Set(['window', 'document', 'navigator', 'process', 'Buffer', 'Bun', 'localStorage']);
const WINDOW_MEMBERS = new Set([
  'document', 'location', 'addEventListener', 'removeEventListener', 'navigator', 'localStorage', 'sessionStorage',
  'innerWidth', 'innerHeight', 'requestAnimationFrame', 'getComputedStyle',
]);
const DOCUMENT_MEMBERS = new Set(['createElement', 'getElementById', 'querySelector', 'querySelectorAll', 'body', 'head', 'addEventListener', 'fonts', 'activeElement']);
const LOCALE_ZERO_ARG_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['toLocaleUpperCase', 'locale-dependent case fold with no explicit locale'],
  ['toLocaleLowerCase', 'locale-dependent case fold with no explicit locale'],
  ['toLocaleString', 'locale-dependent formatting with no explicit locale'],
  ['localeCompare', 'locale-dependent comparison with no argument'],
];

interface AstMatcher {
  reason: string;
  test: (node: ts.Node) => boolean;
}

/** Every forbidden-API rule this guard has ever had, now expressed over AST node shapes instead of text patterns. */
const NON_CLOCK_MATCHERS: readonly AstMatcher[] = [
  { reason: 'globalThis escape hatch', test: (n) => isPropAccessOf(n, 'globalThis') && GLOBALTHIS_MEMBERS.has(n.name.text) },
  {
    reason: 'dynamic Node built-in import',
    test: (n) =>
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments.length > 0 &&
      ts.isStringLiteralLike(n.arguments[0]!) &&
      n.arguments[0]!.text.startsWith('node:'),
  },
  {
    reason: 'Node built-in',
    test: (n) => {
      const spec = ts.isImportDeclaration(n) ? n.moduleSpecifier : ts.isExportDeclaration(n) ? n.moduleSpecifier : undefined;
      return !!spec && ts.isStringLiteral(spec) && spec.text.startsWith('node:');
    },
  },
  { reason: 'CommonJS', test: (n) => ts.isCallExpression(n) && isIdent(n.expression, 'require') },
  { reason: 'unsupported by Hermes/Metro', test: (n) => ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword && n.name.text === 'meta' },
  { reason: 'host environment', test: (n) => isPropAccessOf(n, 'process') && n.name.text === 'env' },
  { reason: 'Node global', test: (n) => isPropAccessOf(n, 'Buffer') },
  { reason: 'Bun global', test: (n) => isPropAccessOf(n, 'Bun') },
  { reason: 'browser storage', test: (n) => ts.isIdentifier(n) && n.text === 'localStorage' && isPlainReference(n) },
  { reason: 'browser global', test: (n) => isPropAccessOf(n, 'navigator') },
  { reason: 'browser global', test: (n) => isPropAccessOf(n, 'window') && WINDOW_MEMBERS.has(n.name.text) },
  { reason: 'DOM global', test: (n) => isPropAccessOf(n, 'document') && DOCUMENT_MEMBERS.has(n.name.text) },
  ...LOCALE_ZERO_ARG_METHODS.map(
    ([method, reason]): AstMatcher => ({
      reason,
      test: (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === method && n.arguments.length === 0,
    }),
  ),
  {
    reason: 'host-locale-dependent Intl API',
    test: (n) => ts.isNewExpression(n) && ts.isPropertyAccessExpression(n.expression) && isIdent(n.expression.expression, 'Intl'),
  },
];

/** `Date.now()` and no-argument `new Date()` — handled separately because they alone can be exempted by a marker. */
const CLOCK_MATCHERS: readonly AstMatcher[] = [
  {
    reason: CLOCK_REASON,
    test: (n) => ts.isCallExpression(n) && isPropAccessOf(n.expression, 'Date') && n.expression.name.text === 'now' && n.arguments.length === 0,
  },
  { reason: CLOCK_REASON, test: (n) => ts.isNewExpression(n) && isIdent(n.expression, 'Date') && (n.arguments === undefined || n.arguments.length === 0) },
];

// ─── Comment handling (real comment ranges, never line text) ───────────────

/**
 * Walks up from `node` to the nearest ancestor that is a direct statement,
 * object-literal property, or class/interface member — the smallest unit
 * whose own `.end` is a meaningful place to look for a trailing comment.
 * Scoped to the container kinds this repo's forbidden calls actually appear
 * in; an exotic position (inside an array literal element, say) falls back
 * to a higher ancestor, which only risks a spurious "unmarked" report for a
 * marker placed somewhere this guard doesn't specifically look — the safe
 * direction, never a silent bypass.
 */
function enclosingElement(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    !ts.isBlock(current.parent) &&
    !ts.isModuleBlock(current.parent) &&
    !ts.isObjectLiteralExpression(current.parent) &&
    !ts.isClassDeclaration(current.parent) &&
    !ts.isClassExpression(current.parent) &&
    !ts.isInterfaceDeclaration(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

/**
 * Real trailing comment ranges starting right after `endPos`, skipping at
 * most one list-separator or statement-terminator character first — a list
 * element's own `.end` (an object-literal property, say) does not include
 * its trailing `,`, so `now: () => Date.now(), // marker` needs the comma
 * skipped before `ts.getTrailingCommentRanges` can see the comment; a
 * statement's `.end` already includes its `;`, so the skip is a no-op there.
 */
function trailingCommentRangesAfter(fullText: string, endPos: number): readonly ts.CommentRange[] {
  let pos = endPos;
  while (pos < fullText.length && (fullText[pos] === ',' || fullText[pos] === ';')) pos += 1;
  return ts.getTrailingCommentRanges(fullText, pos) ?? [];
}

/** `platform-free-allow-clock:` plus its reason from one comment's raw text (a `//` line comment or a block comment), or null if absent. */
function markerInfo(commentText: string): { reason: string } | null {
  const idx = commentText.indexOf(CLOCK_MARKER);
  if (idx === -1) return null;
  const rest = commentText.slice(idx + CLOCK_MARKER.length).replace(/\*\/\s*$/, '');
  return { reason: rest.trim() };
}

/** The marker (if any) genuinely trailing `node`'s enclosing statement/element — real comment ranges, not line text. */
function findMarkerFor(node: ts.Node, fullText: string): { pos: number; reason: string } | null {
  for (const range of trailingCommentRangesAfter(fullText, enclosingElement(node).end)) {
    const info = markerInfo(fullText.slice(range.pos, range.end));
    if (info) return { pos: range.pos, reason: info.reason };
  }
  return null;
}

/**
 * Every comment in the file. A comment on its own line is leading trivia of
 * whatever real token follows it; a comment sharing a line with preceding
 * code — every marker this guard cares about — is the *trailing* comment of
 * whatever precedes it instead (confirmed directly against the compiler:
 * `getLeadingCommentRanges` returns nothing for a same-line trailing
 * comment, only `getTrailingCommentRanges` finds it). So this walks every
 * node and asks for *both* the leading ranges at its full-start and the
 * trailing ranges at its end, deduped by position — between the two, every
 * comment in the file is found by at least one node. Used only to find
 * markers that don't validly trail any clock call (the stale-marker check)
 * — detection itself never needs this, since `ts.createSourceFile` already
 * correctly tokenizes string, template and regex literals as opaque single
 * tokens, so a `//` or marker text inside one is never trivia and is never
 * returned here.
 */
function collectComments(sourceFile: ts.SourceFile, fullText: string): ReadonlyArray<{ pos: number; text: string }> {
  const seen = new Set<number>();
  const out: Array<{ pos: number; text: string }> = [];
  const record = (ranges: readonly ts.CommentRange[] | undefined): void => {
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      out.push({ pos: r.pos, text: fullText.slice(r.pos, r.end) });
    }
  };
  const visit = (node: ts.Node): void => {
    record(ts.getLeadingCommentRanges(fullText, node.getFullStart()));
    record(ts.getTrailingCommentRanges(fullText, node.getEnd()));
    node.forEachChild(visit);
  };
  visit(sourceFile);
  record(ts.getLeadingCommentRanges(fullText, sourceFile.endOfFileToken.getFullStart()));
  return out;
}

// ─── The guard itself ────────────────────────────────────────────────────────

/**
 * One substring per rule (and the marker), each a *necessary* prerequisite
 * for that rule to ever match: every identifier and keyword a matcher looks
 * for must appear verbatim in the source text for the parser to produce a
 * token for it at all, so a file containing none of these cannot possibly
 * contain any violation or marker. This is not a semantic heuristic — it
 * decides nothing about code vs. string vs. comment vs. regex, only whether
 * full parsing is worth attempting — so it cannot reintroduce any of the
 * four bypasses; it can only ever over-trigger (parse a file that turns out
 * clean), never under-trigger. Exists because this package ships several
 * multi-hundred-KB generated data tables (dictionaries, font metrics) that
 * are pure data and can never contain a forbidden call — parsing 13+ MB of
 * source on every guard run is the dominant cost this guard has, once
 * per-file text scanning stopped being the alternative.
 */
const TRIGGER_SUBSTRINGS: readonly string[] = [
  'globalThis', 'node:', 'require(', 'import.meta', 'process', 'Buffer', 'Bun', 'localStorage',
  'navigator', 'window', 'document', 'toLocaleUpperCase', 'toLocaleLowerCase', 'toLocaleString',
  'localeCompare', 'Intl', 'Date', CLOCK_MARKER,
];

function mightHaveViolations(fileText: string): boolean {
  return TRIGGER_SUBSTRINGS.some((s) => fileText.includes(s));
}

/**
 * One file's platform-free violations, found by walking its real AST: every
 * `NON_CLOCK_MATCHERS` hit is reported unconditionally; every
 * `CLOCK_MATCHERS` hit is reported unless a valid `platform-free-allow-clock:`
 * marker genuinely trails it (§1.1); every such marker that never validly
 * trails a clock call is reported as stale. `ts.createSourceFile` recovers
 * from syntax errors rather than throwing, so this never crashes on a
 * fixture.
 */
function findGuardViolations(relPath: string, fileText: string): string[] {
  if (!mightHaveViolations(fileText)) return [];
  const sourceFile = ts.createSourceFile(relPath, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = fileText.split('\n');
  const lineTextAt = (line0: number): string => (lines[line0] ?? '').trim();
  const lineOf = (pos: number): number => sourceFile.getLineAndCharacterOfPosition(pos).line;

  const violations: string[] = [];
  // comment.pos -> its reason text, for every marker `findMarkerFor` actually found
  // trailing some clock call — recorded whether or not the reason is non-empty, so a
  // reason-less marker still suppresses the raw "unmarked call" report (there was a
  // marker attempt) while the stale-marker pass below reports the real problem once,
  // not the same mistake twice under two different messages.
  const markerReasonByPos = new Map<number, string>();

  const visitNonClock = (node: ts.Node): void => {
    for (const m of NON_CLOCK_MATCHERS) {
      if (m.test(node)) violations.push(`${relPath}:${lineOf(node.getStart(sourceFile)) + 1} ${m.reason}: ${lineTextAt(lineOf(node.getStart(sourceFile)))}`);
    }
    node.forEachChild(visitNonClock);
  };
  visitNonClock(sourceFile);

  const visitClock = (node: ts.Node): void => {
    for (const m of CLOCK_MATCHERS) {
      if (!m.test(node)) continue;
      const marker = findMarkerFor(node, fileText);
      if (marker) {
        markerReasonByPos.set(marker.pos, marker.reason);
        continue;
      }
      const line0 = lineOf(node.getStart(sourceFile));
      violations.push(`${relPath}:${line0 + 1} ${m.reason}: ${lineTextAt(line0)}`);
    }
    node.forEachChild(visitClock);
  };
  visitClock(sourceFile);

  for (const comment of collectComments(sourceFile, fileText)) {
    if (!comment.text.includes(CLOCK_MARKER)) continue;
    const reason = markerReasonByPos.get(comment.pos);
    const isValid = reason !== undefined && reason.length > 0;
    if (isValid) continue;
    const line0 = lineOf(comment.pos);
    violations.push(
      `${relPath}:${line0 + 1} stale platform-free-allow-clock marker (needs a reason and to trail a clock call as a same-line comment): ${lineTextAt(line0)}`,
    );
  }

  return violations;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('findGuardViolations: forbidden APIs (walked over the real AST)', () => {
  it('flags globalThis.window / .document / .process / etc.', () => {
    expect(findGuardViolations('f.ts', 'const w = globalThis.window;')).toHaveLength(1);
  });

  it('flags a dynamic import of a node: built-in', () => {
    expect(findGuardViolations('f.ts', "const fs = await import('node:fs');")).toHaveLength(1);
  });

  it('flags a static import from a node: built-in', () => {
    expect(findGuardViolations('f.ts', "import { readFileSync } from 'node:fs';")).toHaveLength(1);
  });

  it('flags a static export ... from a node: built-in', () => {
    expect(findGuardViolations('f.ts', "export { readFileSync } from 'node:fs';")).toHaveLength(1);
  });

  it('flags require(...)', () => {
    expect(findGuardViolations('f.ts', "const fs = require('fs');")).toHaveLength(1);
  });

  it('flags import.meta', () => {
    expect(findGuardViolations('f.ts', 'const dir = import.meta.dirname;')).toHaveLength(1);
  });

  it('flags process.env', () => {
    expect(findGuardViolations('f.ts', 'const key = process.env.API_KEY;')).toHaveLength(1);
  });

  it('flags Buffer.<member>', () => {
    expect(findGuardViolations('f.ts', "const b = Buffer.from('x');")).toHaveLength(1);
  });

  it('flags Bun.<member>', () => {
    expect(findGuardViolations('f.ts', "const f = Bun.file('x');")).toHaveLength(1);
  });

  it('flags localStorage used as a value', () => {
    expect(findGuardViolations('f.ts', "localStorage.setItem('a', 'b');")).toHaveLength(1);
  });

  it('flags navigator.<member>', () => {
    expect(findGuardViolations('f.ts', "navigator.clipboard.writeText('x');")).toHaveLength(1);
  });

  it('flags window.<real browser member>', () => {
    expect(findGuardViolations('f.ts', "window.location.href = '/x';")).toHaveLength(1);
  });

  it('flags document.<real DOM member>', () => {
    expect(findGuardViolations('f.ts', "document.getElementById('app');")).toHaveLength(1);
  });

  it('does not flag a local variable named window used as an ordinary layout term', () => {
    expect(findGuardViolations('f.ts', 'const window = { start: 0 }; window.start;')).toEqual([]);
  });

  it('flags toLocaleUpperCase() called with no locale argument', () => {
    expect(findGuardViolations('f.ts', 'const s = x.toLocaleUpperCase();')).toHaveLength(1);
  });

  it('does not flag toLocaleUpperCase(locale) called with an explicit locale', () => {
    expect(findGuardViolations('f.ts', "const s = x.toLocaleUpperCase('en');")).toEqual([]);
  });

  it('flags toLocaleLowerCase() called with no locale argument', () => {
    expect(findGuardViolations('f.ts', 'const s = x.toLocaleLowerCase();')).toHaveLength(1);
  });

  it('does not flag toLocaleLowerCase(language) called with an explicit locale', () => {
    expect(findGuardViolations('f.ts', 'const s = x.toLocaleLowerCase(language);')).toEqual([]);
  });

  it('flags toLocaleString() called with no locale argument', () => {
    expect(findGuardViolations('f.ts', 'const s = n.toLocaleString();')).toHaveLength(1);
  });

  it('does not flag toLocaleString(locale) called with an explicit locale', () => {
    expect(findGuardViolations('f.ts', "const s = n.toLocaleString('en-US');")).toEqual([]);
  });

  it('flags localeCompare() called with no argument', () => {
    expect(findGuardViolations('f.ts', 'const c = a.localeCompare();')).toHaveLength(1);
  });

  it('does not flag localeCompare(b) called with an argument', () => {
    expect(findGuardViolations('f.ts', 'const c = a.localeCompare(b);')).toEqual([]);
  });

  it('flags bare `new Intl.` usage', () => {
    expect(findGuardViolations('f.ts', "const f = new Intl.Collator('en');")).toHaveLength(1);
  });

  it('flags Date.now() with no marker', () => {
    expect(findGuardViolations('f.ts', 'const t = Date.now();')).toHaveLength(1);
  });

  it('flags new Date() with no argument and no marker', () => {
    expect(findGuardViolations('f.ts', 'const d = new Date();')).toHaveLength(1);
  });

  it('does not flag new Date(epochMs) with an explicit, caller-supplied epoch', () => {
    expect(findGuardViolations('f.ts', 'const d = new Date(epochMs);')).toEqual([]);
  });

  it('an empty file has no violations', () => {
    expect(findGuardViolations('f.ts', '')).toEqual([]);
  });
});

describe('clock guard: platform-free-allow-clock marker (spec 02 §1.1)', () => {
  it('a marker trailing the call on the same line, after a statement terminator, passes', () => {
    const fileText = 'const t = Date.now(); // platform-free-allow-clock: legit reason';
    expect(findGuardViolations('f.ts', fileText)).toEqual([]);
  });

  it('a marker trailing the call on the same line, after a list-separator comma, passes', () => {
    const fileText = 'const o = { now: () => Date.now(), // platform-free-allow-clock: legit reason\n  x: 1 };';
    expect(findGuardViolations('f.ts', fileText)).toEqual([]);
  });

  it('two clock calls on one marked statement are both exempt (accepted consequence — requires deliberately writing them that way)', () => {
    const fileText = 'const a = Date.now(), b = new Date(); // platform-free-allow-clock: both intentional, same seam';
    expect(findGuardViolations('f.ts', fileText)).toEqual([]);
  });

  it('a marker on the line before the call (round 2\'s rejected design) does not exempt it — both the marker and the call are reported', () => {
    const fileText = ['// platform-free-allow-clock: options.clock default', 'const clock = options.clock ?? (() => Date.now());'].join('\n');
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.includes('stale platform-free-allow-clock marker') && v.startsWith('f.ts:1'))).toBe(true);
    expect(violations.some((v) => v.includes(CLOCK_REASON) && v.startsWith('f.ts:2'))).toBe(true);
  });

  it('a marker with no reason text is invalid, even trailing a real call', () => {
    const fileText = 'const t = Date.now(); // platform-free-allow-clock:';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('stale platform-free-allow-clock marker');
  });

  it('a marker with no clock call anywhere is stale', () => {
    const fileText = '// platform-free-allow-clock: nothing clock-related follows\nconst x = 1;';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('stale platform-free-allow-clock marker');
  });

  it('block comments work as trailing markers too', () => {
    const fileText = 'const t = Date.now(); /* platform-free-allow-clock: legit reason */';
    expect(findGuardViolations('f.ts', fileText)).toEqual([]);
  });

  // Round 2/3 regressions: a genuine same-line trailing marker survives unrelated
  // edits elsewhere in the file, and never exempts a call it doesn't trail.
  it('an unrelated edit above the seam does not affect its own trailing marker', () => {
    const fileText = [
      '// a totally unrelated comment inserted above the seam',
      '// another unrelated line, pushing everything further down',
      'now: () => Date.now(), // platform-free-allow-clock: IdSource.now default',
    ].join('\n');
    expect(findGuardViolations('f.ts', `({${fileText}\n});`)).toEqual([]);
  });

  it('a trailing-marked call immediately followed by an unrelated clock call does not exempt the second one', () => {
    const fileText = [
      'const real = clock ?? (() => Date.now()); // platform-free-allow-clock: legit seam reason',
      'const unrelated = Date.now();',
    ].join('\n');
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toEqual([`f.ts:2 ${CLOCK_REASON}: const unrelated = Date.now();`]);
  });

  it("reproduces the round-3 reviewer probe verbatim: a marker before the call, with an unrelated call inserted between, catches all three lines", () => {
    const fileText = [
      '// platform-free-allow-clock: legit seam reason',
      'const inserted = Date.now();',
      'const real = clock ?? (() => Date.now());',
    ].join('\n');
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(3);
    expect(violations.some((v) => v.includes('stale platform-free-allow-clock marker') && v.startsWith('f.ts:1'))).toBe(true);
    expect(violations.some((v) => v.includes(CLOCK_REASON) && v.startsWith('f.ts:2') && v.includes('inserted'))).toBe(true);
    expect(violations.some((v) => v.includes(CLOCK_REASON) && v.startsWith('f.ts:3') && v.includes('real'))).toBe(true);
  });
});

describe('fix round 4: the AST closes four bypasses that needed no marker at all', () => {
  it('bypass 1 — a leading block-comment marker on the same line does not exempt the call; both the call and the orphaned marker are caught', () => {
    const fileText = '/* platform-free-allow-clock: x */ const t = Date.now();';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.includes(CLOCK_REASON) && v.includes('Date.now()'))).toBe(true);
    expect(violations.some((v) => v.includes('stale platform-free-allow-clock marker'))).toBe(true);
  });

  it("bypass 2 — a call on a continuation line that trims to start with '*' is still found (no 'skip JSDoc continuation' heuristic exists to fool)", () => {
    const fileText = 'const t = 2\n  * Date.now();';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toBe(`f.ts:2 ${CLOCK_REASON}: * Date.now();`);
  });

  it('bypass 3 — a regex character class containing // does not hide a real call that follows it on the same line', () => {
    const fileText = 'const r = /[a//b]/; const t = Date.now();';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(CLOCK_REASON);
    expect(violations[0]).toContain('Date.now()');
  });

  it('bypass 4 — a marker past a regex, with no comment relationship to an earlier call on the same line, does not exempt it; both are caught', () => {
    const fileText = 'const t = Date.now(); const r = /[a//b]/; // platform-free-allow-clock: not really for the call above';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.includes(CLOCK_REASON) && v.includes('const t = Date.now()'))).toBe(true);
    expect(violations.some((v) => v.includes('stale platform-free-allow-clock marker'))).toBe(true);
  });

  // A parser has no string/comment ambiguity at all, so these — round 3's own
  // closed gap — hold structurally now, not as a patched special case.
  it('a marker inside a string literal is not a comment and grants no exemption', () => {
    const fileText = "const s = 'platform-free-allow-clock: fake reason'; const t = Date.now();";
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(CLOCK_REASON);
  });

  it('a marker inside a template literal is not a comment and grants no exemption', () => {
    const fileText = 'const s = `platform-free-allow-clock: fake reason`; const t = Date.now();';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(CLOCK_REASON);
  });

  it('a marker inside a regex literal is not a comment and grants no exemption', () => {
    const fileText = 'const r = /platform-free-allow-clock: fake reason/; const t = new Date();';
    const violations = findGuardViolations('f.ts', fileText);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(CLOCK_REASON);
  });

  it("a stray ' inside a regex no longer desyncs anything (round 3's quote-tracker false positive) — a correctly marked, unrelated seam elsewhere still passes", () => {
    const fileText = ["const re = /it's a regex/;", 'const t = Date.now(); // platform-free-allow-clock: legit reason'].join('\n');
    expect(findGuardViolations('f.ts', fileText)).toEqual([]);
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
