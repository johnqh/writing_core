import type { IdSource } from '../ids/id-source.js';
import type { ElementId, StyleId } from '../ids/ids.js';
import type { ElementMeta, ElementNumbering, OmitRecord, TrackChangeRecord } from '../schema/document.js';
import type { ElementOverrides } from '../schema/template.js';
import type { TextJSON } from '../schema/text.js';
import type { StyleRole, TitleField } from '../schema/vocab.js';

export type TextSnapshot = TextJSON;

export interface ElementView {
  readonly id: ElementId;
  readonly pos: string;
  readonly style: StyleId;
  readonly role: StyleRole | null;
  readonly text: TextSnapshot;
  readonly ov: ElementOverrides;
  readonly num: ElementNumbering | null;
  readonly hasScene: boolean;
  readonly dual: { group: string; side: 'left' | 'right' } | null;
  readonly altCount: number;
  readonly label: string | null;
  readonly outlineLevel: number | null;
  readonly shotId: string | null;
  readonly folderId: string | null;
  readonly lineAdjust: { deltaRight: number; auto: boolean } | null;
  readonly tc: TrackChangeRecord | null;
  readonly omit: OmitRecord | null;
  readonly meta: ElementMeta;
  readonly field: TitleField | null;
}

export type ModelChange =
  | { kind: 'elements'; inserted: string[]; removed: string[]; changed: string[]; reordered: boolean }
  | { kind: 'template'; styleIds: string[] | 'all' }
  | { kind: 'titlePage' }
  | { kind: 'entities'; ids: string[] }
  | { kind: 'tags'; ids: string[] }
  | { kind: 'notes'; ids: string[] }
  | { kind: 'revisions' } | { kind: 'trackChanges' } | { kind: 'production' }
  | { kind: 'folders' } | { kind: 'beats'; ids: string[] } | { kind: 'shots'; ids: string[] }
  | { kind: 'smartType' } | { kind: 'settings' } | { kind: 'bin' } | { kind: 'bookmarks' } | { kind: 'macros' };

export interface ModelChangeBatch {
  changes: ModelChange[];
  origin: unknown;
  local: boolean;
}

export interface ModelDeps {
  ids: IdSource;
  clock: () => number;
  locale: string;
}

export type Unsubscribe = () => void;
