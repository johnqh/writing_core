import * as Y from 'yjs';
import type { ElementId, EntityId, FolderId } from '../ids/ids.js';
import { readTextJSON } from '../model/ytext.js';
import { SCENE_BOUNDARY_ROLES, SCENE_ROLES, SPEAKER_ROLES, SPEECH_MEMBER_ROLES } from '../schema/vocab.js';
import { stripExtension } from '../smarttype/normalize.js';
import { formatNumberLabel } from './number-label.js';
import { type HeadingVocabulary, parseSceneHeading } from './scene-heading.js';
import type { DialogueBlockView, ElementView, OutlineNode, SceneView } from './views.js';

export interface StructureInput {
  elements: readonly ElementView[];
  sceneMap(id: string): Y.Map<unknown> | undefined;
  folders: readonly { id: string; kind: 'act' | 'sequence' | 'folder'; title: string; parentId: string | null }[];
  vocab: HeadingVocabulary;
  resolveEntity(kind: 'character' | 'location', name: string): EntityId | null;
  castTagsByElement: ReadonlyMap<string, readonly EntityId[]>;
}

const inList = (list: readonly string[], role: string | null) => role !== null && list.includes(role);

export function computeScenes(input: StructureInput): SceneView[] {
  const scenes: SceneView[] = [];
  const folderById = new Map(input.folders.map((f) => [f.id, f] as const));
  let actId: string | null = null;
  let current: { view: ElementView; members: ElementView[]; actId: string | null } | null = null;
  let index = 0;

  const close = () => {
    if (!current) return;
    const { view, members } = current;
    const scene = input.sceneMap(view.id);
    const omitted = scene?.get('omit') != null;
    const heading = parseSceneHeading(view.text.plain, input.vocab);
    const folderPath: FolderId[] = [];
    let fid = view.folderId;
    const guard = new Set<string>();
    while (fid && folderById.has(fid) && !guard.has(fid)) {
      guard.add(fid);
      folderPath.unshift(fid as FolderId);
      fid = folderById.get(fid)!.parentId;
    }
    const characterIds = new Set<EntityId>();
    for (const m of members) {
      if (inList(SPEAKER_ROLES, m.role)) {
        const e = input.resolveEntity('character', stripExtension(m.text.plain).name);
        if (e) characterIds.add(e);
      }
      for (const e of input.castTagsByElement.get(m.id) ?? []) characterIds.add(e);
    }
    const explicitLocation = (scene?.get('locationId') as EntityId | null | undefined) ?? null;
    const synopsis = scene?.get('synopsis');
    const versions = scene?.get('versions');
    scenes.push(Object.freeze({
      id: view.id,
      index: omitted ? -1 : index++,
      headingText: view.text.plain,
      heading,
      number: view.num?.locked || view.num?.manual ? formatNumberLabel(view.num.label) : null,
      elementIds: Object.freeze(members.map((m) => m.id)),
      folderPath: Object.freeze(folderPath),
      actId: current.actId ?? (folderPath.find((f) => folderById.get(f)!.kind === 'act') ?? null),
      synopsis: synopsis instanceof Y.Text ? readTextJSON(synopsis) : { plain: '', runs: [], embeds: [] },
      color: (scene?.get('color') as string | null | undefined) ?? null,
      title: (scene?.get('title') as string | undefined) ?? '',
      locationId: explicitLocation
        ?? (heading.location ? input.resolveEntity('location', heading.location) : null)
        ?? (heading.subLocations[0] ? input.resolveEntity('location', heading.subLocations[0]) : null),
      characterIds: Object.freeze([...characterIds]),
      omitted,
      storyDay: (scene?.get('storyDay') as string | undefined) ?? '',
      versions: Object.freeze(versions instanceof Y.Array ? versions.toArray().map((v) => {
        const m = v as Y.Map<unknown>;
        return { id: String(m.get('id')), name: String(m.get('name')), createdAt: Number(m.get('createdAt')) };
      }) : []),
    }));
    current = null;
  };

  for (const el of input.elements) {
    if (inList(SCENE_BOUNDARY_ROLES, el.role)) {
      close();
      if (el.role === 'actStart') actId = el.id;
      if (inList(SCENE_ROLES, el.role)) current = { view: el, members: [el], actId };
      continue;
    }
    // actEnd closes the derived act (spec 01 §5.13) but is not a scene boundary (§3.4.1).
    if (el.role === 'actEnd') actId = null;
    current?.members.push(el);
  }
  close();
  return scenes;
}

export function computeDialogueBlocks(input: StructureInput, scenes: readonly SceneView[]): DialogueBlockView[] {
  const sceneOf = new Map<string, ElementId>();
  for (const s of scenes) for (const id of s.elementIds) sceneOf.set(id, s.id);
  const blocks: DialogueBlockView[] = [];
  let current: { speaker: ElementView; ids: ElementId[] } | null = null;
  const close = () => {
    if (!current) return;
    const { name, extension } = stripExtension(current.speaker.text.plain);
    blocks.push(Object.freeze({
      speakerId: current.speaker.id, elementIds: Object.freeze(current.ids), name, extension,
      entityId: input.resolveEntity('character', name), dualGroup: current.speaker.dual?.group ?? null,
      sceneId: sceneOf.get(current.speaker.id) ?? null,
    }));
    current = null;
  };
  for (const el of input.elements) {
    if (inList(SPEAKER_ROLES, el.role)) {
      close();
      current = { speaker: el, ids: [el.id] };
    } else if (current && inList(SPEECH_MEMBER_ROLES, el.role)) {
      current.ids.push(el.id);
    } else close();
  }
  close();
  return blocks;
}

export function computeOutlineTree(input: StructureInput, scenes: readonly SceneView[]): OutlineNode {
  const root: OutlineNode = { kind: 'root', id: 'root', title: '', level: 0, elementId: null, children: [] };
  const sceneById = new Map(scenes.map((s) => [s.id, s] as const));
  const folderById = new Map(input.folders.map((f) => [f.id, f] as const));
  let act: OutlineNode | null = null;
  let sequence: OutlineNode | null = null;
  const outlines: OutlineNode[] = [];
  const folderNodes = new Map<string, OutlineNode>();

  const container = () => outlines[outlines.length - 1] ?? sequence ?? act ?? root;
  const node = (kind: OutlineNode['kind'], el: ElementView, level = 0): OutlineNode => ({ kind, id: el.id, title: el.text.plain, level, elementId: el.id, children: [] });

  const folderNode = (folderId: string, base: OutlineNode): OutlineNode => {
    const existing = folderNodes.get(folderId);
    if (existing) return existing;
    const f = folderById.get(folderId)!;
    const parent = f.parentId && folderById.has(f.parentId) ? folderNode(f.parentId, base) : base;
    const created: OutlineNode = { kind: f.kind === 'folder' ? 'folder' : f.kind, id: f.id, title: f.title, level: 0, elementId: null, children: [] };
    parent.children.push(created);
    folderNodes.set(folderId, created);
    return created;
  };

  for (const el of input.elements) {
    switch (el.role) {
      case 'actStart':
        act = node('act', el);
        root.children.push(act);
        sequence = null;
        outlines.length = 0;
        folderNodes.clear();
        break;
      case 'actEnd':
        act = null;
        sequence = null;
        outlines.length = 0;
        break;
      case 'sequence':
        sequence = node('sequence', el);
        (act ?? root).children.push(sequence);
        outlines.length = 0;
        break;
      case 'outline': {
        const level = el.outlineLevel ?? 1;
        while (outlines.length > 0 && outlines[outlines.length - 1]!.level >= level) outlines.pop();
        const n = node('outline', el, level);
        container().children.push(n);
        outlines.push(n);
        break;
      }
      default: {
        const scene = sceneById.get(el.id);
        if (!scene) break;
        const target = el.folderId && folderById.has(el.folderId) ? folderNode(el.folderId, container()) : container();
        target.children.push({ kind: 'scene', id: scene.id, title: scene.headingText, level: 0, elementId: scene.id, children: [] });
      }
    }
  }
  return root;
}
