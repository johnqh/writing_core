import type { IdSource } from '../ids/id-source.js';
import type { ElementId, EntityId, FolderId, StyleId } from '../ids/ids.js';
import type { EntityJSON } from '../schema/entities.js';
import type {
  ElementMeta, ElementNumbering, NoteJSON, OmitRecord, TagCategoryJSON, TagJSON, TrackChangeRecord,
} from '../schema/document.js';
import type { ElementOverrides } from '../schema/template.js';
import type { TextJSON } from '../schema/text.js';
import type { StyleRole, TitleField } from '../schema/vocab.js';
import type { ParsedSceneHeading } from './scene-heading.js';

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

export interface SceneView {
  readonly id: ElementId;
  readonly index: number;
  readonly headingText: string;
  readonly heading: ParsedSceneHeading;
  readonly number: string | null;
  readonly elementIds: readonly ElementId[];
  readonly folderPath: readonly FolderId[];
  readonly actId: string | null;
  readonly synopsis: TextSnapshot;
  readonly color: string | null;
  readonly title: string;
  readonly locationId: EntityId | null;
  readonly characterIds: readonly EntityId[];
  readonly omitted: boolean;
  readonly storyDay: string;
  readonly versions: readonly { id: string; name: string; createdAt: number }[];
}

export interface DialogueBlockView {
  readonly speakerId: ElementId;
  readonly elementIds: readonly ElementId[];
  readonly name: string;
  readonly extension: string | null;
  readonly entityId: EntityId | null;
  readonly dualGroup: string | null;
  readonly sceneId: ElementId | null;
}

export interface OutlineNode {
  kind: 'root' | 'act' | 'sequence' | 'folder' | 'outline' | 'scene';
  id: string;
  title: string;
  level: number;
  elementId: ElementId | null;
  children: OutlineNode[];
}

export interface TitlePageView {
  readonly elements: readonly ElementView[];
  readonly fields: Partial<Record<TitleField, { elementId: ElementId; text: string }>>;
}

export type EntityView = Readonly<EntityJSON> & { readonly hidden: boolean };
export interface OccurrenceView {
  readonly sceneId: ElementId | null;
  readonly elementId: ElementId;
  readonly source: 'speaker' | 'heading' | 'tag';
  readonly range: { index: number; length: number } | null;
}
export type TagView = Readonly<TagJSON>;
export type TagCategoryView = Readonly<TagCategoryJSON>;
export type NoteView = Readonly<NoteJSON>;
export interface Suggestion {
  text: string;
  key: string;
  source: 'entity' | 'list';
  entityId: EntityId | null;
  count: number;
}
export interface SuggestionContext {
  elementId?: ElementId;
}
