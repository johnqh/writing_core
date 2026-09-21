// Title page fields, header/footer and scene-number display settings, plus scene omit (spec 01 §5.12, §3.3, §3.7).
import * as Y from 'yjs';
import { z } from 'zod/v4';
import { type ElementId, type StyleId, newId } from '../ids/ids.js';
import { insertElementRecord } from '../model/element-record.js';
import { comparePositions, positionBetween } from '../model/positions.js';
import { childMap, lastPosition, setJSONMap } from '../model/ymap.js';
import { idSchema } from '../schema/primitives.js';
import { textJSONFromPlain } from '../schema/text.js';
import { SCENE_ROLES, TITLE_FIELDS, type TitleField } from '../schema/vocab.js';
import { resolveStyle } from '../template/resolve.js';
import { bodyElements } from './element-ops.js';
import { defineCommand } from './registry.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

type YMap = Y.Map<unknown>;
const S = (slug: string) => `st_${slug}` as StyleId;

function bumpRevision(ctx: CommandContext): void {
  const t = ctx.doc.getMap<unknown>('template');
  t.set('revision', ((t.get('revision') as number | undefined) ?? 0) + 1);
}

/** Style and overrides for a title-page field that has no element yet. */
function seedFor(field: TitleField, styleIds: readonly string[]): { style: StyleId; ov: Record<string, unknown> } {
  const has = (slug: string) => styleIds.includes(S(slug));
  const center = has('title_center') ? S('title_center') : (styleIds[0] as StyleId);
  const left = has('title_left') ? S('title_left') : center;
  const right = has('title_right') ? S('title_right') : center;
  switch (field) {
    case 'title':
      return { style: has('title') ? S('title') : center, ov: { spaceBefore: 20 } };
    case 'subtitle':
    case 'credit':
    case 'author':
    case 'source':
    case 'basedOn':
    case 'series':
    case 'episode':
      return { style: center, ov: { spaceBefore: 1 } };
    case 'draftDate':
    case 'revision':
    case 'wga':
      return { style: right, ov: { anchor: 'bottom' } };
    default:
      return { style: left, ov: { anchor: 'bottom' } };
  }
}

const HeaderFooterPatch = z.object({
  enabled: z.boolean().optional(),
  left: z.string().optional(),
  center: z.string().optional(),
  right: z.string().optional(),
  showOnFirstPage: z.boolean().optional(),
  showOnTitlePage: z.boolean().optional(),
  startAtPage: z.number().int().min(1).optional(),
});

const ContinuedsPatch = z.object({
  moreAtBottom: z.boolean().optional(),
  contAtTop: z.boolean().optional(),
  automaticContinueds: z.boolean().optional(),
  sceneTop: z.boolean().optional(),
  sceneBottom: z.boolean().optional(),
  sceneNumbered: z.boolean().optional(),
});

const SCENE_NUMBER_MODES = ['none', 'left', 'right', 'both'] as const;

export const PAGE_SETUP_COMMANDS: CommandSpec<never>[] = [
  // Sets one semantic title-page field's text; creates the field's element when the page has none.
  defineCommand('title.setField', z.object({ field: z.enum(TITLE_FIELDS), text: z.string() }), (ctx, p): CommandResult => {
    const tp = ctx.doc.getMap<unknown>('titlePage');
    const elements = tp.get('elements');
    const fields = tp.get('fields');
    if (!(elements instanceof Y.Map) || !(fields instanceof Y.Map)) return { ok: false, reason: 'notApplicable' };
    const existing = fields.get(p.field);
    const rec = typeof existing === 'string' ? (elements.get(existing) as YMap | undefined) : undefined;
    const meta = { createdBy: ctx.actor.userId, createdAt: ctx.clock(), editedBy: ctx.actor.userId, editedAt: ctx.clock() };
    if (rec) {
      const text = rec.get('text') as Y.Text;
      if (text.toString() !== p.text) {
        if (text.length > 0) text.delete(0, text.length);
        if (p.text) text.insert(0, p.text.normalize('NFC'));
        rec.set('meta', { ...(rec.get('meta') as Record<string, unknown>), editedBy: meta.editedBy, editedAt: meta.editedAt });
      }
      return { ok: true };
    }
    if (p.text === '') return { ok: true };
    const styleIds = ctx.model.template().titlePageStyles.map((s) => s.id);
    const seed = seedFor(p.field, styleIds);
    const id = newId('el', ctx.ids);
    // Flow fields go before the bottom-anchored block so the block stays last; bottom fields go at the end.
    const bottomAnchored = (seed.ov as { anchor?: string }).anchor === 'bottom';
    let firstBottom: string | null = null;
    for (const v of (elements as YMap).values()) {
      const m = v as YMap;
      const anchor = (m.get('ov') as YMap | undefined)?.get('anchor');
      const p2 = String(m.get('pos'));
      if (anchor === 'bottom' && (firstBottom === null || comparePositions(p2, firstBottom) < 0)) firstBottom = p2;
    }
    let before: string | null = null;
    if (!bottomAnchored && firstBottom !== null) {
      // The greatest position strictly below the first bottom element.
      for (const v of (elements as YMap).values()) {
        const p2 = String((v as YMap).get('pos'));
        if (comparePositions(p2, firstBottom) < 0 && (before === null || comparePositions(p2, before) > 0)) before = p2;
      }
    }
    const pos = !bottomAnchored && firstBottom !== null
      ? positionBetween(before, firstBottom, ctx.ids)
      : positionBetween(lastPosition(elements as YMap), null, ctx.ids);
    insertElementRecord(elements as YMap, { id, pos, style: seed.style, text: textJSONFromPlain(p.text), ov: seed.ov as never, field: p.field }, meta);
    (fields as YMap).set(p.field, id);
    return { ok: true, effects: [{ kind: 'elementCreated', id }] };
  }, { scope: 'titlePage' }),

  // Patches the template's header or footer (document-level, collaborative).
  defineCommand('template.setHeaderFooter', z.object({ which: z.enum(['header', 'footer']), patch: HeaderFooterPatch }), (ctx, p): CommandResult => {
    const map = childMap(ctx.doc.getMap<unknown>('template'), p.which);
    for (const [k, v] of Object.entries(p.patch)) if (v !== undefined) map.set(k, v);
    bumpRevision(ctx);
    return { ok: true };
  }),

  // Scene numbering display: none | left | right | both, on the template's scene-numbering style.
  defineCommand('template.setSceneNumbering', z.object({ mode: z.enum(SCENE_NUMBER_MODES) }), (ctx, p): CommandResult => {
    const styleId = ctx.model.template().sceneNumbering.styleId;
    const styles = childMap(ctx.doc.getMap<unknown>('template'), 'styles');
    const style = styles.get(styleId) as YMap | undefined;
    if (!style) return { ok: false, reason: 'notFound' };
    const enabled = p.mode !== 'none';
    let numbering = style.get('numbering');
    if (!(numbering instanceof Y.Map)) {
      numbering = setJSONMap(style, 'numbering', {
        enabled, counter: 'own', start: 1, format: '{n}', position: 'both', leftOffset: 685_800, rightOffset: 6_748_272,
        hideRightOnOverlap: true, resetAfterStyle: null, resetEvery: 0, suffixMode: '1AB', skipIO: false, autoOmit: false,
        omittedText: null, numberFont: null,
      });
    }
    const n = numbering as YMap;
    n.set('enabled', enabled);
    if (enabled) n.set('position', p.mode);
    bumpRevision(ctx);
    return { ok: true };
  }),

  // (MORE)/(CONT'D) and scene CONTINUED switches on the template's pagination rules (spec 02 §14).
  defineCommand('template.setContinueds', ContinuedsPatch, (ctx, p): CommandResult => {
    const pagination = childMap(ctx.doc.getMap<unknown>('template'), 'pagination');
    // The pagination groups are stored as plain JSON objects (or Y.Maps); either way replace the group, not the leaf.
    const patchGroup = (key: string, patch: Record<string, unknown>): void => {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return;
      const cur = pagination.get(key);
      if (cur instanceof Y.Map) for (const [k, v] of entries) cur.set(k, v);
      else pagination.set(key, { ...(cur as Record<string, unknown>), ...Object.fromEntries(entries) });
    };
    patchGroup('dialogue', { moreAtBottom: p.moreAtBottom, contAtTop: p.contAtTop });
    patchGroup('automaticContinueds', { enabled: p.automaticContinueds });
    patchGroup('sceneContinueds', { top: p.sceneTop, bottom: p.sceneBottom, numbered: p.sceneNumbered });
    bumpRevision(ctx);
    return { ok: true };
  }),

  // Omit / restore a whole scene (the heading's `scene.omit` record, spec 01 §5.6).
  defineCommand('scene.setOmitted', z.object({ scene: idSchema('el'), omitted: z.boolean() }), (ctx, p): CommandResult => {
    const heading = bodyElements(ctx.doc).get(p.scene as ElementId) as YMap | undefined;
    if (!heading) return { ok: false, reason: 'notFound' };
    const template = ctx.model.template();
    const style = heading.get('style') as StyleId;
    if (!template.styles.some((s) => s.id === style)) return { ok: false, reason: 'notFound' };
    if (!(SCENE_ROLES as readonly string[]).includes(resolveStyle(template, style).role)) return { ok: false, reason: 'notFound' };
    let scene = heading.get('scene');
    if (!(scene instanceof Y.Map)) {
      if (!p.omitted) return { ok: true };
      scene = heading.set('scene', new Y.Map<unknown>());
      const m = scene as YMap;
      m.set('synopsis', new Y.Text());
      m.set('color', null);
      m.set('title', '');
      m.set('locationId', null);
      m.set('storyDay', '');
      m.set('arcBeats', new Y.Map<unknown>());
      m.set('storylineIds', new Y.Map<unknown>());
      m.set('omit', null);
      m.set('versions', new Y.Array<unknown>());
      m.set('estimatedSeconds', null);
    }
    (scene as YMap).set('omit', p.omitted ? { at: ctx.clock(), by: ctx.actor.userId, rev: null } : null);
    return { ok: true };
  }, { scope: 'structure' }),
];
