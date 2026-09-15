import { builtinStyleId } from '../../ids/ids.js';
import { SCREENPLAY_MACRO_SEEDS, letterPage, sceneHeadingNumbering, standardHeader } from '../shared.js';
import { inchesToEmu as inch } from '../../units.js';
import { authoredTemplate, flowTo, styleDef } from './authoring.js';
import { SCREENPLAY_STANDARD_STYLES } from './screenplay-standard.js';

const NT = 'normal';

/** Spec 01 §4.7. */
export const verticalDrama = authoredTemplate({
  key: 'vertical-drama',
  name: 'Vertical / Micro Drama',
  category: 'verticalDrama',
  page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1.5), right: inch(1) }),
  header: standardHeader(),
  styles: [
    ...SCREENPLAY_STANDARD_STYLES,
    styleDef('episode', 'Episode', 'actStart', NT, {
      font: { bold: true, underline: 'single' }, allCaps: true, spaceBefore: 0, align: 'center', pageBreakBefore: true, actBreak: true,
      flow: flowTo('scene_heading'),
      numbering: { ...sceneHeadingNumbering('both'), enabled: true, format: 'EPISODE {n}', position: 'inline' },
    }),
    styleDef('hook', 'Hook', 'action', 'action', { font: { bold: true }, spaceBefore: 1, align: 'left', flow: flowTo('scene_heading') }),
    styleDef('on_screen_text', 'On-Screen Text', 'action', 'action', { font: { italic: true }, allCaps: true, spaceBefore: 1, align: 'center', flow: flowTo('action') }),
    styleDef('cliffhanger', 'Cliffhanger', 'actEnd', NT, { font: { bold: true }, allCaps: true, spaceBefore: 2, align: 'center', flow: flowTo('episode') }),
  ],
  defaults: { firstElement: builtinStyleId('episode') },
  macros: [...SCREENPLAY_MACRO_SEEDS],
  body: [{ styleKey: 'st_episode', text: '' }, { styleKey: 'st_scene_heading', text: '' }],
});
