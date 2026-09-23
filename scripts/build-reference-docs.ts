// M2 task 35, step 1. Generates spec 02 §33's own reference documents as committed `DocumentJSON`
// fixtures under `test/fixtures/`, seeded and deterministic (never hand-written, so they are
// reproducible and reviewable as a diff). §33 gives exact element counts for two of the six
// (`feature-120` 2 800, `feature-150` 3 500); the other four are given only as page counts, so their
// element counts here are reasoned estimates from feature-120's own ~23 elements/page density,
// adjusted for how each genre's paragraphs run (prose: fewer, longer; AV two-column: more, shorter) —
// stated plainly so nobody mistakes them for the spec's own numbers:
//   novel-320   ~8 elements/page  (long prose paragraphs)      -> 2600
//   av-80       ~19 elements/page (short two-column rows)      -> 1500
//   drama-60-cjk ~23 elements/page (same shape as a screenplay) -> 1400
//   arabic-90   ~23 elements/page (same shape as a screenplay) -> 2000
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSeededIdSource } from '../src/ids/id-source.js';
import { newId } from '../src/ids/ids.js';
import { createDocument } from '../src/model/create.js';
import { insertElementRecord } from '../src/model/element-record.js';
import { documentToJSON } from '../src/model/json.js';
import { generatePositions } from '../src/model/positions.js';
import { getBuiltinTemplate } from '../src/templates/catalogue.js';
import type { TemplateJSON } from '../src/schema/template.js';

interface RefDoc {
  key: string;
  templateKey: string;
  size: number;
  seed: number;
  /** `[style, plainText]` for body element `i`. */
  at(i: number): [style: string, text: string];
}

function cycleOf(cycle: [style: string, text: (i: number) => string][]): RefDoc['at'] {
  return (i) => {
    const [style, text] = cycle[i % cycle.length]!;
    return [style, text(i)];
  };
}

const SCREENPLAY_CYCLE = cycleOf([
  ['st_scene_heading', (i) => `INT. ROOM ${i} - DAY`],
  ['st_action', (i) => `Maya crosses the room and checks the window, again, for the ${i}th time.`],
  ['st_character', (i) => (i % 2 === 0 ? 'MAYA' : 'JONAH')],
  ['st_parenthetical', () => '(quietly)'],
  ['st_dialogue', (i) => `Nobody is coming. Not tonight, not on day ${i}.`],
]);

// `st_chapter` starts a fresh page (a real manuscript convention), so it appears only once every 40
// paragraphs here, not every cycle — an early draft of this generator put one every 3 elements and
// produced 867 pages for a "novel-320", each chapter break alone forcing a near-empty page.
function novelAt(i: number): [style: string, text: string] {
  if (i % 40 === 0) return ['st_chapter', `Chapter ${Math.floor(i / 40) + 1}`];
  const words = 12 + (i % 5);
  return ['st_paragraph', Array.from({ length: words }, (_, w) => `word${(i * 17 + w) % 251}`).join(' ')];
}

const AV_CYCLE = cycleOf([
  ['st_scene_heading', (i) => `EXT. ROOFTOP ${i} - DAY`],
  ['st_action', (i) => `Drone shot ${i}: the city skyline.`],
  ['st_character', () => 'NARRATOR'],
  ['st_dialogue', (i) => `Beat ${i}.`],
]);

const JA_CYCLE = cycleOf([
  ['st_scene_heading', (i) => `屋内。部屋${i}。昼`],
  ['st_action', (i) => `マヤは窓の外を見つめている。もう${i}回目だ。`],
  ['st_character', (i) => (i % 2 === 0 ? 'マヤ' : 'ジョナ')],
  ['st_parenthetical', () => '（静かに）'],
  ['st_dialogue', (i) => `今夜は誰も来ない。${i}日目もだ。`],
]);

const ARABIC_CYCLE = cycleOf([
  ['st_scene_heading', (i) => `داخلي. غرفة ${i}. نهار`],
  ['st_action', (i) => `تنظر مايا من النافذة مرة أخرى، للمرة ${i}.`],
  ['st_character', (i) => (i % 2 === 0 ? 'مايا' : 'يونا')],
  ['st_parenthetical', () => '(بهدوء)'],
  ['st_dialogue', (i) => `لن يأتي أحد الليلة، ولا في اليوم ${i}.`],
]);

const DOCS: RefDoc[] = [
  { key: 'feature-120', templateKey: 'screenplay-standard', size: 2800, seed: 101, at: SCREENPLAY_CYCLE },
  { key: 'feature-150', templateKey: 'screenplay-standard', size: 3500, seed: 102, at: SCREENPLAY_CYCLE },
  { key: 'novel-320', templateKey: 'novel-manuscript', size: 2600, seed: 103, at: novelAt },
  { key: 'av-80', templateKey: 'av-two-column', size: 1500, seed: 104, at: AV_CYCLE },
  { key: 'drama-60-cjk', templateKey: 'screenplay-standard-ja', size: 1400, seed: 105, at: JA_CYCLE },
  { key: 'arabic-90', templateKey: 'screenplay-standard-rtl', size: 2000, seed: 106, at: ARABIC_CYCLE },
];

function build(ref: RefDoc): unknown {
  const template = getBuiltinTemplate(ref.templateKey) as TemplateJSON;
  const ids = createSeededIdSource(ref.seed);
  const doc = createDocument({ template, uid: 'ref', ids, clock: () => 0 });
  const elements = doc.getMap<unknown>('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const positions = generatePositions(ref.size, null, null, null);
  const meta = { createdBy: 'ref', createdAt: 0, editedBy: 'ref', editedAt: 0 };
  for (let i = 0; i < ref.size; i++) {
    const [style, plain] = ref.at(i);
    insertElementRecord(elements, { id: newId('el', ids), pos: positions[i]!, style: style as never, text: { plain, runs: [{ text: plain, attrs: {} }], embeds: [] } }, meta);
  }
  return documentToJSON(doc);
}

const outDir = resolve('test/fixtures');
mkdirSync(outDir, { recursive: true });
for (const ref of DOCS) {
  const json = build(ref);
  writeFileSync(resolve(outDir, `${ref.key}.doc.json`), `${JSON.stringify(json)}\n`);
  console.log(`wrote ${ref.key}.doc.json (${ref.size} elements, ${ref.templateKey})`);
}
