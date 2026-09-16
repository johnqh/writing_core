import * as Y from 'yjs';
import { z } from 'zod/v4';
import type { ElementId } from '../ids/ids.js';
import type { YDeltaOp } from '../model/ytext.js';
import { bodyElements, documentLanguage, elementIdsBetween, inheritedAttributes, mergeElements, removeElement, resolveRange } from './element-ops.js';
import { policyDelete, policyInsert, touchElement, writePolicy } from './marks-policy.js';
import { WireDocPos, WireRange, resolveWirePos } from './positions.js';
import { defineCommand } from './registry.js';
import { nextBoundary, previousBoundary } from './segment.js';
import type { CommandContext, CommandResult, CommandSpec } from './types.js';

const ok: CommandResult = { ok: true };
const refuse = (reason: 'invalidPosition' | 'notApplicable' | 'emptySelection'): CommandResult => ({ ok: false, reason });
const Marks = z.record(z.string(), z.unknown());
const spec = defineCommand;

/**
 * Marks a command as safe to skip rehearsal (spec 08 / Task 24's `fastPath` contract): every
 * branch that can refuse in `text.insert`/`insertSoftReturn`/`deleteBackward`/`deleteForward`
 * does so before that command's first write, so opting out of the throwaway-replica rehearsal
 * cannot leave a partial write committed. These four are the typing hot path (character insert,
 * soft return, backspace, forward delete); every other command in this file keeps the default
 * (rehearsed) behaviour because it either isn't hot-path or has a refuse-after-write shape
 * (e.g. `text.replaceRange` calls `deleteRangeImpl` and can still return its failure).
 */
function fast<P>(s: CommandSpec<P>): CommandSpec<P> {
  return { ...s, fastPath: true };
}

function insertAt(ctx: CommandContext, pos: WireDocPos, text: string, marks?: Record<string, unknown>): CommandResult {
  const r = resolveWirePos(ctx.doc, pos);
  if (!r) return refuse('invalidPosition');
  const policy = writePolicy(ctx);
  policyInsert(policy, r.text, r.index, text, marks ?? inheritedAttributes(r.text, r.index));
  touchElement(r.element, policy);
  return ok;
}

const SPECIAL: Record<string, string> = { nbsp: ' ', nbhyphen: '‑', emdash: '—', ellipsis: '…' };

function dualOrColumnBoundary(ctx: CommandContext, a: ElementId, b: ElementId): boolean {
  const ea = ctx.model.element(a)!;
  const eb = ctx.model.element(b)!;
  if ((ea.dual?.group ?? null) !== (eb.dual?.group ?? null)) return true;
  return (ea.ov.column ?? ctx.model.resolveStyle(a).column) !== (eb.ov.column ?? ctx.model.resolveStyle(b).column);
}

function deleteRangeImpl(ctx: CommandContext, range: WireRange): CommandResult {
  const resolved = resolveRange(ctx, range);
  if (!resolved) return refuse('invalidPosition');
  const [from, to] = resolved;
  const policy = writePolicy(ctx);
  if (from.elementId === to.elementId) {
    if (to.index === from.index) return refuse('emptySelection');
    policyDelete(policy, from.text, from.index, to.index - from.index);
    touchElement(from.element, policy);
    return ok;
  }
  const ids = elementIdsBetween(ctx, from.elementId, to.elementId);
  // Spec 08 §3.2: fully covered elements are removed; partial first/last are trimmed, then joined only if the same style.
  const fromCovered = from.index === 0;
  const toCovered = to.index === to.text.length;
  const sameStyle = from.element.get('style') === to.element.get('style');
  if (toCovered) removeElement(ctx, to.elementId);
  else {
    policyDelete(policy, to.text, 0, to.index);
    touchElement(to.element, policy);
  }
  for (const id of ids.slice(1, -1)) removeElement(ctx, id);
  if (fromCovered) removeElement(ctx, from.elementId);
  else {
    policyDelete(policy, from.text, from.index, from.text.length - from.index);
    touchElement(from.element, policy);
  }
  if (!fromCovered && !toCovered && sameStyle && !policy.track) mergeElements(ctx, from.elementId, to.elementId);
  return ok;
}

export const TEXT_COMMANDS: CommandSpec<never>[] = [
  fast(spec('text.insert', z.object({ at: WireDocPos, text: z.string().min(1), marks: Marks.optional() }), (ctx, p) => insertAt(ctx, p.at, p.text, p.marks))),
  fast(spec('text.insertSoftReturn', z.object({ at: WireDocPos }), (ctx, p) => insertAt(ctx, p.at, '\n'))),
  spec('text.insertSpecial', z.object({ at: WireDocPos, char: z.string().min(1) }), (ctx, p) => insertAt(ctx, p.at, SPECIAL[p.char] ?? p.char)),

  fast(spec('text.deleteBackward', z.object({ at: WireDocPos, unit: z.enum(['char', 'grapheme', 'word', 'line', 'element']) }), (ctx, p) => {
    if (p.unit === 'line') return refuse('notApplicable');
    const r = resolveWirePos(ctx.doc, p.at);
    if (!r) return refuse('invalidPosition');
    if (p.unit === 'element') {
      removeElement(ctx, r.elementId);
      return { ok: true, effects: [{ kind: 'elementRemoved', id: r.elementId }] };
    }
    if (r.index > 0) {
      const policy = writePolicy(ctx);
      const start = previousBoundary(r.text.toString(), r.index, p.unit);
      policyDelete(policy, r.text, start, r.index - start);
      touchElement(r.element, policy);
      return ok;
    }
    const previous = ctx.model.previous(r.elementId);
    if (!previous) return refuse('notApplicable');
    if (r.text.length === 0) {
      removeElement(ctx, r.elementId);
      return { ok: true, effects: [{ kind: 'elementRemoved', id: r.elementId }] };
    }
    if (dualOrColumnBoundary(ctx, previous.id, r.elementId)) return ok;
    mergeElements(ctx, previous.id, r.elementId);
    return { ok: true, effects: [{ kind: 'elementRemoved', id: r.elementId }] };
  })),

  fast(spec('text.deleteForward', z.object({ at: WireDocPos, unit: z.enum(['char', 'grapheme', 'word', 'line', 'element']) }), (ctx, p) => {
    if (p.unit === 'line') return refuse('notApplicable');
    const r = resolveWirePos(ctx.doc, p.at);
    if (!r) return refuse('invalidPosition');
    if (p.unit === 'element') {
      removeElement(ctx, r.elementId);
      return { ok: true, effects: [{ kind: 'elementRemoved', id: r.elementId }] };
    }
    if (r.index < r.text.length) {
      const policy = writePolicy(ctx);
      const end = nextBoundary(r.text.toString(), r.index, p.unit);
      policyDelete(policy, r.text, r.index, end - r.index);
      touchElement(r.element, policy);
      return ok;
    }
    const next = ctx.model.next(r.elementId);
    if (!next) return refuse('notApplicable');
    const nextText = (ctx.doc.getMap<unknown>('elements').get(next.id) as Y.Map<unknown>).get('text') as Y.Text;
    if (nextText.length === 0) {
      removeElement(ctx, next.id);
      return { ok: true, effects: [{ kind: 'elementRemoved', id: next.id }] };
    }
    if (dualOrColumnBoundary(ctx, r.elementId, next.id)) return ok;
    mergeElements(ctx, r.elementId, next.id);
    return { ok: true, effects: [{ kind: 'elementRemoved', id: next.id }] };
  })),

  spec('text.deleteRange', z.object({ range: WireRange }), (ctx, p) => deleteRangeImpl(ctx, p.range)),

  spec('text.replaceRange', z.object({ range: WireRange, text: z.string(), marks: Marks.optional() }), (ctx, p) => {
    const resolved = resolveRange(ctx, p.range);
    if (!resolved) return refuse('invalidPosition');
    const [from] = resolved;
    const startIndex = from.index;
    const marks = p.marks ?? inheritedAttributes(from.text, from.index + (resolved[1].elementId === from.elementId && resolved[1].index > from.index ? 1 : 0));
    const collapsed = from.elementId === resolved[1].elementId && from.index === resolved[1].index;
    if (!collapsed) {
      const result = deleteRangeImpl(ctx, p.range);
      if (!result.ok) return result;
    }
    if (p.text) {
      const policy = writePolicy(ctx);
      // If the deletion removed a fully covered first element, the text goes to the start of the surviving last one.
      const target = bodyElements(ctx.doc).has(from.elementId) ? { text: from.text, at: startIndex } : { text: resolved[1].text, at: 0 };
      const offset = policy.revisionSetId && !policy.track ? 1 : 0;
      const index = Math.min(target.at + (collapsed ? 0 : offset * Number(hasRevDelAt(target.text, target.at))), target.text.length);
      policyInsert(policy, target.text, index, p.text, marks);
    }
    return ok;
  }),

  spec('text.transformCase', z.object({ range: WireRange, to: z.enum(['upper', 'lower', 'title', 'sentence']) }), (ctx, p) => {
    const resolved = resolveRange(ctx, p.range);
    if (!resolved) return refuse('invalidPosition');
    const [from, to] = resolved;
    const language = documentLanguage(ctx.doc);
    const policy = writePolicy(ctx);
    for (const id of elementIdsBetween(ctx, from.elementId, to.elementId)) {
      const el = ctx.doc.getMap<unknown>('elements').get(id) as Y.Map<unknown>;
      const text = el.get('text') as Y.Text;
      const start = id === from.elementId ? from.index : 0;
      const end = id === to.elementId ? to.index : text.length;
      const whole = text.toString();
      const target = transform(whole, start, end, p.to, language);
      // Rewrite changed runs only, keeping each run's formatting.
      let pos = 0;
      const edits: { index: number; length: number; replacement: string; attrs: Record<string, unknown> }[] = [];
      for (const op of text.toDelta() as YDeltaOp[]) {
        if (typeof op.insert !== 'string') { pos += 1; continue; }
        const from_ = Math.max(pos, start);
        const to_ = Math.min(pos + op.insert.length, end);
        if (from_ < to_) {
          const original = whole.slice(from_, to_);
          const replacement = target.slice(from_, to_);
          if (original !== replacement) edits.push({ index: from_, length: to_ - from_, replacement, attrs: op.attributes ?? {} });
        }
        pos += op.insert.length;
      }
      for (const e of edits.reverse()) {
        text.delete(e.index, e.length);
        policyInsert(policy, text, e.index, e.replacement, e.attrs);
      }
      if (edits.length > 0) touchElement(el, policy);
    }
    return ok;
  }),
];

function hasRevDelAt(text: Y.Text, index: number): boolean {
  let pos = 0;
  for (const op of text.toDelta() as YDeltaOp[]) {
    const size = typeof op.insert === 'string' ? op.insert.length : 1;
    if (pos === index && typeof op.insert !== 'string' && (op.insert as { type?: string }).type === 'revDel') return true;
    pos += size;
    if (pos > index) break;
  }
  return false;
}

/** Same-length transforms only change characters within [start, end). */
function transform(whole: string, start: number, end: number, to: 'upper' | 'lower' | 'title' | 'sentence', language: string): string {
  const chars = [...whole];
  let offset = 0;
  let prev = start > 0 ? whole[start - 1]! : ' ';
  let sentenceStart = start === 0 || /[.!?]\s*$/.test(whole.slice(0, start));
  const out: string[] = [];
  for (const ch of chars) {
    const inRange = offset >= start && offset < end;
    let next = ch;
    if (inRange) {
      if (to === 'upper') next = ch.toLocaleUpperCase(language);
      else if (to === 'lower') next = ch.toLocaleLowerCase(language);
      else if (to === 'title') next = /\s/.test(prev) ? ch.toLocaleUpperCase(language) : ch.toLocaleLowerCase(language);
      else {
        next = sentenceStart && /\p{L}/u.test(ch) ? ch.toLocaleUpperCase(language) : ch.toLocaleLowerCase(language);
        if (/\p{L}/u.test(ch)) sentenceStart = false;
        if (/[.!?]/.test(ch)) sentenceStart = true;
      }
      if (next.length !== ch.length) next = ch; // keep offsets stable (e.g. ß → SS is left as ß)
    }
    out.push(next);
    prev = ch;
    offset += ch.length;
  }
  return out.join('');
}
