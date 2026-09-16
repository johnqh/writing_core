// Compile-level test (spec 02 M2 task 1): builds one literal of each §29/§30/§31.3/
// §31.4/§8.2/§35 output type so a field dropped later fails `bun run typecheck`
// rather than silently disappearing. Assertions are minimal by design — the job is
// the literal's shape, not runtime behaviour (there is none in `./types.js`).
import { describe, expect, it } from 'vitest';
import type { BookmarkId, ElementId, NoteId, PageLockId, RevisionSetId, TagId } from '../ids/ids.js';
import type { NumberLabel } from '../schema/template.js';
import { DIAGNOSTIC_CODES } from '../schema/vocab.js';
import type {
  CaretGeometry, ElementLayoutIndex, GlyphRun, HitResult, LayoutDelta, LayoutDiagnostic, LayoutEngineOptions,
  LayoutLine, LayoutResult, LineKind, LineRef, ModelPosition, PageLayout, PagePoint, PageStartState,
  PositionedText, RevisionFilter, SelectionRect, ViewSpec,
} from './types.js';

const elementId = 'el_00000000000000000000000000' as ElementId;
const noteId = 'note_00000000000000000000000000' as NoteId;
const tagId = 'tag_00000000000000000000000000' as TagId;
const bookmarkId = 'bm_00000000000000000000000000' as BookmarkId;
const revisionSetId = 'rev_00000000000000000000000000' as RevisionSetId;
const pageLockId = 'plk_00000000000000000000000000' as PageLockId;
const numberLabel: NumberLabel = { base: 1, prefix: [], suffix: [] };
const modelPosition: ModelPosition = { elementId, offset: 0 };

const positionedText: PositionedText = { text: '12', x: 0, faceId: 'courier-prime:regular', sizeEmu: 152_400 };

const glyphRun: GlyphRun = {
  x: 0, faceId: 'courier-prime:regular', sizeEmu: 152_400, synthBold: false, synthItalic: false,
  text: 'INT. HOUSE - DAY', bidiLevel: 0,
  clusters: new Uint32Array([0]), clusterAdvances: new Int32Array([91_440]), clusterSource: new Uint32Array([0]),
  width: 91_440,
  style: { color: '#000000', background: null, underline: 'none', strike: false, smallCaps: false, baselineShift: 0 },
  annotations: {
    revisionSetId: null, trackChange: null, noteIds: [noteId], tagIds: [tagId], suggestionIds: [],
    highlight: null, link: { kind: 'bookmark', id: bookmarkId }, nospell: false, lang: null, decoration: 'none',
  },
};

const layoutLine: LayoutLine = {
  kind: 'text' satisfies LineKind, elementId, lineIndexInElement: 0,
  top: 0, pitch: 200_000, baseline: 150_000, x: 0, width: 5_486_400,
  sourceStart: 0, sourceEnd: 17, bidiParagraphLevel: 0, runs: [glyphRun],
  numbers: { left: positionedText }, revisionMark: { ...positionedText, setId: revisionSetId },
  changeBar: { writerColor: '#ff0000' }, invisibles: { marks: [{ glyph: '¶', x: 0 }] },
  column: 0, dualSide: null,
};

const pageStartState: PageStartState = {
  blockIndex: 0, elementId, lineIndexInElement: 0, partial: null,
  pendingTop: [{ kind: 'continuedTop', elementId, text: 'CONTINUED:' }],
  sceneId: elementId, sceneContinuationCount: 0, lockSegment: null, firstLineFingerprint: 0,
};

const pageLayout: PageLayout = {
  index: 0, label: '1', labelModel: numberLabel, lockedPageId: pageLockId, isOverflow: false,
  startState: pageStartState, bodyTop: 685_800, bodyBottom: 9_601_200, lines: [layoutLine],
  header: { lines: [layoutLine] }, footer: null, revisionSetId, pageColor: null,
  sceneIds: [elementId], firstSource: modelPosition, lastSource: modelPosition,
  blockOutlines: [{ x: 0, y: 0, width: 1, height: 1 }],
};

const lineRef: LineRef = { pageIndex: 0, lineIndex: 0, sourceStart: 0, sourceEnd: 17 };

const elementLayoutIndex: ElementLayoutIndex = {
  linesOf: (id) => (id === elementId ? [lineRef] : []),
  elementsOnPage: (pageIndex) => (pageIndex === 0 ? [elementId] : []),
};

const layoutDiagnostic: LayoutDiagnostic = { code: 'glyphMissing', elementId, pageIndex: 0, detail: { cp: 0x1f600 } };

const revisionFilter: RevisionFilter = { kind: 'selected', setIds: [revisionSetId] };

const viewSpec: ViewSpec = {
  mode: 'page', revisionFilter, trackChanges: 'markup', pageColor: 'off', showInvisibles: false,
  alternatesMode: 'active',
};

const layoutResult: LayoutResult = {
  engineVersion: 1, fontRegistryVersion: 'v1', docVersion: 'sv1', view: viewSpec,
  pageSize: { width: 7_772_400, height: 10_058_400 }, titlePages: [], pages: [pageLayout],
  scenes: [{ sceneId: elementId, firstPageIndex: 0, lastPageIndex: 0 }],
  elementIndex: elementLayoutIndex, diagnostics: [layoutDiagnostic],
};

const layoutDelta: LayoutDelta = {
  docVersion: 'sv1', complete: true, pageCount: 1,
  replacedPages: { from: 0, to: 0, pages: [pageLayout] }, removedPageCount: 0,
  decorationsChanged: [0], diagnosticsChanged: false,
};

const pagePoint: PagePoint = { pageIndex: 0, x: 0, y: 0 };
const caretGeometry: CaretGeometry = { pageIndex: 0, x: 0, top: 0, height: 200_000, direction: 'ltr' };
const hitResult: HitResult = { position: modelPosition, affinity: 'downstream', inside: 'text', annotations: glyphRun.annotations };
const selectionRect: SelectionRect = { pageIndex: 0, x: 0, y: 0, width: 91_440, height: 200_000 };

const layoutEngineOptions: LayoutEngineOptions = {
  fonts: {
    version: 'v1',
    resolveFamily: (id) => ({ familyId: id, substituted: false }),
    face: () => {
      throw new Error('not implemented in a type-level test');
    },
    fallbackFor: () => {
      throw new Error('not implemented in a type-level test');
    },
    registerCustom: () => undefined,
  },
  shaper: null,
  segmentation: { ucdVersion: '16.0' },
  budgetMsPerSlice: 8,
};

describe('§29/§30/§31.3/§31.4/§8.2/§35 layout output types', () => {
  it('constructs one literal of each required interface', () => {
    expect(layoutLine.kind).toBe('text');
    expect(layoutResult.pages[0]).toBe(pageLayout);
    expect(layoutDelta.replacedPages.pages[0]).toBe(pageLayout);
    expect(caretGeometry.direction).toBe('ltr');
    expect(hitResult.inside).toBe('text');
    expect(pagePoint.pageIndex).toBe(0);
    expect(selectionRect.width).toBe(91_440);
    expect(layoutEngineOptions.segmentation.ucdVersion).toBe('16.0');
  });

  it('DIAGNOSTIC_CODES is the closed §35 vocabulary of 16 codes', () => {
    expect(DIAGNOSTIC_CODES).toHaveLength(16);
    expect(layoutDiagnostic.code).toBe('glyphMissing');
  });
});
