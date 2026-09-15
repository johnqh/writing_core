import { builtinStyleId } from '../../ids/ids.js';
import { inchesToEmu as inch } from '../../units.js';
import { defaultPagination, letterPage, sceneHeadingNumbering, standardHeader } from '../shared.js';
import { authoredTemplate, flowTo, rootStyle, styleDef } from './authoring.js';

const NT = 'normal';

/** Spec 01 §4.5. The Summary's +0.5 in relative indent is applied by the insert command as an override. */
export const textOutline = authoredTemplate({
  key: 'text-outline',
  name: 'Text Outline',
  category: 'outline',
  page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1.5), right: inch(1) }),
  header: standardHeader(),
  styles: [
    rootStyle(),
    styleDef('outline_1', 'Outline 1', 'outline', NT, { font: { bold: true }, allCaps: true, spaceBefore: 2, keepWithNext: true, outlineLevel: 1, flow: flowTo('summary', undefined, 'outline_2') }),
    styleDef('outline_2', 'Outline 2', 'outline', NT, { font: { bold: true }, indentLeft: inch(0.5), spaceBefore: 1, keepWithNext: true, outlineLevel: 2, flow: flowTo('summary', undefined, 'outline_3') }),
    styleDef('outline_3', 'Outline 3', 'outline', NT, { indentLeft: inch(1), spaceBefore: 1, keepWithNext: true, outlineLevel: 3, flow: flowTo('summary', undefined, 'scene_heading') }),
    styleDef('scene_heading', 'Scene Heading', 'sceneHeading', NT, { allCaps: true, indentLeft: inch(1.5), spaceBefore: 1, keepWithNext: true, numbering: sceneHeadingNumbering('both'), smartTypeList: 'locations', flow: flowTo('summary') }),
    styleDef('summary', 'Summary', 'synopsis', NT, { indentLeft: inch(0.5), spaceBefore: 0, flow: flowTo(null) }),
    styleDef('note', 'Note', 'note', NT, { font: { italic: true, color: '#6B6B6B' }, spaceBefore: 1, printable: false, flow: flowTo('summary') }),
  ],
  defaults: { firstElement: builtinStyleId('outline_1'), pasteFallback: builtinStyleId('summary') },
  // Spec 01 §4.2: dual dialogue only for screenplay, television and vertical drama.
  pagination: defaultPagination({ dualDialogue: { enabled: false, columnGap: inch(0.25), stackWhileEditing: false, geometry: null } }),
});
