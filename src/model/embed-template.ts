import * as Y from 'yjs';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { StyleDef, TemplateJSON } from '../schema/template.js';
import { generatePositions, comparePositions } from './positions.js';
import { childMap, setJSONMap } from './ymap.js';

export const TEMPLATE_SCALAR_KEYS = [
  'schemaVersion', 'id', 'key', 'version', 'name', 'nameKey', 'description', 'category', 'locale', 'direction',
  'layoutMode', 'instructions', 'importMeta',
] as const;
export const TEMPLATE_JSON_MAP_KEYS = [
  'page', 'header', 'footer', 'defaults', 'pagination', 'pageNumbering', 'sceneNumbering', 'continueds', 'titlePageLayout',
] as const;
export const STYLE_NESTED_KEYS = ['font', 'flow', 'numbering'] as const;

export function writeStyle(styles: Y.Map<unknown>, style: StyleDef, pos: string): void {
  const map = new Y.Map<unknown>();
  styles.set(style.id, map);
  map.set('pos', pos);
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined) continue;
    if ((STYLE_NESTED_KEYS as readonly string[]).includes(k) && v !== null) setJSONMap(map, k, v as Record<string, unknown>);
    else map.set(k, v);
  }
}

export function readStyle(map: Y.Map<unknown>): StyleDef {
  const out: Record<string, unknown> = {};
  for (const [k, v] of map.entries()) {
    if (k === 'pos') continue;
    out[k] = v instanceof Y.Map ? v.toJSON() : v;
  }
  return out as StyleDef;
}

export function embedTemplate(doc: Y.Doc, template: TemplateJSON | EmbeddedTemplateJSON): void {
  const t = doc.getMap<unknown>('template');
  for (const k of TEMPLATE_SCALAR_KEYS) t.set(k, (template as Record<string, unknown>)[k] ?? null);
  for (const k of TEMPLATE_JSON_MAP_KEYS) setJSONMap(t, k, template[k] as Record<string, unknown>);
  for (const listKey of ['styles', 'titlePageStyles'] as const) {
    const styles = new Y.Map<unknown>();
    t.set(listKey, styles);
    const positions = generatePositions(template[listKey].length, null, null, null);
    template[listKey].forEach((s, i) => writeStyle(styles, s, positions[i]!));
  }
  t.set('revision', 'revision' in template ? template.revision : 0);
}

function readStyleList(map: Y.Map<unknown>): StyleDef[] {
  return [...map.values()]
    .map((v) => v as Y.Map<unknown>)
    .sort((a, b) => comparePositions(a.get('pos') as string, b.get('pos') as string))
    .map(readStyle);
}

export function readEmbeddedTemplate(doc: Y.Doc): EmbeddedTemplateJSON {
  const t = doc.getMap<unknown>('template');
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_SCALAR_KEYS) out[k] = t.get(k);
  for (const k of TEMPLATE_JSON_MAP_KEYS) out[k] = childMap(t, k).toJSON();
  out.styles = readStyleList(childMap(t, 'styles'));
  out.titlePageStyles = readStyleList(childMap(t, 'titlePageStyles'));
  out.revision = t.get('revision');
  return out as EmbeddedTemplateJSON;
}
