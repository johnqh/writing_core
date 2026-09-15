import { builtinStyleId } from '../../ids/ids.js';
import type { StyleDef } from '../../schema/template.js';
import { inchesToEmu as inch } from '../../units.js';
import { SCREENPLAY_MACRO_SEEDS, letterPage, sceneHeadingNumbering, standardHeader } from '../shared.js';
import { authoredTemplate, flowTo, rootStyle, styleDef } from './authoring.js';

const NT = 'normal';

/** Spec 01 §4.3 — Final Draft 13 blank-template geometry. */
export const SCREENPLAY_STANDARD_STYLES: StyleDef[] = [
  rootStyle(),
  styleDef('scene_heading', 'Scene Heading', 'sceneHeading', NT, { shortcut: 1, allCaps: true, spaceBefore: 2, keepWithNext: true, flow: flowTo('action', 'action', 'action'), numbering: sceneHeadingNumbering('both'), smartTypeList: 'locations' }),
  styleDef('action', 'Action', 'action', NT, { shortcut: 2, spaceBefore: 1, flow: flowTo(null, 'character', 'character') }),
  styleDef('character', 'Character', 'character', NT, { shortcut: 3, allCaps: true, indentLeft: inch(2), indentRight: inch(0.25), spaceBefore: 1, keepWithNext: true, flow: flowTo('dialogue', 'transition', 'parenthetical'), smartTypeList: 'characters', dualDialogue: true }),
  styleDef('parenthetical', 'Parenthetical', 'parenthetical', NT, { shortcut: 4, indentLeft: inch(1.5), indentRight: inch(2), indentFirstLine: inch(-0.1), spaceBefore: 0, keepWithNext: true, flow: flowTo('dialogue', 'dialogue', 'dialogue'), dualDialogue: true }),
  styleDef('dialogue', 'Dialogue', 'dialogue', NT, { shortcut: 5, indentLeft: inch(1), indentRight: inch(1.5), spaceBefore: 0, flow: flowTo('action', 'parenthetical', 'parenthetical'), dualDialogue: true }),
  styleDef('transition', 'Transition', 'transition', NT, { shortcut: 6, allCaps: true, indentLeft: inch(4), indentRight: inch(0.4), spaceBefore: 1, align: 'right', flow: flowTo('scene_heading', 'action', 'action'), smartTypeList: 'transitions' }),
  styleDef('shot', 'Shot', 'shot', NT, { shortcut: 7, allCaps: true, spaceBefore: 1, keepWithNext: true, flow: flowTo('action', 'action', 'action'), paginateAs: builtinStyleId('scene_heading') }),
  styleDef('lyrics', 'Lyrics', 'lyrics', 'dialogue', { font: { italic: true }, flow: flowTo('lyrics', 'parenthetical', 'parenthetical'), paginateAs: builtinStyleId('dialogue'), dualDialogue: true }),
  styleDef('cast_list', 'Cast List', 'castList', NT, { allCaps: true, spaceBefore: 0, flow: flowTo('action', null, null) }),
  styleDef('new_act', 'New Act', 'actStart', NT, { font: { underline: 'single' }, allCaps: true, spaceBefore: 0, align: 'center', keepWithNext: true, pageBreakBefore: true, actBreak: true, hiddenInScript: false, flow: flowTo('scene_heading', 'scene_heading', 'scene_heading') }),
  styleDef('end_of_act', 'End of Act', 'actEnd', NT, { font: { underline: 'single' }, allCaps: true, spaceBefore: 2, align: 'center', flow: flowTo('new_act', 'new_act', 'new_act') }),
  styleDef('sequence', 'Sequence', 'sequence', NT, { font: { bold: true }, allCaps: true, spaceBefore: 2, align: 'left', keepWithNext: true, hiddenInScript: true, printable: false, flow: flowTo('scene_heading', null, null) }),
  styleDef('outline_1', 'Outline 1', 'outline', NT, { font: { bold: true }, allCaps: true, indentLeft: 0, spaceBefore: 2, keepWithNext: true, outlineLevel: 1, hiddenInScript: true, printable: false, flow: flowTo('outline_2') }),
  styleDef('outline_2', 'Outline 2', 'outline', NT, { font: { bold: true }, indentLeft: inch(0.5), spaceBefore: 1, keepWithNext: true, outlineLevel: 2, hiddenInScript: true, printable: false, flow: flowTo('outline_3') }),
  styleDef('outline_3', 'Outline 3', 'outline', NT, { indentLeft: inch(1), spaceBefore: 1, keepWithNext: true, outlineLevel: 3, hiddenInScript: true, printable: false, flow: flowTo('summary') }),
  styleDef('summary', 'Summary', 'synopsis', NT, { font: { italic: true }, spaceBefore: 0, hiddenInScript: true, printable: false, flow: flowTo('scene_heading', null, null) }),
  styleDef('note', 'Note', 'note', NT, { font: { italic: true, color: '#6B6B6B' }, spaceBefore: 1, printable: false, flow: flowTo('action', null, null) }),
];

export const screenplayStandard = authoredTemplate({
  key: 'screenplay-standard',
  name: 'Screenplay (Standard)',
  category: 'screenplay',
  page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1.5), right: inch(1) }),
  header: standardHeader(),
  styles: SCREENPLAY_STANDARD_STYLES,
  defaults: { firstElement: builtinStyleId('scene_heading') },
  macros: [...SCREENPLAY_MACRO_SEEDS],
});
