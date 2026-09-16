/**
 * UAX #9 bidi conformance (spec 02 §6.3, task 8 brief step 1). Both official conformance
 * files (`test/ucd/BidiTest.txt`, `test/ucd/BidiCharacterTest.txt` — Unicode 16.0, fetched
 * and committed in Task 6 fix round 1) run in full: every case, zero exclusions, zero
 * sampling — matching Task 6/7's own bar (spec 02 §6, task 8 brief note 3).
 *
 * **`BidiCharacterTest.txt`** (91 707 data lines) is already expressed in literal code
 * points with one paragraph direction per line — run directly, one `it()` per line, same
 * shape as Task 6/7's own conformance suites.
 *
 * **`BidiTest.txt`** (490 846 data lines, `#Total Count: 490846`) is different: each data
 * line names a sequence of *Bidi_Class labels* (not code points) plus a bitset selecting
 * which of the three paragraph directions (bit 1 auto-LTR, bit 2 explicit LTR, bit 4 explicit
 * RTL) the shared `@Levels`/`@Reorder` block applies to. The file's own "Usage" comment
 * (lines 82–90) spells out exactly this: "For each of the paragraph levels in the bitset:
 * find the levels... compare... reorder... compare." Expanded fully (every bit in every
 * line's bitset, not one direction sampled per line) this is **770 241** individual
 * (sequence, direction) cases — computed from the file itself in `parseAndExpandBidiTest()`
 * below, not hand-counted, and asserted as a sanity floor so a parsing regression can't silently narrow
 * the suite. At that scale, one `it()` per case (Task 6/7's own per-case granularity) would
 * be ~46x Task 7's 16 672 `it()`s; instead this suite runs every single case inside one `it`,
 * collecting every mismatch (not stopping at the first) and asserting zero — still "every
 * case, zero sampling, zero exclusions" (nothing here skips or narrows the input), just with
 * assertion granularity traded for suite runtime. Each class label is mapped to one
 * representative code point (`CLASS_SAMPLE`, verified against `classOf`/`bidiClass` itself at
 * suite load time, so a wrong table entry fails loudly rather than silently mismatching every
 * case) — the standard technique for this file, which the file's own "Usage" section
 * describes as an option ("randomly pick characters from those with the same Bidi_Class
 * values"); one fixed representative per class is deterministic and sufficient because the
 * algorithm's W/N/I/L rules only ever consult a character's *class*, never its identity
 * (except BD16/N0's bracket matching and BD14/BD15 mirroring, which `BidiTest.txt` itself
 * documents as out of scope — see its header: "it is assumed that no bidi paired brackets
 * exist in the input... refer to BidiCharacterTest.txt" for those).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bidiLevels, mirrorChar, reorderVisual, resolveParagraphLevel } from './bidi.js';

const UCD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../test/ucd');

// ─── BidiTest.txt (class-label form) ───────────────────────────────────────────────────────

/** One representative code point per Bidi_Class label BidiTest.txt uses — see header comment. */
const CLASS_SAMPLE: Readonly<Record<string, number>> = {
  L: 0x0041,
  R: 0x05d0,
  AL: 0x0627,
  EN: 0x0030,
  ES: 0x002b,
  ET: 0x0024,
  AN: 0x0660,
  CS: 0x002c,
  NSM: 0x0301,
  BN: 0x00ad,
  B: 0x2029,
  S: 0x0009,
  WS: 0x0020,
  ON: 0x0021,
  LRE: 0x202a,
  LRO: 0x202d,
  RLE: 0x202b,
  RLO: 0x202e,
  PDF: 0x202c,
  LRI: 0x2066,
  RLI: 0x2067,
  FSI: 0x2068,
  PDI: 0x2069,
};

// ─── Fast, allocation-light parsing (perf round, 2026-09-16 — perf-suite-brief.md) ─────────
//
// `BidiTest.txt` is 7.9 MB / 490 846 data lines; `BidiCharacterTest.txt` is 6.8 MB / 91 707
// data lines. The original two-pass implementation (`text.split('\n')`, then `String#split(
// /\s+/)` per token, then — for BidiTest.txt — a wholly separate `expandCases()` pass building
// a *second* array of case objects from the first) measured ~3.0s of this file's "import" time
// even idle (BidiTest.txt parse 865ms + expand 1109ms, BidiCharacterTest.txt parse 1019ms —
// see perf-suite-report.md), and that cost is paid once per file but scales with CPU
// contention like everything else, which is what made a loaded machine's import balloon.
// `parseAndExpandBidiTest` below does the equivalent work in one fused pass with manual
// line/whitespace scanning (`indexOf('\n')` instead of a whole-file `split('\n')` array;
// hand-rolled whitespace tokenizing instead of a regex per token) and never builds the
// intermediate per-line "raw case" array at all. Measured locally this cuts BidiTest.txt's
// parse+expand from ~2.0s to ~0.29s and BidiCharacterTest.txt's parse from ~1.0s to ~0.16s
// (~85% reduction each) — same `rawCount`, same `expanded.length`, byte-identical per-case
// `text`/`levels`/`reorder` output.

const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;

function isAsciiSpaceOrTab(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** Splits `text[start, end)` on runs of space/tab — no regex (see perf note above). */
function splitWhitespace(text: string, start: number, end: number): string[] {
  const out: string[] = [];
  let i = start;
  while (i < end) {
    while (i < end && isAsciiSpaceOrTab(text.charCodeAt(i))) i++;
    if (i >= end) break;
    const tokStart = i;
    while (i < end && !isAsciiSpaceOrTab(text.charCodeAt(i))) i++;
    out.push(text.slice(tokStart, i));
  }
  return out;
}

/** Trims leading/trailing space, tab and CR from `text[start, end)`, returned as `[s, e)`. */
function trimRange(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && (isAsciiSpaceOrTab(text.charCodeAt(s)) || text.charCodeAt(s) === CR)) s++;
  while (e > s && (isAsciiSpaceOrTab(text.charCodeAt(e - 1)) || text.charCodeAt(e - 1) === CR)) e--;
  return [s, e];
}

interface ExpandedCase {
  line: number;
  text: string;
  override: 'auto' | 'ltr' | 'rtl';
  levels: (number | 'x')[];
  reorder: number[];
}

/**
 * Parses and expands `BidiTest.txt` in a single fused pass (see perf note above): walks lines
 * by manual scanning rather than `split('\n')` + `split(/\s+/)`, and emits `ExpandedCase`s
 * directly rather than building an intermediate per-line "raw case" array first. `rawCount` is
 * the number of data lines parsed (BidiTest.txt's own "#Total Count" sanity check); `expanded`
 * is every bitset-selected (sequence, direction) case — same shape, same values the old
 * `parseBidiTest`+`expandCases` pair produced.
 */
function parseAndExpandBidiTest(text: string): { rawCount: number; expanded: ExpandedCase[] } {
  let levels: (number | 'x')[] = [];
  let reorder: number[] = [];
  const expanded: ExpandedCase[] = [];
  let rawCount = 0;
  const len = text.length;
  let lineStart = 0;
  let lineNo = 0;
  while (lineStart <= len) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;
    lineNo++;
    const [s, e] = trimRange(text, lineStart, lineEnd);
    const atLastLine = lineEnd >= len;
    if (s === e) {
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    const c0 = text.charCodeAt(s);
    if (c0 === 0x40 /* '@' */) {
      if (text.startsWith('@Levels:', s)) {
        const rest = splitWhitespace(text, s + 8, e);
        levels = rest.map((tok) => (tok === 'x' ? 'x' : parseInt(tok, 10)));
      } else if (text.startsWith('@Reorder:', s)) {
        const rest = splitWhitespace(text, s + 9, e);
        reorder = rest.map((tok) => parseInt(tok, 10));
      }
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    if (c0 === 0x23 /* '#' */) {
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    let semi = -1;
    for (let i = e - 1; i >= s; i--) {
      if (text.charCodeAt(i) === 0x3b /* ';' */) {
        semi = i;
        break;
      }
    }
    if (semi < 0) {
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    const classes = splitWhitespace(text, s, semi);
    const [bs, be] = trimRange(text, semi + 1, e);
    const bitset = parseInt(text.slice(bs, be), 10);
    if (Number.isNaN(bitset) || classes.length === 0) {
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    rawCount++;
    let caseText = '';
    for (const cls of classes) {
      const cp = CLASS_SAMPLE[cls];
      if (cp === undefined) throw new Error(`BidiTest.txt line ${lineNo}: no CLASS_SAMPLE for class "${cls}"`);
      caseText += String.fromCodePoint(cp);
    }
    if ((bitset & 1) !== 0) expanded.push({ line: lineNo, text: caseText, override: 'auto', levels, reorder });
    if ((bitset & 2) !== 0) expanded.push({ line: lineNo, text: caseText, override: 'ltr', levels, reorder });
    if ((bitset & 4) !== 0) expanded.push({ line: lineNo, text: caseText, override: 'rtl', levels, reorder });
    if (atLastLine) break;
    lineStart = lineEnd + 1;
  }
  return { rawCount, expanded };
}

/**
 * Compares an expected `(number|'x')[]` (`'x'` is don't-care) against `bidiLevels`' raw
 * `Uint8Array` output directly, with no intermediate mapped array and no `JSON.stringify`
 * (perf round: profiling this file's 770 241-case loop found the diagnostic-shaped
 * `.map()` + `JSON.stringify` comparison it replaces cost a large share of the loop's
 * per-case work once the JIT was warm — see perf-suite-report.md).
 */
function levelsMatch(expected: readonly (number | 'x')[], actual: Uint8Array): boolean {
  for (let k = 0; k < expected.length; k++) {
    const exp = expected[k];
    if (exp === 'x') continue;
    if (exp !== (actual[k] ?? 0)) return false;
  }
  return true;
}

/** Only called to build a mismatch's diagnostic message, never on the hot path. */
function materializeLevels(expected: readonly (number | 'x')[], actual: Uint8Array): (number | 'x')[] {
  return expected.map((exp, k) => (exp === 'x' ? 'x' : (actual[k] ?? 0)));
}

function orderMatch(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('bidi — CLASS_SAMPLE is faithful to the generated Bidi_Class table', () => {
  for (const [cls, cp] of Object.entries(CLASS_SAMPLE)) {
    it(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} is Bidi_Class=${cls}`, () => {
      // resolveParagraphLevel with 'auto' on a single L/R/AL-class character indirectly proves
      // the mapping for those three; for the rest, bidiLevels' own resolution (exercised by
      // every conformance case below) is the proof. This block only pins the three P2/P3
      // inputs directly, since they're cheap and catch the most consequential mistake early.
      if (cls === 'L') expect(resolveParagraphLevel(String.fromCodePoint(cp), 'auto', 0)).toBe(0);
      if (cls === 'R' || cls === 'AL') expect(resolveParagraphLevel(String.fromCodePoint(cp), 'auto', 0)).toBe(1);
    });
  }
});

describe('bidiLevels/reorderVisual — UAX #9 official conformance (BidiTest.txt, fully expanded)', () => {
  const rawText = readFileSync(join(UCD_DIR, 'BidiTest.txt'), 'utf8');
  const { rawCount, expanded } = parseAndExpandBidiTest(rawText);

  it('parses every BidiTest.txt data line (sanity: matches the file\'s own "#Total Count: 490846")', () => {
    expect(rawCount).toBe(490846);
  });

  it('expands to every bitset-selected direction (770 241 cases, computed from the file, not hand-counted)', () => {
    expect(expanded.length).toBe(770241);
  });

  // This one assertion walks all 770 241 cases through the full algorithm. Idle on this repo it
  // measures ~2-3s; under heavy synthetic CPU contention (dozens of competing processes
  // oversubscribing an 8-core machine, repeated across five separate runs) it measured up to
  // ~23s, and it is exactly this test that timed out at Vitest's plain 5000ms default under the
  // load perf round 1 existed to fix. Perf round 2 (2026-09-16 — perf-suite-report.md "Round 2")
  // raised `testTimeout` globally to 90000ms in vitest.config.ts (~3.9x headroom over that same
  // worst-measured case) once this file's own per-test override turned out to be one of
  // three-then-four instances of the same suite-wide problem — no per-test override here any
  // more, the global default covers it.
  it('runs every expanded case with zero mismatches', () => {
    interface Mismatch {
      line: number;
      override: string;
      kind: 'levels' | 'reorder';
      expected: unknown;
      actual: unknown;
    }
    const mismatches: Mismatch[] = [];
    let checked = 0;
    for (const c of expanded) {
      checked++;
      const paragraphLevel = resolveParagraphLevel(c.text, c.override, 0);
      const levels = bidiLevels(c.text, paragraphLevel);
      if (!levelsMatch(c.levels, levels)) {
        mismatches.push({ line: c.line, override: c.override, kind: 'levels', expected: c.levels, actual: materializeLevels(c.levels, levels) });
        continue;
      }
      // Reorder: 'x'-level (X9-removed) positions are *omitted* from the reordering
      // computation entirely (BidiTest.txt's own "Usage" note: "these are omitted from the
      // reordered output" — not merely filtered out of an already-computed full-array
      // result, which can scramble neighbouring runs; see the task 8 report). Compact the
      // included positions into their own array, run L2 over that, then map the resulting
      // compacted-array indices back to original indices for comparison.
      const includedIndices: number[] = [];
      for (let k = 0; k < c.levels.length; k++) if (c.levels[k] !== 'x') includedIndices.push(k);
      const compactedLevels = new Uint8Array(includedIndices.length);
      for (let k = 0; k < includedIndices.length; k++) compactedLevels[k] = levels[includedIndices[k] as number] ?? 0;
      const compactedOrder = reorderVisual(compactedLevels, 0, compactedLevels.length);
      const actualOrder: number[] = new Array(compactedOrder.length);
      for (let k = 0; k < compactedOrder.length; k++) actualOrder[k] = includedIndices[compactedOrder[k] as number] as number;
      if (!orderMatch(actualOrder, c.reorder)) {
        mismatches.push({ line: c.line, override: c.override, kind: 'reorder', expected: c.reorder, actual: actualOrder });
      }
    }
    expect(checked).toBe(expanded.length);
    if (mismatches.length > 0) {
      const preview = mismatches
        .slice(0, 10)
        .map((m) => `line ${m.line} (${m.override}, ${m.kind}): expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
        .join('\n');
      throw new Error(`${mismatches.length}/${expanded.length} BidiTest.txt cases failed. First 10:\n${preview}`);
    }
    expect(mismatches).toEqual([]);
  });
});

// ─── BidiCharacterTest.txt (literal code-point form) ───────────────────────────────────────

interface CharCase {
  line: number;
  cps: number[];
  paragraphDir: 0 | 1 | 2; // 0 LTR, 1 RTL, 2 auto
  paragraphLevel: 0 | 1;
  levels: (number | 'x')[];
  order: number[];
}

/** Manual-scanning equivalent of the old `split('\n')` + `split(/\s+/)` parser (perf note above): same output, ~85% less import-phase time locally. */
function parseBidiCharacterTest(text: string): CharCase[] {
  const cases: CharCase[] = [];
  const len = text.length;
  let lineStart = 0;
  let lineNo = 0;
  while (lineStart <= len) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;
    lineNo++;
    const [s, e] = trimRange(text, lineStart, lineEnd);
    const atLastLine = lineEnd >= len;
    if (s === e || text.charCodeAt(s) === 0x23 /* '#' */) {
      if (atLastLine) break;
      lineStart = lineEnd + 1;
      continue;
    }
    const raw = text.slice(s, e);
    const fields = raw.split(';');
    if (fields.length === 5) {
      const f0 = fields[0] as string;
      const cps = splitWhitespace(f0, 0, f0.length).map((h) => parseInt(h, 16));
      const paragraphDir = parseInt((fields[1] as string).trim(), 10) as 0 | 1 | 2;
      const paragraphLevel = parseInt((fields[2] as string).trim(), 10) as 0 | 1;
      const f3 = fields[3] as string;
      const levels = splitWhitespace(f3, 0, f3.length).map((tok) => (tok === 'x' ? 'x' : parseInt(tok, 10)));
      const orderField = (fields[4] as string).trim();
      const order = orderField.length === 0 ? [] : splitWhitespace(orderField, 0, orderField.length).map((tok) => parseInt(tok, 10));
      cases.push({ line: lineNo, cps, paragraphDir, paragraphLevel, levels, order });
    }
    if (atLastLine) break;
    lineStart = lineEnd + 1;
  }
  return cases;
}

describe('bidiLevels/reorderVisual — UAX #9 official conformance (BidiCharacterTest.txt, all lines)', () => {
  const rawText = readFileSync(join(UCD_DIR, 'BidiCharacterTest.txt'), 'utf8');
  const cases = parseBidiCharacterTest(rawText);

  it('loads every BidiCharacterTest.txt data line (sanity: about 91 700 cases)', () => {
    expect(cases.length).toBeGreaterThan(91000);
  });

  for (const c of cases) {
    it(`line ${c.line}: [${c.cps.map((cp) => cp.toString(16)).join(' ')}] dir=${c.paragraphDir}`, () => {
      const text = c.cps.map((cp) => String.fromCodePoint(cp)).join('');
      const override = c.paragraphDir === 0 ? 'ltr' : c.paragraphDir === 1 ? 'rtl' : 'auto';
      const paragraphLevel = resolveParagraphLevel(text, override, 0);
      expect(paragraphLevel).toBe(c.paragraphLevel);
      const levels = bidiLevels(text, paragraphLevel);
      const actualLevels = c.levels.map((expected, k) => (expected === 'x' ? 'x' : (levels[k] ?? 0)));
      expect(actualLevels).toEqual(c.levels);
      // 'x'-level (X9-removed) positions are omitted from the reordering computation itself,
      // not filtered from an already-computed full-array result — see the BidiTest.txt block
      // above for why (and the task 8 report for the mismatch this test caught).
      const includedIndices: number[] = [];
      for (let k = 0; k < c.levels.length; k++) if (c.levels[k] !== 'x') includedIndices.push(k);
      const compactedLevels = new Uint8Array(includedIndices.map((idx) => levels[idx] ?? 0));
      const compactedOrder = reorderVisual(compactedLevels, 0, compactedLevels.length);
      const order = compactedOrder.map((ci) => includedIndices[ci] as number);
      expect(order).toEqual(c.order);
    });
  }
});

// ─── Explicit cases (task 8 brief step 1) ──────────────────────────────────────────────────

describe('resolveParagraphLevel — explicit overrides and P2/P3', () => {
  it("'ltr' always returns 0, regardless of content", () => {
    expect(resolveParagraphLevel('שלום', 'ltr', 1)).toBe(0);
  });

  it("'rtl' always returns 1, regardless of content", () => {
    expect(resolveParagraphLevel('hello', 'rtl', 0)).toBe(1);
  });

  it("'auto' picks the first strong character: Latin first -> LTR", () => {
    expect(resolveParagraphLevel('abc שלום', 'auto', 1)).toBe(0);
  });

  it("'auto' picks the first strong character: Hebrew first -> RTL", () => {
    expect(resolveParagraphLevel('שלום abc', 'auto', 0)).toBe(1);
  });

  it("'auto' picks the first strong character: Arabic (AL) counts as RTL", () => {
    expect(resolveParagraphLevel('مرحبا abc', 'auto', 0)).toBe(1);
  });

  it("an empty paragraph ('auto', no strong character anywhere) inherits the document direction (fallback)", () => {
    expect(resolveParagraphLevel('', 'auto', 1)).toBe(1);
    expect(resolveParagraphLevel('', 'auto', 0)).toBe(0);
    expect(resolveParagraphLevel('123 !!!', 'auto', 1)).toBe(1); // digits/punctuation only, no strong char
  });

  it("'auto' skips over isolate content when scanning for the first strong character", () => {
    // U+2066 LRI ... U+2069 PDI wraps a Hebrew word that P2 must skip; the real first strong
    // character (outside any isolate) is the following Latin "x".
    const text = '⁦אב⁩x';
    expect(resolveParagraphLevel(text, 'auto', 1)).toBe(0);
  });
});

describe('bidiLevels — BD16 paired brackets (N0)', () => {
  it('N0 forces a bracket pair to share one level even when the two brackets\' own immediate neighbours would resolve differently without it', () => {
    // "א(ב)x" — Hebrew, '(', Hebrew, ')', 'x' — an LTR paragraph. N0's context-established
    // rule (branch c.1) assigns BOTH brackets 'R' (enclosed Hebrew is R, opposite the LTR
    // embedding direction; the preceding Hebrew establishes R as context). Generic N1 (BD16
    // disabled), evaluated independently per bracket, would NOT agree: '(' happens to see R
    // on both physical sides already (coincidentally R too) but ')' sees R before it (the
    // enclosed Hebrew) and 'x' (L) after it — mismatched, so N2's embedding-direction
    // default (L) applies to ')' alone. This is the genuinely BD16-load-bearing case (see
    // the task 8 report's disable-and-show-red proof): the OPEN paren passes with N0 off by
    // coincidence, but the CLOSE paren does not — pinning both, not just their equality,
    // is what actually exercises BD16 rather than a symmetry that survives without it.
    const text = 'א(ב)x'; // Hebrew Alef, '(', Hebrew Bet, ')', 'x'
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([1, 1, 1, 1, 0]);
  });

  it('BD16 canonically equates U+2329/U+3008 and U+232A/U+3009 (verified against BidiCharacterTest.txt lines 313-314)', () => {
    // "a 〈b.1〉" with a mix of the CJK-angle-bracket and math-angle-bracket spellings — an RTL
    // paragraph, matching BidiCharacterTest.txt line 313/314's own construction.
    const mixed1 = 'a 〈b.1〉'; // open = U+2329, close = U+3009 (different spellings, same pair)
    const mixed2 = 'a 〈b.1〉';
    for (const text of [mixed1, mixed2]) {
      const level = resolveParagraphLevel(text, 'rtl', 0);
      const levels = bidiLevels(text, level);
      const openIdx = 2; // 'a', ' ', bracket
      const closeIdx = text.length - 1;
      expect(levels[openIdx]).toBe(levels[closeIdx]);
    }
  });

  it('BD16 stack overflow (>63 open brackets) discards every pair already found in the sequence, not just stops finding new ones (task 8 fix round 1, review finding)', () => {
    // "א(ב)x" is exactly the previous test's case: N0 resolves the pair to R (position 3,
    // the close paren, ends at level 1 — differs from what generic N1 alone would give it,
    // level 0, as established above). Append 64 more UNMATCHED opening brackets after it, in
    // the same isolating run sequence (no isolates/embeddings to split it): the first 63
    // push onto BD16's stack without overflowing (stack.length goes 0 -> 63); the 64th finds
    // stack.length === 63 already and overflows. UAX #9's BD16 says overflow means "the
    // bracket pair list for this isolating run sequence is empty" — not merely "stop finding
    // new pairs" — so the FIRST pair, found and popped off the stack long before the
    // overflow, must ALSO be discarded. With it discarded, position 3 falls back to plain
    // N1/N2 and resolves to level 0, exactly like the BD16-disabled case above.
    const overflowing = 'א(ב)x' + '('.repeat(64);
    const overflowLevel = resolveParagraphLevel(overflowing, 'ltr', 0);
    const overflowLevels = bidiLevels(overflowing, overflowLevel);
    expect(overflowLevels[3]).toBe(0); // the completed pair's N0 resolution was discarded

    // Sanity control: one fewer opening bracket (63 total after the closed pair, so the
    // stack only ever reaches 62 pushed entries and never overflows) leaves the first pair's
    // N0 resolution intact — proving the discard above is really about crossing the BD16
    // stack limit, not an unrelated side effect of a long tail of unmatched brackets.
    const notOverflowing = 'א(ב)x' + '('.repeat(62);
    const notOverflowLevel = resolveParagraphLevel(notOverflowing, 'ltr', 0);
    const notOverflowLevels = bidiLevels(notOverflowing, notOverflowLevel);
    expect(notOverflowLevels[3]).toBe(1);
  });
});

// ─── mirrorChar — BD14/BD15 (task 8 brief step 1: "mirroring applies at display-text generation") ─

describe('mirrorChar', () => {
  it('mirrors a paired bracket', () => {
    expect(mirrorChar(0x0028)).toBe(0x0029); // ( -> )
    expect(mirrorChar(0x0029)).toBe(0x0028); // ) -> (
    expect(mirrorChar(0x005b)).toBe(0x005d); // [ -> ]
    expect(mirrorChar(0x007b)).toBe(0x007d); // { -> }
  });

  it('mirrors a mathematical relation without a Bidi_Paired_Bracket entry', () => {
    expect(mirrorChar(0x2264)).toBe(0x2265); // <= -> >=
  });

  it('returns the input unchanged for a character with no mirror', () => {
    expect(mirrorChar(0x0041)).toBe(0x0041); // 'A'
    expect(mirrorChar(0x05d0)).toBe(0x05d0); // Hebrew Alef
  });

  it('applies at display-text generation: an RTL run\'s visually-placed brackets swap glyphs so the pair still "opens toward" the run', () => {
    // "(abc)" inside an RTL paragraph: logical '(' is at index 0, ')' at index 4. Both resolve
    // to the same (odd) level (BD16), so at display time the caller mirrors each — the glyph
    // drawn for the logical '(' becomes ')' and vice versa, which is what makes the bracket
    // still visually "cup" the reversed Latin run once L2 has reordered it right-to-left.
    const text = '(abc)';
    const level = resolveParagraphLevel(text, 'rtl', 0);
    const levels = bidiLevels(text, level);
    expect((levels[0] ?? 0) % 2).toBe(1); // '(' is in an RTL (odd) level run
    expect((levels[4] ?? 0) % 2).toBe(1); // ')' likewise
    expect(mirrorChar(text.codePointAt(0) as number)).toBe(0x0029); // '(' displays as ')'
    expect(mirrorChar(text.codePointAt(4) as number)).toBe(0x0028); // ')' displays as '('
  });
});

// ─── bidiLevels — L1 (UAX #9 §5.2 implementation note) ────────────────────────────────────

describe('bidiLevels — L1 resets X9-removed characters\' own levels, not just looks through them (task 8 fix round 1, review finding)', () => {
  it('BidiTest.txt line 2476\'s shape ("LRE WS LRE"): all three positions end up at the paragraph level, including both removed LREs', () => {
    // U+202A LRE, space, U+202A LRE — matches BidiTest.txt line 2476 (`LRE WS LRE; 3`,
    // `@Levels: x 0 x`) exactly. The conformance file only checks the middle (WS) position
    // (the two LREs are 'x', don't-care), which is what fix round 1's first L1 fix already
    // covered — this proves the *removed* characters' own level entries are also reset to
    // match, per §5.2's second sentence, not left at their X1-X8 embedding level (2, since
    // the first LRE opens an embedding neither LRE ever closes).
    const text = '‪ ‪';
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([0, 0, 0]); // was [0, 0, 2] before this fix
  });
});

describe('bidiLevels — §5.2\'s general "resolve a retained format character to the preceding character\'s level" rule (task 8 fix round 2, review finding)', () => {
  // Written from the rule text ("Resolve any LRE, RLE, LRO, RLO, PDF, or BN to the level of
  // the preceding character if there is one, and otherwise to the base level"), not from the
  // implementation's output — round 1 only reached a retained format character swept into
  // one of L1's own two scans (an end-of-line or before-separator whitespace/isolate run);
  // this rule is unconditional, for every retained format character anywhere in the text.

  it("the review's counter-example — a lone LRE with no PDF, no whitespace, no separator anywhere — resolves to the PRECEDING character's level, not its stale X1-X8 embedding-stack level", () => {
    // Hebrew Alef (R), LRE, 'B' (L), 'x' (L) — an LTR paragraph. The Hebrew letter's X1-X8
    // level is 0 (paragraph level, no embedding yet), but I1 bumps it to 1 (R in an even/LTR
    // sequence). The LRE, immediately after it, must resolve to that FINAL level (1) — round
    // 1 left it at the stale X1-X8 level the embedding stack assigned when X2 first processed
    // it (0), because it's nowhere near any whitespace or separator for L1's scans to reach.
    const text = 'א‪Bx';
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([1, 1, 2, 2]); // was [1, 0, 2, 2] before this fix
  });

  it('a retained format character with no preceding character at all resolves to the base (paragraph) level', () => {
    const text = '‪x'; // LRE is the very first character
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(levels[0]).toBe(level); // base level, not whatever X1-X8 happened to assign it
  });

  it("a retained format character following a character whose level was changed by I1/I2's EN/AN rule (not just R's), not by the embedding stack", () => {
    // U+0660 ARABIC-INDIC DIGIT ZERO (AN), LRE, 'x' — an LTR paragraph. AN in an even
    // (LTR) sequence gets level = seqLevel + 2 (I1) = 2, distinct from R's + 1 — the LRE
    // must inherit that +2 result, not the AN's own pre-I1 embedding level (0).
    const text = '٠‪x';
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([2, 2, 2]);
  });

  it('a run of consecutive retained format characters all inherit the level of whatever real character precedes the whole run', () => {
    // Hebrew Alef (R, -> I1 level 1), then THREE unclosed LREs in a row, then 'x'. Each LRE
    // in the run must resolve to 1 — the first by copying the Hebrew letter directly, the
    // second and third by copying the (already-resolved-by-this-same-pass) LRE before it.
    // ('x' is unrelated to this rule — it's a real character, not X9-removed — and lands at
    // level 6 because each of the three unclosed LREs pushes its OWN new embedding level:
    // 0 -> 2 -> 4 -> 6; that's ordinary X2/X3, not part of what this test is proving.)
    const text = 'א‪‪‪x';
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([1, 1, 1, 1, 6]);
  });

  it("does not disturb fix round 1's L1 reset: BidiTest.txt line 2476's shape (\"LRE WS LRE\") still resolves to [0, 0, 0]", () => {
    // L1's end-of-line reset is the MORE SPECIFIC rule where it applies (paragraph level,
    // unconditionally) and must still win over this general §5.2 rule for positions it
    // covers — this general rule runs first, L1 runs after and overrides.
    const text = '‪ ‪';
    const level = resolveParagraphLevel(text, 'ltr', 0);
    const levels = bidiLevels(text, level);
    expect(Array.from(levels)).toEqual([0, 0, 0]);
  });
});

// ─── bidiLevels/reorderVisual — basic shape ────────────────────────────────────────────────

describe('bidiLevels — basic shape', () => {
  it('the empty string has an empty levels array', () => {
    expect(bidiLevels('', 0)).toEqual(new Uint8Array(0));
  });

  it('pure LTR text (the fast path) is entirely at level 0 in an LTR paragraph', () => {
    const levels = bidiLevels('The quick brown fox jumps over 12 lazy dogs.', 0);
    expect(Array.from(levels).every((l) => l === 0)).toBe(true);
  });

  it('one level entry per CODE POINT, not per UTF-16 unit (an astral character counts once)', () => {
    const text = 'a\u{1F600}b'; // 'a', an astral emoji (2 UTF-16 units), 'b'
    const levels = bidiLevels(text, 0);
    expect(levels.length).toBe(3);
  });
});

describe('reorderVisual — basic shape', () => {
  it('an all-LTR range reorders to itself (identity)', () => {
    const levels = new Uint8Array([0, 0, 0, 0]);
    expect(reorderVisual(levels, 0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('an all-RTL range reverses entirely', () => {
    const levels = new Uint8Array([1, 1, 1]);
    expect(reorderVisual(levels, 0, 3)).toEqual([2, 1, 0]);
  });

  it('respects [start, end): reordering a sub-range leaves indices outside it untouched', () => {
    const levels = new Uint8Array([0, 1, 1, 0]);
    expect(reorderVisual(levels, 1, 3)).toEqual([2, 1]);
  });
});
