import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { builtinStyleId, newId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { assignNumbers } from '../numbering/assign.js';
import { openDocument } from '../read-model/open.js';
import { screenplayStandard } from '../templates/builtin/screenplay-standard.js';
import { contextPass } from './context.js';

const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };
const POS = 'BDFHJLNPRTVXZbdfhjlnprtvxz'.split('');

function setup() {
  const ids = createSeededIdSource(7);
  const doc = createDocument({ template: screenplayStandard, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  let i = 0;
  const add = (slug: string, text = '') =>
    insertElementRecord(elements, { id: newId('el', ids), pos: POS[i++]!, style: builtinStyleId(slug), text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  const idOf = (m: Y.Map<unknown>) => m.get('id') as never;
  const run = (deps?: Parameters<typeof contextPass>[3]) => {
    const model = openDocument(doc, { ids, clock: () => 0, locale: 'en' });
    return { model, ...contextPass(model, model.template(), assignNumbers(model), deps) };
  };
  return { doc, add, idOf, run };
}

describe('contextPass', () => {
  it('assigns scenes; elements before the first boundary get sceneId null', () => {
    const { add, idOf, run } = setup();
    const a = add('action', 'cold open');
    const s1 = add('scene_heading', 'INT. A - DAY');
    const b = add('action', 'x');
    const s2 = add('scene_heading', 'INT. B - DAY');
    const { contexts } = run();
    expect(contexts.get(idOf(a))!.sceneId).toBeNull();
    expect(contexts.get(idOf(s1))!.sceneId).toBe(idOf(s1));
    expect(contexts.get(idOf(b))!.sceneId).toBe(idOf(s1));
    expect(contexts.get(idOf(s2))!.sceneOrdinal).toBe(1);
  });

  it('propagates omission to the scene body', () => {
    const { add, idOf, run } = setup();
    const s1 = add('scene_heading', 'INT. A - DAY');
    const b = add('action', 'x');
    const scene = new Y.Map<unknown>();
    s1.set('scene', scene);
    scene.set('omit', { at: 1, by: 'u', rev: null });
    const { contexts } = run();
    expect(contexts.get(idOf(s1))!.omitted).toBe(true);
    expect(contexts.get(idOf(s1))!.hidden).toBe(false);
    expect(contexts.get(idOf(b))!.omitted).toBe(true);
    expect(contexts.get(idOf(b))!.hidden).toBe(true);
  });

  it('auto-continues a repeated speaker only across an intervening non-dialogue element', () => {
    const { add, idOf, run } = setup();
    add('scene_heading', 'INT. A - DAY');
    const c1 = add('character', 'MILLER');
    add('dialogue', 'Hi.');
    const c2 = add('character', 'Miller (V.O.)');
    add('dialogue', 'Still me.');
    add('action', 'A beat.');
    const c3 = add('character', 'MILLER');
    add('dialogue', 'Again.');
    const c4 = add('character', "MILLER (CONT’D)");
    const { contexts } = run();
    expect(contexts.get(idOf(c1))!.autoContinued).toBe(false);
    expect(contexts.get(idOf(c2))!.autoContinued).toBe(false); // no interruption
    expect(contexts.get(idOf(c2))!.speaker).toBe('miller');
    expect(contexts.get(idOf(c3))!.autoContinued).toBe(true);
    expect(contexts.get(idOf(c4))!.autoContinued).toBe(false); // already has CONT'D (curly apostrophe)
  });

  it('a new scene resets the last speaker', () => {
    const { add, idOf, run } = setup();
    add('scene_heading', 'INT. A - DAY');
    add('character', 'MILLER');
    add('action', 'x');
    add('scene_heading', 'INT. B - DAY');
    add('action', 'y');
    const c = add('character', 'MILLER');
    expect(run().contexts.get(idOf(c))!.autoContinued).toBe(false);
  });

  it('decorationHash changes when autoContinued flips, not on unrelated text', () => {
    const a = setup();
    a.add('scene_heading', 'INT. A - DAY');
    a.add('character', 'MILLER');
    a.add('action', 'one');
    const c = a.add('character', 'MILLER');
    const before = a.run().contexts.get(a.idOf(c))!;
    const b = setup();
    b.add('scene_heading', 'INT. A - DAY');
    b.add('character', 'MILLER');
    b.add('action', 'a different action line');
    const c2 = b.add('character', 'MILLER');
    const same = b.run().contexts.get(b.idOf(c2))!;
    expect(same.decorationHash).toBe(before.decorationHash);
    const d = setup();
    d.add('scene_heading', 'INT. A - DAY');
    d.add('character', 'MILLER');
    d.add('dialogue', 'no interruption');
    const c3 = d.add('character', 'MILLER');
    const flipped = d.run().contexts.get(d.idOf(c3))!;
    expect(flipped.autoContinued).toBe(false);
    expect(before.autoContinued).toBe(true);
    expect(flipped.decorationHash).not.toBe(before.decorationHash);
  });

  it('memoizes speaker normalization per (element, textVersion)', () => {
    const { add, run } = setup();
    add('scene_heading', 'INT. A - DAY');
    add('character', 'MILLER');
    add('character', 'JONES');
    let calls = 0;
    const normalizeSpeaker = (t: string) => { calls++; return t.toLowerCase(); };
    const first = run({ normalizeSpeaker });
    expect(calls).toBe(2);
    // A second pass over the same model instance reuses the memo.
    contextPass(first.model, first.model.template(), assignNumbers(first.model), { normalizeSpeaker });
    expect(calls).toBe(2);
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

    it('"active" (default) never folds inactive alternates into decorationHash', () => {
      const { add, idOf, run } = setup();
      const a = add('action', 'Same active text.');
      const before = run().contexts.get(idOf(a))!.decorationHash;
      addAlt(a, 'alt_01ARYZ6S410000000000000000', 'A very different alternate.');
      const after = run().contexts.get(idOf(a))!.decorationHash;
      expect(after).toBe(before);
    });

    it('"all" folds inactive alternates\' text into decorationHash, so editing one changes it', () => {
      const { add, idOf, run } = setup();
      const a = add('action', 'Same active text.');
      const noAlts = run({ alternatesMode: 'all' }).contexts.get(idOf(a))!.decorationHash;
      addAlt(a, 'alt_01ARYZ6S410000000000000000', 'Alternate one.');
      const withAlt = run({ alternatesMode: 'all' }).contexts.get(idOf(a))!.decorationHash;
      expect(withAlt).not.toBe(noAlts);
      // "active" mode is unaffected by the very same alt being present.
      expect(run({ alternatesMode: 'active' }).contexts.get(idOf(a))!.decorationHash).toBe(noAlts);
    });
  });
});
