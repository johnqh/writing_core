import * as Y from 'yjs';
import type { DocId, ElementId, StyleId } from '../ids/ids.js';
import { readEmbeddedTemplate } from '../model/embed-template.js';
import { documentToJSON } from '../model/json.js';
import { readTextJSON } from '../model/ytext.js';
import type { DocumentJSON, EmbeddedTemplateJSON, SettingsJSON } from '../schema/document.js';
import type { StyleDef } from '../schema/template.js';
import type { StyleRole } from '../schema/vocab.js';
import { type ResolvedStyle, resolveStyle } from '../template/resolve.js';
import { OrderIndex } from './order-index.js';
import type { ElementView, ModelChange, ModelChangeBatch, ModelDeps, Unsubscribe } from './views.js';

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

  for (const [id, v] of elementsMap.entries()) if (v instanceof Y.Map) index.upsert(id, String(v.get('pos')));

  const template = () => (templateCache ??= deepFreeze(readEmbeddedTemplate(doc)));

  function buildView(id: string): ElementView | undefined {
    const m = elementsMap.get(id);
    if (!(m instanceof Y.Map)) return undefined;
    const style = m.get('style') as StyleId;
    let role: StyleRole | null = null;
    try {
      role = resolveStyle(template(), style).role;
    } catch {
      role = null;
    }
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
    templateCache = null;
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      elementsMap.unobserveDeep(onElements);
      templateMap.unobserveDeep(onTemplate);
      doc.getMap('settings').unobserve(onSettings);
      doc.off('afterTransaction', afterTransaction);
      listeners.clear();
    },
  };
  return model;
}
