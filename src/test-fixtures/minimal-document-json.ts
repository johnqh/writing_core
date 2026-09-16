import type { DocId, ElementId, EntityId } from '../ids/ids.js';
import type { DocumentJSON } from '../schema/document.js';
import { emptyTextJSON, textJSONFromPlain } from '../schema/text.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';

export const FIXTURE_DOC_ID = 'doc_01ARYZ6S410000000000000000' as DocId;
export const FIXTURE_HEADING_ID = 'el_01ARYZ6S410000000000000001' as ElementId;
export const FIXTURE_ACTION_ID = 'el_01ARYZ6S410000000000000002' as ElementId;
export const FIXTURE_ENTITY_ID = 'ent_01ARYZ6S410000000000000003' as EntityId;

const meta = { createdBy: 'uid-1', createdAt: 1, editedBy: 'uid-1', editedAt: 1 };

export function minimalDocumentJSON(): DocumentJSON {
  const {
    smartType: _st, revisionColors: _rc, tagCategories: _tc, noteTypes: _nt, traitDefs: _td, macros: _m,
    titlePage: _tp, body: _b, ...embedded
  } = screenplayStandard;
  return {
    meta: {
      schemaVersion: 1, docId: FIXTURE_DOC_ID, createdAt: 1, createdBy: 'uid-1', kind: 'script', language: 'en', direction: 'ltr',
      templateOrigin: { templateId: screenplayStandard.id, key: 'screenplay-standard', version: 1, hash: 'v1:0' },
      forkedFrom: null, migrations: {},
    },
    template: { ...embedded, revision: 0 },
    elements: [
      {
        id: FIXTURE_HEADING_ID, style: 'st_scene_heading' as never, text: textJSONFromPlain('INT. DINER - NIGHT'), meta,
        scene: { synopsis: emptyTextJSON(), color: null, title: '', locationId: null, storyDay: '', arcBeats: {}, storylineIds: [], omit: null, versions: [], estimatedSeconds: null },
      },
      {
        id: FIXTURE_ACTION_ID, style: 'st_action' as never, meta,
        text: { plain: 'MAYA waits.', runs: [{ text: 'MAYA', attrs: { b: true } }, { text: ' waits.', attrs: {} }], embeds: [] },
      },
    ],
    titlePage: { elements: [], fields: {}, computed: {} },
    folders: [],
    entities: [{
      id: FIXTURE_ENTITY_ID, kind: 'character', name: 'MAYA', nameKey: 'maya', aliases: [], color: null,
      description: emptyTextJSON(), fields: { role: 'lead' }, attributes: {}, categoryId: null, retain: false,
      mergedInto: null, createdBy: 'uid-1', createdAt: 1, origin: 'manual',
    }],
    traitDefs: [], tagCategories: [], tags: [], notes: [], noteTypes: [],
    revisions: { sets: [], activeSetId: null, headerSetId: null, mode: false, display: 'none', selectedSetIds: [], showPageColor: false, colorRevisedText: false, markColumn: 7_086_600 },
    trackChanges: { enabled: false, view: 'markup' },
    writers: [],
    production: { scenesLocked: false, scenesLockedAt: null, lockedStyles: [], pagesLocked: false, pagesLockedAt: null, pageLocks: [] },
    beats: [], beatLinks: [], plotColumns: [], storylines: [], lanes: [], bin: [], shots: [], bookmarks: [], macros: [],
    smartType: { sceneIntros: [], times: [], extensions: [], transitions: [], soundCues: [], introSeparator: ' ', timeSeparator: ' - ', sortMode: 'alphabetical', dismissed: [], entityTombstones: [] },
    spelling: { language: 'en', words: [], ignored: [] },
    tableRead: { narrator: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 }, narratorStyleIds: [], dialogueOnly: false, speakCharacterNames: true, defaultVoice: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 } },
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
