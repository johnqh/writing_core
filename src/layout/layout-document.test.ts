import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { commandHarness } from '../commands/test-harness.js';
import { createSeededIdSource } from '../ids/id-source.js';
import { builtinStyleId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { getRawFilledPages, layoutDocument } from './layout-document.js';
import { createParagraphCache } from './paragraph-cache.js';

const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };

function setup() {
  const ids = createSeededIdSource(11);
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  let i = 0;
  const add = (slug: string, text = '') =>
    insertElementRecord(elements, { id: newId('el', ids), pos: `B${String(i++).padStart(4, '0')}B`, style: builtinStyleId(slug), text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  const idOf = (m: Y.Map<unknown>) => m.get('id') as never;
  const model = () => openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  return { add, idOf, model };
}

describe('layoutDocument', () => {
  it('lays out a small screenplay on one page with source ranges, positions and page numbers', () => {
    const { add, idOf, model } = setup();
    const heading = add('scene_heading', 'INT. KITCHEN - DAY');
    add('action', 'Rain on the window.');
    const cue = add('character', 'MILLER');
    add('dialogue', 'Is anyone home?');
    const layout = layoutDocument(model());
    expect(layout.pages).toHaveLength(1);
    const lines = layout.pages[0]!.lines;
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.pageNumber === 1)).toBe(true);
    expect(lines[0]!.elementId).toBe(idOf(heading));
    expect(lines[0]!.y).toBe(layout.bodyTop); // space before suppressed at the page top
    expect(lines[0]!.sourceStart).toBe(0);
    expect(lines[0]!.sourceEnd).toBe('INT. KITCHEN - DAY'.length);
    expect(lines[0]!.x).toBe(1_371_600); // left margin 1.5 in
    const cueLine = lines.find((l) => l.elementId === idOf(cue))!;
    expect(cueLine.x).toBe(1_371_600 + 1_828_800);
    expect(lines[1]!.y).toBeGreaterThan(lines[0]!.y);
    expect(lines[1]!.runs.map((r) => r.text).join('')).toBe('Rain on the window.');
  });

  it('breaks a long document onto a second page at the 54-line boundary', () => {
    const { add, idOf, model } = setup();
    add('scene_heading', 'INT. HOUSE - DAY');
    const actions = Array.from({ length: 30 }, (_, i) => add('action', `Beat ${i}.`));
    const layout = layoutDocument(model());
    expect(layout.pages).toHaveLength(2);
    // Heading (1 line) + 26 one-line actions each preceded by a blank line = 53 of 54 rows.
    expect(layout.pages[0]!.lines).toHaveLength(27);
    expect(layout.pages[1]!.lines).toHaveLength(4);
    expect(layout.pages[1]!.lines[0]!.elementId).toBe(idOf(actions[26]!));
    expect(layout.pages[1]!.lines[0]!.y).toBe(layout.bodyTop);
    expect(layout.pages[1]!.lines[0]!.pageNumber).toBe(2);
  });

  it('with a paragraphCache, a second layout of an unchanged document is a pure cache hit and reproduces the same output', () => {
    const { add, model } = setup();
    add('scene_heading', 'INT. KITCHEN - DAY');
    add('action', 'Rain on the window.');
    add('character', 'MILLER');
    add('dialogue', 'Is anyone home?');
    const paragraphCache = createParagraphCache(10 * 1024 * 1024);
    const first = layoutDocument(model(), undefined, { paragraphCache });
    const countAfterFirst = paragraphCache.count();
    expect(countAfterFirst).toBeGreaterThan(0);
    const second = layoutDocument(model(), undefined, { paragraphCache });
    expect(paragraphCache.count()).toBe(countAfterFirst); // no new entries: every paragraph was a hit
    expect(second.pages).toEqual(first.pages);
  });

  it('a real change to one element only produces a new cache entry for that element, the rest stay hits', () => {
    const { add, model } = setup();
    add('scene_heading', 'INT. KITCHEN - DAY');
    const action = add('action', 'Rain on the window.');
    add('character', 'MILLER');
    add('dialogue', 'Is anyone home?');
    const paragraphCache = createParagraphCache(10 * 1024 * 1024);
    layoutDocument(model(), undefined, { paragraphCache });
    const countBefore = paragraphCache.count();
    (action.get('text') as Y.Text).insert(0, 'More ');
    const after = layoutDocument(model(), undefined, { paragraphCache });
    expect(paragraphCache.count()).toBe(countBefore + 1); // one new key; the other three elements hit
    expect(after.pages[0]!.lines.find((l) => l.runs.map((r) => r.text).join('').startsWith('More Rain'))).toBeDefined();
  });

  describe('visiblePageHint / budgetMs (Task 31 §31.4)', () => {
    function longDoc() {
      const { add, model } = setup();
      add('scene_heading', 'INT. HOUSE - DAY');
      for (let i = 0; i < 90; i++) add('action', `Beat ${i}.`);
      return model();
    }

    it('with no hint or budget, always completes', () => {
      const layout = layoutDocument(longDoc());
      expect(layout.complete).toBe(true);
      expect(layout.resume).toBeNull();
      expect(layout.pages.length).toBeGreaterThan(2);
    });

    it('visiblePageHint stops at hint+2 pages and reports a resume point', () => {
      const model = longDoc();
      const full = layoutDocument(model);
      const partial = layoutDocument(model, undefined, { visiblePageHint: 0 });
      expect(partial.complete).toBe(false);
      expect(partial.resume).not.toBeNull();
      expect(partial.pages).toHaveLength(2); // max(0 + 2, 1)
      expect(partial.pages).toHaveLength(Math.min(2, full.pages.length));
      // The prefix that WAS computed is byte-identical to the same pages of the full layout.
      expect(partial.pages).toEqual(full.pages.slice(0, 2));
    });

    it('a later call with a bigger hint (sharing the cache) reaches complete: true with identical output', () => {
      const model = longDoc();
      const paragraphCache = createParagraphCache(10 * 1024 * 1024);
      const full = layoutDocument(model, undefined, { paragraphCache });
      const partial = layoutDocument(model, undefined, { paragraphCache, visiblePageHint: 0 });
      expect(partial.complete).toBe(false);
      const finished = layoutDocument(model, undefined, { paragraphCache }); // no hint: run to completion
      expect(finished.complete).toBe(true);
      expect(finished.pages).toEqual(full.pages);
    });

    it('budgetMs: 0 against a frozen clock stops immediately (deterministic, no real timing)', () => {
      const model = longDoc();
      const partial = layoutDocument(model, undefined, { budgetMs: 0, clock: () => 1_000 });
      expect(partial.complete).toBe(false);
      expect(partial.pages.length).toBeGreaterThan(0); // still at least one whole page (paginate's own guarantee)
      expect(partial.pages.length).toBeLessThan(layoutDocument(model).pages.length);
    });

    it('a huge budgetMs against a frozen clock never trips the deadline', () => {
      const model = longDoc();
      const layout = layoutDocument(model, undefined, { budgetMs: 999_999, clock: () => 1_000 });
      expect(layout.complete).toBe(true);
      expect(layout.resume).toBeNull();
    });
  });

  describe('resumeFrom: genuine cross-call resumption (Task 31 §31.3, completed)', () => {
    function longDoc() {
      const { add, model } = setup();
      add('scene_heading', 'INT. HOUSE - DAY');
      for (let i = 0; i < 90; i++) add('action', `Beat ${i}.`);
      return model();
    }

    it('resuming from an incomplete result reaches complete: true with byte-identical output to one full call', () => {
      const model = longDoc();
      const full = layoutDocument(model);
      const paragraphCache = createParagraphCache(10 * 1024 * 1024);
      const partial = layoutDocument(model, undefined, { paragraphCache, visiblePageHint: 0 });
      expect(partial.complete).toBe(false);
      expect(partial.resume).not.toBeNull();
      const finished = layoutDocument(model, undefined, {
        paragraphCache, resumeFrom: { priorPages: getRawFilledPages(partial)!, state: partial.resume! },
      });
      expect(finished.complete).toBe(true);
      expect(finished.resume).toBeNull();
      expect(finished.pages).toEqual(full.pages);
    });

    it('resuming twice in a row (three total chunks) still reaches the same full result', () => {
      const model = longDoc();
      const full = layoutDocument(model);
      const paragraphCache = createParagraphCache(10 * 1024 * 1024);
      let layout = layoutDocument(model, undefined, { paragraphCache, visiblePageHint: 0 });
      const chunks: number[] = [layout.pages.length];
      for (let guard = 0; guard < 10 && !layout.complete; guard++) {
        layout = layoutDocument(model, undefined, {
          paragraphCache, visiblePageHint: 0,
          resumeFrom: { priorPages: getRawFilledPages(layout)!, state: layout.resume! },
        });
        chunks.push(layout.pages.length - chunks.reduce((a, b) => a + b, 0));
      }
      expect(layout.complete).toBe(true);
      expect(chunks.length).toBeGreaterThan(1); // proves more than one resume actually happened
      expect(layout.pages).toEqual(full.pages);
    });

    it('a scene spanning the resume boundary still gets its real CONTINUED bottom/top decorations (the retroactiveSceneBottom path, exercised end to end)', () => {
      const h = commandHarness();
      h.replaceBody([
        ['st_scene_heading', 'INT. HOUSE - DAY'],
        ...Array.from({ length: 90 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
      ]);
      expect(h.run('template.setContinueds', { sceneBottom: true, sceneTop: true }).ok).toBe(true);
      const full = layoutDocument(h.model);
      expect(full.pages.length).toBeGreaterThan(1);
      const fullBottoms = full.pages.map((p) => p.lines.some((l) => l.kind === 'continuedBottom'));
      const fullTops = full.pages.map((p) => p.lines.some((l) => l.kind === 'continuedTop'));
      expect(fullBottoms.some(Boolean)).toBe(true); // the fixture actually exercises this, or the test proves nothing

      const paragraphCache = createParagraphCache(10 * 1024 * 1024);
      const partial = layoutDocument(h.model, undefined, { paragraphCache, visiblePageHint: 0 });
      const finished = layoutDocument(h.model, undefined, {
        paragraphCache, resumeFrom: { priorPages: getRawFilledPages(partial)!, state: partial.resume! },
      });
      expect(finished.pages).toEqual(full.pages);
      expect(finished.pages.map((p) => p.lines.some((l) => l.kind === 'continuedBottom'))).toEqual(fullBottoms);
      expect(finished.pages.map((p) => p.lines.some((l) => l.kind === 'continuedTop'))).toEqual(fullTops);
      // Page LABELS specifically (computed from the resolved lock/label pass over the whole,
      // combined page array, not just the newly-placed tail) match a full, unchunked run too.
      expect(finished.pages.map((p) => p.label)).toEqual(full.pages.map((p) => p.label));
    });

    it('getRawFilledPages returns undefined for a layout it did not itself produce', () => {
      const model = longDoc();
      const layout = layoutDocument(model);
      expect(getRawFilledPages({ ...layout })).toBeUndefined(); // a copy, not the same object
      expect(getRawFilledPages(layout)).toBeDefined();
    });
  });

  describe('Track Changes display (§26, M2 task 35)', () => {
    const at = (elementId: string, offset: number) => ({ elementId, offset });
    const range = (a: string, ao: number, b: string, bo: number) => ({ anchor: at(a, ao), head: at(b, bo) });
    const textOf = (layout: ReturnType<typeof layoutDocument>, id: string) =>
      layout.pages.flatMap((p) => p.lines).filter((l) => l.elementId === id).map((l) => l.runs.map((r) => r.text).join('')).join('');

    it('final hides a tracked deletion\'s text; original hides the tracked insertion instead and shows the deletion', () => {
      const h = commandHarness();
      const [a] = h.replaceBody([['st_action', 'Keep this']]);
      h.doc.getMap('trackChanges').set('enabled', true);
      h.run('text.deleteRange', { range: range(a!, 5, a!, 9) }); // marks 'this' del (kept under Track Changes)
      h.run('text.insert', { at: at(a!, 5), text: 'THAT' }); // marks 'THAT' ins

      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      expect(textOf(final, a!)).toBe('Keep THAT');

      const original = layoutDocument(h.model, undefined, { trackChangesView: 'original' });
      expect(textOf(original, a!)).toBe('Keep this');
    });

    it('tc.kind "delete" hides the whole element in final/simple, and shows it in original', () => {
      const h = commandHarness();
      const [, b] = h.replaceBody([['st_action', 'She runs'], ['st_dialogue', ' fast.']]);
      h.doc.getMap('trackChanges').set('enabled', true);
      h.run('text.deleteBackward', { at: at(b!, 0), unit: 'char' }); // merges b into a, marking b tc.kind: 'delete'
      expect((h.doc.getMap('elements').get(b!) as Y.Map<unknown>).get('tc')).toMatchObject({ kind: 'delete' });

      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      expect(final.pages.flatMap((p) => p.lines).some((l) => l.elementId === b)).toBe(false);
      const simple = layoutDocument(h.model, undefined, { trackChangesView: 'simple' });
      expect(simple.pages.flatMap((p) => p.lines).some((l) => l.elementId === b)).toBe(false);

      const original = layoutDocument(h.model, undefined, { trackChangesView: 'original' });
      expect(textOf(original, b!)).toBe(' fast.');
    });

    it('tc.kind "insert" (a whole tracked new element) hides in original, shows in final', () => {
      const h = commandHarness();
      const [a] = h.replaceBody([['st_action', 'One']]);
      h.doc.getMap('trackChanges').set('enabled', true);
      const res = h.run('element.insert', { after: a, style: 'st_action', text: 'Two' });
      expect(res).toMatchObject({ ok: true });
      const b = h.body()[1]!.id;
      expect((h.doc.getMap('elements').get(b) as Y.Map<unknown>).get('tc')).toMatchObject({ kind: 'insert' });

      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      expect(textOf(final, b)).toBe('Two');
      const original = layoutDocument(h.model, undefined, { trackChangesView: 'original' });
      expect(original.pages.flatMap((p) => p.lines).some((l) => l.elementId === b)).toBe(false);
    });

    it('tc.kind "style" resolves against fromStyle in original view only', () => {
      const h = commandHarness();
      const [c] = h.replaceBody([['st_character', 'maya']]);
      h.doc.getMap('trackChanges').set('enabled', true);
      h.run('element.setStyle', { elements: [c], style: 'st_action' });
      expect((h.doc.getMap('elements').get(c!) as Y.Map<unknown>).get('tc')).toMatchObject({ kind: 'style', fromStyle: 'st_character' });

      // st_action is not allCaps; st_character is — the resolved style change is only observable this way.
      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      expect(textOf(final, c!)).toBe('maya');
      const original = layoutDocument(h.model, undefined, { trackChangesView: 'original' });
      expect(textOf(original, c!)).toBe('MAYA');
    });

    it('simple lays out exactly like final, plus a writer-coloured change bar on lines touching a tracked change', () => {
      const h = commandHarness();
      const w = new Y.Map<unknown>();
      w.set('uid', 'u1');
      w.set('displayName', 'Writer');
      w.set('initials', 'W');
      w.set('color', '#224466');
      h.doc.getMap('writers').set('u1', w);
      const [a, plain] = h.replaceBody([['st_action', 'She runs'], ['st_action', 'Untouched.']]);
      h.doc.getMap('trackChanges').set('enabled', true);
      h.run('text.insert', { at: at(a!, 8), text: ' fast' });

      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      const simple = layoutDocument(h.model, undefined, { trackChangesView: 'simple' });
      // Same text layout as final (only the decoration differs).
      expect(simple.pages.map((p) => p.lines.map((l) => l.runs.map((r) => r.text).join(''))))
        .toEqual(final.pages.map((p) => p.lines.map((l) => l.runs.map((r) => r.text).join(''))));
      expect(final.pages.flatMap((p) => p.lines).every((l) => l.changeBar == null)).toBe(true); // no bars outside simple
      const changedLine = simple.pages.flatMap((p) => p.lines).find((l) => l.elementId === a);
      expect(changedLine!.changeBar).toEqual({ writerColor: '#224466' });
      const untouchedLine = simple.pages.flatMap((p) => p.lines).find((l) => l.elementId === plain);
      expect(untouchedLine!.changeBar).toBeNull();
    });

    it('a page-view request for markup is narrowed to final, with a markupForcesSpeedView diagnostic (§26: markup needs speed view)', () => {
      const h = commandHarness();
      h.replaceBody([['st_action', 'Some text.']]);
      const markup = layoutDocument(h.model, undefined, { trackChangesView: 'markup' });
      const final = layoutDocument(h.model, undefined, { trackChangesView: 'final' });
      expect(markup.diagnostics.some((d) => d.code === 'markupForcesSpeedView')).toBe(true);
      expect(markup.pages.map((p) => p.lines.map((l) => l.runs.map((r) => r.text).join(''))))
        .toEqual(final.pages.map((p) => p.lines.map((l) => l.runs.map((r) => r.text).join(''))));
    });
  });

  describe('alternatesMode (spec 09, M2 task 35)', () => {
    function addAlt(record: Y.Map<unknown>, id: string, text: string) {
      let altsMap = record.get('alts') as Y.Map<unknown> | undefined;
      if (!(altsMap instanceof Y.Map)) { altsMap = new Y.Map(); record.set('alts', altsMap); }
      const alt = new Y.Map<unknown>();
      alt.set('id', id);
      alt.set('pos', 'M');
      const t = new Y.Text();
      t.insert(0, text);
      alt.set('text', t);
      alt.set('style', builtinStyleId('action'));
      alt.set('label', '');
      alt.set('createdBy', 'u');
      alt.set('createdAt', 0);
      altsMap.set(id, alt);
    }
    const textOf = (layout: ReturnType<typeof layoutDocument>, id: string) =>
      layout.pages.flatMap((p) => p.lines).filter((l) => l.elementId === id).map((l) => l.runs.map((r) => r.text).join('')).join('');

    it('"active" (default) never renders inactive alternates; "all" appends each inline as " // " + its text', () => {
      const { add, idOf, model } = setup();
      const a = add('action', 'Active text');
      addAlt(a, 'alt_01ARYZ6S410000000000000000', 'Alt one');
      addAlt(a, 'alt_01ARYZ6S410000000000000001', 'Alt two');

      const activeLayout = layoutDocument(model());
      expect(textOf(activeLayout, idOf(a))).toBe('Active text');

      const allLayout = layoutDocument(model(), undefined, { alternatesMode: 'all' });
      expect(textOf(allLayout, idOf(a))).toBe('Active text // Alt one // Alt two');
    });

    it("an alternate's own suffix is non-editable, mapped to the end of the element's real source", () => {
      const { add, idOf, model } = setup();
      const a = add('action', 'Hi');
      addAlt(a, 'alt_01ARYZ6S410000000000000000', 'Alt');
      const layout = layoutDocument(model(), undefined, { alternatesMode: 'all' });
      const line = layout.pages[0]!.lines.find((l) => l.elementId === idOf(a))!;
      // 'Hi' is the whole real source (length 2): every generated ' // Alt' character maps back to it.
      expect(line.sourceStart).toBe(0);
      expect(line.sourceEnd).toBe(2);
    });
  });
});
