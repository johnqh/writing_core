// M2 task 32, step 1. Run by hand (not in CI): converts the two real `.fadein` reference documents
// (spike S2's own `screenwriter_plans/research/spikes/s2-metrics-pagination.md`) into committed,
// plain `DocumentJSON` fixtures under `test/fixtures/`. `writing_core` has no `.fadein`/OSF *document*
// importer (that is spec 04 / `writing_formats`, M3) — only an OSF *template* importer
// (`src/templates/generator/osf.ts`), which this script does not reuse for the body: the two source
// documents use only the built-in styles at their defaults, so `screenplayStandard` already matches
// their `<settings>`/`<styles>` (spike S2 recorded them: Letter page, Courier New 12, the same
// spacing/indents `screenplayStandard` encodes) — there is nothing template-specific left to parse.
// Body `<para><style basestyle="…"/><text>…</text></para>` is the whole shape actually used by both
// files (spike S2: no dual dialogue, no soft returns, no per-paragraph `pageBreakBefore`); parenthetical
// text is stored WITHOUT its parentheses (`<text>To Shane</text>`) and restored here, matching this
// codebase's own convention of storing the parens as literal text (`'(quietly)'`, `dual.test.ts` etc.).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { createSeededIdSource } from '../src/ids/id-source.js';
import { builtinStyleId, newId, type StyleId } from '../src/ids/ids.js';
import { createDocument } from '../src/model/create.js';
import { insertElementRecord } from '../src/model/element-record.js';
import { documentToJSON } from '../src/model/json.js';
import { generatePositions } from '../src/model/positions.js';
import { screenplayStandard } from '../src/templates/builtin/screenplay-standard.js';

const STYLE_MAP: Record<string, string> = {
  'Scene Heading': 'scene_heading', Action: 'action', Character: 'character',
  Parenthetical: 'parenthetical', Dialogue: 'dialogue', Transition: 'transition', Shot: 'shot',
  'Normal Text': 'action', // the handful of body paragraphs with no basestyle override, if any
};

interface RawPara { style?: { basestyle?: string }; text?: string | { '#text'?: string } }

function textOf(p: RawPara): string {
  const t = p.text;
  if (t === undefined) return '';
  if (typeof t === 'string') return t;
  return t['#text'] ?? '';
}

function convert(xmlPath: string): unknown {
  const xml = execSync(`unzip -p ${JSON.stringify(xmlPath)} document.xml`, { maxBuffer: 32 * 1024 * 1024 }).toString('utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, isArray: (name) => name === 'para' });
  const doc = parser.parse(xml).document as { paragraphs: { para: RawPara[] } };
  const rows = doc.paragraphs.para;

  const ids = createSeededIdSource(1);
  const yDoc = createDocument({ template: screenplayStandard, uid: 'fixture', ids, clock: () => 0 });
  const elements = yDoc.getMap<unknown>('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  const positions = generatePositions(rows.length, null, null, null);
  const meta = { createdBy: 'fixture', createdAt: 0, editedBy: 'fixture', editedAt: 0 };
  rows.forEach((row, i) => {
    const basestyle = row.style?.basestyle ?? 'Action';
    const slug = STYLE_MAP[basestyle];
    if (!slug) throw new Error(`unmapped basestyle: ${basestyle}`);
    let text = textOf(row);
    if (slug === 'parenthetical' && text.length > 0 && !text.startsWith('(')) text = `(${text})`;
    const style: StyleId = builtinStyleId(slug);
    insertElementRecord(elements, { id: newId('el', ids), pos: positions[i]!, style, text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  });

  return documentToJSON(yDoc);
}

const dir = resolve(process.env.FADEWRIGHT_FIXTURES_DIR ?? join(homedir(), 'projects/writing'));
const outDir = resolve('test/fixtures');
mkdirSync(outDir, { recursive: true });

const SOURCES: { file: string; out: string }[] = [
  { file: 'Act 2.fadein', out: 'act-2.doc.json' },
  { file: 'Ending-updated.fadein', out: 'ending-updated.doc.json' },
];

for (const { file, out } of SOURCES) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    console.log(`skip ${file}: not found at ${path} (set FADEWRIGHT_FIXTURES_DIR)`);
    continue;
  }
  const json = convert(path);
  writeFileSync(join(outDir, out), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
