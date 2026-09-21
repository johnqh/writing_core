import * as Y from 'yjs';
import { templateHash } from '../hash/content.js';
import type { IdSource } from '../ids/id-source.js';
import { type StyleId, newId } from '../ids/ids.js';
import type { MacroSeed, StyleDef, TemplateJSON } from '../schema/template.js';
import { STORED_SMARTTYPE_LISTS } from '../schema/vocab.js';
import { normalizeKey } from '../smarttype/normalize.js';
import { camelKey } from '../templates/role-table.js';
import { titleFromKey } from './create.js';
import { embedTemplate, readEmbeddedTemplate } from './embed-template.js';
import { documentToJSON } from './json.js';
import { systemOrigin } from './origins.js';
import { positionBetween } from './positions.js';
import { childMap, lastPosition, setJSONMap } from './ymap.js';

export function mapStyle(
  oldStyles: readonly StyleDef[],
  next: Pick<TemplateJSON, 'styles' | 'defaults'>,
  styleId: StyleId,
  mapping: Readonly<Record<string, StyleId>> = {},
): StyleId {
  const explicit = mapping[styleId];
  if (explicit && next.styles.some((s) => s.id === explicit)) return explicit;
  if (next.styles.some((s) => s.id === styleId)) return styleId;
  const role = oldStyles.find((s) => s.id === styleId)?.role;
  const byRole = role ? next.styles.find((s) => s.role === role) : undefined;
  return byRole?.id ?? next.defaults.pasteFallback;
}

export function applyTemplate(
  doc: Y.Doc,
  template: TemplateJSON,
  options: { ids: IdSource; uid: string; clock?: () => number; mapping?: Readonly<Record<string, StyleId>> },
): { remapped: number } {
  const now = (options.clock ?? Date.now)(); // platform-free-allow-clock: applyTemplate's options.clock default — an injectable seam; callers pass options.clock to freeze timestamps for tests (spec 02 §1.1)
  let remapped = 0;
  doc.transact(() => {
    const old = readEmbeddedTemplate(doc);
    const t = doc.getMap<unknown>('template');
    for (const k of [...t.keys()]) t.delete(k);
    embedTemplate(doc, template);
    t.set('revision', old.revision + 1);

    const restyle = (elements: Y.Map<unknown>, oldStyles: readonly StyleDef[], next: Pick<TemplateJSON, 'styles' | 'defaults'>) => {
      for (const v of elements.values()) {
        const el = v as Y.Map<unknown>;
        const current = el.get('style') as StyleId;
        const target = mapStyle(oldStyles, next, current, options.mapping);
        if (target !== current) {
          el.set('style', target);
          remapped++;
        }
      }
    };
    restyle(doc.getMap('elements'), old.styles, template);
    const tp = doc.getMap<unknown>('titlePage');
    if (tp.has('elements')) {
      restyle(childMap(tp, 'elements'), old.titlePageStyles, {
        styles: template.titlePageStyles,
        defaults: { ...template.defaults, pasteFallback: template.defaults.titleDefault },
      });
    }

    // Merge seeds by normalized key; never delete.
    const st = doc.getMap<unknown>('smartType');
    for (const list of STORED_SMARTTYPE_LISTS) {
      const entries = childMap(st, list);
      const seed = list === 'soundCues' ? [] : template.smartType[list];
      for (const text of seed) {
        const key = normalizeKey(text, { language: template.locale });
        if (!entries.has(key)) entries.set(key, { text, pos: positionBetween(lastPosition(entries), null, options.ids), origin: 'seed', count: 0 });
      }
    }
    const sets = childMap(doc.getMap('revisions'), 'sets');
    const colorKeys = new Set([...sets.values()].map((s) => (s as Y.Map<unknown>).get('colorKey')));
    for (const c of template.revisionColors) {
      if (colorKeys.has(c.key)) continue;
      const id = newId('rev', options.ids);
      setJSONMap(sets, id, {
        id, pos: positionBetween(lastPosition(sets), null, options.ids), name: `${titleFromKey(c.key)} Revision`, colorKey: c.key,
        textColor: c.color, pageColor: c.pageColor, mark: c.mark, textStyle: { underline: 'none', bold: false, strike: false },
        fullDraft: false, date: null, createdBy: options.uid, createdAt: now,
      });
    }
    const mergeByKey = (mapKey: string, prefix: 'cat' | 'ntp' | 'trt', seeds: readonly { key: string }[], shape: (seed: never) => Record<string, unknown>) => {
      const target = doc.getMap<unknown>(mapKey);
      const existing = new Set([...target.values()].map((v) => (v as Y.Map<unknown>).get('key')));
      for (const seed of seeds) {
        if (existing.has(seed.key)) continue;
        const id = newId(prefix, options.ids);
        setJSONMap(target, id, { id, pos: positionBetween(lastPosition(target), null, options.ids), ...shape(seed as never) });
      }
    };
    mergeByKey('tagCategories', 'cat', template.tagCategories, (c: TemplateJSON['tagCategories'][number]) => ({
      key: c.key, name: titleFromKey(c.key), color: c.color, entityKind: c.entityKind, textStyle: c.textStyle, visible: c.visible, fdxGuid: c.fdxGuid, osfUuid: c.osfUuid,
    }));
    mergeByKey('noteTypes', 'ntp', template.noteTypes, (n: TemplateJSON['noteTypes'][number]) => ({ key: n.key, name: titleFromKey(n.key), color: n.color, marker: n.marker }));
    mergeByKey('traitDefs', 'trt', template.traitDefs, (tr: TemplateJSON['traitDefs'][number]) => ({ key: tr.key, name: titleFromKey(tr.key), type: tr.type, options: tr.options }));
    const macros = doc.getMap<unknown>('macros');
    const shortcuts = new Set([...macros.values()].map((v) => (v as Y.Map<unknown>).get('shortcut')));
    for (const seed of template.macros) {
      if (seed.shortcut && shortcuts.has(seed.shortcut)) continue;
      const id = newId('mac', options.ids);
      setJSONMap(macros, id, { id, ...seed });
    }

    doc.getMap('meta').set('templateOrigin', { templateId: template.id, key: template.key, version: template.version, hash: templateHash(template) });
  }, systemOrigin('applyTemplate'));
  return { remapped };
}

const i18nSlug = (text: string) => (/^[a-z][A-Za-z0-9]*$/.test(text) ? text : camelKey(text) || 'custom');

export function exportTemplate(doc: Y.Doc, options: { ids: IdSource; name: string }): TemplateJSON {
  const json = documentToJSON(doc);
  const { revision: _revision, ...embedded } = json.template;
  const retained = (kind: 'character' | 'location') =>
    json.entities.filter((e) => e.kind === kind && e.retain && e.mergedInto === null).map((e) => e.name);
  const texts = (list: (typeof STORED_SMARTTYPE_LISTS)[number]) => json.smartType[list].map((e) => e.text);
  const macros: MacroSeed[] = json.macros.map(({ id: _id, ...m }) => m);
  return {
    ...embedded,
    id: newId('tpl', options.ids),
    key: null,
    version: 1,
    name: options.name,
    nameKey: null,
    smartType: {
      sceneIntros: texts('sceneIntros'), times: texts('times'), extensions: texts('extensions'), transitions: texts('transitions'),
      characters: retained('character'), locations: retained('location'),
      introSeparator: json.smartType.introSeparator, timeSeparator: json.smartType.timeSeparator, sortMode: json.smartType.sortMode,
    },
    revisionColors: json.revisions.sets.map((s) => ({ key: s.colorKey, nameKey: `template.revision.${i18nSlug(s.colorKey)}`, color: s.textColor, pageColor: s.pageColor, mark: s.mark })),
    tagCategories: json.tagCategories.map((c) => ({
      key: c.key ?? i18nSlug(c.name), nameKey: `template.tagCategory.${c.key ?? i18nSlug(c.name)}`, color: c.color, entityKind: c.entityKind,
      fdxGuid: c.fdxGuid, osfUuid: c.osfUuid, textStyle: c.textStyle, visible: c.visible,
    })),
    noteTypes: json.noteTypes.map((n) => ({ key: n.key ?? i18nSlug(n.name), nameKey: `template.noteType.${n.key ?? i18nSlug(n.name)}`, color: n.color, marker: n.marker })),
    traitDefs: json.traitDefs.map((t) => ({ key: t.key ?? i18nSlug(t.name), nameKey: `template.trait.${t.key ?? i18nSlug(t.name)}`, type: t.type, options: t.options })),
    macros,
    titlePage: json.titlePage.elements.map((e) => ({
      styleKey: e.style, text: e.text.plain, ...(e.ov ? { overrides: e.ov } : {}), ...(e.field ? { titleField: e.field } : {}),
    })),
    body: [{ styleKey: json.template.defaults.firstElement, text: '' }],
  };
}
