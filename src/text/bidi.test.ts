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
 * (sequence, direction) cases — computed from the file itself in `expandCases()` below, not
 * hand-counted, and asserted as a sanity floor so a parsing regression can't silently narrow
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

interface RawCase {
  line: number;
  classes: string[];
  bitset: number;
  levels: (number | 'x')[]; // last @Levels
  reorder: number[]; // last @Reorder
}

function parseBidiTest(text: string): RawCase[] {
  const cases: RawCase[] = [];
  let levels: (number | 'x')[] = [];
  let reorder: number[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('@Levels:')) {
      const rest = trimmed.slice('@Levels:'.length).trim();
      levels = rest.length === 0 ? [] : rest.split(/\s+/).map((tok) => (tok === 'x' ? 'x' : parseInt(tok, 10)));
      continue;
    }
    if (trimmed.startsWith('@Reorder:')) {
      const rest = trimmed.slice('@Reorder:'.length).trim();
      reorder = rest.length === 0 ? [] : rest.split(/\s+/).map((tok) => parseInt(tok, 10));
      continue;
    }
    if (trimmed.startsWith('@') || trimmed.startsWith('#')) continue;
    const semi = trimmed.lastIndexOf(';');
    if (semi < 0) continue;
    const classes = trimmed.slice(0, semi).trim().split(/\s+/);
    const bitset = parseInt(trimmed.slice(semi + 1).trim(), 10);
    if (Number.isNaN(bitset) || classes.length === 0) continue;
    cases.push({ line: i + 1, classes, bitset, levels, reorder });
  }
  return cases;
}

interface ExpandedCase {
  line: number;
  text: string;
  override: 'auto' | 'ltr' | 'rtl';
  levels: (number | 'x')[];
  reorder: number[];
}

/** Expands each data line's bitset into every requested (sequence, direction) case — see header comment. */
function expandCases(raw: RawCase[]): ExpandedCase[] {
  const out: ExpandedCase[] = [];
  for (const c of raw) {
    let text = '';
    for (const cls of c.classes) {
      const cp = CLASS_SAMPLE[cls];
      if (cp === undefined) throw new Error(`BidiTest.txt line ${c.line}: no CLASS_SAMPLE for class "${cls}"`);
      text += String.fromCodePoint(cp);
    }
    if ((c.bitset & 1) !== 0) out.push({ line: c.line, text, override: 'auto', levels: c.levels, reorder: c.reorder });
    if ((c.bitset & 2) !== 0) out.push({ line: c.line, text, override: 'ltr', levels: c.levels, reorder: c.reorder });
    if ((c.bitset & 4) !== 0) out.push({ line: c.line, text, override: 'rtl', levels: c.levels, reorder: c.reorder });
  }
  return out;
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
  const raw = parseBidiTest(rawText);
  const expanded = expandCases(raw);

  it('parses every BidiTest.txt data line (sanity: matches the file\'s own "#Total Count: 490846")', () => {
    expect(raw.length).toBe(490846);
  });

  it('expands to every bitset-selected direction (770 241 cases, computed from the file, not hand-counted)', () => {
    expect(expanded.length).toBe(770241);
  });

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
      const actualLevels: (number | 'x')[] = c.levels.map((expectedLevel, k) => (expectedLevel === 'x' ? 'x' : (levels[k] ?? 0)));
      if (JSON.stringify(actualLevels) !== JSON.stringify(c.levels)) {
        mismatches.push({ line: c.line, override: c.override, kind: 'levels', expected: c.levels, actual: actualLevels });
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
      const compactedLevels = new Uint8Array(includedIndices.map((idx) => levels[idx] ?? 0));
      const compactedOrder = reorderVisual(compactedLevels, 0, compactedLevels.length);
      const actualOrder = compactedOrder.map((ci) => includedIndices[ci] as number);
      if (JSON.stringify(actualOrder) !== JSON.stringify(c.reorder)) {
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

function parseBidiCharacterTest(text: string): CharCase[] {
  const cases: CharCase[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] as string).trim();
    if (!raw || raw.startsWith('#')) continue;
    const fields = raw.split(';');
    if (fields.length !== 5) continue;
    const cps = (fields[0] as string).trim().split(/\s+/).map((h) => parseInt(h, 16));
    const paragraphDir = parseInt((fields[1] as string).trim(), 10) as 0 | 1 | 2;
    const paragraphLevel = parseInt((fields[2] as string).trim(), 10) as 0 | 1;
    const levels = (fields[3] as string)
      .trim()
      .split(/\s+/)
      .map((tok) => (tok === 'x' ? 'x' : parseInt(tok, 10)));
    const orderField = (fields[4] as string).trim();
    const order = orderField.length === 0 ? [] : orderField.split(/\s+/).map((tok) => parseInt(tok, 10));
    cases.push({ line: i + 1, cps, paragraphDir, paragraphLevel, levels, order });
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
