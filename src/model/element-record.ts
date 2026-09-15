import * as Y from 'yjs';
import type { ElementId, StyleId } from '../ids/ids.js';
import type { ElementMeta } from '../schema/document.js';
import type { ElementOverrides } from '../schema/template.js';
import type { TextJSON } from '../schema/text.js';
import type { TitleField } from '../schema/vocab.js';
import { setJSONMap } from './ymap.js';
import { textJSONToDelta } from './ytext.js';

export interface NewElement {
  id: ElementId;
  pos: string;
  style: StyleId;
  text?: TextJSON;
  ov?: ElementOverrides;
  field?: TitleField;
}

export function insertElementRecord(elements: Y.Map<unknown>, el: NewElement, meta: ElementMeta): Y.Map<unknown> {
  const record = new Y.Map<unknown>();
  elements.set(el.id, record);
  record.set('id', el.id);
  record.set('pos', el.pos);
  record.set('style', el.style);
  const text = new Y.Text();
  record.set('text', text);
  // NFC per inserted string: embeds are separate delta ops, so their positions stay aligned.
  if (el.text) text.applyDelta(textJSONToDelta(el.text).map((op) => (typeof op.insert === 'string' ? { ...op, insert: op.insert.normalize('NFC') } : op)));
  if (el.ov && Object.keys(el.ov).length > 0) setJSONMap(record, 'ov', el.ov);
  if (el.field) record.set('field', el.field);
  record.set('meta', { ...meta });
  return record;
}
