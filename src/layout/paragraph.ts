/**
 * Paragraph layout, spec 02 §11 (S3): display text -> itemize -> measure -> greedy line breaking ->
 * alignment -> pitch grid. Output is `ParagraphLayout` (§11.4).
 *
 * Speed-mode scope: RTL paragraphs swap left/right alignment and reorder runs (L2) but indents are
 * not mirrored; inline images/embeds, hyphenation, tab stops, and `leadingAdjust` beyond the additive
 * term are not implemented. Track Changes display (§26, M2 task 35): `makeDisplayText`'s
 * `trackChangesView` genuinely renders `final`/`simple`/`original` (run- and, via `layoutDocument`,
 * element-level hiding); `markup` is NOT laid out by this pipeline — it needs speed view (deleted
 * text takes real space alongside its live replacement), which does not exist here (`paginate.ts`'s
 * own header: page mode only) — `layoutTrackChangesMarkup` below is the pure text transform, real and
 * tested, waiting for whichever future speed-view pass wants it. Alternates display (`alternatesMode:
 * 'all'`, spec 09, M2 task 35): `makeDisplayText`'s own `alternatesMode` parameter appends each
 * inactive alternate inline as ` // ` + its text, a non-editable generated suffix exactly like
 * `autoContinued`'s — real and tested. Not done: a distinct tint / `GlyphRun.annotations.decoration`
 * tag for it, which is unset (`'none'`) for every one of the four decoration kinds §29.3 lists
 * (`autoContd`, `inlineNumber`, `alternates`, `generatedHeading`) — a pre-existing gap in this whole
 * annotations field across the pipeline, not something specific to alternates to fix in isolation.
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { PageSpec } from '../schema/template.js';
import type { ChangeMark, TextRun } from '../schema/text.js';
import { LINE_SPACING_FACTORS, type TrackChangeView } from '../schema/vocab.js';
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

/** Spec 02 §31.2's paragraph cache (M2 task 31): get-or-nothing plus a stored write, so a hit skips
 *  the rest of `layoutParagraph` entirely. Defined in `paragraph-cache.ts`, imported type-only here to
 *  avoid a runtime circular dependency (that module imports `ParagraphLayout` from this one). */
export interface ParagraphCache {
  get(cacheKey: string): ParagraphLayout | undefined;
  set(cacheKey: string, value: ParagraphLayout): void;
}

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
  /**
   * Hash of the FULLY RESOLVED style (inheritance + `ov` + `paginateAs` already applied), spec
   * 02 §31.2's `effectiveStyleHash`. `style.id` alone (already in `cacheKey`) is not enough: two
   * elements sharing a style id but different per-element `ov` overrides that don't touch
   * `textLeft`/`width` — `spaceBefore`, `lineSpacing`, `indentFirstLine`, font weight/size, etc. —
   * would otherwise collide on the same cache entry. Task 31.
   */
  styleHash?: string;
  decorationHash?: number;
  /** Geometry override for dual dialogue / column rows (§15/§16). */
  geometry?: { textLeft: number; width: number };
  /** Task 31: checked (after geometry is known, before any measuring) and written to on a miss. */
  cache?: ParagraphCache;
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

  // Task 31 (§31.2): every ingredient is known now, before any itemizing/measuring/breaking — a cache
  // hit returns straight away, and a miss is written once the real result is ready below. `dt.sourceLength`
  // is folded in alongside `fnv(display)`: generated display text (an omitted scene's "OMITTED"
  // placeholder, a synthesized cue) can stay byte-identical while the REAL underlying source range it
  // collapses to changes length (e.g. editing an omitted scene's own heading text) — `display` alone
  // would then wrongly hit a cache entry built from the old `sourceStart`/`sourceEnd`.
  const cacheKey = [
    input.keyPrefix ?? '', input.elementId, fnv(display), dt.sourceLength, style.id, input.styleHash ?? '', textLeft, width, input.decorationHash ?? 0,
    page.linesPerInch, page.lineSpacingPreset, page.elementSpacing, fnv(JSON.stringify(input.attrs)),
  ].join('|');
  const cached = input.cache?.get(cacheKey);
  if (cached) return cached;

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

  const result: ParagraphLayout = {
    elementId: input.elementId, cacheKey, spaceBefore: spaceBeforeOf(style, page), lines, totalHeight: top,
    sentenceEndLines, category: input.category, diagnostics,
  };
  input.cache?.set(cacheKey, result);
  return result;
}

/**
 * Spec 02 §26: which run-level marks a non-`markup` Track Changes view hides. `final`/`simple` hide
 * `del` runs (accepted state); `original` hides `ins` runs (rejected state) instead. `markup` hides
 * nothing here — it lays out everything inline (struck through / underlined), which needs speed
 * view (§34.2, not implemented by this pipeline — see this file's own header and `layoutTrackChangesMarkup`
 * below) to have room for both a deletion's text and its replacement at once; page mode never reaches
 * this function with `markup` (`layoutDocument` narrows it to `final` first — see that file's header).
 */
export function hiddenMarkFor(view: TrackChangeView): ChangeMark | null {
  if (view === 'final' || view === 'simple') return 'del';
  if (view === 'original') return 'ins';
  return null;
}

/**
 * Drops the hidden mark's run text (§26) from `runs`, returning the filtered text plus, per UTF-16
 * code unit of that filtered text, which code unit of the FULL (unfiltered) source it came from — so
 * a caller composing further transforms (all-caps, prefixes) on the filtered text can still map back
 * to real Y.Text offsets afterward. A `revDel` embed (spec 01: a deletion placeholder) is dropped
 * unconditionally — spec 11's own `canonicalElementText` does the same, for the same reason: it is
 * never real, visible content.
 */
export function filterTrackChanges(runs: readonly TextRun[], view: TrackChangeView): { text: string; sourceOffsetAt: readonly number[] } {
  const hidden = hiddenMarkFor(view);
  let text = '';
  const sourceOffsetAt: number[] = [];
  let srcOffset = 0;
  for (const run of runs) {
    const isHidden = hidden !== null && run.attrs[hidden] !== undefined && run.attrs[hidden] !== null;
    if (!isHidden) {
      text += run.text;
      for (let i = 0; i < run.text.length; i++) sourceOffsetAt.push(srcOffset + i);
    }
    srcOffset += run.text.length;
  }
  return { text, sourceOffsetAt };
}

/**
 * The display text for one Track Changes view (§26; defaults to `final`): all caps (§7.1), the
 * omitted-scene placeholder, the automatic `(CONT'D)` suffix and, with `alternatesMode: 'all'` (spec
 * 09), each inactive alternate appended inline as ` // ` + its own plain text (§11.2 step 3), composed
 * on top of `filterTrackChanges`'s own run-level hiding. Element-level hiding (`tc.kind:
 * 'delete'`/`'insert'`) and `tc.kind: 'style'`'s `fromStyle` substitution are `layoutDocument`'s own
 * job (they decide whether this function is even called for an element, and which style it resolves
 * against) — this function only ever sees an element it has already been decided should lay out, in
 * the style it should lay out in.
 */
export function makeDisplayText(
  model: DocumentModel,
  template: EmbeddedTemplateJSON,
  contexts: ReadonlyMap<ElementId, ElementContext>,
  styleOf: (el: ElementView) => ResolvedStyle,
  lang: string,
  trackChangesView: TrackChangeView = 'final',
  alternatesMode: 'active' | 'all' = 'active',
): DisplayTextFn {
  const byId = new Map<ElementId, ElementView>();
  for (const el of model.elements()) byId.set(el.id, el);
  return (id) => {
    const el = byId.get(id) as ElementView;
    const ctx = contexts.get(id);
    const fullSource = el.text.plain;
    if (ctx?.generatedText) {
      const g = ctx.generatedText;
      return { text: g, clusterSource: new Uint32Array(graphemeClusters(g).length), sourceLength: fullSource.length };
    }
    const { text: source, sourceOffsetAt } = filterTrackChanges(el.text.runs, trackChangesView);
    let text = source;
    let map: number[];
    if (styleOf(el).allCaps) {
      const up = upperCaseWithMap(source, lang);
      text = up.display;
      map = Array.from(up.clusterSource);
    } else map = graphemeClusters(source);
    // Re-base onto the FULL source: `map` so far is offsets into the filtered `source`.
    map = map.map((filteredOffset) => sourceOffsetAt[filteredOffset] ?? fullSource.length);
    if (ctx?.numberPrefix) {
      const pre = ctx.numberPrefix + (source === '' ? '' : ' ');
      text = pre + text;
      map = [...new Array<number>(graphemeClusters(pre).length).fill(0), ...map];
    }
    if (ctx?.autoContinued) {
      const extra = template.continueds.joiner + template.continueds.cont;
      text += extra;
      for (let i = 0; i < graphemeClusters(extra).length; i++) map.push(fullSource.length);
    }
    if (alternatesMode === 'all') {
      for (const alt of el.alts) {
        const extra = ' // ' + alt.text.plain;
        text += extra;
        for (let i = 0; i < graphemeClusters(extra).length; i++) map.push(fullSource.length);
      }
    }
    return { text, clusterSource: Uint32Array.from(map), sourceLength: fullSource.length };
  };
}

/**
 * Spec 02 §26 `markup`: deletions laid out inline, struck through in writer colour; insertions
 * underlined in writer colour. A pure transform on `runs`, NOT wired into `layoutDocument` — markup
 * needs speed view (deleted text takes real space alongside its replacement), which this pipeline
 * does not implement (page mode, `paginate.ts`'s own header, is the only mode built). Kept here,
 * tested on its own, for whichever future speed-view pass wants it: the logic exists once, not
 * reimplemented the day speed view lands.
 */
export function layoutTrackChangesMarkup(runs: readonly TextRun[], writerColorOf: (by: string) => string): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const del = run.attrs.del as { by?: string } | undefined;
    const ins = run.attrs.ins as { by?: string } | undefined;
    if (!del && !ins) {
      out.push(run);
      continue;
    }
    const by = (del ?? ins)?.by ?? '';
    const attrs: TextRun['attrs'] = { ...run.attrs };
    if (del) {
      attrs.s = true;
      attrs.fc = writerColorOf(by);
    } else if (ins) {
      attrs.u = true;
      attrs.fc = writerColorOf(by);
    }
    out.push({ text: run.text, attrs });
  }
  return out;
}
