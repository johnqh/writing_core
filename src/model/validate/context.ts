import * as Y from 'yjs';
import { DOC_SCHEMA_VERSION } from '../../migrations/index.js';
import type { EmbeddedTemplateJSON } from '../../schema/document.js';
import type { StyleRole } from '../../schema/vocab.js';
import { BUILTIN_TEMPLATES } from '../../templates/catalogue.js';
import { readEmbeddedTemplate } from '../embed-template.js';
import { orderElements } from '../ymap.js';

export interface ValidationContext {
  doc: Y.Doc;
  template: EmbeddedTemplateJSON;
  docId: string;
  bodyElements: Y.Map<unknown>;
  titleElements: Y.Map<unknown> | null;
  orderedBody(): Y.Map<unknown>[];
  codeVersion: number;
}

/** Role of every fixed built-in style id, for role-preserving repair of unknown styles (I5). */
export const BUILTIN_STYLE_ROLES: ReadonlyMap<string, StyleRole> = new Map(
  Object.values(BUILTIN_TEMPLATES).flatMap((t) => [...t.styles, ...t.titlePageStyles].map((s) => [s.id, s.role] as const)),
);

/** Every element text in the body and the title page. */
export function allTexts(ctx: ValidationContext): { elementId: string; text: Y.Text }[] {
  const out: { elementId: string; text: Y.Text }[] = [];
  for (const map of [ctx.bodyElements, ctx.titleElements]) {
    if (!map) continue;
    for (const [id, v] of map.entries()) {
      const t = v instanceof Y.Map ? v.get('text') : undefined;
      if (t instanceof Y.Text) out.push({ elementId: id, text: t });
    }
  }
  return out;
}

export function createValidationContext(doc: Y.Doc, codeVersion = DOC_SCHEMA_VERSION): ValidationContext {
  const tp = doc.getMap<unknown>('titlePage').get('elements');
  return {
    doc,
    template: readEmbeddedTemplate(doc),
    docId: String(doc.getMap('meta').get('docId') ?? ''),
    bodyElements: doc.getMap('elements'),
    titleElements: tp instanceof Y.Map ? (tp as Y.Map<unknown>) : null,
    orderedBody: () => orderElements(doc.getMap('elements')),
    codeVersion,
  };
}
