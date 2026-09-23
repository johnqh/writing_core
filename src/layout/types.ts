/**
 * Spec 02 layout output types — declarations only, no runtime behaviour (M2 task 1).
 *
 * Transcribed field-for-field from spec 02 §29.1 (`LayoutResult`, `PageLayout`,
 * `LayoutLine`), §29.2 (`LineKind`), §29.3 (`GlyphRun`), §29.5 (`ElementLayoutIndex`,
 * `LineRef`), §30 (`PositionedText`, `SelectionRect`, `CaretGeometry`, `HitResult`,
 * `PagePoint`), §31.3 (`PageStartState`), §31.4 (`LayoutDelta`), §35
 * (`LayoutDiagnostic`, `DIAGNOSTIC_CODES`) and §8.2 (`ViewSpec`, `RevisionFilter`,
 * `LayoutEngineOptions`, plus the `FontRegistry`/`FontFaceMetrics`/`Shaper` shapes
 * §8.2's `LayoutEngineOptions` needs, given in full at §4.3/§5.2).
 *
 * `GlyphRun.runs` is used by `ParagraphLayout` from a later task onward, and later
 * tasks annotate lines — this is why the type lives here rather than in whichever
 * task first produces a populated instance (registry note on task 29/1 boundary).
 *
 * A few field types the required interfaces reference are not themselves given a
 * field list anywhere in spec 02 and are owned by later, more specific tasks
 * (font metrics, §6 segmentation, §13/§14 paginator state, §20 headers/footers,
 * §27 scene running time, §34.7 invisibles, spec 04 print options). Each such type
 * is marked "placeholder" below: a minimal, low-commitment shape that lets the
 * required interfaces type-check today without presupposing a later task's design.
 */

import type { ElementId, BookmarkId, NoteId, PageLockId, RevisionSetId, TagId } from '../ids/ids.js';
import type { FontFamilyId } from '../schema/primitives.js';
import type { NumberLabel } from '../schema/template.js';
import type { Column, DiagnosticCode, TextDirection, TrackChangeView } from '../schema/vocab.js';
import type { LocaleDataPort } from '../template/locale-data.js';

export { DIAGNOSTIC_CODES } from '../schema/vocab.js';
export type { DiagnosticCode } from '../schema/vocab.js';

// ─── §8.2 Public API (data shapes only; `LayoutEngine` itself is a later task) ──

/** Spec 02 §8.2: `ModelPosition = { elementId: ElementId; offset: number }` (UTF-16 into Y.Text). */
export interface ModelPosition {
  elementId: ElementId;
  offset: number;
}

/**
 * Spec 02 §8.2's `selectionRects(range: ModelRange)` names this type but never gives its field list
 * (M2 task 31): the minimal shape every other spec 02 range already uses — an anchor and a head, not
 * necessarily in document order (the engine, which holds the model, orders them before calling
 * `mapping.ts`'s `selectionRects`, which has no ordering of its own to check them against).
 */
export interface ModelRange {
  anchor: ModelPosition;
  head: ModelPosition;
}

/** Placeholder: §4 (font metrics) owns the branded id; a bare string here, e.g. `'courier-prime:regular'`. */
export type FaceId = string;

/** Spec 02 §4.3, given in full: per-face metrics the paginator measures against. */
export interface FontFaceMetrics {
  readonly faceId: FaceId;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  readonly strikeoutPosition: number;
  readonly strikeoutThickness: number;
  readonly italicAngle: number;
  readonly monospace: boolean;
  readonly requiresShaping: boolean;
  covers(cp: number): boolean;
  advance(cp: number): number;
  kern(left: number, right: number): number;
}

/** Spec 02 §4.3, given in full. */
export interface FontRegistry {
  readonly version: string;
  resolveFamily(id: FontFamilyId): { familyId: FontFamilyId; substituted: boolean };
  face(familyId: FontFamilyId, bold: boolean, italic: boolean): { face: FontFaceMetrics; synthBold: boolean; synthItalic: boolean };
  fallbackFor(primary: FontFamilyId, cp: number, bold: boolean, italic: boolean, lang: string): FontFaceMetrics;
  registerCustom(familyId: FontFamilyId, faces: FontFaceMetrics[]): void;
}

/**
 * Spec 02 §5.2, given in full (amended to add `prepareFace`: `shape` is synchronous, so
 * a host whose font source is asynchronous — a service-worker cache on the web, a
 * bundle read on a phone — must resolve a face's bytes ahead of time. `prepareFace` is
 * the sanctioned way to do that; `shape` on a face that was never prepared throws
 * rather than substituting a face or returning wrong metrics.
 */
export interface Shaper {
  readonly version: string;
  shape(input: { faceId: FaceId; text: string; script: string; direction: 'ltr' | 'rtl'; language: string; sizeEmu: number }): {
    glyphIds: Uint16Array;
    clusters: Uint32Array;
    advancesEmu: Int32Array;
    offsetsEmu: Int32Array;
  };
  /** Resolve the face's bytes before shaping with it (spec 02 §5.2). */
  prepareFace(faceId: FaceId): Promise<void>;
}

/** Placeholder: §6 owns the full shape ("UCD tables + lazily loaded dictionaries"). */
export interface SegmentationData {
  readonly ucdVersion: string;
}

export interface LayoutEngineOptions {
  fonts: FontRegistry;
  shaper: Shaper | null;
  segmentation: SegmentationData;
  budgetMsPerSlice?: number;
  /** The `TokenString` locale port (§20.2, M2 task 11); defaults to `defaultLocaleData`. */
  locale?: LocaleDataPort;
}

/** Spec 02 §25.3, given in full. */
export type RevisionFilter =
  | { kind: 'none' }
  | { kind: 'active' }
  | { kind: 'collated' }
  | { kind: 'all' }
  | { kind: 'sinceLastFull' }
  | { kind: 'selected'; setIds: RevisionSetId[] };

/** Placeholder: spec 04 (print) owns the real shape; not part of M2. Empty until then. */
export type PrintSpec = Record<string, never>;

export interface ViewSpec {
  mode: 'page' | 'speed' | 'print';
  revisionFilter: RevisionFilter;
  trackChanges: TrackChangeView;
  pageColor: 'off' | 'margin' | 'page';
  showInvisibles: boolean;
  alternatesMode: 'active' | 'all';
  print?: PrintSpec;
}

// ─── §29.2 Line kinds ────────────────────────────────────────────────────────

export type LineKind =
  | 'text' | 'blank' | 'more' | 'contdCue' | 'continuedTop' | 'continuedBottom'
  | 'omitted' | 'pageHeadingContd' | 'image';

// ─── §29.3 Glyph runs ────────────────────────────────────────────────────────

export interface GlyphRun {
  x: number;
  faceId: FaceId;
  sizeEmu: number;
  synthBold: boolean;
  synthItalic: boolean;
  text: string;
  bidiLevel: number;
  clusters: Uint32Array;
  clusterAdvances: Int32Array;
  clusterSource: Uint32Array;
  glyphs?: { ids: Uint16Array; clusterOfGlyph: Uint32Array; advances: Int32Array; offsets: Int32Array };
  width: number;
  style: {
    color: string;
    background: string | null;
    underline: 'none' | 'regular' | 'dotted' | 'word' | 'double';
    strike: boolean;
    smallCaps: boolean;
    baselineShift: number;
  };
  annotations: {
    revisionSetId: RevisionSetId | null;
    trackChange: { kind: 'ins' | 'del' | 'fmt'; changeId: string; by: string } | null;
    noteIds: NoteId[];
    tagIds: TagId[];
    suggestionIds: string[];
    highlight: string | null;
    link: { kind: 'url'; href: string } | { kind: 'bookmark'; id: BookmarkId } | null;
    nospell: boolean;
    lang: string | null;
    decoration: 'none' | 'autoContd' | 'inlineNumber' | 'alternates' | 'generatedHeading';
  };
}

// ─── §21.4 / §25.5 positioned text (referenced by name, no field list given) ───

/**
 * A short run of non-editable text drawn at a fixed point, baseline-aligned with
 * its host line (§21.4 margin/inline numbers, §25.5 revision marks in the
 * margin). Spec 02 names this type at both call sites but never gives its field
 * list; this is the minimal shape both descriptions agree on: the text, its x
 * position, and the face/size to draw it in (the line supplies the baseline).
 */
export interface PositionedText {
  text: string;
  x: number;
  faceId: FaceId;
  sizeEmu: number;
}

// ─── §34.7 invisibles (placeholder: full shape owned by that task) ─────────────

export interface Invisibles {
  marks: readonly { glyph: '·' | '→' | '¶' | '↵'; x: number }[];
}

// ─── §20 headers/footers (placeholder: full shape owned by that task) ──────────

/** Headers/footers render as lines drawn in the page margins, like a page's body. */
export interface HeaderFooterLayout {
  lines: readonly LayoutLine[];
}

// ─── Geometry ───────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── §27 scene running time (placeholder: eighths/seconds owned by that task) ──

export interface SceneLayoutInfo {
  sceneId: ElementId;
  firstPageIndex: number;
  lastPageIndex: number;
}

// ─── §29.1 Result ────────────────────────────────────────────────────────────

export interface LayoutLine {
  kind: LineKind;
  elementId: ElementId | null;
  lineIndexInElement: number;
  top: number;
  pitch: number;
  baseline: number;
  x: number;
  width: number;
  sourceStart: number;
  sourceEnd: number;
  bidiParagraphLevel: 0 | 1;
  runs: GlyphRun[];
  numbers: { left?: PositionedText; right?: PositionedText };
  revisionMark: (PositionedText & { setId: RevisionSetId }) | null;
  changeBar: { writerColor: string } | null;
  invisibles?: Invisibles;
  column: Column;
  dualSide: 'left' | 'right' | null;
}

export interface PageLayout {
  index: number;
  label: string;
  labelModel: NumberLabel | { range: [NumberLabel, NumberLabel] };
  lockedPageId: PageLockId | null;
  isOverflow: boolean;
  startState: PageStartState;
  bodyTop: number;
  bodyBottom: number;
  lines: LayoutLine[];
  header: HeaderFooterLayout | null;
  footer: HeaderFooterLayout | null;
  revisionSetId: RevisionSetId | null;
  pageColor: string | null;
  sceneIds: ElementId[];
  firstSource: ModelPosition;
  lastSource: ModelPosition;
  blockOutlines: Rect[];
}

export interface LayoutResult {
  engineVersion: number;
  fontRegistryVersion: string;
  docVersion: string;
  view: ViewSpec;
  pageSize: { width: number; height: number };
  titlePages: PageLayout[];
  pages: PageLayout[];
  scenes: SceneLayoutInfo[];
  elementIndex: ElementLayoutIndex;
  diagnostics: LayoutDiagnostic[];
}

// ─── §29.5 Element index ─────────────────────────────────────────────────────

/** elementId → ordered list of (pageIndex, lineIndex in page.lines, sourceStart, sourceEnd). */
export interface LineRef {
  pageIndex: number;
  lineIndex: number;
  sourceStart: number;
  sourceEnd: number;
}

/** Backed by arrays sorted by document order for O(log n) lookup. */
export interface ElementLayoutIndex {
  linesOf(elementId: ElementId): readonly LineRef[];
  elementsOnPage(pageIndex: number): readonly ElementId[];
}

// ─── §30 Source ↔ layout mapping ─────────────────────────────────────────────

/** §30.2 step 1: page-relative hit-test input, EMU. */
export interface PagePoint {
  pageIndex: number;
  x: number;
  y: number;
}

/** §30.1 step 4. */
export interface CaretGeometry {
  pageIndex: number;
  x: number;
  top: number;
  height: number;
  direction: TextDirection;
}

/** §30.2 step 6. `annotations` mirrors the hit run's `GlyphRun.annotations`, absent for non-text hits. */
export interface HitResult {
  position: ModelPosition;
  affinity: 'upstream' | 'downstream';
  inside: 'text' | 'margin' | 'number' | 'revisionMark' | 'decoration';
  annotations: GlyphRun['annotations'] | null;
}

/** §30.3. */
export interface SelectionRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── §31.3 Page convergence ──────────────────────────────────────────────────

/** Placeholder: §13/§14 own the full shape. A decoration queued to draw at the top of the next page. */
export interface TopDecoration {
  kind: 'continuedTop' | 'contdCue' | 'pageHeadingContd';
  elementId: ElementId;
  text: string;
}

export interface PageStartState {
  blockIndex: number;
  elementId: ElementId;
  lineIndexInElement: number;
  partial: null | { kind: 'dialogue' | 'dual' | 'row' | 'paragraph'; cursor: number[] };
  pendingTop: TopDecoration[];
  sceneId: ElementId | null;
  sceneContinuationCount: number;
  lockSegment: number | null;
  firstLineFingerprint: number;
}

// ─── §31.4 Visible-first scheduling ──────────────────────────────────────────

export interface LayoutDelta {
  docVersion: string;
  complete: boolean;
  pageCount: number;
  replacedPages: { from: number; to: number; pages: PageLayout[] };
  removedPageCount: number;
  decorationsChanged: number[];
  diagnosticsChanged: boolean;
}

// ─── §35 Diagnostics ─────────────────────────────────────────────────────────

export interface LayoutDiagnostic {
  code: DiagnosticCode;
  elementId: ElementId | null;
  pageIndex: number | null;
  detail: Record<string, string | number>;
}
