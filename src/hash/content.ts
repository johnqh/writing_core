import { BUILTIN_STYLE_RE } from '../ids/ids.js';
import type { EntityJSON } from '../schema/entities.js';
import type { TextJSON } from '../schema/text.js';
import { NON_PRINTING_ROLES, type StyleRole } from '../schema/vocab.js';
import { canonicalJSON } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export const HASH_VERSION = 1;
export type ContentHash = `v1:${string}`;

const HASHED_MARKS = ['b', 'i', 'u', 's', 'sc', 'va'] as const;

const v1 = (payload: string): ContentHash => `v1:${sha256Hex(payload)}`;

type Item = { ch: string; attrs: Record<string, unknown> } | { embed: { assetId: string; widthEmu: number; heightEmu: number } };

export function canonicalElementText(text: TextJSON): {
  text: string;
  runs: [number, number, Record<string, unknown>][];
  embeds: { at: number; assetId: string; widthEmu: number; heightEmu: number }[];
} {
  // 1. Interleave characters (UTF-16 units) and image embeds in Y.Text index order, dropping tracked deletions.
  const items: Item[] = [];
  const embeds = [...text.embeds].sort((a, b) => a.at - b.at);
  let y = 0;
  let e = 0;
  const flush = () => {
    while (e < embeds.length && embeds[e]!.at === y) {
      const emb = embeds[e]!.embed;
      if (emb.type === 'image') items.push({ embed: { assetId: emb.assetId, widthEmu: emb.widthEmu, heightEmu: emb.heightEmu } });
      y++;
      e++;
    }
  };
  flush();
  for (const run of text.runs) {
    const deleted = run.attrs.del !== undefined;
    const hashed: Record<string, unknown> = {};
    for (const k of HASHED_MARKS) if (run.attrs[k] !== undefined && run.attrs[k] !== null) hashed[k] = run.attrs[k];
    for (const unit of run.text.normalize('NFC')) {
      if (!deleted) for (let i = 0; i < unit.length; i++) items.push({ ch: unit[i]!, attrs: hashed });
      y += unit.length;
      flush();
    }
  }
  flush();

  // 2. Line endings: CRLF and CR become LF.
  const norm: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if ('ch' in it && it.ch === '\r') {
      const next = items[i + 1];
      if (next && 'ch' in next && next.ch === '\n') continue;
      norm.push({ ch: '\n', attrs: it.attrs });
    } else norm.push(it);
  }

  // 3. Trim trailing whitespace before each LF and at the end (U+00A0 is content, not whitespace here).
  const isTrimmable = (it: Item) => 'ch' in it && (it.ch === ' ' || it.ch === '\t');
  const kept: Item[] = [];
  for (const it of norm) {
    if ('ch' in it && it.ch === '\n') while (kept.length > 0 && isTrimmable(kept[kept.length - 1]!)) kept.pop();
    kept.push(it);
  }
  while (kept.length > 0 && isTrimmable(kept[kept.length - 1]!)) kept.pop();

  // 4. Build text, maximal runs and embed offsets.
  let out = '';
  const runs: [number, number, Record<string, unknown>][] = [];
  const outEmbeds: { at: number; assetId: string; widthEmu: number; heightEmu: number }[] = [];
  for (const it of kept) {
    if ('embed' in it) {
      outEmbeds.push({ at: out.length, ...it.embed });
      continue;
    }
    const start = out.length;
    out += it.ch;
    if (Object.keys(it.attrs).length === 0) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === start && canonicalJSON(last[2]) === canonicalJSON(it.attrs)) last[1] = out.length;
    else runs.push([start, out.length, it.attrs]);
  }
  return { text: out, runs, embeds: outEmbeds };
}

export interface ElementHashInput {
  role: StyleRole;
  style: string;
  text: TextJSON;
  dual: { side: 'left' | 'right'; partnerHash: string } | null;
}

export function elementContentHash(input: ElementHashInput): ContentHash {
  const c = canonicalElementText(input.text);
  return v1(canonicalJSON({
    v: HASH_VERSION,
    role: input.role,
    style: BUILTIN_STYLE_RE.test(input.style) ? null : input.style,
    text: c.text,
    runs: c.runs,
    embeds: c.embeds,
    dual: input.dual ? { side: input.dual.side, partner: input.dual.partnerHash } : null,
    alt: null,
  }));
}

export function sceneContentHash(input: { omitted: boolean; elements: readonly { hash: string; role: StyleRole | null; printable: boolean }[] }): ContentHash {
  const printing = input.elements.filter((e) => e.printable && !(e.role !== null && (NON_PRINTING_ROLES as readonly string[]).includes(e.role)));
  return v1(`fw-scene-v1\n${input.omitted ? 'omitted\n' : ''}${printing.map((e) => e.hash).join('\n')}`);
}

export function sliceTextJSON(text: TextJSON, from: number, to: number): TextJSON {
  const runs: TextJSON['runs'] = [];
  const embeds: TextJSON['embeds'] = [];
  const sorted = [...text.embeds].sort((a, b) => a.at - b.at);
  let y = 0;
  let e = 0;
  const take = () => {
    while (e < sorted.length && sorted[e]!.at === y) {
      if (y >= from && y < to) embeds.push({ at: y - from, embed: sorted[e]!.embed });
      y++;
      e++;
    }
  };
  take();
  for (const run of text.runs) {
    let piece = '';
    for (let i = 0; i < run.text.length; i++) {
      if (y >= from && y < to) piece += run.text[i];
      y++;
      if (e < sorted.length && sorted[e]!.at === y) {
        if (piece) runs.push({ text: piece, attrs: run.attrs });
        piece = '';
        take();
      }
    }
    if (piece) {
      const last = runs[runs.length - 1];
      if (last && canonicalJSON(last.attrs) === canonicalJSON(run.attrs)) last.text += piece;
      else runs.push({ text: piece, attrs: run.attrs });
    }
  }
  return { plain: runs.map((r) => r.text).join(''), runs, embeds };
}

export function shotContentHash(parts: readonly string[]): ContentHash {
  return v1(`fw-shot-v1\n${parts.join('\n')}`);
}

function isTextJSON(v: unknown): v is TextJSON {
  return !!v && typeof v === 'object' && 'plain' in v && 'runs' in v && 'embeds' in v;
}

export function entityContentHash(entity: EntityJSON): ContentHash {
  const { traits, ...rest } = entity.fields as Record<string, unknown> & { traits?: Record<string, unknown> };
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) fields[k] = isTextJSON(v) ? canonicalElementText(v).text : v;
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entity.attributes)) if (!k.startsWith('fw.ui.')) attributes[k] = v;
  return v1(canonicalJSON({
    v: HASH_VERSION,
    kind: entity.kind,
    name: entity.name,
    aliases: [...entity.aliases].sort(),
    description: canonicalElementText(entity.description).text,
    fields,
    traits: traits ?? {},
    attributes,
  }));
}

const PACKET_STRIP = new Set(['generatedAt', 'hash', 'url', 'signedUrl', 'urlExpiresAt']);

function stripPacket(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPacket);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!PACKET_STRIP.has(k)) out[k] = stripPacket(v);
    return out;
  }
  return value;
}

export function packetHash(packet: Record<string, unknown>): ContentHash {
  return v1(canonicalJSON(stripPacket(packet)));
}

/** Pinned test vectors (spec 11 §4.2): element, scene and partial-shot inputs. */
export type HashVectorInput =
  | { name: string; fn: 'element'; input: ElementHashInput }
  | { name: string; fn: 'scene'; input: { omitted: boolean; elements: { input: ElementHashInput; printable: boolean }[] } }
  | { name: string; fn: 'shot'; input: { elements: ElementHashInput[]; first: { from: number; to: number } | null } };
export type HashVector = HashVectorInput & { hash: string };

export function computeHashVector(v: HashVectorInput): ContentHash {
  switch (v.fn) {
    case 'element':
      return elementContentHash(v.input);
    case 'scene':
      return sceneContentHash({
        omitted: v.input.omitted,
        elements: v.input.elements.map((e) => ({ hash: elementContentHash(e.input), role: e.input.role, printable: e.printable })),
      });
    case 'shot': {
      const first = v.input.first;
      return shotContentHash(v.input.elements.map((e, i) => elementContentHash(i === 0 && first ? { ...e, text: sliceTextJSON(e.text, first.from, first.to) } : e)));
    }
  }
}
