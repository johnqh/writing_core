import type { LayoutMode, TemplateCategory } from '../../schema/vocab.js';

export interface BuiltinSource {
  /** Directory name under research/templates (without `/document.xml`). */
  file: string;
  key: string;
  name: string;
  category: TemplateCategory;
  layoutMode: LayoutMode;
}

/** Spec 01 §4.1 catalogue rows derived from Fade In files. */
export const BUILTIN_SOURCES: readonly BuiltinSource[] = [
  { file: 'Screenplay (Final Draft).fadein.template', key: 'screenplay-final-draft-fi', name: 'Screenplay (Final Draft metrics)', category: 'screenplay', layoutMode: 'flow' },
  { file: 'Screenplay (Cole and Haag).fadein.template', key: 'screenplay-cole-haag', name: 'Screenplay (Cole and Haag)', category: 'screenplay', layoutMode: 'flow' },
  { file: 'Screenplay (Warner).fadein.template', key: 'screenplay-warner', name: 'Screenplay (Warner)', category: 'screenplay', layoutMode: 'flow' },
  { file: 'Television - One-Hour Drama.fadein.template', key: 'tv-one-hour', name: 'Television – One-Hour Drama', category: 'television', layoutMode: 'flow' },
  { file: 'Television - Half-Hour Sitcom.fadein.template', key: 'tv-half-hour', name: 'Television – Half-Hour Sitcom (multi-cam)', category: 'television', layoutMode: 'flow' },
  { file: 'Stage Play.fadein.template', key: 'stage-play', name: 'Stage Play', category: 'stagePlay', layoutMode: 'flow' },
  { file: 'Stage Play (Times New Roman).fadein.template', key: 'stage-play-tnr', name: 'Stage Play (Times New Roman)', category: 'stagePlay', layoutMode: 'flow' },
  { file: 'Stage Play (BBC).fadein.template', key: 'stage-play-bbc', name: 'Stage Play (BBC)', category: 'stagePlay', layoutMode: 'flow' },
  { file: 'Radio Play (BBC).fadein.template', key: 'radio-play-bbc', name: 'Radio Play (BBC)', category: 'radio', layoutMode: 'flow' },
  { file: 'Script (Radio).fadein.template', key: 'radio-script-us', name: 'Radio Script', category: 'radio', layoutMode: 'flow' },
  { file: 'Script (AV two-column).fadein.template', key: 'av-two-column', name: 'AV Script (Two-Column)', category: 'audioVisual', layoutMode: 'flow' },
  { file: 'Script (Multimedia).fadein.template', key: 'multimedia', name: 'Multimedia Script', category: 'multimedia', layoutMode: 'flow' },
  { file: 'Graphic Novel.fadein.template', key: 'graphic-novel', name: 'Graphic Novel', category: 'graphicNovel', layoutMode: 'panels' },
  { file: 'Novel Manuscript.fadein.template', key: 'novel-manuscript', name: 'Novel Manuscript', category: 'prose', layoutMode: 'flow' },
];
