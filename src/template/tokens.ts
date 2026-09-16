/**
 * Spec 02 §20.2, registry R30 (M2 task 11): the `TokenString` grammar that renders
 * page headers, footers, number formats and title-page text.
 *
 * ```
 * TokenString  := ( Literal | Token | Conditional )*
 * Literal      := any text; '{{' and '}}' are literal braces
 * Token        := '{' Name ( ':' Arg )* ( '|' Filter )* '}'
 * Conditional  := '{if ' Name ( ':' Arg )? '}' TokenString ( '{else}' TokenString )? '{/if}'
 * Name         := case-insensitive identifier from TOKEN_NAMES (src/schema/vocab.ts)
 * Filter       := 'upper' | 'lower' | 'trunc:' Int | 'plural:' Text
 * ```
 *
 * **A header template is authored by a screenwriter, not a programmer** — nothing in
 * this module throws on malformed input. Two consistent rules cover every malformed
 * or unrecognized case:
 *   - An **unknown token name** (not in `TOKEN_NAMES`, case-insensitively) renders
 *     empty and its name is reported in `unknown`.
 *   - A **malformed token** — an unclosed `{`, a filter that requires an argument and
 *     didn't get one (`trunc` with no `:N`, `plural` with no `:X`), an unrecognized
 *     filter name, `{field}`/`{style}`/`{count}` with no required argument, or `{n:x}`
 *     with an unrecognized format arg — is treated the *same way*: the whole token
 *     renders empty and a descriptive marker lands in `unknown`. This keeps one rule
 *     ("if it isn't right, it renders empty and gets reported") instead of two.
 *
 * One deliberate exception: a **stray, unpaired `}`** encountered outside any open
 * token (not part of a `}}` escape) is emitted as a literal `}` — there is no bounded
 * token there to report, and `}}` already collapsing to one `}` makes a lone `}`
 * falling through as literal the least surprising reading of "any text" (the grammar's
 * own words for `Literal`).
 *
 * `{if Name}`/`{else}`/`{/if}` are recognized as structural markers only while
 * scanning a conditional's `then`/`else` body; at top level (or once a conditional has
 * already closed) `{else}` and `{/if}` are ordinary tokens, and since neither name is
 * in `TOKEN_NAMES`, they fall through to the unknown-name rule automatically.
 */

import type { StyleId } from '../ids/ids.js';
import { graphemeClusters } from '../text/grapheme.js';
import { letters } from '../read-model/number-label.js';
import type { NumberLabel } from '../schema/template.js';
import { TITLE_FIELDS, TOKEN_NAMES, type TitleField } from '../schema/vocab.js';
import type { LocaleDataPort } from './locale-data.js';

// ─── TokenContext (spec 02 §20.2; contract for tasks 14, 25, 26, 31) ───────────────

/**
 * The one place §20.2's token inputs are named. Every field is here because some
 * token needs it, even where this task's own tests don't exercise it — tasks 14
 * (`number.counts`), 25/26 (revisions) and 31 (title/document) fill in a declared
 * shape rather than inventing their own.
 */
export interface TokenContext {
  page?: { label: string; count: number; revisionName: string | null };
  title?: Partial<Record<TitleField, string>>; // {title}, {field:<key>}, {draft}
  scene?: { heading: string; number: string | null };
  styleText?: (styleId: StyleId) => string | null; // {style:<StyleId>}
  number?: { label: NumberLabel; counts: ReadonlyMap<StyleId, number> }; // {n…}, {count:<StyleId>} (Task 14 supplies counts)
  revision?: { name: string | null; color: string | null; date: number | null; mark: string | null; active: string | null; collated: string[] };
  document?: { filename: string; project: string | null; snapshot: string | null; label: string | null; lastRevised: number | null };
  locale: LocaleDataPort; // never `Intl`
  language: string; // BCP 47, from meta.language
}

// ─── Parse tree ─────────────────────────────────────────────────────────────────

export interface TokenFilter {
  readonly name: string;
  readonly arg: string | null;
}

export type TokenNode =
  | { kind: 'literal'; text: string }
  | { kind: 'token'; name: string; args: string[]; filters: TokenFilter[] }
  | { kind: 'conditional'; name: string; arg: string | null; then: TokenNode[]; else: TokenNode[] | null }
  /** An unclosed `{`, or a conditional with no matching `{/if}` before end of input. */
  | { kind: 'malformed'; raw: string };

// ─── Parser ─────────────────────────────────────────────────────────────────────

/** Scans from just past an opening `{` to its closing `}`. See module header for the unclosed-brace decision. */
function findTokenEnd(text: string, start: number): { content: string; end: number; unclosed: boolean } {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '}') return { content: text.slice(start, i), end: i + 1, unclosed: false };
    if (c === '{') return { content: text.slice(start, i), end: i, unclosed: true };
    i += 1;
  }
  return { content: text.slice(start), end: text.length, unclosed: true };
}

function splitTokenContent(content: string): { name: string; args: string[]; filters: TokenFilter[] } {
  const parts = content.split('|');
  const headParts = parts[0]!.split(':');
  const name = headParts[0]!.trim();
  const args = headParts.slice(1).map((a) => a.trim());
  const filters: TokenFilter[] = parts.slice(1).map((f) => {
    const idx = f.indexOf(':');
    return idx === -1 ? { name: f.trim(), arg: null } : { name: f.slice(0, idx).trim(), arg: f.slice(idx + 1).trim() };
  });
  return { name, args, filters };
}

function splitNameArg(s: string): [string, string | null] {
  const idx = s.indexOf(':');
  return idx === -1 ? [s.trim(), null] : [s.slice(0, idx).trim(), s.slice(idx + 1).trim()];
}

type ParseMode = 'top' | 'then' | 'else';
type Terminator = 'else' | 'end' | 'eof';

function parseSegment(text: string, start: number, mode: ParseMode): { nodes: TokenNode[]; pos: number; terminator: Terminator } {
  const nodes: TokenNode[] = [];
  let literal = '';
  let pos = start;
  const flush = (): void => {
    if (literal !== '') {
      nodes.push({ kind: 'literal', text: literal });
      literal = '';
    }
  };
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '{') {
      if (text[pos + 1] === '{') {
        literal += '{';
        pos += 2;
        continue;
      }
      const found = findTokenEnd(text, pos + 1);
      if (found.unclosed) {
        flush();
        nodes.push({ kind: 'malformed', raw: found.content });
        pos = found.end;
        continue;
      }
      const content = found.content;
      const lower = content.toLowerCase();
      if (mode !== 'top' && lower === 'else' && mode === 'then') {
        flush();
        return { nodes, pos: found.end, terminator: 'else' };
      }
      if (mode !== 'top' && lower === '/if') {
        flush();
        return { nodes, pos: found.end, terminator: 'end' };
      }
      if (lower === 'if' || lower.startsWith('if ')) {
        flush();
        const [condName, condArg] = splitNameArg(content.slice(2).trim());
        const thenResult = parseSegment(text, found.end, 'then');
        if (thenResult.terminator === 'eof') {
          // No matching {else}/{/if} before end of input: the whole conditional is malformed.
          nodes.push({ kind: 'malformed', raw: `if ${content.slice(2).trim()}` });
          pos = thenResult.pos;
          continue;
        }
        let elseNodes: TokenNode[] | null = null;
        let cursor = thenResult.pos;
        if (thenResult.terminator === 'else') {
          const elseResult = parseSegment(text, cursor, 'else');
          if (elseResult.terminator === 'eof') {
            nodes.push({ kind: 'malformed', raw: `if ${content.slice(2).trim()}` });
            pos = elseResult.pos;
            continue;
          }
          elseNodes = elseResult.nodes;
          cursor = elseResult.pos;
        }
        nodes.push({ kind: 'conditional', name: condName, arg: condArg, then: thenResult.nodes, else: elseNodes });
        pos = cursor;
        continue;
      }
      flush();
      const { name, args, filters } = splitTokenContent(content);
      nodes.push({ kind: 'token', name, args, filters });
      pos = found.end;
      continue;
    }
    if (ch === '}') {
      if (text[pos + 1] === '}') {
        literal += '}';
        pos += 2;
        continue;
      }
      // Stray unpaired '}': literal (see module header).
      literal += '}';
      pos += 1;
      continue;
    }
    literal += ch;
    pos += 1;
  }
  flush();
  return { nodes, pos, terminator: 'eof' };
}

export function parseTokenString(s: string): TokenNode[] {
  return parseSegment(s, 0, 'top').nodes;
}

// ─── Number-label formatting (§20.2 `{n…}`, prefix/suffix attach to the formatted base) ──

function segText(seg: NumberLabel['prefix'][number]): string {
  return seg.kind === 'letters' ? letters(seg.value) : String(seg.value);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** Roman numerals (lowercase); out-of-range (<=0 or >3999) falls back to digits rather than guessing. */
function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 3999) return String(n);
  let x = n;
  let out = '';
  for (const [value, sym] of ROMAN_TABLE) {
    while (x >= value) {
      out += sym;
      x -= value;
    }
  }
  return out;
}

/** Bijective base-26 (a, b, … z, aa, ab, … — spreadsheet-column style); out-of-range falls back to digits. */
function toBijectiveBase26(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return String(n);
  let x = n;
  let out = '';
  while (x > 0) {
    x -= 1;
    out = String.fromCharCode(97 + (x % 26)) + out;
    x = Math.floor(x / 26);
  }
  return out;
}

function formatNToken(label: NumberLabel, args: string[], ctx: TokenContext, unknown: string[]): { text: string; numeric: number } {
  // A custom label overrides the whole label text (mirrors formatNumberLabel); no format arg applies to it.
  if (label.custom !== undefined && label.custom !== '') return { text: label.custom, numeric: label.base };
  const arg = args[0];
  const padMatch = arg === undefined ? null : /^pad(\d+)$/i.exec(arg);
  let baseText: string;
  if (arg === undefined) baseText = String(label.base);
  else if (padMatch) baseText = String(label.base).padStart(Number(padMatch[1]), '0');
  else if (arg === 'words') baseText = ctx.locale.spellOut(label.base, ctx.language);
  else if (arg === 'Words') baseText = capitalize(ctx.locale.spellOut(label.base, ctx.language));
  else if (arg === 'WORDS') baseText = ctx.locale.spellOut(label.base, ctx.language).toUpperCase();
  else if (arg === 'roman') baseText = toRoman(label.base);
  else if (arg === 'ROMAN') baseText = toRoman(label.base).toUpperCase();
  else if (arg === 'alpha') baseText = toBijectiveBase26(label.base);
  else if (arg === 'ALPHA') baseText = toBijectiveBase26(label.base).toUpperCase();
  else {
    unknown.push(`n:${arg}`);
    return { text: '', numeric: label.base };
  }
  const prefixText = label.prefix.map(segText).join('');
  const suffixText = label.suffix.map(segText).join('');
  return { text: `${prefixText}${baseText}${suffixText}`, numeric: label.base };
}

const COUNT_FORMATS = ['words', 'Words', 'WORDS'] as const;

function formatCountToken(count: number, format: string | undefined, ctx: TokenContext, styleId: string, unknown: string[]): string {
  if (format === undefined) return String(count);
  if (!(COUNT_FORMATS as readonly string[]).includes(format)) {
    unknown.push(`count:${styleId}:${format}`);
    return '';
  }
  const words = ctx.locale.spellOut(count, ctx.language);
  if (format === 'words') return words;
  if (format === 'Words') return capitalize(words);
  return words.toUpperCase();
}

// ─── Name resolution (§20.2 table) ─────────────────────────────────────────────

function firstLine(s: string | undefined): string {
  if (s === undefined) return '';
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

const KNOWN_NAMES = new Set<string>(TOKEN_NAMES.map((n) => n.toLowerCase()));

const DEFAULT_DATE_PATTERN = 'M/d/yy';

function resolveTokenValue(nameLower: string, args: string[], ctx: TokenContext, unknown: string[]): { text: string; numeric: number | null } {
  if (!KNOWN_NAMES.has(nameLower)) {
    unknown.push(nameLower);
    return { text: '', numeric: null };
  }
  switch (nameLower) {
    case 'page':
      return { text: ctx.page?.label ?? '', numeric: null };
    case 'pages':
      return { text: ctx.page ? String(ctx.page.count) : '', numeric: ctx.page?.count ?? null };
    case 'date': {
      // Render-time date (PDF export time): `TokenContext` (§20.2) declares no fixed
      // "now" field, so this reads the wall clock at render time — that variability
      // is the token's whole point. `Date.now()`/UTC getters are ECMA-262, not a host
      // API, so this doesn't reintroduce the `Intl` problem; only the *formatting* of
      // the epoch goes through `ctx.locale`, never through a global.
      const pattern = args[0] ?? DEFAULT_DATE_PATTERN;
      return { text: ctx.locale.formatDate(Date.now(), pattern, ctx.language), numeric: null };
    }
    case 'lastrevised': {
      const epoch = ctx.document?.lastRevised ?? null;
      if (epoch === null) return { text: '', numeric: null };
      const pattern = args[0] ?? DEFAULT_DATE_PATTERN;
      return { text: ctx.locale.formatDate(epoch, pattern, ctx.language), numeric: null };
    }
    case 'title':
      return { text: firstLine(ctx.title?.title), numeric: null };
    case 'field': {
      const key = args[0];
      if (key === undefined || !(TITLE_FIELDS as readonly string[]).includes(key)) {
        unknown.push(key === undefined ? 'field' : `field:${key}`);
        return { text: '', numeric: null };
      }
      return { text: firstLine(ctx.title?.[key as TitleField]), numeric: null };
    }
    case 'draft':
      return { text: firstLine(ctx.title?.draftDate), numeric: null };
    case 'filename':
      return { text: ctx.document?.filename ?? '', numeric: null };
    case 'project':
      return { text: ctx.document?.project ?? '', numeric: null };
    case 'snapshot':
      return { text: ctx.document?.snapshot ?? '', numeric: null };
    case 'scene.heading':
      return { text: ctx.scene?.heading ?? '', numeric: null };
    case 'scene.number':
      return { text: ctx.scene?.number ?? '', numeric: null };
    case 'style': {
      const styleId = args[0];
      if (styleId === undefined) {
        unknown.push('style');
        return { text: '', numeric: null };
      }
      const text = ctx.styleText ? ctx.styleText(styleId as StyleId) : null;
      return { text: text ?? '', numeric: null };
    }
    case 'label':
      return { text: ctx.document?.label ?? '', numeric: null };
    case 'revision.name':
      return { text: ctx.revision?.name ?? '', numeric: null };
    case 'revision.color':
      return { text: ctx.revision?.color ?? '', numeric: null };
    case 'revision.date': {
      const epoch = ctx.revision?.date ?? null;
      // §20.2 groups .name/.color/.date/.mark with no separate `:pattern` arg for
      // .date; this uses the same default pattern `{date}` does.
      return epoch === null ? { text: '', numeric: null } : { text: ctx.locale.formatDate(epoch, DEFAULT_DATE_PATTERN, ctx.language), numeric: null };
    }
    case 'revision.mark':
      return { text: ctx.revision?.mark ?? '', numeric: null };
    case 'page.revision':
      return { text: ctx.page?.revisionName ?? '', numeric: null };
    case 'revision.active':
      return { text: ctx.revision?.active ?? '', numeric: null };
    case 'revision.collated':
      return { text: (ctx.revision?.collated ?? []).join(', '), numeric: null };
    case 'watermark.recipient':
      // Not modeled by `TokenContext` yet (spec 04's batch watermark export, a later
      // task) — §20.2 already specifies "else empty" outside that context, so this
      // renders empty rather than being unknown.
      return { text: '', numeric: null };
    case 'n': {
      const label = ctx.number?.label;
      if (label === undefined) return { text: '', numeric: null };
      return formatNToken(label, args, ctx, unknown);
    }
    case 'count': {
      const styleId = args[0];
      if (styleId === undefined) {
        unknown.push('count');
        return { text: '', numeric: null };
      }
      const count = ctx.number?.counts.get(styleId as StyleId) ?? 0;
      const text = formatCountToken(count, args[1], ctx, styleId, unknown);
      return { text, numeric: count };
    }
    default:
      // Unreachable while this switch covers every entry of TOKEN_NAMES (proven by
      // the "every row of the §20.2 table renders" test) — kept as a safe fallback
      // rather than a throw, per the "never throw on authored text" rule.
      return { text: '', numeric: null };
  }
}

// ─── Filters ────────────────────────────────────────────────────────────────────

function truncateGraphemes(text: string, n: number): string {
  if (n <= 0) return '';
  const starts = graphemeClusters(text);
  return starts.length <= n ? text : text.slice(0, starts[n]);
}

/** Applies one filter; `null` signals "malformed" (caller renders the whole token empty). */
function applyFilter(text: string, numeric: number | null, filter: TokenFilter, nameLower: string, unknown: string[]): string | null {
  const filterNameLower = filter.name.toLowerCase();
  switch (filterNameLower) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'trunc': {
      const n = filter.arg === null ? NaN : Number(filter.arg);
      if (filter.arg === null || !Number.isInteger(n) || n < 0) {
        unknown.push(`${nameLower}|trunc${filter.arg === null ? '' : `:${filter.arg}`}`);
        return null;
      }
      return truncateGraphemes(text, n);
    }
    case 'plural': {
      if (filter.arg === null) {
        unknown.push(`${nameLower}|plural`);
        return null;
      }
      const value = numeric ?? NaN;
      return value !== 1 ? filter.arg : '';
    }
    default:
      unknown.push(`${nameLower}|${filterNameLower}${filter.arg !== null ? `:${filter.arg}` : ''}`);
      return null;
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────────

function renderToken(node: Extract<TokenNode, { kind: 'token' }>, ctx: TokenContext, unknown: string[]): string {
  const nameLower = node.name.toLowerCase();
  const resolved = resolveTokenValue(nameLower, node.args, ctx, unknown);
  let text = resolved.text;
  for (const filter of node.filters) {
    const result = applyFilter(text, resolved.numeric, filter, nameLower, unknown);
    if (result === null) return '';
    text = result;
  }
  return text;
}

function renderNodes(nodes: readonly TokenNode[], ctx: TokenContext, unknown: string[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'literal':
        out += node.text;
        break;
      case 'malformed':
        unknown.push(node.raw.toLowerCase());
        break;
      case 'token':
        out += renderToken(node, ctx, unknown);
        break;
      case 'conditional': {
        const cond = resolveTokenValue(node.name.toLowerCase(), node.arg === null ? [] : [node.arg], ctx, unknown);
        out += cond.text !== '' ? renderNodes(node.then, ctx, unknown) : node.else ? renderNodes(node.else, ctx, unknown) : '';
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function renderTokenString(s: string, ctx: TokenContext): { text: string; unknown: string[] } {
  const nodes = parseTokenString(s);
  const unknown: string[] = [];
  const text = renderNodes(nodes, ctx, unknown);
  return { text, unknown };
}
