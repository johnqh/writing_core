/**
 * Itemization, spec 02 §8.3. A paragraph's display text is split into items, each maximal with
 * constant bidi level, script, resolved face, size, bold, italic, small-caps state, baseline
 * shift, language and tier. Colour, underline, strike, highlight, revision, tag, comment and
 * track-change marks do NOT split items (they split glyph runs at emission, §29.3).
 *
 * Splits happen only at grapheme-cluster boundaries. Small caps: the caller passes display text
 * whose lowercase letters are still lowercase; an item with `smallCaps: true` is measured (and
 * drawn) as its uppercase form at 0.8x size (`measureItem` does the uppercasing).
 */
import type { FontFaceMetrics, FontRegistry } from './types.js';
import type { FontFamilyId } from '../schema/primitives.js';
import type { TextAttrs } from '../schema/text.js';
import type { ResolvedStyle } from '../template/resolve.js';
import { bidiLevels, resolveParagraphLevel } from '../text/bidi.js';
import { graphemeClusters } from '../text/grapheme.js';
import { smallCapsRuns } from '../text/smallcaps.js';
import { generalCategory, script as scriptOfCp } from '../text/ucd.generated.js';
import { roundHalfEven, sizeEmuFromPoints } from './round.js';

/** Formatting marks over UTF-16 ranges of the display text. Ranges may be sparse; gaps carry no marks. */
export interface AttrRun {
  start: number;
  end: number;
  attrs: TextAttrs;
}

export type ItemTier = 1 | 2;
export type BaselineShift = 'none' | 'super' | 'sub';

export interface Item {
  /** UTF-16 range in the display text. */
  start: number;
  end: number;
  text: string;
  bidiLevel: number;
  /** Unicode script name (UCD), Common/Inherited resolved to a neighbour. */
  script: string;
  familyId: FontFamilyId;
  face: FontFaceMetrics;
  synthBold: boolean;
  synthItalic: boolean;
  sizeEmu: number;
  bold: boolean;
  italic: boolean;
  smallCaps: boolean;
  baselineShift: BaselineShift;
  lang: string;
  tier: ItemTier;
}

/** ISO 15924 codes for the scripts a shaper is ever handed (tier 2 plus Hebrew/Hangul). */
const ISO_15924: Readonly<Record<string, string>> = {
  Arabic: 'Arab', Syriac: 'Syrc', Nko: 'Nkoo', Thaana: 'Thaa', Devanagari: 'Deva', Bengali: 'Beng',
  Gurmukhi: 'Guru', Gujarati: 'Gujr', Oriya: 'Orya', Tamil: 'Taml', Telugu: 'Telu', Kannada: 'Knda',
  Malayalam: 'Mlym', Sinhala: 'Sinh', Thai: 'Thai', Lao: 'Laoo', Tibetan: 'Tibt', Myanmar: 'Mymr',
  Khmer: 'Khmr', Hebrew: 'Hebr', Hangul: 'Hang', Latin: 'Latn', Greek: 'Grek', Cyrillic: 'Cyrl',
};
export function iso15924(scriptName: string): string {
  return ISO_15924[scriptName] ?? 'Zyyy';
}

const TIER2_SCRIPTS: ReadonlySet<string> = new Set([
  'Arabic', 'Syriac', 'Nko', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Khmer', 'Myanmar', 'Tibetan',
]);

function isJamo(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff);
}

const SMALL_CAPS_SCALE = 0.8;

/** Tier of one grapheme cluster given its resolved script (spec 02 §5.1). */
function clusterTier(text: string, start: number, end: number, scriptName: string): ItemTier {
  if (TIER2_SCRIPTS.has(scriptName)) return 2;
  let hebrewMark = false;
  for (let i = start; i < end; ) {
    const cp = text.codePointAt(i) as number;
    i += cp > 0xffff ? 2 : 1;
    if (isJamo(cp)) return 2;
    if (scriptName === 'Hebrew' && generalCategory(cp) === 'Mn') hebrewMark = true;
  }
  return hebrewMark ? 2 : 1;
}

function isNeutralScript(name: string): boolean {
  return name === 'Common' || name === 'Inherited' || name === 'Unknown';
}

export function itemize(
  display: string,
  attrs: readonly AttrRun[],
  style: Pick<ResolvedStyle, 'font' | 'direction'>,
  fonts: FontRegistry,
  lang: string,
): Item[] {
  if (display.length === 0) return [];
  const starts = graphemeClusters(display);
  const n = starts.length;

  // Bidi levels are per code point; index them by the cluster's first code point.
  const paragraphLevel = resolveParagraphLevel(display, style.direction, 0);
  const levels = bidiLevels(display, paragraphLevel);
  const cpIndexOfCluster = new Int32Array(n);
  {
    let cpIndex = 0;
    let ci = 0;
    for (let i = 0; i < display.length && ci < n; ) {
      if (i === starts[ci]) cpIndexOfCluster[ci++] = cpIndex;
      const cp = display.codePointAt(i) as number;
      i += cp > 0xffff ? 2 : 1;
      cpIndex++;
    }
  }

  // Script per cluster; Common/Inherited take the previous cluster's script, or the next one at the start.
  const scripts: string[] = new Array(n);
  for (let c = 0; c < n; c++) scripts[c] = scriptOfCp(display.codePointAt(starts[c] as number) as number);
  let prev: string | null = null;
  for (let c = 0; c < n; c++) {
    const s = scripts[c] as string;
    if (isNeutralScript(s)) {
      if (prev) scripts[c] = prev;
    } else prev = s;
  }
  let next: string | null = null;
  for (let c = n - 1; c >= 0; c--) {
    const s = scripts[c] as string;
    if (isNeutralScript(s)) {
      if (next) scripts[c] = next;
    } else next = s;
  }

  // Small-caps synthesis mask by UTF-16 offset.
  const synth = smallCapsRuns(display);
  let synthRun = 0;

  const items: Item[] = [];
  let attrPtr = 0;
  let cur: Item | null = null;

  for (let c = 0; c < n; c++) {
    const cs = starts[c] as number;
    const ce = c + 1 < n ? (starts[c + 1] as number) : display.length;
    const firstCp = display.codePointAt(cs) as number;

    while (attrPtr < attrs.length && (attrs[attrPtr] as AttrRun).end <= cs) attrPtr++;
    const run = attrPtr < attrs.length ? (attrs[attrPtr] as AttrRun) : null;
    const marks: TextAttrs = run && run.start <= cs ? run.attrs : {};

    const bold = marks.b === true || style.font.bold;
    const italic = marks.i === true || style.font.italic;
    const familyId = (typeof marks.ff === 'string' ? marks.ff : style.font.family) as FontFamilyId;
    const pt = typeof marks.fs === 'number' ? marks.fs : style.font.size;
    const smallCapsOn = marks.sc === true || style.font.smallCaps;
    while ((synth[synthRun] as { end: number }).end <= cs) synthRun++;
    const smallCaps = smallCapsOn && (synth[synthRun] as { synthesize: boolean }).synthesize;
    const baseSize = sizeEmuFromPoints(pt);
    const sizeEmu = smallCaps ? roundHalfEven(baseSize * SMALL_CAPS_SCALE) : baseSize;
    const baselineShift: BaselineShift = marks.va === 'super' ? 'super' : marks.va === 'sub' ? 'sub' : 'none';
    const cLang = typeof marks.lang === 'string' ? marks.lang : lang;

    const primary = fonts.face(familyId, bold, italic);
    let face = primary.face;
    let synthBold = primary.synthBold;
    let synthItalic = primary.synthItalic;
    if (!face.covers(firstCp) && firstCp > 0x20) {
      face = fonts.fallbackFor(familyId, firstCp, bold, italic, cLang);
      synthBold = false;
      synthItalic = false;
    }

    const scriptName = scripts[c] as string;
    const level = levels[cpIndexOfCluster[c] as number] as number;
    const tier = clusterTier(display, cs, ce, scriptName);

    if (
      cur &&
      cur.bidiLevel === level && cur.script === scriptName && cur.face.faceId === face.faceId &&
      cur.familyId === familyId && cur.synthBold === synthBold && cur.synthItalic === synthItalic &&
      cur.sizeEmu === sizeEmu && cur.smallCaps === smallCaps && cur.baselineShift === baselineShift &&
      cur.lang === cLang && cur.tier === tier && cur.bold === bold && cur.italic === italic
    ) {
      cur.end = ce;
    } else {
      cur = {
        start: cs, end: ce, text: '', bidiLevel: level, script: scriptName, familyId, face, synthBold, synthItalic,
        sizeEmu, bold, italic, smallCaps, baselineShift, lang: cLang, tier,
      };
      items.push(cur);
    }
  }
  for (const it of items) it.text = display.slice(it.start, it.end);
  return items;
}
