import * as Y from 'yjs';
import { z } from 'zod/v4';
import type { ElementId } from '../ids/ids.js';
import { decodeRelativePosition, encodeRelativePosition } from '../model/portable-pos.js';
import type { DocumentModel } from '../read-model/open.js';
import { idSchema } from '../schema/primitives.js';

export const WireDocPos = z.union([
  z.object({ elementId: idSchema('el'), rel: z.string().min(1) }),
  z.object({ elementId: idSchema('el'), offset: z.number().int().min(0) }),
]);
export type WireDocPos = z.infer<typeof WireDocPos>;

export const WireRange = z.object({ anchor: WireDocPos, head: WireDocPos });
export type WireRange = z.infer<typeof WireRange>;

export interface ResolvedPos {
  elementId: ElementId;
  element: Y.Map<unknown>;
  text: Y.Text;
  index: number;
}

export function resolveWirePos(doc: Y.Doc, pos: WireDocPos, scope: 'body' | 'titlePage' = 'body'): ResolvedPos | null {
  const container = scope === 'body' ? doc.getMap<unknown>('elements') : (doc.getMap<unknown>('titlePage').get('elements') as Y.Map<unknown> | undefined);
  const element = container?.get(pos.elementId);
  if (!(element instanceof Y.Map)) return null;
  const text = element.get('text');
  if (!(text instanceof Y.Text)) return null;
  if ('offset' in pos) {
    return pos.offset <= text.length ? { elementId: pos.elementId, element: element as Y.Map<unknown>, text, index: pos.offset } : null;
  }
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(pos.rel), doc);
    if (!abs || abs.type !== text) return null;
    return { elementId: pos.elementId, element: element as Y.Map<unknown>, text, index: abs.index };
  } catch {
    return null;
  }
}

export function relPos(text: Y.Text, elementId: ElementId, index: number, assoc: -1 | 0 = 0): WireDocPos {
  return { elementId, rel: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index, assoc)) };
}

export function orderRange(model: DocumentModel, a: ResolvedPos, b: ResolvedPos): [ResolvedPos, ResolvedPos] {
  const ia = model.indexOf(a.elementId);
  const ib = model.indexOf(b.elementId);
  return ia < ib || (ia === ib && a.index <= b.index) ? [a, b] : [b, a];
}
