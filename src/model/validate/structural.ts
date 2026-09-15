import * as Y from 'yjs';
import { deterministicId } from '../../ids/ids.js';
import { DOC_TOP_LEVEL_KEYS } from '../../schema/document.js';
import type { StyleDef } from '../../schema/template.js';
import { FLOW_KEYS, FONT_KEYS, ROOT_REQUIRED_KEYS } from '../../template/resolve.js';
import { validateTemplate } from '../../template/validate.js';
import { ROOT_STYLE_DEFAULTS } from '../../templates/shared.js';
import { readElementRecord, writeElementRecord } from '../json.js';
import { MAX_POSITION_LENGTH, positionBetween, rebalancePositions } from '../positions.js';
import { orderElements } from '../ymap.js';
import type { YDeltaOp } from '../ytext.js';
import { BUILTIN_STYLE_ROLES, allTexts } from './context.js';
import { type Invariant, issue } from './types.js';

type YMap = Y.Map<unknown>;

const KEYED_COLLECTIONS: readonly (readonly string[])[] = [
  ['elements'], ['titlePage', 'elements'], ['folders'], ['entities'], ['traitDefs'], ['tagCategories'], ['tags'], ['notes'],
  ['noteTypes'], ['revisions', 'sets'], ['beats'], ['beatLinks'], ['plotColumns'], ['storylines'], ['lanes'], ['bin'],
  ['shots'], ['bookmarks'], ['macros'], ['production', 'pageLocks'],
];

function collection(doc: Y.Doc, path: readonly string[]): YMap | null {
  let current: unknown = doc.getMap(path[0]!);
  for (const key of path.slice(1)) current = current instanceof Y.Map ? current.get(key) : undefined;
  return current instanceof Y.Map ? (current as YMap) : null;
}

const I1: Invariant = {
  code: 'I1', severity: 'error', autoRepair: false,
  check(ctx) {
    const known = new Set<string>(DOC_TOP_LEVEL_KEYS);
    const unknown = [...ctx.doc.share.keys()].filter((k) => !known.has(k));
    const out = unknown.map((k) => issue(I1, `unknown top-level key "${k}"`, [k]));
    if (!ctx.docId) out.push(issue(I1, 'meta.docId is missing', []));
    return out;
  },
};

const I2: Invariant = {
  code: 'I2', severity: 'error', autoRepair: true,
  check(ctx) {
    const out = [];
    for (const path of KEYED_COLLECTIONS) {
      const map = collection(ctx.doc, path);
      if (!map) continue;
      for (const [key, value] of map.entries()) {
        if (value instanceof Y.Map && value.get('id') !== key) {
          out.push(issue(I2, `${path.join('.')}: record id ${String(value.get('id'))} ≠ key ${key}`, [key], () => value.set('id', key)));
        }
      }
    }
    return out;
  },
};

const I3: Invariant = {
  code: 'I3', severity: 'error', autoRepair: true,
  check(ctx) {
    const tp = ctx.titleElements;
    if (!tp) return [];
    return [...tp.keys()]
      .filter((id) => ctx.bodyElements.has(id))
      .map((id) =>
        issue(I3, `element id ${id} is used by the body and the title page`, [id], () => {
          const record = tp.get(id) as YMap;
          const json = readElementRecord(record);
          const pos = String(record.get('pos'));
          const nextId = deterministicId('el', [ctx.docId, id, pos]);
          tp.delete(id);
          writeElementRecord(tp, { ...json, id: nextId }, pos);
          const fields = ctx.doc.getMap<unknown>('titlePage').get('fields');
          if (fields instanceof Y.Map) for (const [field, target] of fields.entries()) if (target === id) fields.set(field, nextId);
        }),
      );
  },
};

const I4: Invariant = {
  code: 'I4', severity: 'error', autoRepair: true,
  check(ctx) {
    const out = [];
    for (const map of [ctx.bodyElements, ctx.titleElements].filter((m): m is YMap => m !== null)) {
      const all = [...map.entries()].filter(([, v]) => v instanceof Y.Map) as [string, YMap][];
      for (const [id, el] of all) {
        const missing = (['pos', 'style', 'text', 'meta'] as const).filter((k) => (k === 'text' ? !(el.get('text') instanceof Y.Text) : el.get(k) === undefined));
        if (missing.length === 0) continue;
        const fallback = map === ctx.titleElements ? ctx.template.defaults.titleDefault : ctx.template.defaults.pasteFallback;
        out.push(issue(I4, `element ${id} lacks ${missing.join(', ')}`, [id], () => {
          if (missing.includes('pos')) {
            const earlier = all.filter(([other, e]) => other < id && typeof e.get('pos') === 'string').map(([, e]) => String(e.get('pos'))).sort();
            const prev = earlier[earlier.length - 1] ?? null;
            const later = all.map(([, e]) => e.get('pos')).filter((p): p is string => typeof p === 'string' && (prev === null || p > prev)).sort();
            el.set('pos', positionBetween(prev, later[0] ?? null, null));
          }
          if (missing.includes('style')) el.set('style', fallback);
          if (missing.includes('text')) el.set('text', new Y.Text());
          if (missing.includes('meta')) el.set('meta', { createdBy: 'system', createdAt: 0, editedBy: 'system', editedAt: 0 });
        }));
      }
    }
    return out;
  },
};

const I5: Invariant = {
  code: 'I5', severity: 'error', autoRepair: true,
  check(ctx) {
    const out = [];
    const lists: [YMap | null, readonly StyleDef[], string][] = [
      [ctx.bodyElements, ctx.template.styles, ctx.template.defaults.pasteFallback],
      [ctx.titleElements, ctx.template.titlePageStyles, ctx.template.defaults.titleDefault],
    ];
    for (const [map, styles, fallback] of lists) {
      if (!map) continue;
      const ids = new Set(styles.map((s) => s.id as string));
      for (const [id, v] of map.entries()) {
        if (!(v instanceof Y.Map)) continue;
        const style = v.get('style');
        if (typeof style !== 'string' || ids.has(style)) continue;
        const role = BUILTIN_STYLE_ROLES.get(style);
        const target = (role && styles.find((s) => s.role === role)?.id) ?? fallback;
        out.push(issue(I5, `element ${id} uses unknown style ${style}`, [id], () => v.set('style', target)));
      }
    }
    return out;
  },
};

const I6: Invariant = {
  code: 'I6', severity: 'error', autoRepair: true,
  check(ctx) {
    const styles = ctx.doc.getMap<unknown>('template').get('styles');
    if (!(styles instanceof Y.Map)) return [issue(I6, 'template has no styles', [])];
    const root = ctx.template.defaults.root;
    const styleMap = (id: string) => styles.get(id) as YMap | undefined;
    return validateTemplate(ctx.template as never)
      .filter((t) => ['basedOnCycle', 'missingParent', 'multipleRoots', 'noRoot', 'rootMismatch', 'incompleteRoot'].includes(t.code))
      .map((t) => {
        const target = t.styleId ? styleMap(t.styleId) : undefined;
        let repair: (() => void) | undefined;
        if ((t.code === 'basedOnCycle' || t.code === 'missingParent') && target && t.styleId !== root) repair = () => target.set('basedOn', root);
        if (t.code === 'multipleRoots') {
          repair = () => {
            for (const s of ctx.template.styles) if (s.basedOn === null && s.id !== root) styleMap(s.id)?.set('basedOn', root);
          };
        }
        if (t.code === 'incompleteRoot' && target && t.field) {
          const field = t.field;
          repair = () => {
            if (field.startsWith('font.')) (target.get('font') as YMap).set(field.slice(5), ROOT_STYLE_DEFAULTS.font[field.slice(5) as (typeof FONT_KEYS)[number]]);
            else if (field.startsWith('flow.')) (target.get('flow') as YMap).set(field.slice(5), ROOT_STYLE_DEFAULTS.flow[field.slice(5) as (typeof FLOW_KEYS)[number]]);
            else target.set(field, ROOT_STYLE_DEFAULTS[field as (typeof ROOT_REQUIRED_KEYS)[number]]);
          };
        }
        return issue(I6, t.message, t.styleId ? [t.styleId] : [], repair);
      });
  },
};

const I18: Invariant = {
  code: 'I18', severity: 'info', autoRepair: true,
  check(ctx) {
    const out: ReturnType<Invariant['check']> = [];
    for (const { elementId: id, text } of allTexts(ctx)) {
      const s = text.toString();
      if (s === s.normalize('NFC')) continue;
      out.push(issue(I18, `element ${id} text is not NFC`, [id], () => {
        const delta = (text.toDelta() as YDeltaOp[]).map((op) => (typeof op.insert === 'string' ? { ...op, insert: op.insert.normalize('NFC') } : op));
        text.delete(0, text.length);
        text.applyDelta(delta);
      }));
    }
    return out;
  },
};

const I19: Invariant = {
  code: 'I19', severity: 'info', autoRepair: true,
  check(ctx) {
    const out = [];
    for (const map of [ctx.bodyElements, ctx.titleElements]) {
      if (!map) continue;
      const ordered = orderElements(map);
      if (!ordered.some((e) => String(e.get('pos') ?? '').length > MAX_POSITION_LENGTH)) continue;
      out.push(issue(I19, `position keys exceed ${MAX_POSITION_LENGTH} characters`, [], () => {
        const keys = rebalancePositions(ordered.length);
        ordered.forEach((e, i) => e.set('pos', keys[i]!));
      }));
    }
    return out;
  },
};

const I20: Invariant = {
  code: 'I20', severity: 'error', autoRepair: false,
  check(ctx) {
    const version = Number(ctx.doc.getMap('meta').get('schemaVersion') ?? 1);
    return version > ctx.codeVersion ? [issue(I20, `document schema ${version} is newer than code ${ctx.codeVersion}; open read-only`, [])] : [];
  },
};

export const STRUCTURAL_INVARIANTS: readonly Invariant[] = [I1, I2, I3, I4, I5, I6, I18, I19, I20];
