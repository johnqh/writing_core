import { describe, expect, it } from 'vitest';
import { LOCALE_SCRIPT_WORDS } from '../templates/locale.js';
import { parseSceneHeading } from './scene-heading.js';

const en = { sceneIntros: ['INT.', 'EXT.', 'INT./EXT.'], times: ['DAY', 'NIGHT', 'MOMENTS LATER', 'CONTINUOUS'], introSeparator: ' ', timeSeparator: ' - ' };

describe('parseSceneHeading', () => {
  it('splits intro, location, sub-locations and time', () => {
    expect(parseSceneHeading('INT. HOUSE - KITCHEN - NIGHT', en)).toEqual({
      intro: 'INT.', location: 'HOUSE - KITCHEN', subLocations: ['HOUSE', 'KITCHEN'], time: 'NIGHT', raw: 'INT. HOUSE - KITCHEN - NIGHT', nonstandardSeparator: false,
    });
  });
  it('prefers the longest intro and tolerates case and separators', () => {
    expect(parseSceneHeading('int./ext. car -  day', en)).toMatchObject({ intro: 'INT./EXT.', location: 'car', time: 'DAY' });
    expect(parseSceneHeading('INT.DINER - NIGHT', en)).toMatchObject({ intro: 'INT.', location: 'DINER' });
    expect(parseSceneHeading('I/E VAN - DAY', en)).toMatchObject({ intro: 'I/E', location: 'VAN' });
    expect(parseSceneHeading('INTERIOR MONOLOGUE', en)).toMatchObject({ intro: null, location: 'INTERIOR MONOLOGUE', time: null });
  });
  it('accepts the comma habit and flags it', () => {
    expect(parseSceneHeading('INT. SFPD BRIEFING ROOM, DAY', en)).toMatchObject({ location: 'SFPD BRIEFING ROOM', time: 'DAY', nonstandardSeparator: true });
  });
  it('keeps an unknown trailing segment in the location', () => {
    expect(parseSceneHeading('EXT. ROOF - DUSKISH', en)).toMatchObject({ location: 'ROOF - DUSKISH', time: null });
  });
  it('parses CJK headings with no intro separator', () => {
    const zh = LOCALE_SCRIPT_WORDS['zh-Hans'];
    expect(parseSceneHeading('内景咖啡馆 · 夜', zh)).toMatchObject({ intro: '内景', location: '咖啡馆', time: '夜' });
  });
});
