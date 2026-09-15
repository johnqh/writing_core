// src/model/validate/marks.ts
import type * as Y from 'yjs';
import type { StyleId } from '../../ids/ids.js';
import type { StyleRole } from '../../schema/vocab.js';
import { resolveStyle } from '../../template/resolve.js';
import type { ValidationContext } from './context.js';

export { allTexts } from './context.js';
export { type EmbedHit, type MarkRange, scanText } from '../ytext.js';

export function roleOf(ctx: ValidationContext, element: Y.Map<unknown>): StyleRole | null {
  try {
    return resolveStyle(ctx.template, element.get('style') as StyleId).role;
  } catch {
    return null;
  }
}
