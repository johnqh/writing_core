// Regenerates `src/text/generated/*.generated.ts` and the `src/text/ucd.generated.ts`
// barrel from the Unicode 16.0.0 Character Database (spec 02 §6). Bun script.
//
// Downloads the source `.txt` files into `scratch/ucd/` (gitignored — always re-fetched,
// never read back, so a stale local copy can never silently diverge from upstream) and the
// GraphemeBreakTest.txt conformance file into `test/ucd/` (committed, spec 02 §6.1 / task
// 6 step 2). Emits one generated file per property under `src/text/generated/` plus the
// `src/text/ucd.generated.ts` barrel that re-exports typed lookup functions from them.
//
// **Reproducibility (spec 02 §36.1).** Regenerating against the same pinned Unicode
// version must produce byte-identical output: no timestamps, no `Date.now()`, no
// nondeterministic iteration order anywhere in this file. Every generated file's only
// variable content is (a) the parsed UCD data, which is itself deterministic for a fixed,
// released Unicode version, and (b) each source file's SHA-256, recorded in a header
// comment as a provenance pin — if `unicode.org` ever served different bytes at the same
// URL, regeneration would produce a different hash and the diff would show it immediately.
//
// **Size (task 6 brief, pre-flight T6 ruling).** The brief's own worry — "seven
// whole-Unicode properties do not fit in 400 KB as plain range arrays" — assumes one
// array entry per *listed line*. Encoding each property as a merged, gap-filled pair of
// parallel typed arrays (sorted range starts + value indices, binary-searched — see
// `src/text/ucd-lookup.ts`) comes in far smaller: every property measured here is under
// 32 KB of generated source, ~165 KB total across all eleven properties. The per-property
// split (`src/text/generated/*.generated.ts`) is kept anyway, both because the brief asks
// for it as the size-budget fallback and because it lets a caller who only needs, say,
// `script(cp)` import that one table without pulling in the rest (tree-shakeable: every
// generated module is side-effect-free `export const`s, nothing else).
//
// Usage: bun run ucd:generate

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UNICODE_VERSION = '16.0.0';
const BASE = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd`;
const SCRATCH_DIR = 'scratch/ucd';
const TEST_DIR = 'test/ucd';
const OUT_DIR = 'src/text/generated';
const BARREL_PATH = 'src/text/ucd.generated.ts';

// Source files (task 6 brief step 1's exact list, plus DerivedCoreProperties.txt — see
// "Deviation" below).
const SOURCES: Record<string, string> = {
  'GraphemeBreakProperty.txt': `${BASE}/auxiliary/GraphemeBreakProperty.txt`,
  'LineBreak.txt': `${BASE}/LineBreak.txt`,
  'DerivedBidiClass.txt': `${BASE}/extracted/DerivedBidiClass.txt`,
  'Scripts.txt': `${BASE}/Scripts.txt`,
  'DerivedGeneralCategory.txt': `${BASE}/extracted/DerivedGeneralCategory.txt`,
  'WordBreakProperty.txt': `${BASE}/auxiliary/WordBreakProperty.txt`,
  'SentenceBreakProperty.txt': `${BASE}/auxiliary/SentenceBreakProperty.txt`,
  'emoji-data.txt': `${BASE}/emoji/emoji-data.txt`,
  'BidiBrackets.txt': `${BASE}/BidiBrackets.txt`,
  'BidiMirroring.txt': `${BASE}/BidiMirroring.txt`,
  // Deviation from the brief's file list: UAX #29 GB9c (Indic conjunct clusters, added
  // Unicode 15.1) needs the Indic_Conjunct_Break property, which lives only in
  // DerivedCoreProperties.txt — not in GraphemeBreakProperty.txt. Without it, the brief's
  // own explicit test case ("a Devanagari क + virama + ष is one cluster") fails: virama
  // (U+094D) is Grapheme_Cluster_Break=Extend, so GB9 glues क+virama, but nothing glues
  // virama+ष without GB9c's Indic_Conjunct_Break=Consonant/Linker/Extend chain. Recorded
  // here rather than silently added, per the implementer instructions ("fix minimally and
  // record exactly what and why").
  'DerivedCoreProperties.txt': `${BASE}/DerivedCoreProperties.txt`,
};

const CONFORMANCE: Record<string, string> = {
  'GraphemeBreakTest.txt': `${BASE}/auxiliary/GraphemeBreakTest.txt`,
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── UCD line parsing ───────────────────────────────────────────────────────────────────

interface RangeEntry {
  start: number;
  end: number;
  value: string;
}

const CODE_RANGE_RE = /^([0-9A-Fa-f]{4,6})(?:\.\.([0-9A-Fa-f]{4,6}))?$/;
// "# @missing: START..END; VALUE" or "# @missing: START..END; PROPERTY; VALUE"
const MISSING_RE = /@missing:\s*([0-9A-Fa-f]{4,6})(?:\.\.([0-9A-Fa-f]{4,6}))?\s*;\s*(?:([A-Za-z_0-9]+)\s*;\s*)?([A-Za-z_0-9]+)/;

/**
 * Parses one UCD data file into explicit `entries` and `@missing` default `entries`
 * (spec: UAX #44 §5.7.1). `propertyFilter` selects one property out of a file that lists
 * several per line (`emoji-data.txt`: `Emoji`, `Extended_Pictographic`, ...;
 * `DerivedCoreProperties.txt`: `Alphabetic`, `InCB`, ...) — required whenever a line can
 * carry more than one property's data; omitted for single-property files.
 */
function parseRangedProperty(text: string, propertyFilter?: string): { entries: RangeEntry[]; missing: RangeEntry[] } {
  const entries: RangeEntry[] = [];
  const missing: RangeEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const hashIndex = rawLine.indexOf('#');
    const code = (hashIndex >= 0 ? rawLine.slice(0, hashIndex) : rawLine).trim();
    const comment = hashIndex >= 0 ? rawLine.slice(hashIndex) : '';
    if (comment.startsWith('# @missing:')) {
      const m = MISSING_RE.exec(comment);
      if (m) {
        const [, startHex, endHex, propName, value] = m;
        if (startHex !== undefined && value !== undefined && (!propertyFilter || propName === propertyFilter)) {
          const start = parseInt(startHex, 16);
          const end = endHex !== undefined ? parseInt(endHex, 16) : start;
          missing.push({ start, end, value });
        }
      }
      continue;
    }
    if (!code) continue;
    const fields = code.split(';').map((s) => s.trim());
    const codeField = fields[0];
    if (fields.length < 2 || !codeField) continue;
    let propName: string | null = null;
    let value: string | undefined;
    if (fields.length >= 3) {
      propName = fields[1] ?? null;
      value = fields[2]?.split(/\s+/)[0];
    } else {
      value = fields[1]?.split(/\s+/)[0];
    }
    if (!value) continue;
    if (propertyFilter) {
      if (propName !== null ? propName !== propertyFilter : value !== propertyFilter) continue;
    }
    const rm = CODE_RANGE_RE.exec(codeField);
    if (!rm?.[1]) continue;
    const start = parseInt(rm[1], 16);
    const end = rm[2] !== undefined ? parseInt(rm[2], 16) : start;
    entries.push({ start, end, value });
  }
  return { entries, missing };
}

const CODESPACE_SIZE = 0x110000; // 0..10FFFF inclusive

interface EncodedProperty {
  starts: number[];
  values: number[];
  names: string[];
}

/**
 * Materializes a property over the full codespace (defaults from `missing`, then explicit
 * `entries` painted on top — later writes win, matching UAX #44's "explicit data overrides
 * @missing defaults" rule) and re-derives merged, gap-free ranges by scanning for value
 * transitions. `names` is in first-seen order (deterministic for fixed input text).
 */
function encodeProperty(entries: RangeEntry[], missing: RangeEntry[], defaultValue: string): EncodedProperty {
  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  const idx = (name: string): number => {
    let i = nameIndex.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      nameIndex.set(name, i);
    }
    return i;
  };
  idx(defaultValue); // reserve index 0 for the fallback even if no @missing line names it (e.g. General_Category)
  const arr = new Uint8Array(CODESPACE_SIZE); // zero-initialized == index 0 == defaultValue
  for (const m of missing) arr.fill(idx(m.value), m.start, m.end + 1);
  for (const e of entries) arr.fill(idx(e.value), e.start, e.end + 1);

  const starts: number[] = [0];
  const values: number[] = [arr[0] ?? 0];
  for (let cp = 1; cp < CODESPACE_SIZE; cp++) {
    const v = arr[cp];
    if (v !== arr[cp - 1]) {
      starts.push(cp);
      values.push(v ?? 0);
    }
  }
  return { starts, values, names };
}

interface SparseMapping {
  codes: number[]; // sorted, unique
  mapped: number[];
  extra?: number[]; // e.g. bracket type, parallel to codes
}

function parseSparseMapping(text: string, thirdFieldMap?: Record<string, number>): SparseMapping {
  const rows: { code: number; mapped: number; extra?: number }[] = [];
  for (const rawLine of text.split('\n')) {
    const hashIndex = rawLine.indexOf('#');
    const code = (hashIndex >= 0 ? rawLine.slice(0, hashIndex) : rawLine).trim();
    if (!code) continue;
    const fields = code.split(';').map((s) => s.trim());
    const codeField = fields[0];
    const mappedField = fields[1];
    if (!codeField || !mappedField) continue;
    const cp = parseInt(codeField, 16);
    const mapped = parseInt(mappedField, 16);
    if (Number.isNaN(cp) || Number.isNaN(mapped)) continue;
    let extra: number | undefined;
    if (thirdFieldMap && fields[2]) extra = thirdFieldMap[fields[2]];
    rows.push({ code: cp, mapped, extra });
  }
  rows.sort((a, b) => a.code - b.code);
  return {
    codes: rows.map((r) => r.code),
    mapped: rows.map((r) => r.mapped),
    extra: thirdFieldMap ? rows.map((r) => r.extra ?? 0) : undefined,
  };
}

// ─── Code generation ────────────────────────────────────────────────────────────────────

const HEADER = (sourceFile: string, sha: string) =>
  `// GENERATED by scripts/build-ucd.ts from ${sourceFile} (Unicode ${UNICODE_VERSION}) — do not edit.\n` +
  `// Source SHA-256: ${sha}\n`;

function u32Literal(nums: number[]): string {
  return `new Uint32Array([${nums.join(',')}])`;
}
function u8Literal(nums: number[]): string {
  return `new Uint8Array([${nums.join(',')}])`;
}

function writeCategoryProperty(
  fileBase: string,
  sourceFile: string,
  sha: string,
  constPrefix: string,
  typeName: string,
  encoded: EncodedProperty,
): void {
  const namesLiteral = encoded.names.map((n) => `'${n}'`).join(', ');
  const src =
    HEADER(sourceFile, sha) +
    `export const ${constPrefix}_NAMES = [${namesLiteral}] as const;\n` +
    `export type ${typeName} = typeof ${constPrefix}_NAMES[number];\n` +
    `export const ${constPrefix}_STARTS = ${u32Literal(encoded.starts)};\n` +
    `export const ${constPrefix}_VALUES = ${u8Literal(encoded.values)};\n`;
  writeFileSync(join(OUT_DIR, `${fileBase}.generated.ts`), src);
}

function writeBinaryProperty(fileBase: string, sourceFile: string, sha: string, constPrefix: string, encoded: EncodedProperty): void {
  // encoded.names[0] is the default (false); names[1], if present, is the true label.
  const src =
    HEADER(sourceFile, sha) +
    `// 0 = false, 1 = true.\n` +
    `export const ${constPrefix}_STARTS = ${u32Literal(encoded.starts)};\n` +
    `export const ${constPrefix}_VALUES = ${u8Literal(encoded.values)};\n`;
  writeFileSync(join(OUT_DIR, `${fileBase}.generated.ts`), src);
}

async function main(): Promise<void> {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const sourceText: Record<string, string> = {};
  const sourceSha: Record<string, string> = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const text = await fetchText(url);
    sourceText[name] = text;
    sourceSha[name] = sha256(text);
    writeFileSync(join(SCRATCH_DIR, name), text);
    console.log(`fetched ${name}: ${text.length} bytes, sha256 ${sourceSha[name]}`);
  }
  for (const [name, url] of Object.entries(CONFORMANCE)) {
    const text = await fetchText(url);
    writeFileSync(join(TEST_DIR, name), text);
    console.log(`fetched (conformance) ${name}: ${text.length} bytes, sha256 ${sha256(text)}`);
  }

  const req = (name: string): string => {
    const t = sourceText[name];
    if (t === undefined) throw new Error(`missing source text for ${name}`);
    return t;
  };

  // Grapheme_Cluster_Break (spec 02 §6.1 — the property grapheme.ts's automaton runs on).
  {
    const { entries, missing } = parseRangedProperty(req('GraphemeBreakProperty.txt'));
    const encoded = encodeProperty(entries, missing, 'Other');
    writeCategoryProperty('grapheme-break', 'GraphemeBreakProperty.txt', sourceSha['GraphemeBreakProperty.txt']!, 'GRAPHEME_BREAK', 'GraphemeBreakClass', encoded);
    console.log(`Grapheme_Cluster_Break: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Extended_Pictographic (emoji-data.txt) — GB11's other input.
  {
    const { entries, missing } = parseRangedProperty(req('emoji-data.txt'), 'Extended_Pictographic');
    const encoded = encodeProperty(entries, missing.length ? missing : [{ start: 0, end: CODESPACE_SIZE - 1, value: 'false' }], 'false');
    writeBinaryProperty('extended-pictographic', 'emoji-data.txt', sourceSha['emoji-data.txt']!, 'EXTENDED_PICTOGRAPHIC', encoded);
    console.log(`Extended_Pictographic: ${encoded.starts.length} ranges`);
  }

  // Indic_Conjunct_Break (DerivedCoreProperties.txt) — GB9c's input (see "Deviation" above).
  {
    const { entries, missing } = parseRangedProperty(req('DerivedCoreProperties.txt'), 'InCB');
    const encoded = encodeProperty(entries, missing, 'None');
    writeCategoryProperty('indic-conjunct-break', 'DerivedCoreProperties.txt', sourceSha['DerivedCoreProperties.txt']!, 'INDIC_CONJUNCT_BREAK', 'IndicConjunctBreakClass', encoded);
    console.log(`Indic_Conjunct_Break: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Line_Break (spec 02 §6.2 — consumed by a later task's line-breaking algorithm).
  {
    const { entries, missing } = parseRangedProperty(req('LineBreak.txt'));
    const encoded = encodeProperty(entries, missing, 'XX');
    writeCategoryProperty('line-break', 'LineBreak.txt', sourceSha['LineBreak.txt']!, 'LINE_BREAK', 'LineBreakClass', encoded);
    console.log(`Line_Break: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Bidi_Class (spec 02 §6.3 — consumed by a later task's bidi algorithm).
  {
    const { entries, missing } = parseRangedProperty(req('DerivedBidiClass.txt'));
    const encoded = encodeProperty(entries, missing, 'Left_To_Right');
    writeCategoryProperty('bidi-class', 'DerivedBidiClass.txt', sourceSha['DerivedBidiClass.txt']!, 'BIDI_CLASS', 'BidiClass', encoded);
    console.log(`Bidi_Class: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Script (consumed by font fallback (spec 02 §5.1, already shipped) and a later task).
  {
    const { entries, missing } = parseRangedProperty(req('Scripts.txt'));
    const encoded = encodeProperty(entries, missing, 'Unknown');
    writeCategoryProperty('script', 'Scripts.txt', sourceSha['Scripts.txt']!, 'SCRIPT', 'ScriptCode', encoded);
    console.log(`Script: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // General_Category.
  {
    const { entries, missing } = parseRangedProperty(req('DerivedGeneralCategory.txt'));
    const encoded = encodeProperty(entries, missing, 'Cn');
    writeCategoryProperty('general-category', 'DerivedGeneralCategory.txt', sourceSha['DerivedGeneralCategory.txt']!, 'GENERAL_CATEGORY', 'GeneralCategory', encoded);
    console.log(`General_Category: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Word_Break (spec 02 §6.5 — consumed by a later task's word-boundary algorithm).
  {
    const { entries, missing } = parseRangedProperty(req('WordBreakProperty.txt'));
    const encoded = encodeProperty(entries, missing, 'Other');
    writeCategoryProperty('word-break', 'WordBreakProperty.txt', sourceSha['WordBreakProperty.txt']!, 'WORD_BREAK', 'WordBreakClass', encoded);
    console.log(`Word_Break: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // Sentence_Break (spec 02 §6.5 — consumed by a later task's sentence-boundary algorithm).
  {
    const { entries, missing } = parseRangedProperty(req('SentenceBreakProperty.txt'));
    const encoded = encodeProperty(entries, missing, 'Other');
    writeCategoryProperty('sentence-break', 'SentenceBreakProperty.txt', sourceSha['SentenceBreakProperty.txt']!, 'SENTENCE_BREAK', 'SentenceBreakClass', encoded);
    console.log(`Sentence_Break: ${encoded.starts.length} ranges, ${encoded.names.length} values`);
  }

  // BidiBrackets.txt — sparse cp -> (pairedBracket, type 'o'|'c') mapping (spec 02 §6.3, not consumed until a later task).
  {
    const { codes, mapped, extra } = parseSparseMapping(req('BidiBrackets.txt'), { o: 0, c: 1 });
    const src =
      HEADER('BidiBrackets.txt', sourceSha['BidiBrackets.txt']!) +
      `// type: 0 = open, 1 = close.\n` +
      `export const BIDI_BRACKET_CODES = ${u32Literal(codes)};\n` +
      `export const BIDI_BRACKET_PAIRED = ${u32Literal(mapped)};\n` +
      `export const BIDI_BRACKET_TYPES = ${u8Literal(extra ?? [])};\n`;
    writeFileSync(join(OUT_DIR, 'bidi-brackets.generated.ts'), src);
    console.log(`BidiBrackets: ${codes.length} entries`);
  }

  // BidiMirroring.txt — sparse cp -> mirrored cp mapping (spec 02 §6.3, not consumed until a later task).
  {
    const { codes, mapped } = parseSparseMapping(req('BidiMirroring.txt'));
    const src =
      HEADER('BidiMirroring.txt', sourceSha['BidiMirroring.txt']!) +
      `export const BIDI_MIRROR_CODES = ${u32Literal(codes)};\n` +
      `export const BIDI_MIRROR_MAPPED = ${u32Literal(mapped)};\n`;
    writeFileSync(join(OUT_DIR, 'bidi-mirroring.generated.ts'), src);
    console.log(`BidiMirroring: ${codes.length} entries`);
  }

  // Barrel: `src/text/ucd.generated.ts` (task 6 brief's named artifact). Re-exports typed
  // getter functions built on the per-property files above — the per-property files carry
  // the bulk data, this file is the small, stable entry point `src/index.ts` re-exports
  // from. `grapheme.ts` imports the grapheme-specific tables directly (not through this
  // barrel) so its own import graph stays minimal on the per-keystroke path.
  const barrel =
    `// GENERATED by scripts/build-ucd.ts — do not edit.\n` +
    `// Unicode Character Database version pin (spec 02 §36.1: "UCD version" is part of\n` +
    `// LAYOUT_ENGINE_VERSION's bump surface).\n` +
    `export const UNICODE_VERSION = '${UNICODE_VERSION}';\n\n` +
    `import { lookupRangeValue } from './ucd-lookup.js';\n` +
    `import { GRAPHEME_BREAK_NAMES, GRAPHEME_BREAK_STARTS, GRAPHEME_BREAK_VALUES, type GraphemeBreakClass } from './generated/grapheme-break.generated.js';\n` +
    `import { LINE_BREAK_NAMES, LINE_BREAK_STARTS, LINE_BREAK_VALUES, type LineBreakClass } from './generated/line-break.generated.js';\n` +
    `import { BIDI_CLASS_NAMES, BIDI_CLASS_STARTS, BIDI_CLASS_VALUES, type BidiClass } from './generated/bidi-class.generated.js';\n` +
    `import { SCRIPT_NAMES, SCRIPT_STARTS, SCRIPT_VALUES, type ScriptCode } from './generated/script.generated.js';\n` +
    `import { GENERAL_CATEGORY_NAMES, GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, type GeneralCategory } from './generated/general-category.generated.js';\n` +
    `import { WORD_BREAK_NAMES, WORD_BREAK_STARTS, WORD_BREAK_VALUES, type WordBreakClass } from './generated/word-break.generated.js';\n` +
    `import { SENTENCE_BREAK_NAMES, SENTENCE_BREAK_STARTS, SENTENCE_BREAK_VALUES, type SentenceBreakClass } from './generated/sentence-break.generated.js';\n\n` +
    `export type { GraphemeBreakClass, LineBreakClass, BidiClass, ScriptCode, GeneralCategory, WordBreakClass, SentenceBreakClass };\n\n` +
    `/** Unicode 16.0 Grapheme_Cluster_Break (spec 02 §6.1). */\n` +
    `export function graphemeBreakProperty(cp: number): GraphemeBreakClass {\n` +
    `  return GRAPHEME_BREAK_NAMES[lookupRangeValue(GRAPHEME_BREAK_STARTS, GRAPHEME_BREAK_VALUES, cp)] ?? 'Other';\n` +
    `}\n\n` +
    `/** Unicode 16.0 Line_Break (spec 02 §6.2). */\n` +
    `export function lineBreakClass(cp: number): LineBreakClass {\n` +
    `  return LINE_BREAK_NAMES[lookupRangeValue(LINE_BREAK_STARTS, LINE_BREAK_VALUES, cp)] ?? 'XX';\n` +
    `}\n\n` +
    `/** Unicode 16.0 Bidi_Class, derived (spec 02 §6.3). */\n` +
    `export function bidiClass(cp: number): BidiClass {\n` +
    `  return BIDI_CLASS_NAMES[lookupRangeValue(BIDI_CLASS_STARTS, BIDI_CLASS_VALUES, cp)] ?? 'Left_To_Right';\n` +
    `}\n\n` +
    `/** Unicode 16.0 Script. */\n` +
    `export function script(cp: number): ScriptCode {\n` +
    `  return SCRIPT_NAMES[lookupRangeValue(SCRIPT_STARTS, SCRIPT_VALUES, cp)] ?? 'Unknown';\n` +
    `}\n\n` +
    `/** Unicode 16.0 General_Category, derived. */\n` +
    `export function generalCategory(cp: number): GeneralCategory {\n` +
    `  return GENERAL_CATEGORY_NAMES[lookupRangeValue(GENERAL_CATEGORY_STARTS, GENERAL_CATEGORY_VALUES, cp)] ?? 'Cn';\n` +
    `}\n\n` +
    `/** Unicode 16.0 Word_Break (spec 02 §6.5). */\n` +
    `export function wordBreakProperty(cp: number): WordBreakClass {\n` +
    `  return WORD_BREAK_NAMES[lookupRangeValue(WORD_BREAK_STARTS, WORD_BREAK_VALUES, cp)] ?? 'Other';\n` +
    `}\n\n` +
    `/** Unicode 16.0 Sentence_Break (spec 02 §6.5). */\n` +
    `export function sentenceBreakProperty(cp: number): SentenceBreakClass {\n` +
    `  return SENTENCE_BREAK_NAMES[lookupRangeValue(SENTENCE_BREAK_STARTS, SENTENCE_BREAK_VALUES, cp)] ?? 'Other';\n` +
    `}\n`;
  writeFileSync(BARREL_PATH, barrel);

  console.log('done.');
}

await main();
