import { builtinStyleId } from '../../ids/ids.js';
import { inchesToEmu as inch } from '../../units.js';
import { defaultPagination, letterPage, standardHeader } from '../shared.js';
import { EMPTY_SMARTTYPE, ENGLISH_SMARTTYPE, authoredTemplate, flowTo, rootStyle, styleDef } from './authoring.js';

const NT = 'normal';

/** Spec 01 §4.4. */
export const treatment = authoredTemplate({
  key: 'treatment',
  name: 'Treatment',
  category: 'treatment',
  page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1), right: inch(1) }),
  header: standardHeader('{field:title} – {page}'),
  styles: [
    rootStyle(),
    styleDef('treatment_title', 'Title', 'subheading', NT, { font: { bold: true }, allCaps: true, spaceBefore: 0, align: 'center', keepWithNext: true, flow: flowTo('logline') }),
    styleDef('logline', 'Logline', 'paragraph', NT, { font: { italic: true }, indentLeft: inch(0.5), indentRight: inch(0.5), spaceBefore: 1, flow: flowTo('section_heading') }),
    styleDef('section_heading', 'Section Heading', 'actStart', NT, { font: { bold: true, underline: 'single' }, allCaps: true, spaceBefore: 2, keepWithNext: true, actBreak: true, flow: flowTo('paragraph') }),
    styleDef('scene_heading', 'Scene Heading', 'sceneHeading', NT, { font: { bold: true }, allCaps: true, spaceBefore: 2, keepWithNext: true, smartTypeList: 'locations', flow: flowTo('paragraph') }),
    styleDef('paragraph', 'Paragraph', 'paragraph', NT, { indentFirstLine: inch(0.5), spaceBefore: 1, flow: flowTo(null) }),
    styleDef('character_intro', 'Character Introduction', 'action', NT, { spaceBefore: 1, flow: flowTo('paragraph') }),
    styleDef('note', 'Note', 'note', NT, { font: { italic: true, color: '#6B6B6B' }, spaceBefore: 1, printable: false, flow: flowTo('paragraph') }),
  ],
  defaults: { firstElement: builtinStyleId('paragraph'), pasteFallback: builtinStyleId('paragraph') },
  pagination: defaultPagination({
    dialogue: { allowBreaks: false, minLinesBeforeBreak: 2, minLinesAfterBreak: 2, moreAtBottom: false, contAtTop: false },
    automaticContinueds: { enabled: false, scope: 'scene' },
    dualDialogue: { enabled: false, columnGap: inch(0.25), stackWhileEditing: false, geometry: null },
  }),
  smartType: { ...EMPTY_SMARTTYPE, sceneIntros: ENGLISH_SMARTTYPE.sceneIntros, times: ENGLISH_SMARTTYPE.times },
});
