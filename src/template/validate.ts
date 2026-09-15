import type { StyleId } from '../ids/ids.js';
import type { StyleDef, TemplateJSON } from '../schema/template.js';
import { FLOW_KEYS, FONT_KEYS, ROOT_REQUIRED_KEYS } from './resolve.js';

export const TEMPLATE_ISSUE_CODES = [
  'duplicateStyleId', 'missingParent', 'basedOnCycle', 'multipleRoots', 'noRoot', 'rootMismatch',
  'incompleteRoot', 'danglingDefault', 'danglingFlow', 'danglingPaginateAs', 'danglingNumberingReset',
] as const;
export type TemplateIssueCode = (typeof TEMPLATE_ISSUE_CODES)[number];
export interface TemplateIssue {
  code: TemplateIssueCode;
  styleId?: StyleId;
  field?: string;
  message: string;
}

function checkStyleList(styles: readonly StyleDef[], rootId: StyleId, issues: TemplateIssue[]): void {
  const ids = new Set<string>();
  for (const s of styles) {
    if (ids.has(s.id)) issues.push({ code: 'duplicateStyleId', styleId: s.id, message: `duplicate style ${s.id}` });
    ids.add(s.id);
  }
  const roots = styles.filter((s) => s.basedOn === null);
  if (roots.length === 0) issues.push({ code: 'noRoot', message: 'no root style' });
  if (roots.length > 1) issues.push({ code: 'multipleRoots', message: `roots: ${roots.map((r) => r.id).join(', ')}` });

  const byId = new Map(styles.map((s) => [s.id, s] as const));
  const reportedCycle = new Set<string>();
  for (const s of styles) {
    if (s.basedOn !== null && !byId.has(s.basedOn)) {
      issues.push({ code: 'missingParent', styleId: s.id, message: `${s.id} is based on missing ${s.basedOn}` });
      continue;
    }
    const seen: string[] = [];
    let cur: StyleDef | undefined = s;
    while (cur && cur.basedOn !== null) {
      if (seen.includes(cur.id)) {
        // Report the cycle members only: a style that merely descends into a cycle is not part of it.
        const cycle = seen.slice(seen.indexOf(cur.id));
        const key = [...cycle].sort().join('|');
        if (!reportedCycle.has(key)) {
          reportedCycle.add(key);
          issues.push({ code: 'basedOnCycle', styleId: cur.id, message: `cycle through ${cycle.join(' → ')}` });
        }
        break;
      }
      seen.push(cur.id);
      cur = byId.get(cur.basedOn);
    }
  }

  const root = byId.get(rootId);
  if (root) {
    if (root.basedOn !== null) issues.push({ code: 'rootMismatch', styleId: rootId, message: 'defaults.root has a parent' });
    const missing = [
      ...ROOT_REQUIRED_KEYS.filter((k) => root[k] === undefined),
      ...FONT_KEYS.filter((k) => root.font[k] === undefined).map((k) => `font.${k}`),
      ...FLOW_KEYS.filter((k) => root.flow?.[k] === undefined).map((k) => `flow.${k}`),
    ];
    for (const field of missing) {
      issues.push({ code: 'incompleteRoot', styleId: rootId, field, message: `root style lacks ${field}` });
    }
  }

  for (const s of styles) {
    for (const k of FLOW_KEYS) {
      const target = s.flow?.[k];
      if (typeof target === 'string' && target !== 'picker' && target !== 'flow' && !byId.has(target as StyleId)) {
        issues.push({ code: 'danglingFlow', styleId: s.id, field: `flow.${k}`, message: `${s.id} flow.${k} → ${target}` });
      }
    }
    if (s.paginateAs && !byId.has(s.paginateAs)) {
      issues.push({ code: 'danglingPaginateAs', styleId: s.id, message: `${s.id} paginateAs → ${s.paginateAs}` });
    }
    const reset = s.numbering?.resetAfterStyle;
    if (reset && !byId.has(reset)) {
      issues.push({ code: 'danglingNumberingReset', styleId: s.id, message: `${s.id} numbering reset → ${reset}` });
    }
  }
}

export function validateTemplate(template: TemplateJSON): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  checkStyleList(template.styles, template.defaults.root, issues);
  const bodyIds = new Set<string>(template.styles.map((s) => s.id));
  const titleIds = new Set<string>(template.titlePageStyles.map((s) => s.id));
  const d = template.defaults;
  const bodyRefs: [string, StyleId | null][] = [
    ['root', d.root], ['firstElement', d.firstElement], ['pasteFallback', d.pasteFallback],
    ['sceneHeading', d.sceneHeading], ['character', d.character], ['dialogue', d.dialogue],
    ['parenthetical', d.parenthetical], ['action', d.action], ['transition', d.transition],
    ['sceneNumbering', template.sceneNumbering.styleId],
  ];
  for (const [field, id] of bodyRefs) {
    if (id !== null && !bodyIds.has(id)) issues.push({ code: 'danglingDefault', field, message: `defaults.${field} → ${id}` });
  }
  if (!titleIds.has(d.titleDefault)) {
    issues.push({ code: 'danglingDefault', field: 'titleDefault', message: `defaults.titleDefault → ${d.titleDefault}` });
  }
  return issues;
}
