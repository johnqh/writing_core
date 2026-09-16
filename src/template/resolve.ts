import type { StyleId } from '../ids/ids.js';
import type {
  ElementOverrides, FontSpec, NumberingSpec, StyleDef, StyleFlow, TemplateJSON,
} from '../schema/template.js';
import type { Alignment, Column, SmartTypeList, SplitRule, StyleRole } from '../schema/vocab.js';

export interface ResolvedStyle {
  id: StyleId;
  name: string;
  nameKey: string | null;
  role: StyleRole;
  basedOn: StyleId | null;
  shortcut: number | null;
  font: FontSpec;
  allCaps: boolean;
  align: Alignment;
  indentLeft: number;
  indentRight: number;
  indentFirstLine: number;
  spaceBefore: number;
  lineSpacing: number;
  column: Column;
  keepWithNext: boolean;
  keepTogether: boolean;
  splitRule: SplitRule;
  pageBreakBefore: boolean;
  actBreak: boolean;
  paginateAs: StyleId | null;
  hiddenInScript: boolean;
  printable: boolean;
  outlineLevel: number;
  flow: StyleFlow;
  numbering: NumberingSpec | null;
  prefix: string;
  suffix: string;
  smartTypeList: SmartTypeList | null;
  dualDialogue: boolean;
  leadingAdjust: number;
  direction: 'auto' | 'ltr' | 'rtl';
  anchor: 'flow' | 'bottom';
}

export const ROOT_REQUIRED_KEYS = [
  'allCaps', 'align', 'indentLeft', 'indentRight', 'indentFirstLine', 'spaceBefore', 'lineSpacing', 'column',
  'keepWithNext', 'keepTogether', 'splitRule', 'pageBreakBefore', 'actBreak', 'paginateAs', 'hiddenInScript',
  'printable', 'outlineLevel', 'flow', 'numbering', 'prefix', 'suffix', 'smartTypeList', 'dualDialogue',
] as const satisfies readonly (keyof StyleDef)[];

export const FONT_KEYS = ['family', 'size', 'bold', 'italic', 'underline', 'strike', 'smallCaps', 'color'] as const satisfies readonly (keyof FontSpec)[];
export const FLOW_KEYS = ['onEnter', 'onEnterEmpty', 'onTabEmpty', 'onTabText', 'onShiftTabEmpty'] as const satisfies readonly (keyof StyleFlow)[];

/** Spec 01 §3.4.1 "Default split rule" column. */
export const ROLE_DEFAULT_SPLIT: Record<StyleRole, SplitRule | 'sentencesIfBreakOnSentences'> = {
  normal: 'lines', sceneHeading: 'never', action: 'sentencesIfBreakOnSentences', character: 'never',
  parenthetical: 'never', dialogue: 'sentencesIfBreakOnSentences', transition: 'never', shot: 'never',
  lyrics: 'lines', castList: 'lines', actStart: 'never', actEnd: 'never', sequence: 'never', outline: 'never',
  synopsis: 'lines', note: 'lines', notation: 'lines', soundCue: 'never', page: 'never', panel: 'never',
  chapter: 'never', paragraph: 'lines', subheading: 'never', quotation: 'lines', blockText: 'lines',
  chapterEnd: 'never', titleText: 'lines',
};

type StyleSource = Pick<TemplateJSON, 'styles' | 'defaults' | 'pagination'>;

/** Leaf first. A missing parent or a cycle jumps to the root (spec 01 §3.4.2 rule 1). */
export function styleChain(styles: readonly StyleDef[], styleId: StyleId): StyleDef[] {
  const byId = new Map(styles.map((s) => [s.id, s] as const));
  const root = styles.find((s) => s.basedOn === null);
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let current = byId.get(styleId);
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    if (current.basedOn === null) return chain;
    current = byId.get(current.basedOn);
  }
  if (root && !seen.has(root.id)) chain.push(root);
  return chain;
}

function nearest<K extends keyof StyleDef>(chain: readonly StyleDef[], key: K): StyleDef[K] | undefined {
  for (const s of chain) if (s[key] !== undefined) return s[key];
  return undefined;
}

function required<T>(value: T, styleId: string, field: string): Exclude<T, undefined> {
  if (value === undefined) throw new Error(`style ${styleId}: no value for ${field} anywhere in its chain (incomplete root)`);
  return value as Exclude<T, undefined>;
}

/** Resolves every field except the paginateAs borrow (kept separate so the borrow can walk iteratively without recursing). */
function resolveStyleCore(template: StyleSource, styleId: StyleId): ResolvedStyle {
  const leaf = template.styles.find((s) => s.id === styleId);
  if (!leaf) throw new Error(`unknown style ${styleId}`);
  const chain = styleChain(template.styles, styleId);
  const get = <K extends keyof StyleDef>(k: K) => required(nearest(chain, k), styleId, k);

  const font = {} as FontSpec;
  for (const k of FONT_KEYS) {
    const found = chain.find((s) => s.font[k] !== undefined);
    (font as Record<string, unknown>)[k] = required(found?.font[k], styleId, `font.${k}`);
  }
  const flow = {} as StyleFlow;
  for (const k of FLOW_KEYS) {
    const found = chain.find((s) => s.flow?.[k] !== undefined);
    (flow as Record<string, unknown>)[k] = required(found?.flow?.[k], styleId, `flow.${k}`);
  }

  const nonRoot = chain.filter((s) => s.basedOn !== null);
  const roleSplit = ROLE_DEFAULT_SPLIT[leaf.role];
  const splitRule: SplitRule =
    nearest(nonRoot, 'splitRule') ??
    (roleSplit === 'sentencesIfBreakOnSentences' ? (template.pagination.breakOnSentences ? 'sentences' : 'lines') : roleSplit);

  return {
    id: leaf.id, name: leaf.name, nameKey: leaf.nameKey, role: leaf.role, basedOn: leaf.basedOn, shortcut: leaf.shortcut,
    font, flow, splitRule,
    allCaps: get('allCaps'), align: get('align'), indentLeft: get('indentLeft'), indentRight: get('indentRight'),
    indentFirstLine: get('indentFirstLine'), spaceBefore: get('spaceBefore'), lineSpacing: get('lineSpacing'),
    column: get('column'), keepWithNext: get('keepWithNext'), keepTogether: get('keepTogether'),
    pageBreakBefore: get('pageBreakBefore'), actBreak: get('actBreak'), paginateAs: get('paginateAs') ?? null,
    hiddenInScript: get('hiddenInScript'), printable: get('printable'), outlineLevel: get('outlineLevel'),
    numbering: get('numbering') ?? null, prefix: get('prefix'), suffix: get('suffix'),
    smartTypeList: get('smartTypeList') ?? null, dualDialogue: get('dualDialogue'),
    leadingAdjust: 0, direction: 'auto', anchor: 'flow',
  };
}

/**
 * Walks the paginateAs chain iteratively, borrowing keepWithNext/keepTogether/splitRule from the
 * furthest reachable target. `validateTemplate` rejects a paginateAs ring as `paginateAsCycle`; this
 * loop is the runtime backstop so a template that slips past validation (or a keystroke resolved
 * before validation runs) still terminates instead of recursing without bound. On revisiting an id
 * it stops and keeps the last values it borrowed rather than throwing.
 */
function applyPaginateAs(template: StyleSource, startId: StyleId, resolved: ResolvedStyle): void {
  const visited = new Set<StyleId>([startId]);
  let currentId = resolved.paginateAs;
  while (currentId && !visited.has(currentId) && template.styles.some((s) => s.id === currentId)) {
    visited.add(currentId);
    const target = resolveStyleCore(template, currentId);
    resolved.keepWithNext = target.keepWithNext;
    resolved.keepTogether = target.keepTogether;
    resolved.splitRule = target.splitRule;
    currentId = target.paginateAs;
  }
}

/**
 * Spec 01 §3.4.2: "Resolution is memoized per `(templateRevision, styleId)`". The revision counter
 * exists precisely so that a style edit invalidates exactly the cache it affects — and the read
 * model rebuilds its frozen template object on every template mutation (`templateCache = null` in
 * read-model/open.ts), so keying the memo on the template object's identity in a WeakMap IS keying
 * it on the revision, without threading the counter through a signature that does not carry it.
 * A template that is mutated in place rather than replaced would see stale values; every template
 * that reaches here from the read model is deep-frozen, and the memo entry is dropped with the
 * object it belongs to.
 *
 * Without this, `buildView` paid a full chain walk per element just to read `role`: 37 ms to build
 * 3000 element views.
 */
const resolvedCache = new WeakMap<StyleSource, Map<string, ResolvedStyle>>();

function resolveBase(template: StyleSource, styleId: StyleId): ResolvedStyle {
  let byStyle = resolvedCache.get(template);
  if (!byStyle) {
    byStyle = new Map();
    resolvedCache.set(template, byStyle);
  }
  const hit = byStyle.get(styleId);
  if (hit) return hit;
  const resolved = resolveStyleCore(template, styleId);
  applyPaginateAs(template, styleId, resolved);
  // Frozen because it is shared: the no-overrides path below hands the cached instance straight
  // back, so a caller mutating it would corrupt every later resolution of that style.
  Object.freeze(resolved.font);
  Object.freeze(resolved.flow);
  Object.freeze(resolved);
  byStyle.set(styleId, resolved);
  return resolved;
}

export function resolveStyle(template: StyleSource, styleId: StyleId, overrides?: ElementOverrides): ResolvedStyle {
  const base = resolveBase(template, styleId);
  if (!overrides) return base;
  const resolved: ResolvedStyle = { ...base };
  {
    if (overrides.align !== undefined) resolved.align = overrides.align;
    if (overrides.indentLeft !== undefined) resolved.indentLeft = overrides.indentLeft;
    if (overrides.indentRight !== undefined) resolved.indentRight = overrides.indentRight;
    if (overrides.indentFirstLine !== undefined) resolved.indentFirstLine = overrides.indentFirstLine;
    if (overrides.spaceBefore !== undefined) resolved.spaceBefore = overrides.spaceBefore;
    if (overrides.lineSpacing !== undefined) resolved.lineSpacing = overrides.lineSpacing;
    if (overrides.keepWithNext !== undefined) resolved.keepWithNext = overrides.keepWithNext;
    if (overrides.pageBreakBefore !== undefined) resolved.pageBreakBefore = overrides.pageBreakBefore;
    if (overrides.column !== undefined) resolved.column = overrides.column;
    if (overrides.leadingAdjust !== undefined) resolved.leadingAdjust = overrides.leadingAdjust;
    if (overrides.direction !== undefined) resolved.direction = overrides.direction;
    if (overrides.anchor !== undefined) resolved.anchor = overrides.anchor;
  }
  return resolved;
}
