import { writeFileSync } from 'node:fs';
import { type HashVectorInput, computeHashVector } from '../src/hash/content.js';
import type { TextJSON } from '../src/schema/text.js';

const T = (plain: string, attrs: TextJSON['runs'][number]['attrs'] = {}): TextJSON => ({ plain, runs: plain ? [{ text: plain, attrs }] : [], embeds: [] });
const inputs: HashVectorInput[] = [
  { name: 'plain action', fn: 'element', input: { role: 'action', style: 'st_action', text: T('Maya waits.'), dual: null } },
  { name: 'caps not applied', fn: 'element', input: { role: 'sceneHeading', style: 'st_scene_heading', text: T('int. diner - night'), dual: null } },
  { name: 'bold run', fn: 'element', input: { role: 'action', style: 'st_action', text: { plain: 'A big deal', runs: [{ text: 'A ', attrs: {} }, { text: 'big', attrs: { b: true } }, { text: ' deal', attrs: {} }], embeds: [] }, dual: null } },
  { name: 'tracked deletion excluded', fn: 'element', input: { role: 'dialogue', style: 'st_dialogue', text: { plain: 'No way', runs: [{ text: 'No ', attrs: {} }, { text: 'way', attrs: { del: { changeId: 'chg_1', by: 'u', at: 1 } } }], embeds: [] }, dual: null } },
  { name: 'custom style id', fn: 'element', input: { role: 'action', style: 'st_01ARYZ6S410000000000000000', text: T('x'), dual: null } },
  { name: 'dual left', fn: 'element', input: { role: 'character', style: 'st_character', text: T('MAYA'), dual: { side: 'left', partnerHash: 'v1:0000000000000000000000000000000000000000000000000000000000000000' } } },
  { name: 'unicode NFC', fn: 'element', input: { role: 'action', style: 'st_action', text: T('Café \u{1F600}'), dual: null } },
  {
    name: 'omitted scene excludes non-printing', fn: 'scene',
    input: {
      omitted: true,
      elements: [
        { input: { role: 'sceneHeading', style: 'st_scene_heading', text: T('INT. DINER - NIGHT'), dual: null }, printable: true },
        { input: { role: 'note', style: 'st_note', text: T('cut this?'), dual: null }, printable: false },
        { input: { role: 'action', style: 'st_action', text: T('Maya waits.'), dual: null }, printable: true },
      ],
    },
  },
  {
    // Spec 11 §4.2: exclusion is by the style's `printable` flag only. In the text-outline template
    // the outline/summary styles are the printed body (printable: true) and only `note` is
    // printable: false — so this vector must differ from the same scene with its body removed.
    name: 'outline-template scene keeps its printable outline body', fn: 'scene',
    input: {
      omitted: false,
      elements: [
        { input: { role: 'sceneHeading', style: 'st_scene_heading', text: T('INT. DINER - NIGHT'), dual: null }, printable: true },
        { input: { role: 'outline', style: 'st_outline_1', text: T('ACT ONE'), dual: null }, printable: true },
        { input: { role: 'synopsis', style: 'st_summary', text: T('Maya waits for the call.'), dual: null }, printable: true },
        { input: { role: 'note', style: 'st_note', text: T('check this'), dual: null }, printable: false },
      ],
    },
  },
  {
    name: 'partial shot range', fn: 'shot',
    input: {
      elements: [
        { role: 'action', style: 'st_action', text: T('She runs. He waits.'), dual: null },
        { role: 'dialogue', style: 'st_dialogue', text: T('Stop.'), dual: null },
      ],
      first: { from: 10, to: 19 },
    },
  },
];
const vectors = inputs.map((v) => ({ ...v, hash: computeHashVector(v) }));
writeFileSync('src/hash/vectors.json', `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${vectors.length} vectors`);
