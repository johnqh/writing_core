// Font metrics generator (spec 02 §4.1). Bun script; reads every font binary under
// `fonts/src/`, encodes one `.fwm` table per face and regenerates the `FACES` registry
// plus the `FACE_BYTES` wiring `src/fonts/registry.ts` imports (spec 02 §4.2, §4.3).
// Output under `src/fonts/generated/` is committed; CI regenerates and fails on any
// difference, so the committed tables always match the shipped binaries' SHA-256.
//
// Task 4 additions over Task 2's generator:
//   - `.ttc` font collections (Noto Sans/Serif CJK ship as one OTC per weight covering
//     all four regions — far smaller to vendor than four separate ~17 MB OTFs each).
//   - Variable-font instancing (`wght` axis) for the Google-Fonts-only families that
//     ship no static build (Gelasio, Noto Serif/Sans/Sans Mono, Noto Sans/Serif Thai,
//     Noto Sans/Serif Hebrew, Noto Naskh Arabic, the eight bundled Indic scripts, Noto
//     Emoji): two `Font` instances (400/700) are read exactly like a static file — no
//     modified binary is ever written to disk, only metrics extracted in memory.
//   - GPOS `kern` (PairPos formats 1 and 2, unwrapping Extension Positioning) plus the
//     legacy `kern` table, flattened to code-point pairs and restricted per spec §4.2.
//   - `requiresShaping` for the tier-2 script faces this bundle ships, by an explicit
//     family-slug list (not guessed from cmap coverage).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as fontkit from 'fontkit';
import { encodeFwm, type FwmRange } from '../src/fonts/fwm.js';

const SRC = 'fonts/src';
const OUT = 'src/fonts/generated';

type FaceStyle = 'regular' | 'bold' | 'italic' | 'bolditalic';

/**
 * Spec 02 §3.1's tier-2 script faces this bundle ships (Arabic, Indic, Thai — Lao, Khmer,
 * Myanmar, Tibetan, Sinhala are not bundled by this task), keyed by the face's own family
 * slug. Recorded here explicitly, per the brief, rather than guessed from cmap coverage.
 * Hebrew is deliberately absent: spec §5.1 tier-2's Hebrew case is "with niqqud/cantillation"
 * only, which this metrics-generation stage cannot detect, so plain Noto (Sans|Serif) Hebrew
 * stays tier-1 here (as the brief's own explicit list has it).
 */
const TIER2_FAMILY_SLUGS = new Set([
  'noto-naskh-arabic',
  'noto-sans-devanagari',
  'noto-sans-bengali',
  'noto-sans-tamil',
  'noto-sans-telugu',
  'noto-sans-gujarati',
  'noto-sans-gurmukhi',
  'noto-sans-kannada',
  'noto-sans-malayalam',
  'noto-sans-thai',
  'noto-serif-thai',
]);

/**
 * Variable-font source files that ship only a Regular face in this bundle (spec 02 §3.1
 * lists Noto Sans Symbols 2 / Noto Sans Math / Noto Emoji with no R/B split), even though
 * the upstream binary happens to expose a `wght` axis. Every other variable source gets
 * both a 400 (regular/italic) and a 700 (bold/bolditalic) instance below.
 */
const SINGLE_WEIGHT_FILES = new Set(['NotoEmoji[wght].ttf']);

/** The four CJK regions spec 02 §3.1 asks for, out of the OTC's SC/TC/JP/KR/HK + Mono CJK set. */
const CJK_FAMILY_RE = /^Noto (Sans|Serif) CJK (SC|TC|JP|KR)$/;

/** See `buildRanges`'s `maxCp` doc: astral CJK Extension B+ ideographs are excluded from the
 * bundled metrics table to stay inside the spec §4.4 budget. */
const ASTRAL_CJK_LIMIT = 0xffff;

const REGULAR_WGHT = 400;
const BOLD_WGHT = 700;

/**
 * Spec 02 §4.4's Latin/Greek/Cyrillic per-face ceiling (24 KB gzipped). This bundle ships no
 * CJK-mono face, so §4.4's other, looser 30 KB tier never applies here; 24 576 is the one
 * budget every non-CJK face in this generator must fit inside.
 *
 * GPOS class kerning (§4.2's PairPos format 2) is *designed* to cover a huge code-point
 * cross-product from a handful of rules — Carlito's Latin-kerning table alone expands to
 * classes of up to ~90 glyphs a side, so flattening every pair the §4.2-restricted ranges
 * allow can reach 15 000+ pairs (180 KB+) for one face, far over budget even after the
 * 4/1000 em drop. `capKernPairs` keeps the largest-magnitude — the visually significant —
 * pairs up to what fits, and drops the long tail; this is a size cap on top of §4.2's range
 * and threshold rules, not a change to either.
 */
const FACE_BYTE_BUDGET = 24_576;
const FACE_BYTE_SAFETY_MARGIN = 1024;

/** `post.isFixedPitch` is parsed by fontkit at runtime but not declared by @types/fontkit. */
function postIsFixedPitchFlag(font: fontkit.Font): boolean {
  const post = (font as unknown as { post?: { isFixedPitch?: number } }).post;
  return post?.isFixedPitch !== undefined && post.isFixedPitch !== 0;
}

/**
 * A face is monospace if the legacy `post.isFixedPitch` flag says so, or — some shipped
 * variable fonts (Noto Sans Mono among them) leave that flag at 0 even though every glyph
 * shares one advance — if a spread of common glyphs measure identically. Never guessed from
 * the family name: spec 02 §3.1's classification drives fallback and the 10 cpi Courier
 * override, so a wrong answer here silently swaps a document's metrics.
 */
function isFixedPitch(font: fontkit.Font): boolean {
  if (postIsFixedPitchFlag(font)) return true;
  const probe = [0x41, 0x69, 0x57, 0x30, 0x2e]; // A i W 0 .
  let width: number | null = null;
  for (const cp of probe) {
    if (!font.hasGlyphForCodePoint(cp)) return false;
    const w = font.glyphForCodePoint(cp).advanceWidth;
    if (width === null) width = w;
    else if (w !== width) return false;
  }
  return width !== null;
}

/** Collapse consecutive code points sharing an advance into uniform ranges (ideographs and
 * Hangul syllables collapse to one record each, keeping CJK metrics tiny per spec §4.4).
 * `maxCp`, when given, drops code points above it before collapsing (see `ASTRAL_CJK_LIMIT`
 * below): unlike the BMP CJK Unified block, the astral CJK Extension B+ planes (U+20000+)
 * are not fully assigned, so consecutive-run collapsing fragments into thousands of tiny
 * ranges there and blows the spec §4.4 per-face budget for coverage of characters that
 * essentially never appear in a screenplay; they fall through to the fallback chain (§3.3)
 * or the face's own `defaultAdvance` instead of this table. */
function buildRanges(font: fontkit.Font, maxCp = 0x10ffff): { ranges: FwmRange[] } {
  const points: { cp: number; advance: number }[] = [];
  for (const cp of font.characterSet) {
    if (cp > maxCp) continue;
    try {
      points.push({ cp, advance: font.glyphForCodePoint(cp).advanceWidth });
    } catch {
      /* unmapped */
    }
  }
  points.sort((a, b) => a.cp - b.cp);
  const ranges: FwmRange[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && points[j + 1]!.cp === points[j]!.cp + 1) j += 1;
    const slice = points.slice(i, j + 1);
    const first = slice[0]!.advance;
    const uniform = slice.every((p) => p.advance === first);
    ranges.push(
      uniform
        ? { start: slice[0]!.cp, length: slice.length, mode: 'uniform', advance: first }
        : { start: slice[0]!.cp, length: slice.length, mode: 'explicit', advances: slice.map((p) => p.advance) },
    );
    i = j + 1;
  }
  return { ranges };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * `<family-slug>:<style>` per spec 02 §4.3 — the id every other module uses. Derived from
 * the font's own `name` table, never from the file name, so a re-downloaded binary with a
 * different file name keeps its id. Prefers nameID 16 (`preferredFamily`) over nameID 1:
 * a `wght`-variable font whose default named instance is not "Regular" (Noto Sans Hebrew's
 * default is "Thin") reports that instance's name in `familyName` regardless of which
 * instance was read out, but nameID 16 stays the plain family name.
 *
 * `styleOverride` is set for a variable-font instance, whose own `subfamilyName` never
 * changes with the requested weight (fontkit does not rewrite the name table on
 * `getVariation()`); the caller supplies the weight/italic it asked for instead.
 */
function faceIdOf(
  font: fontkit.Font,
  styleOverride?: { bold: boolean; italic: boolean },
): { faceId: string; family: string; style: FaceStyle } {
  const preferredFamily = (font as unknown as { name?: { records?: { preferredFamily?: { en?: string } } } }).name
    ?.records?.preferredFamily?.en;
  const family = slugify(preferredFamily ?? font.familyName);
  const bold = styleOverride ? styleOverride.bold : /bold|black|heavy/i.test(font.subfamilyName);
  const italic = styleOverride ? styleOverride.italic : /italic|oblique/i.test(font.subfamilyName) || font.italicAngle !== 0;
  const style: FaceStyle = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  return { faceId: `${family}:${style}`, family, style };
}

function varNameFor(moduleName: string): string {
  return moduleName.replace(/-([a-z0-9])/g, (_all, c: string) => c.toUpperCase());
}

// ─── §4.2 kerning: GPOS `kern` (PairPos 1/2) + legacy `kern`, restricted, thresholded ──────

/** Basic Latin, Latin-1 Supplement, Latin Extended-A, Greek and Cyrillic — spec 02 §4.2. */
function inKernRange(cp: number): boolean {
  return (
    (cp >= 0x0000 && cp <= 0x007f) ||
    (cp >= 0x0080 && cp <= 0x00ff) ||
    (cp >= 0x0100 && cp <= 0x017f) ||
    (cp >= 0x0370 && cp <= 0x03ff) ||
    (cp >= 0x0400 && cp <= 0x04ff)
  );
}

interface RawKernPair {
  left: number; // glyph id
  right: number; // glyph id
  value: number; // font units
}

function buildGlyphToCp(font: fontkit.Font): Map<number, number> {
  const map = new Map<number, number>();
  for (const cp of font.characterSet) {
    if (!inKernRange(cp)) continue;
    try {
      const gid = font.glyphForCodePoint(cp).id;
      if (!map.has(gid)) map.set(gid, cp);
    } catch {
      /* unmapped */
    }
  }
  return map;
}

/**
 * fontkit's low-level OpenType table decoder exposes `restructure`'s lazily-resolved arrays
 * (`.get(i)`/`.toArray()`) or, once resolved, plain arrays — never declared by
 * `@types/fontkit`, which only covers the high-level `Font` API. These are the minimal
 * shapes the kerning extraction below actually reads off them.
 */
type LazyArrayLike<T> = { get?: (i: number) => T; toArray?: () => T[] };

interface RawCoverage {
  glyphs?: LazyArrayLike<number> | number[];
  rangeRecords?: LazyArrayLike<{ start: number; end: number }> | { start: number; end: number }[];
}

interface RawClassDef {
  classRangeRecord?: LazyArrayLike<{ start: number; end: number; class: number }> | { start: number; end: number; class: number }[];
  classValueArray?: LazyArrayLike<number> | number[];
  classes?: LazyArrayLike<number> | number[];
  startGlyph?: number;
}

interface RawValueRecord {
  xAdvance?: number;
}

interface RawPairValueRecord {
  secondGlyph: number;
  value1?: RawValueRecord;
}

interface RawPairPosSubtable {
  coverage: RawCoverage;
  pairSets?: LazyArrayLike<RawPairValueRecord[]> | RawPairValueRecord[][];
  pairSetCount?: number;
  classDef1?: RawClassDef;
  classDef2?: RawClassDef;
  classRecords?: LazyArrayLike<LazyArrayLike<{ value1?: RawValueRecord }>>;
  extension?: RawPairPosSubtable;
}

interface RawLookup {
  subTables: RawPairPosSubtable[];
}

interface RawGpos {
  featureList?: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookupList: { get: (i: number) => RawLookup };
}

interface RawKernSubtable {
  pairs?: LazyArrayLike<{ left: number; right: number; value: number }> | { left: number; right: number; value: number }[];
}

interface RawKernTable {
  tables: { subtable?: RawKernSubtable }[];
}

function toArray<T>(value: LazyArrayLike<T> | T[] | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.toArray ? value.toArray() : [];
}

function lazyGet<T>(value: LazyArrayLike<T> | T[] | undefined, i: number): T | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[i];
  return value.get ? value.get(i) : undefined;
}

/** A GPOS Coverage table (format 1: explicit glyph list; format 2: glyph ranges). */
function coverageGlyphs(coverage: RawCoverage): number[] {
  if (coverage.glyphs) return toArray(coverage.glyphs);
  const out: number[] = [];
  for (const r of toArray(coverage.rangeRecords)) {
    for (let g = r.start; g <= r.end; g += 1) out.push(g);
  }
  return out;
}

/** A GPOS ClassDef table (format 1: start glyph + array; format 2: glyph ranges). Class 0
 * (the unlisted default) is never returned: kerning class tables use it as "not a kerning
 * participant", and enumerating it would pair up nearly every glyph in the font. */
function classDefMembers(classDef: RawClassDef): Map<number, number> {
  const map = new Map<number, number>();
  if (classDef.classRangeRecord) {
    for (const r of toArray(classDef.classRangeRecord)) {
      if (r.class === 0) continue;
      for (let g = r.start; g <= r.end; g += 1) map.set(g, r.class);
    }
  } else if (classDef.classValueArray ?? classDef.classes) {
    const startGlyph = classDef.startGlyph ?? 0;
    const arr = toArray(classDef.classValueArray ?? classDef.classes);
    arr.forEach((c, i) => {
      if (c !== 0) map.set(startGlyph + i, c);
    });
  }
  return map;
}

function pushInto<K>(map: Map<K, number[]>, key: K, value: number): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/** Legacy `kern` table format 0 (glyph-id pairs). */
function legacyKernPairs(font: fontkit.Font): RawKernPair[] {
  const kern = (font as unknown as { kern?: RawKernTable }).kern;
  if (!kern) return [];
  const out: RawKernPair[] = [];
  for (const t of kern.tables) {
    if (!t.subtable?.pairs) continue;
    for (const p of toArray(t.subtable.pairs)) out.push({ left: p.left, right: p.right, value: p.value });
  }
  return out;
}

/** GPOS lookups reachable from a `kern`-tagged feature, PairPos formats 1 and 2, unwrapping
 * Extension Positioning (lookupType 9 — used by some variable fonts, e.g. Carlito). */
function gposKernPairs(font: fontkit.Font): RawKernPair[] {
  const gpos = (font as unknown as { GPOS?: RawGpos }).GPOS;
  if (!gpos) return [];
  const lookupIndexes = new Set<number>();
  for (const ft of gpos.featureList ?? []) {
    if (ft.tag !== 'kern') continue;
    for (const li of ft.feature.lookupListIndexes) lookupIndexes.add(li);
  }
  const out: RawKernPair[] = [];
  for (const li of lookupIndexes) {
    const lk = gpos.lookupList.get(li);
    for (const raw of lk.subTables) {
      const st = raw.extension ?? raw;
      if (st.pairSets) {
        // Format 1: explicit per-glyph pairs.
        const covGlyphs = coverageGlyphs(st.coverage);
        const count = st.pairSetCount ?? covGlyphs.length;
        for (let i = 0; i < count; i += 1) {
          const leftGlyph = covGlyphs[i];
          if (leftGlyph === undefined) continue;
          const records = lazyGet(st.pairSets, i) ?? [];
          for (const r of records) {
            const xAdvance = r.value1?.xAdvance;
            if (typeof xAdvance === 'number' && xAdvance !== 0) out.push({ left: leftGlyph, right: r.secondGlyph, value: xAdvance });
          }
        }
      } else if (st.classDef1 && st.classDef2 && st.classRecords) {
        // Format 2: class pairs. Bounded by the (small) set of glyphs each ClassDef
        // actually assigns a non-zero class to, grouped by class before pairing up.
        const covered = new Set(coverageGlyphs(st.coverage));
        const class1 = classDefMembers(st.classDef1);
        const class2 = classDefMembers(st.classDef2);
        const byClass1 = new Map<number, number[]>();
        for (const [g, c] of class1) if (covered.has(g)) pushInto(byClass1, c, g);
        const byClass2 = new Map<number, number[]>();
        for (const [g, c] of class2) pushInto(byClass2, c, g);
        const classRecords = st.classRecords;
        for (const [c1, leftGlyphs] of byClass1) {
          const row = lazyGet(classRecords, c1);
          if (!row) continue;
          for (const [c2, rightGlyphs] of byClass2) {
            const rec = lazyGet(row, c2);
            const xAdvance = rec?.value1?.xAdvance;
            if (typeof xAdvance !== 'number' || xAdvance === 0) continue;
            for (const lg of leftGlyphs) for (const rg of rightGlyphs) out.push({ left: lg, right: rg, value: xAdvance });
          }
        }
      }
    }
  }
  return out;
}

/** Flattens both kerning sources to code-point pairs, restricted to §4.2's ranges and
 * thresholded at 4/1000 em. GPOS wins over the legacy table on a duplicate (left, right). */
function buildKernPairs(font: fontkit.Font, unitsPerEm: number): { left: number; right: number; value: number }[] {
  const glyphToCp = buildGlyphToCp(font);
  const threshold = (4 * unitsPerEm) / 1000;
  const merged = new Map<string, { left: number; right: number; value: number }>();
  const apply = (pairs: RawKernPair[]) => {
    for (const p of pairs) {
      const leftCp = glyphToCp.get(p.left);
      const rightCp = glyphToCp.get(p.right);
      if (leftCp === undefined || rightCp === undefined) continue;
      if (Math.abs(p.value) < threshold) continue;
      merged.set(`${leftCp}:${rightCp}`, { left: leftCp, right: rightCp, value: p.value });
    }
  };
  apply(legacyKernPairs(font));
  apply(gposKernPairs(font));
  return [...merged.values()];
}

function poolBytesFor(ranges: FwmRange[]): number {
  let n = 0;
  for (const r of ranges) if (r.mode === 'explicit') n += (r.advances?.length ?? 0) * 2;
  return n;
}

/** See `FACE_BYTE_BUDGET`'s doc comment. */
function capKernPairs(
  pairs: { left: number; right: number; value: number }[],
  ranges: FwmRange[],
): { left: number; right: number; value: number }[] {
  const fixedBytes = 48 + ranges.length * 12 + poolBytesFor(ranges);
  const budget = FACE_BYTE_BUDGET - FACE_BYTE_SAFETY_MARGIN - fixedBytes;
  const maxPairs = Math.max(0, Math.floor(budget / 12));
  if (pairs.length <= maxPairs) return pairs;
  return [...pairs].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.left - b.left || a.right - b.right).slice(0, maxPairs);
}

// ─── Job collection: one static file may yield 1 (plain), 2 (variable, R/B), or N (a .ttc's
// sub-fonts) logical faces ──────────────────────────────────────────────────────────────

interface FontJob {
  font: fontkit.Font;
  file: string;
  sha: string;
  styleOverride?: { bold: boolean; italic: boolean };
}

function collectJobs(): FontJob[] {
  const jobs: FontJob[] = [];
  for (const file of readdirSync(SRC)
    .filter((f) => /\.(ttf|otf|ttc)$/i.test(f))
    .sort()) {
    const bytes = readFileSync(join(SRC, file));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const parsed = fontkit.create(bytes) as fontkit.Font | fontkit.FontCollection;
    if ('fonts' in parsed) {
      for (const sub of parsed.fonts) {
        if (!CJK_FAMILY_RE.test(sub.familyName)) continue; // skip HK region + the Mono CJK sub-fonts
        jobs.push({ font: sub, file, sha });
      }
      continue;
    }
    const font = parsed;
    const wght = (font as unknown as { variationAxes?: Record<string, unknown> }).variationAxes?.wght;
    if (wght) {
      const italic = font.italicAngle !== 0;
      jobs.push({ font: font.getVariation({ wght: REGULAR_WGHT }), file, sha, styleOverride: { bold: false, italic } });
      if (!SINGLE_WEIGHT_FILES.has(file)) {
        jobs.push({ font: font.getVariation({ wght: BOLD_WGHT }), file, sha, styleOverride: { bold: true, italic } });
      }
      continue;
    }
    jobs.push({ font, file, sha });
  }
  return jobs;
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const entries: string[] = [];
const byteImports: string[] = [];
const byteEntries: string[] = [];
const seenFaceIds = new Set<string>();

for (const job of collectJobs()) {
  const { font, file, sha, styleOverride } = job;
  const { faceId, family, style } = faceIdOf(font, styleOverride);
  if (seenFaceIds.has(faceId)) throw new Error(`build-font-metrics: duplicate faceId '${faceId}' (from ${file})`);
  seenFaceIds.add(faceId);
  const { ranges } = buildRanges(font, family.startsWith('noto-sans-cjk-') || family.startsWith('noto-serif-cjk-') ? ASTRAL_CJK_LIMIT : 0x10ffff);

  // .notdef is glyph 0; its advance is the spec §4.2 `defaultAdvance`, i.e. what
  // `advance(cp)` answers for an uncovered code point. NOT the modal advance.
  const defaultAdvance = font.getGlyph(0).advanceWidth;
  const monospace = isFixedPitch(font);
  const classification: 'mono' | 'serif' | 'sans' = monospace
    ? 'mono'
    : /serif/i.test(family) && !/sans/i.test(family)
      ? 'serif'
      : 'sans';
  const requiresShaping = TIER2_FAMILY_SLUGS.has(family);
  // CJK faces' embedded Latin/Greek/Cyrillic GPOS class-kerning tables are broad (dozens of
  // glyphs per class), so flattening them to code-point pairs the way a Latin proportional
  // face's does blows the spec §4.4 per-face budget for a Latin-kerning nicety inside a
  // face whose job is full-width ideographs (which never kern, §4.2). Skipped for CJK only.
  const isCjkFamily = family.startsWith('noto-sans-cjk-') || family.startsWith('noto-serif-cjk-');
  const kernPairs = monospace || isCjkFamily ? [] : capKernPairs(buildKernPairs(font, font.unitsPerEm), ranges);

  const fwm = encodeFwm({
    faceId,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascent,
    descender: font.descent,
    lineGap: font.lineGap,
    capHeight: font.capHeight,
    xHeight: font.xHeight,
    underlinePosition: font.underlinePosition,
    underlineThickness: font.underlineThickness,
    strikeoutPosition: Math.round(font.capHeight / 2),
    strikeoutThickness: font.underlineThickness,
    italicAngle: font.italicAngle,
    monospace,
    requiresShaping,
    defaultAdvance,
    sourceSha256: sha,
    ranges,
    kernPairs,
  });

  const moduleName = faceId.replace(':', '-'); // 'courier-prime-regular.fwm.ts'
  writeFileSync(
    join(OUT, `${moduleName}.fwm.ts`),
    `// GENERATED by scripts/build-font-metrics.ts — do not edit.\n` +
      `export const bytes = new Uint8Array([${fwm.join(',')}]);\n` +
      `export const sourceSha256 = '${sha}';\n`,
  );
  entries.push(
    `  { faceId: '${faceId}', family: '${family}', style: '${style}', classification: '${classification}', ` +
      `file: '${file}', sha256: '${sha}', unitsPerEm: ${font.unitsPerEm}, monospace: ${monospace}, ` +
      `requiresShaping: ${requiresShaping}, coverage: ${ranges.length} },`,
  );
  const varName = varNameFor(moduleName);
  byteImports.push(`import { bytes as ${varName} } from './${moduleName}.fwm.js';`);
  byteEntries.push(`  '${faceId}': ${varName},`);

  console.log(`${faceId}: ${ranges.length} ranges, ${kernPairs.length} kern pairs, ${fwm.byteLength} bytes, gz ${gzipSync(fwm).byteLength}`);
}

writeFileSync(
  join(OUT, 'registry.generated.ts'),
  `// GENERATED by scripts/build-font-metrics.ts — do not edit.\nexport const FACES = [\n${entries.join('\n')}\n] as const;\n`,
);

// Replaces Task 2's hand-written `FACE_BYTES` map in `src/fonts/registry.ts`: at 80+ faces,
// hand-listing an import per face does not scale and drifts from `FACES` silently. Every
// `.fwm` bytes module above is wired here in the same pass that lists it in `FACES`, so the
// two can never go out of sync.
writeFileSync(
  join(OUT, 'face-bytes.generated.ts'),
  `// GENERATED by scripts/build-font-metrics.ts — do not edit.\n${byteImports.join('\n')}\n\n` +
    `export const FACE_BYTES: Readonly<Record<string, Uint8Array>> = {\n${byteEntries.join('\n')}\n};\n`,
);
