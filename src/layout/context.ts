/**
 * Spec 02 §10: the context pass (S2). One linear walk over the element sequence producing an
 * `ElementContext` per element: category, scene/act, omitted/hidden, speaker, automatic
 * continueds (§14.3), number label and a `decorationHash` for the paragraph-layout cache key.
 *
 * Speed-mode scope: `columnRowId` (§16) is not computed (always null; column rows are formed by `columns.ts`), and
 * graphic-novel `generatedText` (§17) is filled in afterwards by `panels.ts` (here only the §23.3 omitted placeholder); `decorationHash` does not fold in inactive
 * alternates' text versions (the pass has no `ViewSpec`).
 */

import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { NumberLabel } from '../schema/template.js';
import { normalizeKey } from '../smarttype/normalize.js';
import { resolveStyle } from '../template/resolve.js';
import type { AssignNumbersResult } from '../numbering/assign.js';
import { CATEGORY_RULES, categoryOf, type PaginationCategory } from './category.js';

export type SpeakerKey = string & { readonly __speakerKey: true };

export interface ElementContext {
  category: PaginationCategory;
  sceneId: ElementId | null;
  /** 0-based among scene boundaries; -1 for elements before the first boundary. */
  sceneOrdinal: number;
  actId: ElementId | null;
  omitted: boolean;
  hidden: boolean;
  speaker: SpeakerKey | null;
  autoContinued: boolean;
  numberLabel: NumberLabel | null;
  generatedText: string | null;
  dualSide: 'left' | 'right' | null;
  columnRowId: number | null;
  /** Graphic novel (§17, `panels.ts`): the rendered page/panel number label, and the inline label drawn before a panel's text. */
  pageLabel?: string | null;
  numberPrefix?: string | null;
  decorationHash: number;
}

export interface ContextPassResult {
  contexts: Map<ElementId, ElementContext>;
  order: ElementId[];
}

export interface ContextPassDeps {
  /** Speaker normalization; defaults to `normalizeKey(text, { speaker: true, ... })`. Injectable so tests can count calls. */
  normalizeSpeaker?: (text: string, language: string, contText: string) => string;
}

const defaultNormalize = (text: string, language: string, contText: string): string =>
  normalizeKey(text, { language, speaker: true, contTexts: [contText] });

const memos = new WeakMap<DocumentModel, Map<ElementId, { version: number; key: SpeakerKey }>>();

const foldContd = (s: string): string => s.replace(/\s+/g, '').replace(/[‘’ʼ`]/g, "'").toUpperCase();

function fnv1a(parts: readonly string[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x7c;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function contextPass(
  model: DocumentModel,
  template: EmbeddedTemplateJSON,
  numbers: AssignNumbersResult,
  deps: ContextPassDeps = {},
): ContextPassResult {
  const normalize = deps.normalizeSpeaker ?? defaultNormalize;
  const language = model.meta().language;
  const outlineHidden = model.settings().outlineHidden;
  const contText = template.continueds.cont;
  const contFolded = foldContd(contText);
  const continuedsOn = template.pagination.automaticContinueds.enabled;
  let memo = memos.get(model);
  if (!memo) memos.set(model, (memo = new Map()));

  const contexts = new Map<ElementId, ElementContext>();
  const order: ElementId[] = [];

  let sceneId: ElementId | null = null;
  let sceneOrdinal = -1;
  let actId: ElementId | null = null;
  let lastSpeaker: SpeakerKey | null = null;
  let interrupted = false;

  for (const el of model.elements()) {
    const style = resolveStyle(template, el.style);
    const category = categoryOf(style);
    const boundary = CATEGORY_RULES[category].sceneBoundary;
    if (boundary) {
      sceneId = el.id;
      sceneOrdinal++;
      lastSpeaker = null;
      interrupted = false;
    }
    if (category === 'actBreak') actId = el.id;

    const omitted = el.sceneOmit !== null;
    const isHeadingOfOmitted = boundary && omitted;
    const outlineOrNote = el.role === 'outline' || el.role === 'note';
    const hidden = (omitted && !isHeadingOfOmitted) || (outlineOrNote && style.hiddenInScript && outlineHidden);

    let speaker: SpeakerKey | null = null;
    let autoContinued = false;
    if (category === 'character') {
      const version = model.textVersion(el.id);
      const cached = memo.get(el.id);
      if (cached && cached.version === version) speaker = cached.key;
      else {
        speaker = normalize(el.text.plain, language, contText) as SpeakerKey;
        memo.set(el.id, { version, key: speaker });
      }
      if (!hidden) {
        const folded = foldContd(el.text.plain);
        const alreadyContd = (contFolded !== '' && folded.includes(contFolded)) || folded.includes("(CONT'D)");
        autoContinued = continuedsOn && lastSpeaker !== null && lastSpeaker === speaker && interrupted && !alreadyContd;
        // A dual block resets the last speaker to none (§14.3 condition 3).
        lastSpeaker = el.dual !== null ? null : speaker;
        interrupted = false;
      }
    } else if (!hidden && !boundary && CATEGORY_RULES[category].dialogueBlock === false) {
      interrupted = true;
    }

    const generatedText = isHeadingOfOmitted ? template.continueds.omitted : null;
    contexts.set(el.id, {
      category, sceneId, sceneOrdinal, actId, omitted, hidden, speaker, autoContinued,
      numberLabel: numbers.labels.get(el.id)?.label ?? null,
      generatedText,
      dualSide: el.dual?.side ?? null,
      columnRowId: null,
      decorationHash: fnv1a([String(autoContinued), generatedText ?? '~null', String(hidden)]),
    });
    order.push(el.id);
  }
  return { contexts, order };
}
