import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSeededIdSource } from '../ids/id-source.js';
import { builtinStyleId, newId, type StyleId } from '../ids/ids.js';
import { createDocument } from '../model/create.js';
import { insertElementRecord } from '../model/element-record.js';
import { setJSONMap } from '../model/ymap.js';
import { openDocument } from '../read-model/open.js';
import type { LabelSegment, NumberLabel, StyleDef } from '../schema/template.js';
import type { NumberMode } from '../schema/vocab.js';
import { authoredTemplate, flowTo, rootStyle, styleDef } from '../templates/builtin/authoring.js';
import { letterPage, sceneHeadingNumbering, standardHeader } from '../templates/shared.js';
import { inchesToEmu as inch } from '../units.js';
import { assignNumbers, LockedLabelOutOfOrderError, NumberGapExhaustedError, type AssignedNumber } from './assign.js';

// ─── Fixture template ───────────────────────────────────────────────────────────────────────────
//
// One bespoke template built fresh per test (`setup()`), covering every counter/lock shape the
// brief asks for: a plain numbered scene-heading style, a numbered dialogue style with a
// `counter: 'base'` child ('ta_lyrics'), a deliberately misconfigured numbered parenthetical
// (proves the role guard), a numbered outline style (proves the §9.2 hidden exclusion), a numbered
// shot style used only for `resetEvery`, and a page/panel pair (proves `resetAfterStyle` and the
// `counts` map, mirroring the real graphic-novel template). Fresh per test because `resolveStyle`
// memoizes per template-object identity (never invalidated) — a shared template mutated between
// tests (the AB2 refusal test needs a different `suffixMode`) would leak stale cached style
// resolutions into later tests.

const label = (base: number, prefix: LabelSegment[] = [], suffix: LabelSegment[] = [], custom?: string): NumberLabel =>
  custom === undefined ? { base, prefix, suffix } : { base, prefix, suffix, custom };
const letterSeg = (...value: number[]): LabelSegment => ({ kind: 'letters', value });
const digitsSeg = (value: number): LabelSegment => ({ kind: 'digits', value });
const assigned = (l: NumberLabel, provisional: boolean, gapExhausted = false): AssignedNumber => ({ label: l, provisional, gapExhausted });

const ST = (slug: string): StyleId => builtinStyleId(`ta_${slug}`);

function buildStyles(sceneSuffixMode: NumberMode = '1AB'): StyleDef[] {
  const scene = styleDef('ta_scene', 'Scene', 'sceneHeading', 'normal', {
    flow: flowTo('ta_action', 'ta_action', 'ta_action'),
    numbering: { ...sceneHeadingNumbering('both'), enabled: true, start: 1, suffixMode: sceneSuffixMode },
  });
  const action = styleDef('ta_action', 'Action', 'action', 'normal', { flow: flowTo(null, 'ta_character', 'ta_character') });
  const character = styleDef('ta_character', 'Character', 'character', 'normal', { flow: flowTo('ta_dialogue', 'ta_dialogue', 'ta_parenthetical') });
  const dialogue = styleDef('ta_dialogue', 'Dialogue', 'dialogue', 'normal', {
    flow: flowTo('ta_action', 'ta_parenthetical', 'ta_parenthetical'),
    numbering: { ...sceneHeadingNumbering('both'), enabled: true, counter: 'own', start: 1 },
  });
  const lyrics = styleDef('ta_lyrics', 'Lyrics', 'lyrics', 'ta_dialogue', {
    numbering: { ...sceneHeadingNumbering('both'), enabled: true, counter: 'base', start: 1 },
  });
  const parenthetical = styleDef('ta_parenthetical', 'Parenthetical', 'parenthetical', 'normal', {
    flow: flowTo('ta_dialogue', 'ta_dialogue', 'ta_dialogue'),
    // Deliberately misconfigured: §21.2 says parentheticals are never numbered "even if
    // configured" — this proves the guard is a role check, not merely `enabled: false` by default.
    numbering: { ...sceneHeadingNumbering('left'), enabled: true, counter: 'own', start: 1 },
  });
  const outline = styleDef('ta_outline', 'Outline', 'outline', 'normal', {
    hiddenInScript: true,
    numbering: { ...sceneHeadingNumbering('left'), enabled: true, counter: 'own', start: 1 },
  });
  const shot = styleDef('ta_shot', 'Shot', 'shot', 'normal', {
    numbering: { ...sceneHeadingNumbering('left'), enabled: true, counter: 'own', start: 1, resetEvery: 2 },
  });
  const page = styleDef('ta_page', 'Page', 'page', 'normal', {
    numbering: { ...sceneHeadingNumbering('both'), enabled: true, counter: 'own', start: 1 },
  });
  const panel = styleDef('ta_panel', 'Panel', 'panel', 'normal', {
    numbering: { ...sceneHeadingNumbering('both'), enabled: true, counter: 'own', start: 1, resetAfterStyle: page.id },
  });
  return [rootStyle(), scene, action, character, dialogue, lyrics, parenthetical, outline, shot, page, panel];
}

const meta = { createdBy: 'u', createdAt: 0, editedBy: 'u', editedAt: 0 };
const POS = 'BDFHJLNPRTVXZbdfhjlnprtvxz'.split('');

function setup(opts: { sceneSuffixMode?: NumberMode } = {}) {
  const template = authoredTemplate({
    key: 'assign-fixture',
    name: 'Assign Fixture',
    category: 'screenplay',
    page: letterPage({ top: inch(1), bottom: inch(1), left: inch(1.5), right: inch(1) }),
    header: standardHeader(),
    styles: buildStyles(opts.sceneSuffixMode),
    defaults: { firstElement: ST('scene') },
  });
  const ids = createSeededIdSource(7);
  const doc = createDocument({ template, uid: 'u', ids });
  const elements = doc.getMap('elements');
  for (const k of [...elements.keys()]) elements.delete(k);
  let i = 0;
  const add = (styleSlug: string, text = '') =>
    insertElementRecord(elements, { id: newId('el', ids), pos: POS[i++]!, style: ST(styleSlug), text: { plain: text, runs: text ? [{ text, attrs: {} }] : [], embeds: [] } }, meta);
  const model = () => openDocument(doc, { ids, clock: () => 0, locale: 'en' });
  const lockStyle = (slug: string) => (doc.getMap('production').get('lockedStyles') as Y.Map<unknown>).set(ST(slug), true);
  const setNum = (el: Y.Map<unknown>, num: { label: NumberLabel; locked: boolean; manual: boolean }) => setJSONMap(el, 'num', num);
  const setOutlineHidden = (v: boolean) => doc.getMap('settings').set('outlineHidden', v);
  const omitScene = (heading: Y.Map<unknown>) => {
    const scene = new Y.Map<unknown>();
    heading.set('scene', scene);
    scene.set('omit', { at: 1, by: 'u', rev: null });
  };
  return { doc, add, model, lockStyle, setNum, setOutlineHidden, omitScene };
}

// ─── §21.2 unlocked sequential numbering ───────────────────────────────────────────────────────

describe('assignNumbers — unlocked sequential numbering (§21.2)', () => {
  it('numbers visible elements sequentially from `start` in document order', () => {
    const { add, model } = setup();
    const s1 = add('scene', 'INT. A');
    const s2 = add('scene', 'INT. B');
    const s3 = add('scene', 'INT. C');
    const { labels } = assignNumbers(model());
    expect(labels.get(s1.get('id') as never)).toEqual(assigned(label(1), false));
    expect(labels.get(s2.get('id') as never)).toEqual(assigned(label(2), false));
    expect(labels.get(s3.get('id') as never)).toEqual(assigned(label(3), false));
  });

  it('parentheticals are never numbered even when the style is configured with numbering enabled', () => {
    const { add, model } = setup();
    add('character', 'MAYA');
    const paren = add('parenthetical', '(beat)');
    add('dialogue', 'Hello.');
    const { labels } = assignNumbers(model());
    expect(labels.has(paren.get('id') as never)).toBe(false);
  });

  it("`counter: base` interleaves a child style into its owner's single sequence", () => {
    const { add, model } = setup();
    const d1 = add('dialogue', 'One.');
    const l1 = add('lyrics', 'La la.');
    const d2 = add('dialogue', 'Two.');
    const { labels } = assignNumbers(model());
    expect(labels.get(d1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(l1.get('id') as never)?.label.base).toBe(2);
    expect(labels.get(d2.get('id') as never)?.label.base).toBe(3);
  });

  it('resetAfterStyle restarts the counter (panels reset per page)', () => {
    const { add, model } = setup();
    add('page');
    const panel1 = add('panel');
    const panel2 = add('panel');
    add('page');
    const panel3 = add('panel');
    const { labels } = assignNumbers(model());
    expect(labels.get(panel1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(panel2.get('id') as never)?.label.base).toBe(2);
    expect(labels.get(panel3.get('id') as never)?.label.base).toBe(1);
  });

  it('resetEvery restarts the counter every N numbered elements', () => {
    const { add, model } = setup();
    const s1 = add('shot');
    const s2 = add('shot');
    const s3 = add('shot');
    const s4 = add('shot');
    const { labels } = assignNumbers(model());
    expect(labels.get(s1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(s2.get('id') as never)?.label.base).toBe(2);
    expect(labels.get(s3.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(s4.get('id') as never)?.label.base).toBe(2);
  });
});

// ─── §21.2 manual unlocked labels ──────────────────────────────────────────────────────────────

describe('assignNumbers — manual unlocked labels (§21.2)', () => {
  it('a non-custom manual label displays as stored, and the next element continues from base + 1', () => {
    const { add, setNum, model } = setup();
    const d1 = add('dialogue');
    const d2 = add('dialogue');
    setNum(d2, { label: label(50), locked: false, manual: true });
    const d3 = add('dialogue');
    const { labels } = assignNumbers(model());
    expect(labels.get(d1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(d2.get('id') as never)).toEqual(assigned(label(50), false));
    expect(labels.get(d3.get('id') as never)?.label.base).toBe(51);
  });

  it('a non-blank custom manual label displays verbatim, consuming one auto slot', () => {
    const { add, setNum, model } = setup();
    const d1 = add('dialogue'); // -> 1, next auto becomes 2
    const d2 = add('dialogue');
    setNum(d2, { label: label(999, [], [], 'FIVE'), locked: false, manual: true });
    const d3 = add('dialogue');
    const { labels } = assignNumbers(model());
    expect(labels.get(d1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(d2.get('id') as never)).toEqual(assigned(label(999, [], [], 'FIVE'), false));
    // "previous sequential value + 1": the auto sequence was at 2 when d2 was processed, so d3
    // continues from 3 — d2's own base (999) is display-only and never feeds the sequence.
    expect(labels.get(d3.get('id') as never)?.label.base).toBe(3);
  });

  it('custom: "" means unnumbered and consumes no number', () => {
    const { add, setNum, model } = setup();
    const d1 = add('dialogue'); // -> 1, next auto becomes 2
    const blank = add('dialogue');
    setNum(blank, { label: label(0, [], [], ''), locked: false, manual: true });
    const d3 = add('dialogue');
    const { labels } = assignNumbers(model());
    expect(labels.get(d1.get('id') as never)?.label.base).toBe(1);
    expect(labels.has(blank.get('id') as never)).toBe(false);
    // The next auto element gets exactly what it would have gotten had `blank` never existed.
    expect(labels.get(d3.get('id') as never)?.label.base).toBe(2);
  });
});

// ─── §9.2 / §23.3 exclusion ─────────────────────────────────────────────────────────────────────

describe('assignNumbers — hidden and omitted-body exclusion', () => {
  it('excludes a hidden outline element only when hiddenInScript AND settings.outlineHidden both hold', () => {
    const shown = setup();
    const outlineShown = shown.add('outline');
    const shownResult = assignNumbers(shown.model());
    expect(shownResult.labels.has(outlineShown.get('id') as never)).toBe(true); // outlineHidden defaults false

    const hidden = setup();
    hidden.setOutlineHidden(true);
    const outlineHidden = hidden.add('outline');
    const hiddenResult = assignNumbers(hidden.model());
    expect(hiddenResult.labels.has(outlineHidden.get('id') as never)).toBe(false);
  });

  it("an omitted scene's OMITTED placeholder still consumes a number; its body does not (regression: a wrongly-excluded placeholder would shift every later scene number down by one)", () => {
    const { add, model, omitScene } = setup();
    const s1 = add('scene', 'INT. A');
    const s2 = add('scene', 'INT. B'); // will be omitted
    add('character', 'MAYA');
    const bodyDialogue = add('dialogue', 'This should never surface.');
    const s3 = add('scene', 'INT. C');
    omitScene(s2);
    const { labels } = assignNumbers(model());
    expect(labels.get(s1.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(s2.get('id') as never)?.label.base).toBe(2); // the placeholder itself
    expect(labels.get(s3.get('id') as never)?.label.base).toBe(3); // unaffected — no shift
    expect(labels.has(bodyDialogue.get('id') as never)).toBe(false); // omitted body excluded
  });

  it("a `page` heading is a scene boundary (spec 01 §3.4.1), so an omitted scene can't run straight through a page heading and swallow the panels after it", () => {
    // Fix round 1, critical: SCENE_BOUNDARY_ROLES/SCENE_ROLES previously had no `page` role, so
    // `computeScenes` let a scene run straight through a page heading — in a template mixing
    // `sceneHeading` and `page` (the shipped graphic-novel builtin genuinely does), an omitted
    // scene's span continued past the next `page` heading all the way to the next real scene
    // boundary (or end of document). `panel2` here would have been silently swallowed into the
    // omitted scene's excluded body — no number, no count, no diagnostic — even though it visibly
    // sits under its own `page` heading, outside the omitted scene entirely.
    const { add, model, omitScene } = setup();
    const scene = add('scene', 'INT. LATER');
    add('character', 'MAYA');
    add('dialogue', 'This should never surface.');
    const page = add('page');
    const panel2 = add('panel');
    omitScene(scene);
    const { labels, counts } = assignNumbers(model());
    expect(labels.has(scene.get('id') as never)).toBe(true); // the OMITTED placeholder itself
    // `page` now closes the omitted scene's span — it and everything after it are a fresh,
    // un-omitted scene of their own, so both are numbered and counted normally.
    expect(labels.get(page.get('id') as never)?.label.base).toBe(1);
    expect(labels.get(panel2.get('id') as never)?.label.base).toBe(1);
    expect(counts.get(page.get('id') as never)?.get(ST('panel'))).toBe(1);
  });
});

// ─── §22.3 / §23.2 locked numbering ─────────────────────────────────────────────────────────────

describe('assignNumbers — locked numbering (§22.3/§23.2)', () => {
  it('a gap between two locked labels gets a provisional label generated by §22.3', () => {
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false });
    const gap = add('scene');
    const s3 = add('scene');
    setNum(s3, { label: label(11), locked: true, manual: false });
    const { labels } = assignNumbers(model());
    expect(labels.get(s1.get('id') as never)).toEqual(assigned(label(10), false));
    expect(labels.get(s3.get('id') as never)).toEqual(assigned(label(11), false));
    expect(labels.get(gap.get('id') as never)).toEqual(assigned(label(10, [], [letterSeg(1)]), true));
  });

  it('a trailing gap after the last locked label continues plain integers (R === null)', () => {
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false });
    const tail = add('scene');
    const { labels } = assignNumbers(model());
    expect(labels.get(tail.get('id') as never)).toEqual(assigned(label(11), true));
  });

  it('refuses with a typed error (not a bare crash) when AB2 has no structural room for a gap', () => {
    // Spec 02 §22.3's own stated failure case: no label can be generated between a locked `P`
    // (here: none) and an already-minimally-prefixed `R` under AB2/BA2's single flattened prefix
    // run — `generateBetween` throws a bare `RangeError`; `assignNumbers` must not let that escape
    // unannotated, and must not fabricate a label or a silently-shorter result instead.
    const { add, setNum, lockStyle, model } = setup({ sceneSuffixMode: 'AB2' });
    lockStyle('scene');
    const gap = add('scene');
    const r = add('scene');
    setNum(r, { label: label(2, [letterSeg(1)]), locked: true, manual: false }); // "A2"
    let caught: unknown;
    try {
      assignNumbers(model());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NumberGapExhaustedError);
    const err = caught as NumberGapExhaustedError;
    expect(err.mode).toBe('AB2');
    expect(err.previous).toBeNull();
    expect(err.next).toEqual(label(2, [letterSeg(1)]));
    expect(err.elementIds).toEqual([gap.get('id')]);
  });

  it('distinguishes an ordinary provisional gap-fill (steps 2/3) from a §22.3 step-4 gap-exhausted fallback', () => {
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false }); // "10"
    const gap = add('scene');
    const s3 = add('scene');
    setNum(s3, { label: label(10, [], [letterSeg(1)]), locked: true, manual: false }); // "10A"
    const { labels } = assignNumbers(model());
    // Spec 02 §22.4's own worked vector: 1AB | 10 | 10A | 1 → A10A, "gap exhausted" — steps 2/3
    // both fail (every candidate between plain 10 and 10A is either equal to 10A or, once
    // prefixed, sorts before plain P=10 forever), so this is genuinely step 4's last-resort
    // fallback, not an ordinarily-ordered provisional label.
    expect(labels.get(gap.get('id') as never)).toEqual(assigned(label(10, [letterSeg(1)], [letterSeg(1)]), true, true));
  });

  it('rejects a locked stored label that sorts strictly before its predecessor, instead of silently trusting a non-representative anchor (original corruption case)', () => {
    // Fix round 1, important: a locked, stored label's structural base/prefix/suffix still
    // anchors later gap-fills even when its display is blanked (`custom: ''`) — see the doc
    // comment on `LockedLabelOutOfOrderError`. If that anchor's structural position was never
    // kept in sync with reality (corrupted data, or a client bug), trusting it silently can
    // generate a provisional label that sorts *before* an earlier, correctly-ordered locked one.
    // This must be rejected outright rather than produce that corrupted result. (Fix round 2 kept
    // this case rejected while narrowing the comparison from `<= 0` to `< 0` — see the next two
    // tests for the boundary that narrowing was for.)
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false });
    const bad = add('scene'); // stored, locked, but structurally *before* s1 — not representative
    setNum(bad, { label: label(1, [], [], ''), locked: true, manual: true });
    let caught: unknown;
    try {
      assignNumbers(model());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LockedLabelOutOfOrderError);
    const err = caught as LockedLabelOutOfOrderError;
    expect(err.styleId).toBe(ST('scene'));
    expect(err.mode).toBe('1AB');
    expect(err.elementId).toBe(bad.get('id'));
    expect(err.previous).toEqual(label(10));
    expect(err.stored).toEqual(label(1, [], [], ''));
  });

  it('still rejects a strictly out-of-order locked stored label (simple, non-custom case)', () => {
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false });
    const s2 = add('scene');
    setNum(s2, { label: label(9), locked: true, manual: false }); // strictly before s1
    let caught: unknown;
    try {
      assignNumbers(model());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LockedLabelOutOfOrderError);
  });

  it('accepts a duplicate locked label (spec 02 §23.1: "Duplicate labels allowed with diagnostic duplicateNumber") and reports it, instead of throwing', () => {
    // Fix round 2, critical: the round-1 guard used `<= 0`, rejecting an *equal* stored label too
    // — but spec 02 §23.1 explicitly permits this (e.g. an intentional Edit Number that matches an
    // existing locked number). For that legal input, throwing for the whole document was worse
    // than the corruption round 1 was fixing. Narrowed to `< 0`; an equal label is now accepted
    // and reported via `diagnostics`, not rejected.
    const { add, setNum, lockStyle, model } = setup();
    lockStyle('scene');
    const s1 = add('scene');
    setNum(s1, { label: label(10), locked: true, manual: false });
    const s2 = add('scene'); // deliberately the same locked label, via a manual Edit Number
    setNum(s2, { label: label(10), locked: true, manual: true });
    const { labels, diagnostics } = assignNumbers(model());
    expect(labels.get(s1.get('id') as never)).toEqual(assigned(label(10), false));
    expect(labels.get(s2.get('id') as never)).toEqual(assigned(label(10), false));
    expect(diagnostics).toContainEqual({ code: 'duplicateNumber', elementId: s2.get('id'), pageIndex: null, detail: { styleId: ST('scene') } });
    expect(diagnostics).toHaveLength(1);
  });

  it('does not relabel a data-corruption guard from modes.ts (a malformed stored prefix segment) as a gap-exhausted refusal', () => {
    const { add, setNum, lockStyle, model } = setup({ sceneSuffixMode: 'AB2' });
    lockStyle('scene');
    add('scene'); // an unstored gap — needed so `flush` has something to generate for
    const r = add('scene');
    // AB2/BA2 prefix segments must be `letters` — a `digits` segment here is malformed stored
    // data, a different failure from "no structural room for a gap".
    setNum(r, { label: label(2, [digitsSeg(5)]), locked: true, manual: false });
    let caught: unknown;
    try {
      assignNumbers(model());
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(NumberGapExhaustedError);
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as Error).message).toMatch(/letters segment/);
  });
});

// ─── §20.2/§21.3 counts ─────────────────────────────────────────────────────────────────────────

describe('assignNumbers — counts map (§20.2 {count:<StyleId>}, §21.3)', () => {
  it('counts panel elements between one page heading and the next', () => {
    const { add, model } = setup();
    const page1 = add('page');
    add('panel');
    add('panel');
    const page2 = add('page');
    add('panel');
    const { counts } = assignNumbers(model());
    expect(counts.get(page1.get('id') as never)?.get(ST('panel'))).toBe(2);
    expect(counts.get(page2.get('id') as never)?.get(ST('panel'))).toBe(1);
  });

  it('a style with zero occurrences between two numbered elements is simply absent from the tally (a caller reads a missing entry as zero, e.g. tokens.ts\'s `?? 0`)', () => {
    const { add, model } = setup();
    const page1 = add('page'); // no panels before page2
    add('page');
    const { counts } = assignNumbers(model());
    expect(counts.get(page1.get('id') as never)?.has(ST('panel'))).toBe(false);
    expect(counts.get(page1.get('id') as never)?.get(ST('panel')) ?? 0).toBe(0);
  });
});
