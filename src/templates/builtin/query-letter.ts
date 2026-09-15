import { builtinStyleId } from '../../ids/ids.js';
import type { StyleDef } from '../../schema/template.js';
import { inchesToEmu as inch } from '../../units.js';
import { defaultPagination, letterPage } from '../shared.js';
import { EMPTY_SMARTTYPE, authoredTemplate, rootStyle, styleDef } from './authoring.js';

const NT = 'normal';
const letterFlow = (enter: string | null, enterEmpty?: string): StyleDef['flow'] => ({
  onEnter: enter === null ? null : builtinStyleId(enter),
  ...(enterEmpty ? { onEnterEmpty: builtinStyleId(enterEmpty) } : {}),
});

/** Spec 01 §4.6. */
export const queryLetter = authoredTemplate({
  key: 'query-letter',
  name: 'Query Letter',
  category: 'letter',
  page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1), right: inch(1) }),
  header: { enabled: false, left: '', center: '', right: '', styleId: null, showOnFirstPage: false, showOnTitlePage: false, startAtPage: 1 },
  styles: [
    rootStyle({ font: { family: 'times' } }),
    styleDef('sender', 'Sender', 'blockText', NT, { spaceBefore: 0, flow: letterFlow(null, 'letter_date') }),
    styleDef('letter_date', 'Date', 'blockText', NT, { spaceBefore: 1, flow: letterFlow('recipient') }),
    styleDef('recipient', 'Recipient', 'blockText', NT, { spaceBefore: 1, flow: letterFlow(null, 'salutation') }),
    styleDef('salutation', 'Salutation', 'paragraph', NT, { spaceBefore: 1, flow: letterFlow('letter_body') }),
    styleDef('letter_body', 'Body', 'paragraph', NT, { spaceBefore: 1, flow: letterFlow(null, 'closing') }),
    styleDef('closing', 'Closing', 'paragraph', NT, { spaceBefore: 1, flow: letterFlow('signature') }),
    styleDef('signature', 'Signature', 'blockText', NT, { spaceBefore: 3, flow: letterFlow(null) }),
  ],
  defaults: { firstElement: builtinStyleId('sender'), pasteFallback: builtinStyleId('letter_body') },
  pagination: defaultPagination({
    breakOnSentences: false,
    dialogue: { allowBreaks: false, minLinesBeforeBreak: 2, minLinesAfterBreak: 2, moreAtBottom: false, contAtTop: false },
    automaticContinueds: { enabled: false, scope: 'scene' },
    dualDialogue: { enabled: false, columnGap: inch(0.25), stackWhileEditing: false, geometry: null },
  }),
  smartType: EMPTY_SMARTTYPE,
});
