import * as Y from 'yjs';
import type { DocId, ElementId, EntityId, StyleId } from '../ids/ids.js';
import { readEmbeddedTemplate } from '../model/embed-template.js';
import { documentToJSON, readEntity, readNote, readTextKeyed } from '../model/json.js';
import { comparePositions } from '../model/positions.js';
import { readTextJSON, scanText } from '../model/ytext.js';
import type {
  BeatJSON, BinItemJSON, BookmarkJSON, DocumentJSON, EmbeddedTemplateJSON, ProductionJSON, RevisionsJSON, SettingsJSON, ShotJSON, TrackChangesJSON,
} from '../schema/document.js';
import type { MacroRecord, StyleDef } from '../schema/template.js';
import type { EntityKind, SmartTypeList, StyleRole } from '../schema/vocab.js';
import { normalizeKey, stripExtension } from '../smarttype/normalize.js';
import { type ResolvedStyle, resolveStyle } from '../template/resolve.js';
import { readCollection } from './collections.js';
import { OrderIndex } from './order-index.js';
import { computeDialogueBlocks, computeOutlineTree, computeScenes, type StructureInput } from './structure.js';
import { matchesPrefix, rankSuggestions } from './suggestions.js';
import type {
  DialogueBlockView, ElementView, EntityView, ModelChange, ModelChangeBatch, ModelDeps, NoteView, OccurrenceView, OutlineNode,
  SceneView, Suggestion, SuggestionContext, TagCategoryView, TagView, TitlePageView, Unsubscribe,
} from './views.js';

type YMap = Y.Map<unknown>;

/** Element keys whose change bumps `attrsVersion` (spec 01 §10.2). */
const ATTRS_KEYS: ReadonlySet<string> = new Set(['style', 'ov', 'num', 'scene', 'dual', 'alts', 'tc', 'lineAdjust']);

export interface DocumentModel {
  readonly doc: Y.Doc;
  readonly docId: DocId;
  readonly deps: ModelDeps;
  template(): EmbeddedTemplateJSON;
  style(id: StyleId): StyleDef | undefined;
  resolveStyle(elementId: ElementId): ResolvedStyle;
  stylesByRole(role: StyleRole): readonly StyleDef[];
  elementCount(): number;
  elements(range?: { from?: number; to?: number }): readonly ElementView[];
  element(id: ElementId): ElementView | undefined;
  indexOf(id: ElementId): number;
  elementAt(index: number): ElementView;
  next(id: ElementId, filter?: (e: ElementView) => boolean): ElementView | undefined;
  previous(id: ElementId, filter?: (e: ElementView) => boolean): ElementView | undefined;
  textVersion(elementId: ElementId): number;
  attrsVersion(elementId: ElementId): number;
  settings(): SettingsJSON;
  toJSON(): DocumentJSON;
  scenes(): readonly SceneView[];
  scene(id: ElementId): SceneView | undefined;
  sceneOf(elementId: ElementId): SceneView | undefined;
  dialogueBlocks(sceneId?: ElementId): readonly DialogueBlockView[];
  outlineTree(): OutlineNode;
  titlePage(): TitlePageView;
  entities(filter?: { kind?: EntityKind; includeHidden?: boolean }): readonly EntityView[];
  entity(id: EntityId): EntityView | undefined;
  resolveEntity(kind: EntityKind, name: string): EntityView | undefined;
  occurrences(entityId: EntityId): readonly OccurrenceView[];
  tags(filter?: { elementId?: ElementId; categoryId?: string; entityId?: EntityId }): readonly TagView[];
  tagCategories(): readonly TagCategoryView[];
  notes(filter?: { elementId?: ElementId; resolved?: boolean }): readonly NoteView[];
  revisionState(): RevisionsJSON;
  trackChangesState(): TrackChangesJSON;
  productionState(): ProductionJSON;
  shots(sceneId?: ElementId): readonly ShotJSON[];
  beats(filter?: { board?: boolean; plotColumnId?: string; laneId?: string }): readonly BeatJSON[];
  bin(): readonly BinItemJSON[];
  bookmarks(): readonly BookmarkJSON[];
  macros(): readonly MacroRecord[];
  smartTypeSuggestions(list: SmartTypeList, prefix: string, context?: SuggestionContext): readonly Suggestion[];
  guessNextCharacter(elementId: ElementId): string | null;
  subscribe(listener: (batch: ModelChangeBatch) => void): Unsubscribe;
  dispose(): void;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
};

export function openDocument(doc: Y.Doc, deps: ModelDeps): DocumentModel {
  const elementsMap = doc.getMap<unknown>('elements');
  const templateMap = doc.getMap<unknown>('template');
  const index = new OrderIndex();
  const views = new Map<string, ElementView>();
  const textVersions = new Map<string, number>();
  const attrsVersions = new Map<string, number>();
  const listeners = new Set<(batch: ModelChangeBatch) => void>();
  let templateCache: EmbeddedTemplateJSON | null = null;
  let settingsCache: SettingsJSON | null = null;
  const pending = new Map<Y.Transaction, ModelChange[]>();

  let structure: { scenes: SceneView[]; blocks: DialogueBlockView[]; tree: OutlineNode; sceneOf: Map<string, SceneView> } | null = null;
  let titlePageCache: TitlePageView | null = null;
  const invalidateStructure = () => {
    structure = null;
  };

  const entityLookup = (kind: EntityKind, name: string): EntityId | null => {
    const key = normalizeKey(kind === 'character' ? stripExtension(name).name : name, { language: deps.locale });
    let found: Y.Map<unknown> | undefined;
    for (const v of doc.getMap('entities').values()) {
      const e = v as Y.Map<unknown>;
      if (e.get('kind') !== kind) continue;
      const aliases = (e.get('aliases') as Y.Array<string> | undefined)?.toArray() ?? [];
      if (e.get('nameKey') === key || aliases.some((a) => normalizeKey(a, { language: deps.locale }) === key)) {
        found = e;
        break;
      }
    }
    let guard = 0;
    while (found && typeof found.get('mergedInto') === 'string' && guard++ < 64) {
      found = doc.getMap('entities').get(found.get('mergedInto') as string) as Y.Map<unknown> | undefined;
    }
    return (found?.get('id') as EntityId | undefined) ?? null;
  };

  function structureInput(): StructureInput {
    const castCategories = new Set(
      [...doc.getMap('tagCategories').values()].filter((c) => (c as Y.Map<unknown>).get('entityKind') === 'character').map((c) => (c as Y.Map<unknown>).get('id')),
    );
    const castTagsByElement = new Map<string, EntityId[]>();
    for (const v of doc.getMap('tags').values()) {
      const t = v as Y.Map<unknown>;
      if (!castCategories.has(t.get('categoryId'))) continue;
      const list = castTagsByElement.get(String(t.get('elementId'))) ?? [];
      list.push(t.get('entityId') as EntityId);
      castTagsByElement.set(String(t.get('elementId')), list);
    }
    const st = doc.getMap('smartType');
    const listTexts = (key: string) =>
      [...((st.get(key) as Y.Map<{ text: string; pos: string }> | undefined)?.values() ?? [])].sort((a, b) => comparePositions(a.pos, b.pos)).map((e) => e.text);
    return {
      elements: model.elements(),
      sceneMap: (id) => {
        const s = (elementsMap.get(id) as Y.Map<unknown> | undefined)?.get('scene');
        return s instanceof Y.Map ? (s as Y.Map<unknown>) : undefined;
      },
      folders: [...doc.getMap('folders').values()].map((v) => (v as Y.Map<unknown>).toJSON() as StructureInput['folders'][number]),
      vocab: {
        sceneIntros: listTexts('sceneIntros'), times: listTexts('times'),
        introSeparator: String(st.get('introSeparator') ?? ' '), timeSeparator: String(st.get('timeSeparator') ?? ' - '),
        language: String(doc.getMap('meta').get('language') ?? deps.locale),
      },
      resolveEntity: entityLookup,
      castTagsByElement,
    };
  }

  function getStructure() {
    if (!structure) {
      const input = structureInput();
      const scenes = computeScenes(input);
      const sceneOf = new Map<string, SceneView>();
      for (const s of scenes) for (const id of s.elementIds) sceneOf.set(id, s);
      structure = { scenes, blocks: computeDialogueBlocks(input, scenes), tree: computeOutlineTree(input, scenes), sceneOf };
    }
    return structure;
  }

  const COLLECTION_KINDS: Record<string, (ids: string[]) => ModelChange> = {
    titlePage: () => ({ kind: 'titlePage' }),
    entities: (ids) => ({ kind: 'entities', ids }),
    tags: (ids) => ({ kind: 'tags', ids }),
    notes: (ids) => ({ kind: 'notes', ids }),
    revisions: () => ({ kind: 'revisions' }),
    trackChanges: () => ({ kind: 'trackChanges' }),
    production: () => ({ kind: 'production' }),
    folders: () => ({ kind: 'folders' }),
    beats: (ids) => ({ kind: 'beats', ids }),
    shots: (ids) => ({ kind: 'shots', ids }),
    smartType: () => ({ kind: 'smartType' }),
    bin: () => ({ kind: 'bin' }),
    bookmarks: () => ({ kind: 'bookmarks' }),
    macros: () => ({ kind: 'macros' }),
  };
  const STRUCTURE_SOURCES = new Set(['entities', 'tags', 'folders', 'smartType', 'tagCategories']);
  const collectionObservers: [Y.Map<unknown>, (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => void][] = [];
  for (const key of [...Object.keys(COLLECTION_KINDS), 'tagCategories']) {
    const map = doc.getMap<unknown>(key);
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => {
      caches.delete(key);
      caches.delete('occurrences');
      if (STRUCTURE_SOURCES.has(key)) invalidateStructure();
      if (key === 'titlePage') titlePageCache = null;
      const make = COLLECTION_KINDS[key];
      if (!make) return;
      const ids = new Set<string>();
      for (const e of events) {
        if (e.target === map) for (const k of (e as Y.YMapEvent<unknown>).keysChanged) ids.add(k);
        else if (e.path.length > 0) ids.add(String(e.path[0]));
      }
      queue(tx, make([...ids].sort()));
    };
    map.observeDeep(handler);
    collectionObservers.push([map, handler]);
  }

  for (const [id, v] of elementsMap.entries()) if (v instanceof Y.Map) index.upsert(id, String(v.get('pos')));

  const template = () => (templateCache ??= deepFreeze(readEmbeddedTemplate(doc)));

  function buildView(id: string): ElementView | undefined {
    const m = elementsMap.get(id);
    if (!(m instanceof Y.Map)) return undefined;
    const style = m.get('style') as StyleId;
    // Only an unknown style (dangling reference, e.g. after a style deletion) resolves to a
    // null role; any other resolveStyle failure (e.g. an incomplete root chain) is a genuine
    // template bug and must propagate rather than be silently swallowed as "no role".
    const styleExists = template().styles.some((s) => s.id === style);
    const role: StyleRole | null = styleExists ? resolveStyle(template(), style).role : null;
    const alts = m.get('alts');
    const view: ElementView = {
      id: id as ElementId,
      pos: String(m.get('pos')),
      style,
      role,
      text: readTextJSON(m.get('text') as Y.Text),
      ov: m.get('ov') instanceof Y.Map ? ((m.get('ov') as YMap).toJSON() as ElementView['ov']) : {},
      num: m.get('num') instanceof Y.Map ? ((m.get('num') as YMap).toJSON() as ElementView['num']) : null,
      hasScene: m.get('scene') instanceof Y.Map,
      dual: (m.get('dual') as ElementView['dual']) ?? null,
      altCount: alts instanceof Y.Map ? alts.size : 0,
      label: (m.get('label') as string | undefined) ?? null,
      outlineLevel: (m.get('outlineLevel') as number | undefined) ?? null,
      shotId: (m.get('shotId') as string | undefined) ?? null,
      folderId: (m.get('folderId') as string | undefined) ?? null,
      lineAdjust: (m.get('lineAdjust') as ElementView['lineAdjust']) ?? null,
      tc: (m.get('tc') as ElementView['tc']) ?? null,
      omit: (m.get('omit') as ElementView['omit']) ?? null,
      meta: m.get('meta') as ElementView['meta'],
      field: (m.get('field') as ElementView['field']) ?? null,
    };
    return deepFreeze(view);
  }

  function view(id: string): ElementView | undefined {
    let v = views.get(id);
    if (!v) {
      v = buildView(id);
      if (v) views.set(id, v);
    }
    return v;
  }

  const queue = (tx: Y.Transaction, change: ModelChange) => {
    const list = pending.get(tx) ?? [];
    list.push(change);
    pending.set(tx, list);
  };

  const onElements = (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => {
    invalidateStructure();
    caches.delete('occurrences');
    const inserted = new Set<string>();
    const removed = new Set<string>();
    const changed = new Set<string>();
    let reordered = false;
    for (const event of events) {
      if (event.target === elementsMap) {
        for (const [key, change] of (event as Y.YMapEvent<unknown>).changes.keys) {
          if (change.action === 'add') inserted.add(key);
          else if (change.action === 'delete') removed.add(key);
          else changed.add(key);
        }
        continue;
      }
      const id = String(event.path[0]);
      if (inserted.has(id)) continue;
      changed.add(id);
      const isText = event.target instanceof Y.Text && event.path.length === 2 && event.path[1] === 'text';
      const touchesAttrs = event.path.length === 1
        ? [...(event as Y.YMapEvent<unknown>).keysChanged].some((k) => ATTRS_KEYS.has(k))
        : ATTRS_KEYS.has(String(event.path[1]));
      if (isText) textVersions.set(id, (textVersions.get(id) ?? 0) + 1);
      else if (touchesAttrs) attrsVersions.set(id, (attrsVersions.get(id) ?? 0) + 1);
      if (event.target instanceof Y.Map && event.path.length === 1 && (event as Y.YMapEvent<unknown>).keysChanged.has('pos')) reordered = true;
    }
    for (const id of inserted) {
      const m = elementsMap.get(id);
      if (m instanceof Y.Map) index.upsert(id, String(m.get('pos')));
      reordered = true;
    }
    for (const id of removed) {
      index.remove(id);
      views.delete(id);
      textVersions.delete(id);
      attrsVersions.delete(id);
      reordered = true;
    }
    for (const id of changed) {
      const m = elementsMap.get(id);
      if (m instanceof Y.Map) index.upsert(id, String(m.get('pos')));
      views.delete(id);
    }
    queue(tx, { kind: 'elements', inserted: [...inserted].sort(), removed: [...removed].sort(), changed: [...changed].filter((id) => !removed.has(id)).sort(), reordered });
  };

  const onTemplate = (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => {
    invalidateStructure();
    caches.delete('occurrences');
    templateCache = null;
    // Clear every cached view rather than diffing which elements are affected: template edits
    // are rare, but a single style edit (e.g. changing its `role`) can change the resolved role
    // of any element that references it, directly or via `basedOn`/`paginateAs`, so a targeted
    // invalidation would have to replicate the whole resolution chain just to be an optimization.
    views.clear();
    const styleIds = new Set<string>();
    let all = false;
    for (const event of events) {
      if ((event.path[0] === 'styles' || event.path[0] === 'titlePageStyles') && event.path.length >= 2) styleIds.add(String(event.path[1]));
      else all = true;
    }
    queue(tx, { kind: 'template', styleIds: all ? 'all' : [...styleIds].sort() });
  };

  const onSettings = (_e: unknown, tx: Y.Transaction) => {
    settingsCache = null;
    queue(tx, { kind: 'settings' });
  };

  const afterTransaction = (tx: Y.Transaction) => {
    const changes = pending.get(tx);
    if (!changes) return;
    pending.delete(tx);
    const batch: ModelChangeBatch = { changes, origin: tx.origin, local: tx.local };
    for (const l of listeners) l(batch);
  };

  elementsMap.observeDeep(onElements);
  templateMap.observeDeep(onTemplate);
  doc.getMap('settings').observe(onSettings);
  doc.on('afterTransaction', afterTransaction);

  const docId = doc.getMap('meta').get('docId') as DocId;

  const caches = new Map<string, unknown>();
  const cached = <T>(key: string, compute: () => T): T => {
    if (!caches.has(key)) caches.set(key, deepFreeze(compute()));
    return caches.get(key) as T;
  };
  const entityRecords = () => cached('entities', () => readCollection(doc, 'entities', readEntity));

  function occurrenceMap(): Map<string, OccurrenceView[]> {
    return cached('occurrences', () => {
      const map = new Map<string, OccurrenceView[]>();
      const add = (entityId: string | null, o: OccurrenceView) => {
        if (!entityId) return;
        map.set(entityId, [...(map.get(entityId) ?? []), o]);
      };
      const s = getStructure();
      for (const b of s.blocks) add(b.entityId, { sceneId: b.sceneId, elementId: b.speakerId, source: 'speaker', range: null });
      for (const scene of s.scenes) add(scene.locationId, { sceneId: scene.id, elementId: scene.id, source: 'heading', range: null });
      for (const tag of model.tags()) {
        const el = elementsMap.get(tag.elementId) as YMap | undefined;
        const text = el?.get('text');
        const mark = text instanceof Y.Text ? scanText(text).marks.find((m) => m.key === `t:${tag.id}`) : undefined;
        add(tag.entityId, { sceneId: s.sceneOf.get(tag.elementId)?.id ?? null, elementId: tag.elementId, source: 'tag', range: mark ? { index: mark.index, length: mark.length } : null });
      }
      return map;
    });
  }

  const follow = (e: EntityView | undefined): EntityView | undefined => {
    let cur = e;
    for (let i = 0; cur?.mergedInto && i < 64; i++) cur = entityRecords().find((x) => x.id === cur!.mergedInto) as EntityView | undefined;
    return cur;
  };

  const model: DocumentModel = {
    doc,
    docId,
    deps,
    template,
    style: (id) => template().styles.find((s) => s.id === id),
    resolveStyle(elementId) {
      const m = elementsMap.get(elementId) as YMap | undefined;
      if (!m) throw new Error(`unknown element ${elementId}`);
      const ov = m.get('ov') instanceof Y.Map ? ((m.get('ov') as YMap).toJSON() as ElementView['ov']) : undefined;
      return resolveStyle(template(), m.get('style') as StyleId, ov);
    },
    stylesByRole: (role) => template().styles.filter((s) => s.role === role),
    elementCount: () => index.size,
    elements: (range = {}) => index.ids(range.from ?? 0, range.to ?? index.size).map((id) => view(id)!),
    element: (id) => view(id),
    indexOf: (id) => index.indexOf(id),
    elementAt(i) {
      const id = index.idAt(i);
      if (id === undefined) throw new RangeError(`no element at ${i}`);
      return view(id)!;
    },
    next(id, filter) {
      for (let i = index.indexOf(id) + 1; i > 0 && i < index.size; i++) {
        const v = view(index.idAt(i)!)!;
        if (!filter || filter(v)) return v;
      }
      return undefined;
    },
    previous(id, filter) {
      for (let i = index.indexOf(id) - 1; i >= 0; i--) {
        const v = view(index.idAt(i)!)!;
        if (!filter || filter(v)) return v;
      }
      return undefined;
    },
    textVersion: (id) => textVersions.get(id) ?? 0,
    attrsVersion: (id) => attrsVersions.get(id) ?? 0,
    settings: () => (settingsCache ??= deepFreeze(doc.getMap('settings').toJSON() as SettingsJSON)),
    toJSON: () => documentToJSON(doc),
    scenes: () => getStructure().scenes,
    scene: (id) => getStructure().scenes.find((s) => s.id === id),
    sceneOf: (elementId) => getStructure().sceneOf.get(elementId),
    dialogueBlocks: (sceneId) => (sceneId ? getStructure().blocks.filter((b) => b.sceneId === sceneId) : getStructure().blocks),
    outlineTree: () => getStructure().tree,
    titlePage() {
      if (!titlePageCache) {
        const tp = doc.getMap<unknown>('titlePage');
        const elements = tp.get('elements') instanceof Y.Map ? (tp.get('elements') as Y.Map<unknown>) : new Y.Map<unknown>();
        const tpTemplate = { ...template(), styles: template().titlePageStyles };
        const views = [...elements.values()]
          .map((v) => v as Y.Map<unknown>)
          .sort((a, b) => comparePositions(String(a.get('pos')), String(b.get('pos'))))
          .map((m) => {
            const text = readTextJSON(m.get('text') as Y.Text);
            let role: StyleRole | null = null;
            try { role = resolveStyle(tpTemplate, m.get('style') as StyleId).role; } catch { role = null; }
            return deepFreeze({
              id: m.get('id') as ElementId, pos: String(m.get('pos')), style: m.get('style') as StyleId, role, text,
              ov: m.get('ov') instanceof Y.Map ? (m.get('ov') as Y.Map<unknown>).toJSON() : {}, num: null, hasScene: false, dual: null,
              altCount: 0, label: null, outlineLevel: null, shotId: null, folderId: null, lineAdjust: null, tc: null, omit: null,
              meta: m.get('meta') as ElementView['meta'], field: (m.get('field') as ElementView['field']) ?? null,
            } satisfies ElementView);
          });
        const fields: TitlePageView['fields'] = {};
        const fieldMap = tp.get('fields');
        if (fieldMap instanceof Y.Map) {
          for (const [field, id] of fieldMap.entries()) {
            const v = views.find((e) => e.id === id);
            if (v) fields[field as keyof TitlePageView['fields']] = { elementId: v.id, text: v.text.plain };
          }
        }
        titlePageCache = deepFreeze({ elements: views, fields });
      }
      return titlePageCache;
    },
    entities(filter = {}) {
      const all = entityRecords().filter((e) => e.mergedInto === null && (!filter.kind || e.kind === filter.kind));
      const occ = occurrenceMap();
      const withHidden = all.map((e) => ({ ...e, hidden: e.origin === 'harvested' && !e.retain && !(occ.get(e.id)?.length) }) as EntityView);
      const visible = filter.includeHidden ? withHidden : withHidden.filter((e) => !e.hidden);
      // `new Intl.Collator` is banned by the platform-free guard; `localeCompare` with an
      // explicit locale gives the same base-sensitivity comparison.
      return visible.sort((a, b) => a.name.localeCompare(b.name, deps.locale, { sensitivity: 'base' }));
    },
    entity(id) {
      const e = entityRecords().find((x) => x.id === id);
      return e ? follow({ ...e, hidden: false } as EntityView) : undefined;
    },
    resolveEntity(kind, name) {
      const found = entityLookup(kind, name);
      return found ? model.entity(found) : undefined;
    },
    occurrences: (entityId) => occurrenceMap().get(entityId) ?? [],
    tags(filter = {}) {
      const all = cached('tags', () => readCollection(doc, 'tags', (m) => m.toJSON() as TagView));
      return all.filter((t) => (!filter.elementId || t.elementId === filter.elementId) && (!filter.categoryId || t.categoryId === filter.categoryId) && (!filter.entityId || t.entityId === filter.entityId));
    },
    tagCategories: () => cached('tagCategories', () => readCollection(doc, 'tagCategories', (m) => m.toJSON() as TagCategoryView)),
    notes(filter = {}) {
      const all = cached('notes', () => readCollection(doc, 'notes', readNote));
      return all.filter((n) => {
        if (filter.resolved !== undefined && (n.resolved !== null) !== filter.resolved) return false;
        if (!filter.elementId) return true;
        const a = n.anchor;
        return (a.kind === 'element' || a.kind === 'scene') && a.elementId === filter.elementId;
      });
    },
    revisionState: () => cached('revisions', () => {
      const rev = doc.getMap<unknown>('revisions');
      const sets = rev.get('sets');
      const list = sets instanceof Y.Map
        ? [...(sets as YMap).values()].map((s) => (s as YMap).toJSON() as RevisionsJSON['sets'][number]).sort((a, b) => comparePositions(a.pos, b.pos))
        : [];
      return { ...(rev.toJSON() as RevisionsJSON), sets: list };
    }),
    trackChangesState: () => cached('trackChanges', () => doc.getMap('trackChanges').toJSON() as TrackChangesJSON),
    productionState: () => cached('production', () => {
      const prod = doc.getMap<unknown>('production');
      const json = prod.toJSON() as Record<string, unknown>;
      return {
        ...(json as unknown as ProductionJSON),
        lockedStyles: Object.keys((json.lockedStyles as Record<string, true>) ?? {}).sort() as ProductionJSON['lockedStyles'],
        pageLocks: Object.values((json.pageLocks as Record<string, ProductionJSON['pageLocks'][number]>) ?? {}),
      };
    }),
    shots: (sceneId) => cached('shots', () => readCollection(doc, 'shots', (m) => readTextKeyed<ShotJSON>(m, ['description'], []))).filter((s) => !sceneId || s.sceneId === sceneId),
    beats(filter = {}) {
      const all = cached('beats', () => readCollection(doc, 'beats', (m) => readTextKeyed<BeatJSON>(m, ['title', 'body'], ['storylineIds'])));
      return all.filter((b) => (filter.board === undefined || (b.board !== null) === filter.board) && (!filter.plotColumnId || b.plot?.columnId === filter.plotColumnId) && (!filter.laneId || b.lane?.laneId === filter.laneId));
    },
    bin: () => cached('bin', () => readCollection(doc, 'bin', (m) => m.toJSON() as BinItemJSON)),
    bookmarks: () => cached('bookmarks', () => readCollection(doc, 'bookmarks', (m) => m.toJSON() as BookmarkJSON)),
    macros: () => cached('macros', () => readCollection(doc, 'macros', (m) => m.toJSON() as MacroRecord)),
    smartTypeSuggestions(list, prefix) {
      const language = String(doc.getMap('meta').get('language') ?? deps.locale);
      const st = doc.getMap<unknown>('smartType');
      const sortMode = (st.get('sortMode') as 'alphabetical' | 'custom' | 'frequency') ?? 'alphabetical';
      const dismissed = st.get('dismissed') instanceof Y.Map ? (st.get('dismissed') as YMap) : null;
      if (list === 'characters' || list === 'locations') {
        const kind = list === 'characters' ? 'character' : 'location';
        const occ = occurrenceMap();
        const items: Suggestion[] = model.entities({ kind }).flatMap((e) => {
          const names = [e.name, ...e.aliases];
          const reading = typeof e.attributes['smartType.reading'] === 'string' ? (e.attributes['smartType.reading'] as string) : null;
          const hit = names.some((n) => matchesPrefix(n, prefix, language)) || (reading !== null && matchesPrefix(reading, prefix, language));
          return hit ? [{ text: e.name, key: e.nameKey, source: 'entity' as const, entityId: e.id, count: occ.get(e.id)?.length ?? 0 }] : [];
        });
        return rankSuggestions(items, sortMode === 'custom' ? 'alphabetical' : sortMode, language);
      }
      const entries = st.get(list);
      if (!(entries instanceof Y.Map)) return [];
      const order = new Map<string, string>();
      const items: Suggestion[] = [];
      for (const [key, v] of (entries as YMap).entries()) {
        const entry = v as { text: string; pos: string; count: number };
        if (dismissed?.has(`${list}:${key}`)) continue;
        if (!matchesPrefix(entry.text, prefix, language)) continue;
        order.set(key, entry.pos);
        items.push({ text: entry.text, key, source: 'list', entityId: null, count: entry.count });
      }
      return rankSuggestions(items, sortMode, language, order);
    },
    guessNextCharacter(elementId) {
      const scene = model.sceneOf(elementId);
      const index = model.indexOf(elementId);
      const blocks = model.dialogueBlocks(scene?.id).filter((b) => b.speakerId !== elementId && model.indexOf(b.speakerId) < index);
      if (blocks.length >= 2) return blocks[blocks.length - 2]!.name;
      const counts = new Map<string, number>();
      for (const b of blocks) counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      elementsMap.unobserveDeep(onElements);
      templateMap.unobserveDeep(onTemplate);
      doc.getMap('settings').unobserve(onSettings);
      doc.off('afterTransaction', afterTransaction);
      for (const [map, handler] of collectionObservers) map.unobserveDeep(handler);
      listeners.clear();
    },
  };
  return model;
}
