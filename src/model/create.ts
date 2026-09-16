import * as Y from 'yjs';
import { templateHash } from '../hash/content.js';
import type { IdSource } from '../ids/id-source.js';
import { type DocId, type StyleId, newId } from '../ids/ids.js';
import type { DocTopLevelKey, SettingsJSON, TableReadJSON } from '../schema/document.js';
import type { TemplateJSON } from '../schema/template.js';
import { textJSONFromPlain } from '../schema/text.js';
import { STORED_SMARTTYPE_LISTS, type DocumentKind } from '../schema/vocab.js';
import { normalizeKey } from '../smarttype/normalize.js';
import { DOC_SCHEMA_VERSION, MIGRATION_STEPS } from '../migrations/index.js';
import { insertElementRecord } from './element-record.js';
import { embedTemplate } from './embed-template.js';
import { systemOrigin } from './origins.js';
import { generatePositions } from './positions.js';
import { getMap, setJSONMap } from './ymap.js';

export interface CreateDocumentOptions {
  template: TemplateJSON;
  uid: string;
  ids: IdSource;
  docId?: DocId;
  kind?: DocumentKind;
  language?: string;
  clock?: () => number;
  /** Fills the title page `author` field (spec 01 §4.2). */
  authorName?: string;
}

export const DEFAULT_SETTINGS: SettingsJSON = {
  enterOnBlank: 'template', smartQuotes: true, autoCapitalizeSentences: true, fixDoubleCapitals: true, autoParentheses: true,
  smartTypeEnabled: true, guessNextCharacter: true, macrosEnabled: true, highlightCharacters: false, targetPages: null,
  targetEpisodeSeconds: null, secondsPerPage: 60, dualDialogueEditStacked: false, outlineHidden: false, showRevisionsInPrint: true,
  watermark: null, readingDirection: 'ltr',
};

export const DEFAULT_TABLE_READ: TableReadJSON = {
  narrator: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 },
  narratorStyleIds: [], dialogueOnly: false, speakCharacterNames: true,
  defaultVoice: { platformVoiceId: null, rate: 1, pitch: 1, volume: 1 },
};

/**
 * `revisionColors[].key`, `tagCategories[].key`, `noteTypes[].key` and `traitDefs[].key` are all
 * `.min(1)` in the schema, so an empty key cannot reach here from a validated template — but this
 * is also called on hand-built seeds in tests and importers, where `spaced[0]!.toUpperCase()` on
 * an empty string threw.
 */
export function titleFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.length === 0 ? '' : spaced[0]!.toUpperCase() + spaced.slice(1);
}

const KIND_BY_CATEGORY: Partial<Record<TemplateJSON['category'], DocumentKind>> = { treatment: 'treatment', outline: 'outline', prose: 'other', letter: 'other' };

export function createDocument(options: CreateDocumentOptions): Y.Doc {
  const { template, uid, ids } = options;
  const clock = options.clock ?? (() => Date.now()); // platform-free-allow-clock: createDocument's options.clock default — an injectable seam; callers pass options.clock to freeze createdAt/editedAt for tests/rehearsal (spec 02 §1.1)
  const now = clock();
  const doc = new Y.Doc({ gc: true });
  const map = (key: DocTopLevelKey) => getMap(doc, key);
  const meta = { createdBy: uid, createdAt: now, editedBy: uid, editedAt: now };

  doc.transact(() => {
    const m = map('meta');
    m.set('schemaVersion', DOC_SCHEMA_VERSION);
    m.set('docId', options.docId ?? newId('doc', ids));
    m.set('createdAt', now);
    m.set('createdBy', uid);
    m.set('kind', options.kind ?? KIND_BY_CATEGORY[template.category] ?? 'script');
    m.set('language', options.language ?? template.locale);
    m.set('direction', template.direction);
    m.set('templateOrigin', { templateId: template.id, key: template.key, version: template.version, hash: templateHash(template) });
    m.set('forkedFrom', null);
    const migrations = m.set('migrations', new Y.Map<unknown>());
    for (const step of MIGRATION_STEPS) migrations.set(step.id, { at: now, by: 'create', codeVersion: 'create' });

    embedTemplate(doc, template);

    // Elements.
    const bodyPos = generatePositions(template.body.length, null, null, null);
    template.body.forEach((seed, i) => insertElementRecord(map('elements'), {
      id: newId('el', ids), pos: bodyPos[i]!, style: seed.styleKey as StyleId, text: textJSONFromPlain(seed.text), ov: seed.overrides,
    }, meta));

    const tp = map('titlePage');
    const tpElements = new Y.Map<unknown>();
    const tpFields = new Y.Map<unknown>();
    tp.set('elements', tpElements);
    tp.set('fields', tpFields);
    tp.set('computed', new Y.Map());
    const tpPos = generatePositions(template.titlePage.length, null, null, null);
    template.titlePage.forEach((seed, i) => {
      const id = newId('el', ids);
      insertElementRecord(tpElements, { id, pos: tpPos[i]!, style: seed.styleKey as StyleId, text: textJSONFromPlain(seed.titleField === 'author' && options.authorName ? options.authorName : seed.text), ov: seed.overrides, field: seed.titleField }, meta);
      if (seed.titleField) tpFields.set(seed.titleField, id);
    });

    // SmartType lists (characters and locations are entities, spec 01 §5.20).
    const st = map('smartType');
    for (const list of STORED_SMARTTYPE_LISTS) {
      const entries = new Y.Map<unknown>();
      st.set(list, entries);
      const seed = list === 'soundCues' ? [] : template.smartType[list];
      const pos = generatePositions(seed.length, null, null, null);
      seed.forEach((text, i) => entries.set(normalizeKey(text, { language: template.locale }), { text, pos: pos[i]!, origin: 'seed', count: 0 }));
    }
    st.set('introSeparator', template.smartType.introSeparator);
    st.set('timeSeparator', template.smartType.timeSeparator);
    st.set('sortMode', template.smartType.sortMode);
    st.set('dismissed', new Y.Map());
    // Entity-kind tombstones (spec 01 §5.20): `kind:nameKey` the user explicitly deleted, so
    // harvesting never recreates it (§7.2). Lives alongside `dismissed`, which does the same job
    // for the non-entity SmartType lists.
    st.set('entityTombstones', new Y.Map());

    // Revisions.
    const rev = map('revisions');
    const sets = new Y.Map<unknown>();
    rev.set('sets', sets);
    const revPos = generatePositions(template.revisionColors.length, null, null, null);
    template.revisionColors.forEach((c, i) => {
      const id = newId('rev', ids);
      setJSONMap(sets, id, {
        id, pos: revPos[i]!, name: `${titleFromKey(c.key)} Revision`, colorKey: c.key, textColor: c.color, pageColor: c.pageColor, mark: c.mark,
        textStyle: { underline: 'none', bold: false, strike: false }, fullDraft: false, date: null, createdBy: uid, createdAt: now,
      });
    });
    for (const [k, v] of Object.entries({ activeSetId: null, headerSetId: null, mode: false, display: 'none', selectedSetIds: [], showPageColor: false, colorRevisedText: false, markColumn: 7_086_600 })) rev.set(k, v);

    const seedCollection = <T>(key: DocTopLevelKey, prefix: 'cat' | 'ntp' | 'trt', items: readonly T[], shape: (item: T, id: string, pos: string) => Record<string, unknown>) => {
      const target = map(key);
      const pos = generatePositions(items.length, null, null, null);
      items.forEach((item, i) => {
        const id = newId(prefix, ids);
        setJSONMap(target, id, shape(item, id, pos[i]!));
      });
    };
    seedCollection('tagCategories', 'cat', template.tagCategories, (c, id, pos) => ({
      id, key: c.key, name: titleFromKey(c.key), color: c.color, entityKind: c.entityKind, textStyle: c.textStyle, visible: c.visible, pos, fdxGuid: c.fdxGuid, osfUuid: c.osfUuid,
    }));
    seedCollection('noteTypes', 'ntp', template.noteTypes, (n, id, pos) => ({ id, key: n.key, name: titleFromKey(n.key), color: n.color, marker: n.marker, pos }));
    seedCollection('traitDefs', 'trt', template.traitDefs, (tr, id, pos) => ({ id, key: tr.key, name: titleFromKey(tr.key), type: tr.type, options: tr.options, pos }));

    const macros = map('macros');
    for (const seed of template.macros) {
      const id = newId('mac', ids);
      setJSONMap(macros, id, { id, ...seed });
    }

    map('trackChanges').set('enabled', false);
    map('trackChanges').set('view', 'markup');
    const prod = map('production');
    for (const [k, v] of Object.entries({ scenesLocked: false, scenesLockedAt: null, pagesLocked: false, pagesLockedAt: null })) prod.set(k, v);
    prod.set('lockedStyles', new Y.Map());
    prod.set('pageLocks', new Y.Map());

    const spelling = map('spelling');
    spelling.set('language', options.language ?? template.locale);
    spelling.set('words', new Y.Map());
    spelling.set('ignored', new Y.Map());

    const tableRead = map('tableRead');
    tableRead.set('narrator', DEFAULT_TABLE_READ.narrator);
    tableRead.set('narratorStyleIds', new Y.Map());
    tableRead.set('dialogueOnly', DEFAULT_TABLE_READ.dialogueOnly);
    tableRead.set('speakCharacterNames', DEFAULT_TABLE_READ.speakCharacterNames);
    tableRead.set('defaultVoice', DEFAULT_TABLE_READ.defaultVoice);

    const settings = map('settings');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) settings.set(k, v);
    settings.set('readingDirection', template.direction);
    settings.set('dualDialogueEditStacked', template.pagination.dualDialogue.stackWhileEditing);
    if (template.category === 'verticalDrama') settings.set('targetEpisodeSeconds', 90);

    // Empty collections: touching the map creates it.
    const EMPTY_COLLECTIONS = ['folders', 'entities', 'tags', 'notes', 'writers', 'beats', 'beatLinks', 'plotColumns', 'storylines', 'lanes', 'bin', 'shots', 'bookmarks', 'importMeta', 'aiSuggestions'] as const satisfies readonly DocTopLevelKey[];
    for (const key of EMPTY_COLLECTIONS) map(key);
  }, systemOrigin('create'));

  return doc;
}
