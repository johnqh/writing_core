import type { StyleId } from '../ids/ids.js';
import type { TemplateJSON } from '../schema/template.js';
import { type EnterOnBlank, SPEECH_MEMBER_ROLES, type SmartTypeList } from '../schema/vocab.js';
import { resolveStyle } from './resolve.js';

export type FlowAction =
  | { kind: 'split'; style: StyleId }
  | { kind: 'insertAfter'; style: StyleId }
  | { kind: 'convert'; style: StyleId }
  | { kind: 'openPicker' }
  | { kind: 'openSmartType'; list: SmartTypeList }
  | { kind: 'segmentedCompletion' }
  | { kind: 'none' };

type FlowTemplate = Pick<TemplateJSON, 'styles' | 'defaults' | 'pagination'>;

/** Spec 01 §3.5. */
export function enterAction(
  template: FlowTemplate,
  styleId: StyleId,
  ctx: { empty: boolean; caretAtEnd: boolean; enterOnBlank: EnterOnBlank },
): FlowAction {
  const style = resolveStyle(template, styleId);
  if (!ctx.empty) {
    if (!ctx.caretAtEnd) return { kind: 'split', style: styleId };
    return { kind: 'insertAfter', style: style.flow.onEnter ?? styleId };
  }
  const mode = ctx.enterOnBlank === 'template' ? style.flow.onEnterEmpty : ctx.enterOnBlank;
  if (mode === 'picker') return { kind: 'openPicker' };
  if (mode === 'flow') return style.flow.onEnter ? { kind: 'convert', style: style.flow.onEnter } : { kind: 'none' };
  return { kind: 'convert', style: mode };
}

export function tabAction(template: FlowTemplate, styleId: StyleId, ctx: { empty: boolean; caretAtEnd: boolean }): FlowAction {
  const style = resolveStyle(template, styleId);
  if (ctx.empty) {
    if (style.flow.onTabEmpty) return { kind: 'convert', style: style.flow.onTabEmpty };
    return style.smartTypeList ? { kind: 'openSmartType', list: style.smartTypeList } : { kind: 'none' };
  }
  if (style.role === 'sceneHeading') return { kind: 'segmentedCompletion' };
  const target = style.flow.onTabText;
  if (!target) return { kind: 'none' };
  const targetRole = resolveStyle(template, target).role;
  if (ctx.caretAtEnd && (SPEECH_MEMBER_ROLES as readonly string[]).includes(targetRole)) {
    return { kind: 'insertAfter', style: target };
  }
  return { kind: 'convert', style: target };
}

export function shiftTabAction(template: FlowTemplate, styleId: StyleId, ctx: { empty: boolean }): FlowAction {
  const style = resolveStyle(template, styleId);
  if (!ctx.empty) return { kind: 'none' };
  if (style.flow.onShiftTabEmpty) return { kind: 'convert', style: style.flow.onShiftTabEmpty };
  // "previous style in the cycle": the first style whose empty-Tab target is this style
  for (const candidate of template.styles) {
    if (candidate.id === styleId) continue;
    if (resolveStyle(template, candidate.id).flow.onTabEmpty === styleId) return { kind: 'convert', style: candidate.id };
  }
  return { kind: 'none' };
}
