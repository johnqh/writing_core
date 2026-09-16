import { BUILTIN_STYLE_RE } from '../ids/ids.js';
import type { EntityJSON } from '../schema/entities.js';
import type { TextJSON } from '../schema/text.js';
import { NON_PRINTING_ROLES, type StyleRole } from '../schema/vocab.js';
import { canonicalJSON } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export const HASH_VERSION = 1;
/** Derived from HASH_VERSION (not a repeated literal) so a version bump cannot silently mislabel output. */
export type ContentHash = `v${typeof HASH_VERSION}:${string}`;

const HASHED_MARKS = ['b', 'i', 'u', 's', 'sc', 'va'] as const;

const v1 = (payload: string): ContentHash => `v${HASH_VERSION}:${sha256Hex(payload)}`;

/** True for combining marks (Unicode general category M*): the characters NFC composition can merge into a preceding base character. */
const isCombiningMark = (ch: string): boolean => /^\p{M}$/u.test(ch);

type Item = { ch: string; attrs: Record<string, unknown> } | { embed: { assetId: string; widthEmu: number; heightEmu: number } };

export function canonicalElementText(text: TextJSON): {
  text: string;
  runs: [number, number, Record<string, unknown>][];
  embeds: { at: number; assetId: string; widthEmu: number; heightEmu: number }[];
} {
  // 1. Interleave code points and image embeds in Y.Text index order, dropping tracked deletions.
  //    Each run's text is kept RAW here (not normalized) so combining-mark composition can be done
  //    once below, across run/formatting boundaries.
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
    for (const ch of run.text) {
      if (!deleted) items.push({ ch, attrs: hashed });
      y += ch.length;
      flush();
    }
  }
  flush();

  // 1b. Compose combining-mark sequences (Unicode NFC) once, over the whole element's visible text.
  //    Normalizing each run in isolation (the previous approach) cannot compose a base character in
  //    one run with a combining mark that starts an adjacent run (a formatting boundary splits them
  //    before normalization ever sees them together), so two visually identical texts could hash
  //    differently depending on where a bold/italic/etc. boundary happened to fall. Instead, cluster
  //    each visible "starter" character with any combining marks that immediately follow it — across
  //    run boundaries — normalize the cluster as one string, and attribute the composed result to the
  //    starter's attrs (the base character's formatting is what a reader/performer sees).
  const composed: Item[] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i]!;
    if (!('ch' in it)) {
      composed.push(it);
      i++;
      continue;
    }
    let cluster = it.ch;
    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (!('ch' in next) || !isCombiningMark(next.ch)) break;
      cluster += next.ch;
      j++;
    }
    for (const ch of cluster.normalize('NFC')) composed.push({ ch, attrs: it.attrs });
    i = j;
  }

  // 2. Line endings: CRLF and CR become LF.
  const norm: Item[] = [];
  for (let i = 0; i < composed.length; i++) {
    const it = composed[i]!;
    if ('ch' in it && it.ch === '\r') {
      const next = composed[i + 1];
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
  return v1(`fw-scene-v${HASH_VERSION}\n${input.omitted ? 'omitted\n' : ''}${printing.map((e) => e.hash).join('\n')}`);
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
  return v1(`fw-shot-v${HASH_VERSION}\n${parts.join('\n')}`);
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

// Spec 11 §4.2/§7.2: packet-envelope-level `generatedAt`/`hash`, plus every signed-URL field on an
// AssetSummary (`previewUrl`, `originalUrl`) and its expiry (`urlExpiresAt`) — these are re-minted on
// every fetch, so a packet re-fetched with fresh URLs must hash the same. (`url`/`signedUrl` do not
// exist anywhere in spec 11's packet or AssetSummary shapes — §7.2 — and were a bug: stripping them
// left the real field names `previewUrl`/`originalUrl` unstripped, so a re-fetched packet hashed
// differently every time and staleness comparisons could never report "fresh".)
const PACKET_STRIP = new Set(['generatedAt', 'hash', 'previewUrl', 'originalUrl', 'urlExpiresAt']);

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
