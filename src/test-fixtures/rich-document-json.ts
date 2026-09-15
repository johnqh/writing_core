import { createSeededIdSource } from '../ids/id-source.js';
import { builtinStyleId, newDualGroupId, newId } from '../ids/ids.js';
import { generatePositions } from '../model/positions.js';
import { sortedRecords } from '../model/ymap.js';
import type { DocumentJSON, ElementJSON } from '../schema/document.js';
import { textJSONFromPlain, type TextJSON, type TextRun } from '../schema/text.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';

/**
 * A rich `DocumentJSON` fixture used to exercise `documentToJSON` / `materializeDocument` /
 * `remapDocumentIds` far beyond the trivial two-element fixture in minimal-document-json.ts.
 * It deliberately touches:
 *  - every FORMAT_MARK and every CHANGE_MARK, and all three anchor mark kinds (t:, n:, s:),
 *    on a single element's text
 *  - both embed kinds (image, revDel)
 *  - dual dialogue (both sides, one shared group)
 *  - alternates, scene versions
 *  - at least two entries in every keyed collection listed in the Task 15 review findings
 *  - portable (`o:<offset>`) positions in production.pageLocks and shots[].range
 *
 * Ids are generated once, from a fixed seed, at module load, so `richDocumentJSON()` is
 * deterministic and callers may compare directly against the exported id constants below
 * instead of re-deriving them or matching on array position.
 */
const seededIds = createSeededIdSource(424_242);

export const RICH_DOC_ID = newId('doc', seededIds);

export const RICH_HEADING_ID = newId('el', seededIds);
export const RICH_ACTION_ID = newId('el', seededIds);
export const RICH_CHAR_LEFT_ID = newId('el', seededIds);
export const RICH_DIALOGUE_LEFT_ID = newId('el', seededIds);
export const RICH_CHAR_RIGHT_ID = newId('el', seededIds);
export const RICH_DIALOGUE_RIGHT_ID = newId('el', seededIds);
const SV1_CONTENT_ID = newId('el', seededIds);
const SV2_CONTENT_ID = newId('el', seededIds);
const BIN1_CONTENT_ID = newId('el', seededIds);
const BIN2_CONTENT_ID = newId('el', seededIds);

export const RICH_FOLDER1_ID = newId('fld', seededIds);
export const RICH_FOLDER2_ID = newId('fld', seededIds);
export const RICH_CHARACTER_ENTITY_ID = newId('ent', seededIds);
export const RICH_LOCATION_ENTITY_ID = newId('ent', seededIds);
export const RICH_CAT1_ID = newId('cat', seededIds);
export const RICH_CAT2_ID = newId('cat', seededIds);
export const RICH_TAG1_ID = newId('tag', seededIds);
export const RICH_TAG2_ID = newId('tag', seededIds);
export const RICH_NOTE1_ID = newId('note', seededIds);
export const RICH_NOTE2_ID = newId('note', seededIds);
const REPLY1_ID = newId('rep', seededIds);
export const RICH_NTP1_ID = newId('ntp', seededIds);
export const RICH_NTP2_ID = newId('ntp', seededIds);
export const RICH_REV1_ID = newId('rev', seededIds);
export const RICH_REV2_ID = newId('rev', seededIds);
const CHG1_ID = newId('chg', seededIds);
export const RICH_ALT1_ID = newId('alt', seededIds);
export const RICH_ALT2_ID = newId('alt', seededIds);
export const RICH_SV1_ID = newId('sv', seededIds);
export const RICH_SV2_ID = newId('sv', seededIds);
export const RICH_BEAT1_ID = newId('beat', seededIds);
export const RICH_BEAT2_ID = newId('beat', seededIds);
export const RICH_LNK1_ID = newId('lnk', seededIds);
export const RICH_LNK2_ID = newId('lnk', seededIds);
export const RICH_COL1_ID = newId('col', seededIds);
export const RICH_COL2_ID = newId('col', seededIds);
export const RICH_STL1_ID = newId('stl', seededIds);
export const RICH_STL2_ID = newId('stl', seededIds);
export const RICH_LANE1_ID = newId('lane', seededIds);
export const RICH_LANE2_ID = newId('lane', seededIds);
export const RICH_BIN1_ID = newId('bin', seededIds);
export const RICH_BIN2_ID = newId('bin', seededIds);
export const RICH_SHOT1_ID = newId('shot', seededIds);
export const RICH_SHOT2_ID = newId('shot', seededIds);
export const RICH_BM1_ID = newId('bm', seededIds);
export const RICH_BM2_ID = newId('bm', seededIds);
export const RICH_PLK1_ID = newId('plk', seededIds);
export const RICH_PLK2_ID = newId('plk', seededIds);
const ASSET1_ID = newId('asset', seededIds);
const SUG1_ID = newId('sug', seededIds);

/** Not an addressable record (spec 01 §5.3.4): shared verbatim by both sides of the pair. */
export const RICH_DUAL_GROUP = newDualGroupId(seededIds);

const META = { createdBy: 'uid-1', createdAt: 1, editedBy: 'uid-1', editedAt: 1 };

/**
 * The action element's plain text (below), exported so tests can locate that element after an
 * id remap by stable content instead of by id or array position. Guarded at runtime (below)
 * against drifting out of sync with the run text it is built from.
 */
export const RICH_ACTION_PLAIN = 'MAYA notices the exit.!';

function nestedElement(id: typeof RICH_ACTION_ID, plain: string): ElementJSON {
  return { id, style: builtinStyleId('action'), text: textJSONFromPlain(plain), meta: META };
}

/** Builds the action element's text so every FORMAT_MARK, every CHANGE_MARK and all three anchor mark kinds appear. */
function richActionText(): TextJSON {
  const runs: TextRun[] = [
    { text: 'MAYA', attrs: { b: true, i: true, u: true, s: true } },
    { text: ' notices', attrs: { sc: true, va: 'super', fc: '#FF0000', hl: '#FFFF00' } },
    { text: ' the exit', attrs: { ff: 'courier-screenplay', fs: 12, ln: true, lang: 'en', nospell: true } },
    { text: '.', attrs: { rev: RICH_REV1_ID, ins: true, del: false, fmt: true } },
    { text: '!', attrs: { [`t:${RICH_TAG1_ID}`]: true, [`n:${RICH_NOTE1_ID}`]: true, [`s:${SUG1_ID}`]: true } },
  ];
  const plain = runs.map((r) => r.text).join('');
  if (plain !== RICH_ACTION_PLAIN) throw new Error('richActionText: plain text drifted from RICH_ACTION_PLAIN');
  return {
    plain,
    runs,
    embeds: [
      { at: plain.length, embed: { type: 'image', assetId: ASSET1_ID, widthEmu: 914_400, heightEmu: 685_800, alt: 'exit sign' } },
      { at: plain.length + 1, embed: { type: 'revDel', rev: RICH_REV1_ID, by: 'uid-1', at: 2 } },
    ],
  };
}

/** Rebuilds a fresh (mutable-safe) rich `DocumentJSON` every call; ids are stable across calls (fixed seed above). */
export function richDocumentJSON(): DocumentJSON {
  const { smartType: _st, revisionColors: _rc, tagCategories: _tc, noteTypes: _nt, traitDefs: _td, macros: _m, titlePage: _tp, body: _b, ...embedded } = screenplayStandard;

  const [altPos1, altPos2] = generatePositions(2, null, null, null) as [string, string];

  const heading: ElementJSON = {
    id: RICH_HEADING_ID,
    style: builtinStyleId('scene_heading'),
    text: textJSONFromPlain('INT. DINER - NIGHT'),
    meta: META,
    scene: {
      synopsis: textJSONFromPlain('Maya notices something at the exit.'),
      color: '#00FF00',
      title: 'Diner Scene',
      locationId: RICH_LOCATION_ENTITY_ID,
      storyDay: 'Day 1',
      arcBeats: {
        [RICH_CHARACTER_ENTITY_ID]: textJSONFromPlain('Maya arc beat.'),
        [RICH_LOCATION_ENTITY_ID]: textJSONFromPlain('Diner arc beat.'),
      },
      storylineIds: [RICH_STL1_ID, RICH_STL2_ID],
      omit: null,
      versions: [
        { id: RICH_SV1_ID, name: 'Draft 1', createdBy: 'uid-1', createdAt: 1, content: [nestedElement(SV1_CONTENT_ID, 'Alt scene content 1.')] },
        { id: RICH_SV2_ID, name: 'Draft 2', createdBy: 'uid-1', createdAt: 2, content: [nestedElement(SV2_CONTENT_ID, 'Alt scene content 2.')] },
      ],
      estimatedSeconds: 12,
    },
  };

  const action: ElementJSON = {
    id: RICH_ACTION_ID,
    style: builtinStyleId('action'),
    text: richActionText(),
    ov: { align: 'left', keepWithNext: true },
    folderId: RICH_FOLDER1_ID,
    tc: { kind: 'insert', changeId: CHG1_ID, by: 'uid-1', at: 1 },
    alts: [
      { id: RICH_ALT1_ID, pos: altPos1, text: textJSONFromPlain('Alt line one.'), style: builtinStyleId('action'), label: 'Alt A', createdBy: 'uid-1', createdAt: 1 },
      { id: RICH_ALT2_ID, pos: altPos2, text: textJSONFromPlain('Alt line two.'), style: builtinStyleId('action'), label: 'Alt B', createdBy: 'uid-1', createdAt: 2 },
    ],
    meta: META,
  };

  const charLeft: ElementJSON = {
    id: RICH_CHAR_LEFT_ID, style: builtinStyleId('character'), text: textJSONFromPlain('MAYA'),
    dual: { group: RICH_DUAL_GROUP, side: 'left' }, meta: META,
  };
  const dialogueLeft: ElementJSON = {
    id: RICH_DIALOGUE_LEFT_ID, style: builtinStyleId('dialogue'), text: textJSONFromPlain('Where were you?'),
    dual: { group: RICH_DUAL_GROUP, side: 'left' }, meta: META,
  };
  const charRight: ElementJSON = {
    id: RICH_CHAR_RIGHT_ID, style: builtinStyleId('character'), text: textJSONFromPlain('SAM'),
    dual: { group: RICH_DUAL_GROUP, side: 'right' }, shotId: RICH_SHOT1_ID, meta: META,
  };
  const dialogueRight: ElementJSON = {
    id: RICH_DIALOGUE_RIGHT_ID, style: builtinStyleId('dialogue'), text: textJSONFromPlain('Getting coffee.'),
    dual: { group: RICH_DUAL_GROUP, side: 'right' }, meta: META,
  };

  const [folderPos1, folderPos2] = generatePositions(2, null, null, null) as [string, string];
  const [catPos1, catPos2] = generatePositions(2, null, null, null) as [string, string];
  const [ntpPos1, ntpPos2] = generatePositions(2, null, null, null) as [string, string];
  const [revPos1, revPos2] = generatePositions(2, null, null, null) as [string, string];
  const [colPos1, colPos2] = generatePositions(2, null, null, null) as [string, string];
  const [stlPos1, stlPos2] = generatePositions(2, null, null, null) as [string, string];
  const [lanePos1, lanePos2] = generatePositions(2, null, null, null) as [string, string];
  const [binPos1, binPos2] = generatePositions(2, null, null, null) as [string, string];
  const [shotPos1, shotPos2] = generatePositions(2, null, null, null) as [string, string];
  const [stPos1, stPos2] = generatePositions(2, null, null, null) as [string, string];

  return {
    meta: {
      schemaVersion: 1, docId: RICH_DOC_ID, createdAt: 1, createdBy: 'uid-1', kind: 'script', language: 'en', direction: 'ltr',
      templateOrigin: { templateId: screenplayStandard.id, key: 'screenplay-standard', version: 1, hash: 'v1:0' },
      forkedFrom: null, migrations: {},
    },
    template: { ...embedded, revision: 0 },
    elements: [heading, action, charLeft, dialogueLeft, charRight, dialogueRight],
    titlePage: { elements: [], fields: {}, computed: {} },
    folders: sortedRecords([
      { id: RICH_FOLDER1_ID, kind: 'act', title: 'Act One', color: null, synopsis: textJSONFromPlain('Act one synopsis.'), parentId: null, pos: folderPos1, collapsed: false, pageBudget: null },
      { id: RICH_FOLDER2_ID, kind: 'sequence', title: 'Seq A', color: '#112233', synopsis: textJSONFromPlain('Sequence synopsis.'), parentId: RICH_FOLDER1_ID, pos: folderPos2, collapsed: true, pageBudget: 5 },
    ]),
    entities: sortedRecords([
      {
        id: RICH_CHARACTER_ENTITY_ID, kind: 'character', name: 'MAYA', nameKey: 'maya', aliases: ['May'], color: null,
        description: textJSONFromPlain('Waitress at the diner.'), fields: { role: 'lead', bio: textJSONFromPlain('Grew up nearby.') },
        attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'uid-1', createdAt: 1, origin: 'manual',
      },
      {
        id: RICH_LOCATION_ENTITY_ID, kind: 'location', name: 'DINER', nameKey: 'diner', aliases: [], color: null,
        description: textJSONFromPlain('A roadside diner.'), fields: { setting: 'int', setDescription: textJSONFromPlain('Booths and a counter.') },
        attributes: {}, categoryId: null, retain: false, mergedInto: null, createdBy: 'uid-1', createdAt: 1, origin: 'manual',
      },
    ]),
    traitDefs: [],
    tagCategories: sortedRecords([
      { id: RICH_CAT1_ID, key: 'cast', name: 'Cast', color: '#0000FF', entityKind: 'character', textStyle: { bold: true, underline: false, highlight: false }, visible: true, pos: catPos1, fdxGuid: null, osfUuid: null },
      { id: RICH_CAT2_ID, key: 'locations', name: 'Locations', color: '#00FF00', entityKind: 'location', textStyle: { bold: false, underline: true, highlight: false }, visible: true, pos: catPos2, fdxGuid: null, osfUuid: null },
    ]),
    tags: sortedRecords([
      { id: RICH_TAG1_ID, categoryId: RICH_CAT1_ID, entityId: RICH_CHARACTER_ENTITY_ID, elementId: RICH_ACTION_ID, createdBy: 'uid-1', createdAt: 1 },
      { id: RICH_TAG2_ID, categoryId: RICH_CAT2_ID, entityId: RICH_LOCATION_ENTITY_ID, elementId: RICH_HEADING_ID, createdBy: 'uid-1', createdAt: 2 },
    ]),
    notes: sortedRecords([
      {
        id: RICH_NOTE1_ID, anchor: { kind: 'element', elementId: RICH_ACTION_ID }, typeId: RICH_NTP1_ID, title: 'Continuity note',
        body: textJSONFromPlain('Check the exit sign.'), color: null, authorUid: 'uid-1', createdAt: 1, updatedAt: 1, resolved: null,
        includeInPdf: false, mentions: ['uid-1'],
        replies: [{ id: REPLY1_ID, authorUid: 'uid-2', body: textJSONFromPlain('Noted.'), createdAt: 2, editedAt: null, mentions: ['uid-1'] }],
      },
      {
        id: RICH_NOTE2_ID, anchor: { kind: 'beat', beatId: RICH_BEAT1_ID }, typeId: RICH_NTP2_ID, title: 'Story note',
        body: textJSONFromPlain('Strengthen the turn.'), color: '#123456', authorUid: 'uid-1', createdAt: 3, updatedAt: 3,
        resolved: { by: 'uid-1', at: 4 }, includeInPdf: true, mentions: [], replies: [],
      },
    ]),
    noteTypes: sortedRecords([
      { id: RICH_NTP1_ID, key: 'general', name: 'General', color: '#FFD700', marker: '', pos: ntpPos1 },
      { id: RICH_NTP2_ID, key: 'continuity', name: 'Continuity', color: '#FF00FF', marker: '!', pos: ntpPos2 },
    ]),
    revisions: {
      sets: sortedRecords([
        { id: RICH_REV1_ID, pos: revPos1, name: 'Blue Revision', colorKey: 'blue', textColor: '#0000FF', pageColor: '#C6EDFE', mark: '*', textStyle: { underline: 'none', bold: false, strike: false }, fullDraft: false, date: null, createdBy: 'uid-1', createdAt: 1 },
        { id: RICH_REV2_ID, pos: revPos2, name: 'Pink Revision', colorKey: 'pink', textColor: '#FF00FF', pageColor: '#FBD3E9', mark: '*', textStyle: { underline: 'single', bold: true, strike: false }, fullDraft: true, date: 2, createdBy: 'uid-1', createdAt: 2 },
      ]),
      activeSetId: RICH_REV1_ID, headerSetId: RICH_REV2_ID, mode: false, display: 'active',
      selectedSetIds: [RICH_REV1_ID, RICH_REV2_ID], showPageColor: true, colorRevisedText: true, markColumn: 7_086_600,
    },
    trackChanges: { enabled: true, view: 'markup' },
    writers: [],
    production: {
      scenesLocked: true, scenesLockedAt: 5, lockedStyles: [builtinStyleId('action')],
      pagesLocked: false, pagesLockedAt: null,
      pageLocks: sortedRecords([
        { id: RICH_PLK1_ID, label: { base: 1, prefix: [], suffix: [] }, level: 0, start: 'o:5', startElementId: RICH_HEADING_ID, startMidElement: false, revisionSetId: RICH_REV1_ID, lockedAt: 1, lockedBy: 'uid-1' },
        { id: RICH_PLK2_ID, label: { base: 2, prefix: [], suffix: [] }, level: 0, start: 'o:0', startElementId: RICH_HEADING_ID, startMidElement: true, revisionSetId: null, lockedAt: 2, lockedBy: 'uid-1' },
      ]),
    },
    beats: sortedRecords([
      {
        id: RICH_BEAT1_ID, title: textJSONFromPlain('Setup'), body: textJSONFromPlain('Maya arrives.'), color: null, imageAssetId: null,
        board: null, boneyard: false, plot: { columnId: RICH_COL1_ID, pos: colPos1 }, storylineIds: [RICH_STL1_ID],
        arc: { [RICH_STL1_ID]: 2 }, lane: { laneId: RICH_LANE1_ID, pos: lanePos1, pageBudget: null }, anchor: { elementId: RICH_HEADING_ID },
        createdBy: 'uid-1', createdAt: 1,
      },
      {
        id: RICH_BEAT2_ID, title: textJSONFromPlain('Turn'), body: textJSONFromPlain('Sam interrupts.'), color: '#654321', imageAssetId: null,
        board: { x: 0, y: 0, w: 10, h: 10, z: 1 }, boneyard: true, plot: { columnId: RICH_COL2_ID, pos: colPos2 }, storylineIds: [RICH_STL2_ID],
        arc: { [RICH_STL2_ID]: -1 }, lane: { laneId: RICH_LANE2_ID, pos: lanePos2, pageBudget: 5 }, anchor: { elementId: RICH_ACTION_ID },
        createdBy: 'uid-1', createdAt: 2,
      },
    ]),
    beatLinks: sortedRecords([
      { id: RICH_LNK1_ID, from: RICH_BEAT1_ID, to: RICH_BEAT2_ID, label: 'leads to', style: 'arrow', color: null },
      { id: RICH_LNK2_ID, from: RICH_BEAT2_ID, to: RICH_BEAT1_ID, label: 'echoes', style: 'dashed', color: '#ABCDEF' },
    ]),
    plotColumns: sortedRecords([
      { id: RICH_COL1_ID, title: 'Plot A', pos: colPos1, folderId: null },
      { id: RICH_COL2_ID, title: 'Plot B', pos: colPos2, folderId: RICH_FOLDER1_ID },
    ]),
    storylines: sortedRecords([
      { id: RICH_STL1_ID, name: 'A-Story', color: '#111111', pos: stlPos1 },
      { id: RICH_STL2_ID, name: 'B-Story', color: '#222222', pos: stlPos2 },
    ]),
    lanes: sortedRecords([
      { id: RICH_LANE1_ID, label: 'Outline Lane', pos: lanePos1, level: 0, color: null, kind: 'outline' },
      { id: RICH_LANE2_ID, label: 'Custom Lane', pos: lanePos2, level: 1, color: '#ABCDEF', kind: 'custom' },
    ]),
    bin: sortedRecords([
      { id: RICH_BIN1_ID, pos: binPos1, title: 'Cut Scene 1', createdBy: 'uid-1', createdAt: 1, source: { elementIds: [RICH_ACTION_ID], sceneId: RICH_HEADING_ID }, content: [nestedElement(BIN1_CONTENT_ID, 'Cut content 1.')] },
      { id: RICH_BIN2_ID, pos: binPos2, title: 'Cut Scene 2', createdBy: 'uid-1', createdAt: 2, source: { elementIds: [RICH_HEADING_ID], sceneId: null }, content: [nestedElement(BIN2_CONTENT_ID, 'Cut content 2.')] },
    ]),
    shots: sortedRecords([
      {
        id: RICH_SHOT1_ID, sceneId: RICH_HEADING_ID, pos: shotPos1, elementId: RICH_CHAR_RIGHT_ID,
        range: { startElementId: RICH_HEADING_ID, start: 'o:0', endElementId: RICH_ACTION_ID, end: 'o:3' },
        label: 'Wide', description: textJSONFromPlain('Wide establishing shot.'), camera: {}, attributes: {}, createdBy: 'uid-1', createdAt: 1,
      },
      {
        id: RICH_SHOT2_ID, sceneId: RICH_HEADING_ID, pos: shotPos2, elementId: null, range: null,
        label: 'Close', description: textJSONFromPlain('Close on Maya.'), camera: {}, attributes: {}, createdBy: 'uid-1', createdAt: 2,
      },
    ]),
    bookmarks: sortedRecords([
      { id: RICH_BM1_ID, name: 'Top', elementId: RICH_HEADING_ID, at: 'o:0' },
      { id: RICH_BM2_ID, name: 'Mid', elementId: RICH_ACTION_ID, at: 'o:4' },
    ]),
    macros: [],
    smartType: {
      sceneIntros: [
        { key: 'int', text: 'INT.', pos: stPos1, origin: 'seed', count: 0 },
        { key: 'ext', text: 'EXT.', pos: stPos2, origin: 'seed', count: 0 },
      ],
      times: [
        { key: 'day', text: 'DAY', pos: stPos1, origin: 'seed', count: 0 },
        { key: 'night', text: 'NIGHT', pos: stPos2, origin: 'seed', count: 0 },
      ],
      extensions: [
        { key: 'v.o.', text: '(V.O.)', pos: stPos1, origin: 'seed', count: 1 },
        { key: 'o.s.', text: '(O.S.)', pos: stPos2, origin: 'seed', count: 2 },
      ],
      transitions: [
        { key: 'cut to:', text: 'CUT TO:', pos: stPos1, origin: 'seed', count: 0 },
        { key: 'fade out.', text: 'FADE OUT.', pos: stPos2, origin: 'seed', count: 0 },
      ],
      soundCues: [
        { key: 'sfx door', text: 'SFX: DOOR', pos: stPos1, origin: 'harvested', count: 3 },
        { key: 'sfx phone', text: 'SFX: PHONE', pos: stPos2, origin: 'manual', count: 1 },
      ],
      introSeparator: ' ', timeSeparator: ' - ', sortMode: 'alphabetical', dismissed: ['fade in.'],
    },
    spelling: { language: 'en', words: ['maya'], ignored: ['diner'] },
    tableRead: {
      narrator: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 }, narratorStyleIds: [builtinStyleId('character')],
      dialogueOnly: false, speakCharacterNames: true, defaultVoice: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 },
    },
    settings: {
      enterOnBlank: 'template', smartQuotes: true, autoCapitalizeSentences: true, fixDoubleCapitals: true, autoParentheses: true,
      smartTypeEnabled: true, guessNextCharacter: true, macrosEnabled: true, highlightCharacters: false, targetPages: null,
      targetEpisodeSeconds: null, secondsPerPage: 60, dualDialogueEditStacked: false, outlineHidden: false, showRevisionsInPrint: true,
      watermark: null, readingDirection: 'ltr',
    },
    importMeta: null,
    aiSuggestions: [],
  };
}
