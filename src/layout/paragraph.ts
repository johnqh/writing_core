/**
 * Paragraph layout, spec 02 §11 (S3): display text -> itemize -> measure -> greedy line breaking ->
 * alignment -> pitch grid. Output is `ParagraphLayout` (§11.4).
 *
 * Speed-mode scope: RTL paragraphs swap left/right alignment and reorder runs (L2) but indents are
 * not mirrored; inline images/embeds, hyphenation, tab stops, `leadingAdjust` beyond the additive
 * term, and the Track Changes / alternates display modes (the default `displayText` is the `final`
 * view) are not implemented.
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { PageSpec } from '../schema/template.js';
import { LINE_SPACING_FACTORS } from '../schema/vocab.js';
import type { ResolvedStyle } from '../template/resolve.js';
import { mirrorChar, reorderVisual } from '../text/bidi.js';
import { upperCaseWithMap } from '../text/casing.js';
import { graphemeClusters } from '../text/grapheme.js';
import { breakOpportunities } from '../text/linebreak.js';
import { sentenceEnds } from '../text/sentences.js';
import type { PaginationCategory } from './category.js';
import { itemize, type AttrRun, type Item } from './itemize.js';
import { isCourierFamily, measureItem } from './measure.js';
import type { ElementContext } from './context.js';
import { roundHalfEven, sizeEmuFromPoints } from './round.js';
import type { FontRegistry, GlyphRun, LayoutDiagnostic, Shaper } from './types.js';

export interface ParaLine {
  top: number;
  pitch: number;
  baseline: number;
  x: number;
  width: number;
  /** UTF-16 offsets in the element's source text. */
  sourceStart: number;
  sourceEnd: number;
  runs: GlyphRun[];
  hardBreak: boolean;
}

export interface ParagraphLayout {
  elementId: ElementId;
  cacheKey: string;
  spaceBefore: number;
  lines: ParaLine[];
  totalHeight: number;
  sentenceEndLines: Uint8Array;
  category: PaginationCategory;
  diagnostics: LayoutDiagnostic[];
}

export interface DisplayText {
  text: string;
  /** Source offset per display grapheme cluster (`upperCaseWithMap`); null means identity. */
  clusterSource: Uint32Array | null;
  /** Length of the element's source text (the source offset generated text collapses to). */
  sourceLength: number;
}

/** §11.2 step 1 is owned by Task 28 (Track Changes view); the default is the `final` view. */
export type DisplayTextFn = (elementId: ElementId) => DisplayText;

export interface ParagraphInput {
  elementId: ElementId;
  displayText: DisplayTextFn;
  attrs: readonly AttrRun[];
  style: ResolvedStyle;
  category: PaginationCategory;
  page: PageSpec;
  /** Root style font size in pt (`templateReferenceSize`). */
  referenceSizePt: number;
  lang: string;
  fonts: FontRegistry;
  shaper: Shaper | null;
  lineAdjustDeltaRight?: number;
  /** Pre-computed `fontRegistryVersion|engineVersion|viewTextMode` from Task 31. */
  keyPrefix?: string;
  decorationHash?: number;
  /** Geometry override for dual dialogue / column rows (§15/§16). */
  geometry?: { textLeft: number; width: number };
}

/** `basePitch = round(914400 / linesPerInch)`. */
export function basePitchOf(page: PageSpec): number {
  return roundHalfEven(914_400 / page.linesPerInch);
}

/** §11.3.7 space before, EMU. */
export function spaceBeforeOf(style: ResolvedStyle, page: PageSpec): number {
  return roundHalfEven(style.spaceBefore * page.elementSpacing * basePitchOf(page) * LINE_SPACING_FACTORS[page.lineSpacingPreset]);
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

interface Cluster {
  text: string;
  adv: number;
  dStart: number;
  dEnd: number;
  item: number;
  attr: number;
  level: number;
  space: boolean;
}

const NO_ANNOTATIONS = (lang: string): GlyphRun['annotations'] => ({
  revisionSetId: null, trackChange: null, noteIds: [], tagIds: [], suggestionIds: [], highlight: null, link: null,
  nospell: false, lang, decoration: 'none',
});

export function layoutParagraph(input: ParagraphInput): ParagraphLayout {
  const { style, page, fonts, shaper, lang } = input;
  const dt = input.displayText(input.elementId);
  const display = dt.text;
  const diagnostics: LayoutDiagnostic[] = [];
  const basePitch = basePitchOf(page);
  const preset = LINE_SPACING_FACTORS[page.lineSpacingPreset];
  const refSize = sizeEmuFromPoints(input.referenceSizePt);

  // Geometry (§11.1).
  const textLeft = input.geometry?.textLeft ?? page.margins.left + style.indentLeft;
  const width =
    input.geometry?.width ?? page.width - page.margins.right - style.indentRight + (input.lineAdjustDeltaRight ?? 0) - textLeft;
  const textRight = textLeft + width;

  // Display offset -> source offset, per grapheme cluster start.
  const dStarts = graphemeClusters(display);
  const srcAt = new Map<number, number>();
  for (let i = 0; i < dStarts.length; i++) srcAt.set(dStarts[i] as number, dt.clusterSource ? (dt.clusterSource[i] ?? dt.sourceLength) : (dStarts[i] as number));
  srcAt.set(display.length, dt.sourceLength);
  const srcOf = (d: number): number => srcAt.get(d) ?? dt.sourceLength;

  // Itemize + measure into a flat cluster list.
  const items: Item[] = itemize(display, input.attrs, style, fonts, lang);
  const clusters: Cluster[] = [];
  let attrPtr = 0;
  const paragraphLevelRtl = items.length > 0 && items[0]!.bidiLevel % 2 === 1;
  items.forEach((item, ii) => {
    const m = measureItem(item, fonts, shaper);
    diagnostics.push(...m.diagnostics.map((d) => ({ ...d, elementId: input.elementId })));
    const n = m.clusters.length;
    for (let i = 0; i < n; i++) {
      const dStart = item.start + (m.clusterSource[i] as number);
      const dEnd = i + 1 < n ? item.start + (m.clusterSource[i + 1] as number) : item.end;
      const text = m.text.slice(m.clusters[i] as number, i + 1 < n ? (m.clusters[i + 1] as number) : m.text.length);
      while (attrPtr < input.attrs.length && (input.attrs[attrPtr] as AttrRun).end <= dStart) attrPtr++;
      const ar = attrPtr < input.attrs.length ? (input.attrs[attrPtr] as AttrRun) : null;
      clusters.push({
        text, adv: text === '\n' ? 0 : (m.clusterAdvances[i] as number), dStart, dEnd, item: ii,
        attr: ar && ar.start <= dStart ? attrPtr : -1, level: item.bidiLevel, space: text === ' ',
      });
    }
  });

  // Break opportunities over the display text (§6.2), by display offset.
  const opp = display.length ? breakOpportunities(display, { language: lang }) : new Uint8Array(0);
  const oppAt = (c: Cluster): number => opp[c.dStart] ?? 0;

  // Greedy first-fit (§11.3.3): fit predicate is `used <= width`; trailing spaces hang.
  const ranges: { a: number; b: number; hard: boolean }[] = [];
  let a = 0;
  while (a < clusters.length) {
    const avail = ranges.length === 0 ? width - style.indentFirstLine : width;
    let sum = 0;
    let trail = 0;
    let lastCand = -1;
    let end = -1;
    let hard = false;
    let c = a;
    for (; c < clusters.length; c++) {
      const cl = clusters[c] as Cluster;
      if (c > a) {
        const o = oppAt(cl);
        if (o === 2) {
          end = c;
          hard = true;
          break;
        }
        if (o === 1) lastCand = c;
      }
      sum += cl.adv;
      trail = cl.space ? trail + cl.adv : 0;
      if (!cl.space && sum - trail > avail && c > a) {
        if (lastCand > a) end = lastCand;
        else {
          end = c;
          diagnostics.push({ code: 'overlongUnbreakable', elementId: input.elementId, pageIndex: null, detail: { line: ranges.length } });
        }
        break;
      }
    }
    if (end < 0) end = clusters.length;
    ranges.push({ a, b: end, hard });
    a = end;
  }
  if (ranges.length === 0) ranges.push({ a: 0, b: 0, hard: false });

  // Font metrics for the pitch grid (§11.3.5-6).
  const primary = fonts.face(style.font.family, style.font.bold, style.font.italic).face;
  const primarySize = sizeEmuFromPoints(style.font.size);
  const sizeEndsOf = (from: number, to: number): number => {
    let max = primarySize;
    for (let c = from; c < to; c++) max = Math.max(max, items[(clusters[c] as Cluster).item]!.sizeEmu);
    return max;
  };

  const ends = display.length ? sentenceEnds(display, lang) : [];
  const lines: ParaLine[] = [];
  const sentenceEndLines = new Uint8Array(ranges.length);
  let top = 0;

  for (let li = 0; li < ranges.length; li++) {
    const { a: la, b: lb, hard } = ranges[li] as { a: number; b: number; hard: boolean };
    const lineClusters = clusters.slice(la, lb);
    const advs = lineClusters.map((cl) => cl.adv);

    // Visible width excludes trailing hanging spaces.
    let visibleEnd = lineClusters.length;
    while (visibleEnd > 0 && (lineClusters[visibleEnd - 1] as Cluster).space) visibleEnd--;
    let lineWidth = 0;
    for (let i = 0; i < visibleEnd; i++) lineWidth += advs[i] as number;

    const isFirst = li === 0;
    const avail = isFirst ? width - style.indentFirstLine : width;
    const isLast = li === ranges.length - 1;
    let align = style.align;
    if (paragraphLevelRtl && (align === 'left' || align === 'right')) align = align === 'left' ? 'right' : 'left';

    // Justify (§11.3.4): distribute extra one EMU at a time, left to right.
    if (align === 'justify' && !isLast && !hard) {
      const spaces: number[] = [];
      for (let i = 0; i < visibleEnd; i++) if ((lineClusters[i] as Cluster).space) spaces.push(i);
      if (spaces.length > 0 && lineWidth < avail) {
        const extra = avail - lineWidth;
        const each = Math.floor(extra / spaces.length);
        const rem = extra - each * spaces.length;
        spaces.forEach((si, k) => {
          advs[si] = (advs[si] as number) + each + (k < rem ? 1 : 0);
        });
        lineWidth = avail;
      }
    }

    let x: number;
    if (align === 'right') x = textRight - lineWidth;
    else if (align === 'center') x = textLeft + Math.floor((width - lineWidth) / 2);
    else x = textLeft + (isFirst ? style.indentFirstLine : 0);

    // Pitch and baseline.
    const maxSize = sizeEndsOf(la, lb);
    // Courier on the 10 cpi ruling stays exactly on the pitch grid (spec 01 §3.1): its own line height is not consulted.
    const onGrid = isCourierFamily(style.font.family) && primary.monospace;
    const fontLineHeight = onGrid ? 0 : roundHalfEven(((primary.ascender - primary.descender + primary.lineGap) * primarySize) / primary.unitsPerEm);
    const sizeScale = Math.max(1, maxSize / refSize, fontLineHeight / basePitch);
    const pitch = roundHalfEven(basePitch * preset * style.lineSpacing * sizeScale) + style.leadingAdjust;
    const asc = (primary.ascender * maxSize) / primary.unitsPerEm;
    const desc = (primary.descender * maxSize) / primary.unitsPerEm;
    const baseline = top + roundHalfEven((pitch - (asc - desc)) / 2) + roundHalfEven(asc);

    // Glyph runs: group logical clusters by item + attribute run, then order visually.
    const runsLogical: { cl: Cluster[]; adv: number[] }[] = [];
    for (let i = 0; i < lineClusters.length; i++) {
      const cl = lineClusters[i] as Cluster;
      const prev = runsLogical[runsLogical.length - 1];
      const prevCl = prev?.cl[prev.cl.length - 1];
      if (prev && prevCl && prevCl.item === cl.item && prevCl.attr === cl.attr) {
        prev.cl.push(cl);
        prev.adv.push(advs[i] as number);
      } else runsLogical.push({ cl: [cl], adv: [advs[i] as number] });
    }
    const levels = Uint8Array.from(runsLogical.map((r) => (r.cl[0] as Cluster).level));
    const order = reorderVisual(levels, 0, runsLogical.length);
    const runs: GlyphRun[] = [];
    let rx = x;
    for (const ri of order) {
      const r = runsLogical[ri] as { cl: Cluster[]; adv: number[] };
      const first = r.cl[0] as Cluster;
      const item = items[first.item] as Item;
      const marks = first.attr >= 0 ? (input.attrs[first.attr] as AttrRun).attrs : {};
      let text = '';
      const offs: number[] = [];
      const srcs: number[] = [];
      for (const cl of r.cl) {
        offs.push(text.length);
        srcs.push(srcOf(cl.dStart));
        let t = cl.text;
        if (cl.level % 2 === 1) {
          const cp = t.codePointAt(0) as number;
          const mir = mirrorChar(cp);
          if (mir !== cp && t.length === (cp > 0xffff ? 2 : 1)) t = String.fromCodePoint(mir);
        }
        text += t;
      }
      const w = r.adv.reduce((s, v) => s + v, 0);
      const u = marks.u;
      const shift = item.baselineShift === 'super' ? roundHalfEven(item.sizeEmu * 0.35) : item.baselineShift === 'sub' ? -roundHalfEven(item.sizeEmu * 0.15) : 0;
      runs.push({
        x: rx, faceId: item.face.faceId, sizeEmu: item.sizeEmu, synthBold: item.synthBold, synthItalic: item.synthItalic,
        text, bidiLevel: first.level, clusters: Uint32Array.from(offs), clusterAdvances: Int32Array.from(r.adv),
        clusterSource: Uint32Array.from(srcs), width: w,
        style: {
          color: typeof marks.fc === 'string' ? marks.fc : style.font.color,
          background: typeof marks.hl === 'string' ? marks.hl : null,
          underline:
            u === true ? 'regular' : typeof u === 'string' && ['regular', 'dotted', 'word', 'double'].includes(u)
              ? (u as 'regular' | 'dotted' | 'word' | 'double')
              : ((style.font.underline as 'regular' | 'dotted' | 'word' | 'double' | null) ?? 'none'),
          strike: marks.s === true || style.font.strike,
          smallCaps: item.smallCaps,
          baselineShift: shift,
        },
        annotations: NO_ANNOTATIONS(item.lang),
      });
      rx += w;
    }

    const first = lineClusters[0];
    const last = lineClusters[lineClusters.length - 1];
    const sourceStart = first ? srcOf(first.dStart) : ranges.length === 1 ? 0 : dt.sourceLength;
    const sourceEnd = last ? srcOf(last.dEnd) : sourceStart;
    lines.push({ top, pitch, baseline, x, width: lineWidth, sourceStart, sourceEnd, runs, hardBreak: hard });

    // Sentence end (§13.6 rule 3): a sentence end falls at or after the last visible char of this line.
    if (isLast) sentenceEndLines[li] = 1;
    else if (last) {
      const visLast = lineClusters[Math.max(0, visibleEnd - 1)] as Cluster;
      const lo = visLast.dEnd;
      const hi = last.dEnd;
      if (ends.some((e) => e >= lo && e <= hi)) sentenceEndLines[li] = 1;
    }
    top += pitch;
  }

  const cacheKey = [
    input.keyPrefix ?? '', input.elementId, fnv(display), style.id, textLeft, width, input.decorationHash ?? 0,
    page.linesPerInch, page.lineSpacingPreset, page.elementSpacing, fnv(JSON.stringify(input.attrs)),
  ].join('|');

  return {
    elementId: input.elementId, cacheKey, spaceBefore: spaceBeforeOf(style, page), lines, totalHeight: top,
    sentenceEndLines, category: input.category, diagnostics,
  };
}

/**
 * The default (`final` Track Changes view) display text: all caps (§7.1), the omitted-scene
 * placeholder and the automatic `(CONT'D)` suffix (§11.2 step 3).
 */
export function makeDisplayText(
  model: DocumentModel,
  template: EmbeddedTemplateJSON,
  contexts: ReadonlyMap<ElementId, ElementContext>,
  styleOf: (el: ElementView) => ResolvedStyle,
  lang: string,
): DisplayTextFn {
  const byId = new Map<ElementId, ElementView>();
  for (const el of model.elements()) byId.set(el.id, el);
  return (id) => {
    const el = byId.get(id) as ElementView;
    const ctx = contexts.get(id);
    const source = el.text.plain;
    if (ctx?.generatedText) {
      const g = ctx.generatedText;
      return { text: g, clusterSource: new Uint32Array(graphemeClusters(g).length), sourceLength: source.length };
    }
    let text = source;
    let map: number[];
    if (styleOf(el).allCaps) {
      const up = upperCaseWithMap(source, lang);
      text = up.display;
      map = Array.from(up.clusterSource);
    } else map = graphemeClusters(source);
    if (ctx?.autoContinued) {
      const extra = template.continueds.joiner + template.continueds.cont;
      text += extra;
      for (let i = 0; i < graphemeClusters(extra).length; i++) map.push(source.length);
    }
    return { text, clusterSource: Uint32Array.from(map), sourceLength: source.length };
  };
}
