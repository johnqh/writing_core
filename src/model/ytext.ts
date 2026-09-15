import type * as Y from 'yjs';
import { canonicalJSON } from '../hash/canonical-json.js';
import type { Embed, EmbedAt, TextJSON, TextRun } from '../schema/text.js';

export interface YDeltaOp {
  insert: string | object;
  attributes?: Record<string, unknown>;
}

export function textJSONToDelta(t: TextJSON): YDeltaOp[] {
  const ops: YDeltaOp[] = [];
  const embeds = [...t.embeds].sort((a, b) => a.at - b.at);
  let y = 0;
  let e = 0;
  const flushEmbeds = () => {
    while (e < embeds.length && embeds[e]!.at === y) {
      ops.push({ insert: { ...embeds[e]!.embed } });
      y++;
      e++;
    }
  };
  flushEmbeds();
  for (const run of t.runs) {
    let rest = run.text;
    while (rest.length > 0) {
      const nextAt = e < embeds.length ? embeds[e]!.at : Number.POSITIVE_INFINITY;
      const take = Math.min(rest.length, nextAt - y);
      const op: YDeltaOp = { insert: rest.slice(0, take) };
      if (Object.keys(run.attrs).length > 0) op.attributes = { ...run.attrs };
      ops.push(op);
      y += take;
      rest = rest.slice(take);
      flushEmbeds();
    }
  }
  flushEmbeds();
  if (e < embeds.length) throw new RangeError(`embed at ${embeds[e]!.at} is beyond the text (length ${y})`);
  return ops;
}

export function deltaToTextJSON(delta: YDeltaOp[]): TextJSON {
  const runs: TextRun[] = [];
  const embeds: EmbedAt[] = [];
  let y = 0;
  for (const op of delta) {
    if (typeof op.insert === 'string') {
      const attrs = (op.attributes ?? {}) as TextRun['attrs'];
      const last = runs[runs.length - 1];
      if (last && canonicalJSON(last.attrs) === canonicalJSON(attrs)) last.text += op.insert;
      else runs.push({ text: op.insert, attrs: { ...attrs } });
      y += op.insert.length;
    } else {
      embeds.push({ at: y, embed: { ...(op.insert as Embed) } });
      y += 1;
    }
  }
  return { plain: runs.map((r) => r.text).join(''), runs, embeds };
}

export function writeTextJSON(ytext: Y.Text, t: TextJSON): void {
  if (ytext.length > 0) throw new Error('writeTextJSON requires an empty Y.Text');
  ytext.applyDelta(textJSONToDelta(t));
}

export function readTextJSON(ytext: Y.Text): TextJSON {
  return deltaToTextJSON(ytext.toDelta() as YDeltaOp[]);
}

export interface MarkRange { key: string; index: number; length: number; value: unknown }
export interface EmbedHit { index: number; embed: Record<string, unknown> }

/** Every attribute run and embed of a Y.Text with its Y.Text index (validation, occurrences, entity delete). */
export function scanText(text: Y.Text): { marks: MarkRange[]; embeds: EmbedHit[] } {
  const marks: MarkRange[] = [];
  const embeds: EmbedHit[] = [];
  let index = 0;
  for (const op of text.toDelta() as YDeltaOp[]) {
    const length = typeof op.insert === 'string' ? op.insert.length : 1;
    if (typeof op.insert === 'string') {
      for (const [key, value] of Object.entries(op.attributes ?? {})) marks.push({ key, index, length, value });
    } else {
      embeds.push({ index, embed: op.insert as Record<string, unknown> });
    }
    index += length;
  }
  return { marks, embeds };
}
