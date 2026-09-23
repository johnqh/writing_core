/**
 * M2 task 32, step 1: the golden corpus's own two always-running cases (the ones that need no PDF).
 * Reads the committed `test/fixtures/*.doc.json` (never the `.fadein` originals — see their own
 * README), so this runs everywhere with no env var and no licensed file present; `it.skipIf` guards
 * each case anyway, in case the fixtures are ever removed.
 *
 * Spike S2 (`../../../screenwriter_plans/research/spikes/s2-metrics-pagination.md`) established the
 * one number that can be checked without a PDF or Fade In itself: `<info pagecount>`, 12 for Act 2 and
 * 10 for Ending — both documents' page count DOES match here. The per-page breakdown below is this
 * pipeline's OWN computed table, not the spike's separate one-off script's table (the two differ
 * slightly from page 4 on — different implementations, same spec, small independent line-wrap
 * decisions; spike S2 itself says which one matches Fade In's real page breaks "cannot be determined
 * from the files" either way) — it is pinned here as a regression guard: a future change to break
 * placement becomes visible immediately, not only once it happens to move the total page count.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { materializeDocument } from '../model/json.js';
import { openDocument } from '../read-model/open.js';
import { layoutDocument } from './layout-document.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'test', 'fixtures');

interface PageExpectation {
  textLines: number;
  firstIndex: number;
  firstTextStartsWith: string;
}

function load(file: string) {
  const json = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
  const ids = createSeededIdSource(1);
  const doc = materializeDocument(json, { preserveIds: true, ids });
  return openDocument(doc, { ids, clock: () => 0, locale: 'en' });
}

function checkPages(file: string, expected: readonly PageExpectation[]): void {
  const model = load(file);
  const layout = layoutDocument(model);
  const els = model.elements();
  expect(layout.pages).toHaveLength(expected.length);
  layout.pages.forEach((page, i) => {
    const exp = expected[i]!;
    const textLines = page.lines.filter((l) => l.kind === 'text');
    expect(textLines, `page ${i + 1}`).toHaveLength(exp.textLines);
    const firstIndex = els.findIndex((e) => e.id === textLines[0]!.elementId);
    expect(firstIndex, `page ${i + 1} first element index`).toBe(exp.firstIndex);
    expect(els[firstIndex]!.text.plain.startsWith(exp.firstTextStartsWith), `page ${i + 1} first element text`).toBe(true);
  });
}

describe('golden corpus: the two real reference documents (M2 task 32)', () => {
  it.skipIf(!existsSync(join(FIXTURES_DIR, 'act-2.doc.json')))('Act 2: 12 pages, matching spike S2\'s pagecount', () => {
    checkPages('act-2.doc.json', [
      { textLines: 40, firstIndex: 0, firstTextStartsWith: 'int. SFPD briefing room, day' },
      { textLines: 42, firstIndex: 20, firstTextStartsWith: 'miller' },
      { textLines: 36, firstIndex: 40, firstTextStartsWith: 'The phone rings twice.' },
      { textLines: 36, firstIndex: 65, firstTextStartsWith: 'adam' },
      { textLines: 39, firstIndex: 88, firstTextStartsWith: 'A black Jeep Cherokee swings into a spot' },
      { textLines: 37, firstIndex: 108, firstTextStartsWith: 'Shane picks up the key, turning it over' },
      { textLines: 37, firstIndex: 131, firstTextStartsWith: 'miller' },
      { textLines: 35, firstIndex: 154, firstTextStartsWith: 'At the next intersection, King signals' },
      { textLines: 35, firstIndex: 178, firstTextStartsWith: 'female driver' },
      { textLines: 34, firstIndex: 200, firstTextStartsWith: 'And again.' },
      { textLines: 40, firstIndex: 222, firstTextStartsWith: 'miller' },
      { textLines: 20, firstIndex: 242, firstTextStartsWith: 'lee' },
    ]);
  });

  it.skipIf(!existsSync(join(FIXTURES_DIR, 'ending-updated.doc.json')))('Ending: 10 pages, matching spike S2\'s pagecount', () => {
    checkPages('ending-updated.doc.json', [
      { textLines: 40, firstIndex: 0, firstTextStartsWith: "int. spencer's apartment, soma, night" },
      { textLines: 40, firstIndex: 22, firstTextStartsWith: 'shane' },
      { textLines: 42, firstIndex: 47, firstTextStartsWith: 'alice' },
      { textLines: 41, firstIndex: 67, firstTextStartsWith: 'Lee flows in behind King, peeling right' },
      { textLines: 41, firstIndex: 94, firstTextStartsWith: 'Shane EXPLODES forward, driving his shoulder' },
      { textLines: 38, firstIndex: 113, firstTextStartsWith: 'miller' },
      { textLines: 40, firstIndex: 129, firstTextStartsWith: 'shane' },
      { textLines: 43, firstIndex: 148, firstTextStartsWith: 'shane' },
      { textLines: 38, firstIndex: 171, firstTextStartsWith: 'adam' },
      { textLines: 40, firstIndex: 184, firstTextStartsWith: "inT. spencer's apartment, soma, same time" },
    ]);
  });

  it('guards against a vacuous suite: at least one case always runs', () => {
    const always = ['act-2.doc.json', 'ending-updated.doc.json'].filter((f) => existsSync(join(FIXTURES_DIR, f)));
    expect(always.length).toBeGreaterThan(0);
  });
});
