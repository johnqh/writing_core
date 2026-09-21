// Batch equivalence: a command sequence applied as ONE executeBatch must leave exactly the document
// that the same sequence applied one executeBatch per command leaves. Commands read `ctx.model`,
// which is stale inside a batch, so any command that resolves order/indices from it can diverge.
import { describe, expect, it } from 'vitest';
import type { ElementId } from '../ids/ids.js';
import { documentToJSON } from '../model/json.js';
import { executeBatch } from './execute.js';
import { TEST_ACTOR, commandHarness } from './test-harness.js';

type Cmd = { id: string; params: unknown };
type H = ReturnType<typeof commandHarness>;

const at = (elementId: string, offset: number) => ({ elementId, offset });

const INITIAL: [string, string][] = [
  ['st_scene_heading', 'INT. KITCHEN - DAY'],
  ['st_action', 'Maya stirs a pot. Steam rises.'],
  ['st_character', 'MAYA'],
  ['st_dialogue', 'Is it ready yet?'],
  ['st_action', 'Sam shrugs.'],
  ['st_scene_heading', 'EXT. GARDEN - NIGHT'],
  ['st_action', 'Crickets. A door creaks.'],
  ['st_character', 'SAM'],
  ['st_parenthetical', '(whispering)'],
  ['st_dialogue', 'Did you hear that?'],
  ['st_transition', 'CUT TO:'],
  ['st_scene_heading', 'INT. HALLWAY - CONTINUOUS'],
  ['st_action', 'Empty. Quiet.'],
];

function fresh(): { h: H; ids: ElementId[] } {
  const h = commandHarness();
  const ids = h.replaceBody(INITIAL);
  return { h, ids };
}

function apply(h: H, commands: Cmd[], dryRun = false) {
  return executeBatch({
    doc: h.doc, model: h.model, ids: h.ids, actor: TEST_ACTOR,
    origin: h.origins.make('local-command', { commandId: 'batch' }),
    capabilities: new Set(['write'] as const), clock: () => h.now(), commands, dryRun,
  });
}

/** Apply `commands` as one batch on one document and one at a time on another; assert identical. */
function expectEquivalent(make: (ids: ElementId[]) => Cmd[]) {
  const a = fresh();
  const b = fresh();
  const commands = make(a.ids);
  const batch = apply(a.h, commands);
  expect(batch, 'batch must succeed ' + JSON.stringify(batch)).toMatchObject({ ok: true });
  for (const [i, c] of commands.entries()) {
    const r = apply(b.h, [c]);
    expect(r, `sequential command ${i} (${c.id}) must succeed`).toMatchObject({ ok: true });
  }
  expect(documentToJSON(a.h.doc)).toEqual(documentToJSON(b.h.doc));
  expect(a.h.body()).toEqual(b.h.body());
  // The batch model (refreshed at transaction end) agrees with the sequential model too.
  expect(a.h.model.scenes().map((s) => [s.id, s.elementIds.length])).toEqual(b.h.model.scenes().map((s) => [s.id, s.elementIds.length]));
}

describe('batch equivalence: hand-written sequences', () => {
  it('appends and inserts after the same anchor', () => expectEquivalent((e) => [
    { id: 'element.insert', params: { style: 'st_action', text: 'a' } },
    { id: 'element.insert', params: { after: e[1], style: 'st_action', text: 'b' } },
    { id: 'element.insert', params: { after: e[1], style: 'st_action', text: 'c' } },
    { id: 'element.insert', params: { before: e[0], style: 'st_scene_heading', text: 'INT. X - DAY' } },
  ]));
  it('insert then move the new element (needs the new id)', () => {
    // Ids are deterministic, so the id an insert will mint is the one sequential run mints.
    const probe = fresh();
    const r = apply(probe.h, [{ id: 'element.insert', params: { after: probe.ids[1], style: 'st_action', text: 'N' } }]);
    const newId = (r as { effects: { inserted: string[] } }).effects.inserted[0]!;
    expectEquivalent((e) => [
      { id: 'element.insert', params: { after: e[1], style: 'st_action', text: 'N' } },
      { id: 'element.move', params: { elements: [newId], to: { after: e[12] } } },
      { id: 'element.setStyle', params: { elements: [newId], style: 'st_transition' } },
    ]);
  });
  it('two moves in a row', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[1]], to: { after: e[4] } } },
    { id: 'element.move', params: { elements: [e[4]], to: { before: e[0] } } },
    { id: 'element.move', params: { elements: [e[12]], to: { after: null } } },
  ]));
  it('move of several elements then another move relative to them', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[2], e[3]], to: { after: e[12] } } },
    { id: 'element.move', params: { elements: [e[4]], to: { after: e[3] } } },
    { id: 'element.move', params: { elements: [e[6], e[7]], to: { before: e[2] } } },
  ]));
  it('scene.move twice', () => expectEquivalent((e) => [
    { id: 'scene.move', params: { scenes: [e[0]], to: { after: e[11] } } },
    { id: 'scene.move', params: { scenes: [e[5]], to: { before: e[11] } } },
  ]));
  it('scene.move three scenes around', () => expectEquivalent((e) => [
    { id: 'scene.move', params: { scenes: [e[11]], to: { before: e[0] } } },
    { id: 'scene.move', params: { scenes: [e[0]], to: { after: e[5] } } },
    { id: 'scene.move', params: { scenes: [e[5], e[0]], to: { after: null } } },
  ]));
  it('scene.move after a restyle changes scene membership', () => expectEquivalent((e) => [
    { id: 'element.setStyle', params: { elements: [e[6]], style: 'st_scene_heading' } },
    { id: 'scene.move', params: { scenes: [e[6]], to: { before: e[0] } } },
  ]));
  it('scene.move after a heading is inserted', () => expectEquivalent((e) => [
    { id: 'element.insert', params: { after: e[3], style: 'st_scene_heading', text: 'INT. NEW - DAY' } },
    { id: 'scene.move', params: { scenes: [e[5]], to: { before: e[0] } } },
  ]));
  it('restyle then cycle', () => expectEquivalent((e) => [
    { id: 'element.setStyle', params: { elements: [e[1], e[4]], style: 'st_character' } },
    { id: 'element.cycleStyle', params: { element: e[1], direction: 'tabForward', caretAtEnd: true } },
    { id: 'element.cycleStyle', params: { element: e[2], direction: 'tabForward', caretAtEnd: true } },
    { id: 'element.setStyle', params: { elements: [e[4]], style: 'st_dialogue' } },
  ]));
  it('split then split the tail', () => expectEquivalent((e) => [
    { id: 'element.split', params: { at: at(e[1]!, 10) } },
    { id: 'element.split', params: { at: at(e[1]!, 4) } },
    { id: 'element.split', params: { at: at(e[6]!, 8) } },
  ]));
  it('split at the end (Enter flow) then insert after', () => expectEquivalent((e) => [
    { id: 'element.split', params: { at: at(e[2]!, 4) } },
    { id: 'element.insert', params: { after: e[2], style: 'st_action', text: 'x' } },
    { id: 'element.split', params: { at: at(e[3]!, 16) } },
  ]));
  it('merge by backspace at offset 0 twice', () => expectEquivalent((e) => [
    { id: 'text.deleteBackward', params: { at: at(e[4]!, 0), unit: 'char' } },
    { id: 'text.deleteBackward', params: { at: at(e[6]!, 0), unit: 'char' } },
  ]));
  it('merge by forward delete at end', () => expectEquivalent((e) => [
    { id: 'text.deleteForward', params: { at: at(e[1]!, 30), unit: 'char' } },
    { id: 'text.deleteForward', params: { at: at(e[8]!, 12), unit: 'char' } },
  ]));
  it('chained merges: merge a into b then the result into c', () => expectEquivalent((e) => [
    { id: 'text.deleteBackward', params: { at: at(e[4]!, 0), unit: 'char' } },
    { id: 'text.deleteBackward', params: { at: at(e[1]!, 0), unit: 'char' } },
  ]));
  it('delete elements and then act on their neighbours', () => expectEquivalent((e) => [
    { id: 'text.deleteBackward', params: { at: at(e[10]!, 0), unit: 'element' } },
    { id: 'text.deleteBackward', params: { at: at(e[8]!, 0), unit: 'element' } },
    { id: 'text.deleteForward', params: { at: at(e[7]!, 3), unit: 'char' } },
    { id: 'element.insert', params: { after: e[7], style: 'st_action', text: 'after' } },
  ]));
  it('delete then backspace across the gap', () => expectEquivalent((e) => [
    { id: 'text.deleteBackward', params: { at: at(e[4]!, 0), unit: 'element' } },
    { id: 'text.deleteBackward', params: { at: at(e[5]!, 0), unit: 'char' } },
  ]));
  it('delete range across elements, then more', () => expectEquivalent((e) => [
    { id: 'text.deleteRange', params: { range: { anchor: at(e[1]!, 5), head: at(e[4]!, 3) } } },
    { id: 'text.deleteRange', params: { range: { anchor: at(e[6]!, 3), head: at(e[9]!, 4) } } },
  ]));
  it('replaceRange then deleteRange over a moved region', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[4]], to: { before: e[1] } } },
    { id: 'text.deleteRange', params: { range: { anchor: at(e[4]!, 2), head: at(e[2]!, 2) } } },
    { id: 'text.replaceRange', params: { range: { anchor: at(e[6]!, 0), head: at(e[7]!, 1) }, text: 'ZZ' } },
  ]));
  it('range delete over elements after a move (order changed mid batch)', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[3]], to: { after: e[12] } } },
    { id: 'text.deleteRange', params: { range: { anchor: at(e[1]!, 2), head: at(e[12]!, 3) } } },
  ]));
  it('transformCase across moved elements', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[12]], to: { before: e[1] } } },
    { id: 'text.transformCase', params: { range: { anchor: at(e[12]!, 0), head: at(e[4]!, 5) }, to: 'upper' } },
  ]));
  it('mark toggle across a moved range', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[4]], to: { before: e[1] } } },
    { id: 'mark.toggle', params: { range: { anchor: at(e[4]!, 0), head: at(e[2]!, 2) }, mark: 'b' } },
  ]));
  it('duplicate then move the copies', () => {
    const probe = fresh();
    const r = apply(probe.h, [{ id: 'element.duplicate', params: { elements: [probe.ids[1], probe.ids[4]] } }]);
    const [c1] = (r as { effects: { inserted: string[] } }).effects.inserted;
    expectEquivalent((e) => [
      { id: 'element.duplicate', params: { elements: [e[1], e[4]] } },
      { id: 'element.move', params: { elements: [c1!], to: { after: e[12] } } },
      { id: 'element.duplicate', params: { elements: [e[12]] } },
    ]);
  });
  it('duplicate after a move (indexOf sort)', () => expectEquivalent((e) => [
    { id: 'element.move', params: { elements: [e[4]], to: { before: e[1] } } },
    { id: 'element.duplicate', params: { elements: [e[1], e[4]] } },
  ]));
  it('overrides then move', () => expectEquivalent((e) => [
    { id: 'element.setOverride', params: { elements: [e[1]], key: 'align', value: 'center' } },
    { id: 'element.move', params: { elements: [e[1]], to: { after: e[3] } } },
    { id: 'element.revertOverrides', params: { elements: [e[1]] } },
  ]));
  it('text edits then structure', () => expectEquivalent((e) => [
    { id: 'text.insert', params: { at: at(e[1]!, 0), text: 'Well. ' } },
    { id: 'element.split', params: { at: at(e[1]!, 6) } },
    { id: 'text.insert', params: { at: at(e[3]!, 4), text: 'really ' } },
    { id: 'mark.toggle', params: { range: { anchor: at(e[3]!, 0), head: at(e[3]!, 4) }, mark: 'i' } },
  ]));
  it('synopsis then move scenes', () => expectEquivalent((e) => [
    { id: 'scene.setSynopsis', params: { scene: e[0], value: 'Maya cooks.' } },
    { id: 'scene.move', params: { scenes: [e[0]], to: { after: e[11] } } },
    { id: 'scene.setSynopsis', params: { scene: e[5], value: 'Night sounds.' } },
    { id: 'scene.setSynopsis', params: { scene: e[0], value: 'Maya cooks dinner.' } },
  ]));
  it('synopsis on a scene that a previous command created', () => {
    const probe = fresh();
    const r = apply(probe.h, [{ id: 'element.insert', params: { after: probe.ids[4], style: 'st_scene_heading', text: 'INT. NEW - DAY' } }]);
    const newScene = (r as { effects: { inserted: string[] } }).effects.inserted[0]!;
    expectEquivalent((e) => [
      { id: 'element.insert', params: { after: e[4], style: 'st_scene_heading', text: 'INT. NEW - DAY' } },
      { id: 'scene.setSynopsis', params: { scene: newScene, value: 'fresh' } },
      { id: 'scene.move', params: { scenes: [newScene], to: { before: e[0] } } },
    ]);
  });
  it('scene number lock, insert, omit and page lock in one batch', () => expectEquivalent((e) => [
    { id: 'template.setSceneNumbering', params: { mode: 'both' } },
    { id: 'scene.lockNumbers', params: {} },
    { id: 'element.insert', params: { after: e[4], style: 'st_scene_heading', text: 'INT. NEW - DAY' } },
    { id: 'scene.setOmitted', params: { scene: e[0], omitted: true } },
    { id: 'page.lock', params: {} },
    { id: 'scene.unlockNumbers', params: {} },
    { id: 'page.unlock', params: {} },
  ]));
  it('revision set, mode, edits, mark and clear in one batch', () => expectEquivalent((e) => [
    { id: 'revision.setCurrent', params: { date: 1_800_000_000_000 } },
    { id: 'revision.mode', params: { on: true } },
    { id: 'text.insert', params: { at: at(e[1]!, 0), text: 'new ' } },
    { id: 'revision.setCurrent', params: {} },
    { id: 'element.setStyle', params: { elements: [e[2]], style: 'st_shot' } },
    { id: 'revision.markElements', params: { range: { anchor: at(e[3]!, 0), head: at(e[3]!, 2) }, marked: true } },
    { id: 'revision.clear', params: {} },
    { id: 'revision.setDisplay', params: { display: 'collated' } },
  ]));
  it('mixed kinds', () => expectEquivalent((e) => [
    { id: 'element.insert', params: { after: e[3], style: 'st_parenthetical', text: '(smiling)' } },
    { id: 'element.setStyle', params: { elements: [e[4]], style: 'st_transition' } },
    { id: 'scene.move', params: { scenes: [e[5]], to: { before: e[0] } } },
    { id: 'element.split', params: { at: at(e[12]!, 6) } },
    { id: 'text.deleteBackward', params: { at: at(e[10]!, 0), unit: 'element' } },
    { id: 'element.move', params: { elements: [e[1]], to: { after: e[9] } } },
  ]));
  it('a large append batch keeps order', () => expectEquivalent(() => Array.from({ length: 40 }, (_, i) => (
    { id: 'element.insert', params: { style: i % 5 === 0 ? 'st_scene_heading' : 'st_action', text: `line ${i}` } }
  ))));
});

// ---------- randomised ----------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES = ['st_action', 'st_character', 'st_dialogue', 'st_parenthetical', 'st_transition', 'st_scene_heading'];

/**
 * Builds a command sequence adaptively against `h` (the sequential document): each command is
 * proposed from the CURRENT model, applied on its own, and kept only if it succeeded, so the
 * recorded list is valid start to finish. Returns the kept commands.
 */
function generate(h: H, seed: number, steps: number): Cmd[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const kept: Cmd[] = [];
  for (let n = 0; n < steps; n++) {
    const els = h.model.elements();
    if (els.length < 3) break;
    const ids = els.map((e) => e.id as string);
    const el = els[Math.floor(rnd() * els.length)]!;
    const other = pick(els);
    const scenes = h.model.scenes();
    const kind = Math.floor(rnd() * 16);
    let cmd: Cmd;
    switch (kind) {
      case 0: cmd = { id: 'element.insert', params: { style: pick(STYLES), text: `t${n}` } }; break;
      case 1: cmd = { id: 'element.insert', params: { after: el.id, style: pick(STYLES), text: `a${n}` } }; break;
      case 2: cmd = { id: 'element.insert', params: { before: el.id, style: pick(STYLES), text: `b${n}` } }; break;
      case 3: cmd = { id: 'element.move', params: { elements: [el.id], to: rnd() < 0.5 ? { after: other.id } : { before: other.id } } }; break;
      case 4: cmd = { id: 'element.move', params: { elements: [el.id, other.id], to: rnd() < 0.3 ? { after: null } : { after: pick(ids) } } }; break;
      case 5: {
        if (scenes.length === 0) continue;
        const s = pick(scenes);
        const t = pick(scenes);
        cmd = { id: 'scene.move', params: { scenes: [s.id], to: rnd() < 0.5 ? { after: t.id } : { before: t.id } } };
        break;
      }
      case 6: cmd = { id: 'element.setStyle', params: { elements: [el.id], style: pick(STYLES) } }; break;
      case 7: cmd = { id: 'element.cycleStyle', params: { element: el.id, direction: rnd() < 0.5 ? 'tabForward' : 'tabBack', caretAtEnd: rnd() < 0.5 } }; break;
      case 8: cmd = { id: 'element.split', params: { at: at(el.id, Math.floor(rnd() * (el.text.plain.length + 1))) } }; break;
      case 9: cmd = { id: 'text.deleteBackward', params: { at: at(el.id, 0), unit: rnd() < 0.5 ? 'char' : 'element' } }; break;
      case 10: cmd = { id: 'text.deleteForward', params: { at: at(el.id, el.text.plain.length), unit: 'char' } }; break;
      case 11: {
        const a = ids.indexOf(el.id as string);
        const b = ids.indexOf(other.id as string);
        const [x, y] = a <= b ? [el, other] : [other, el];
        cmd = { id: 'text.deleteRange', params: { range: { anchor: at(x.id, Math.min(1, x.text.plain.length)), head: at(y.id, Math.min(2, y.text.plain.length)) } } };
        break;
      }
      case 12: cmd = { id: 'element.duplicate', params: { elements: rnd() < 0.5 ? [el.id] : [el.id, other.id] } }; break;
      case 13: cmd = { id: 'text.insert', params: { at: at(el.id, Math.floor(rnd() * (el.text.plain.length + 1))), text: `x${n}` } }; break;
      case 14: {
        if (scenes.length === 0) continue;
        cmd = { id: 'scene.setSynopsis', params: { scene: pick(scenes).id, value: `syn ${n}` } };
        break;
      }
      default: cmd = { id: 'mark.toggle', params: { range: { anchor: at(el.id, 0), head: at(el.id, Math.min(2, el.text.plain.length)) }, mark: pick(['b', 'i', 'u']) } };
    }
    // Rehearse first: a refused fastPath command would otherwise mint a changeId before refusing
    // and desynchronise the id stream from the batch run that only sees the kept commands.
    if (!apply(h, [cmd], true).ok) continue;
    if (apply(h, [cmd]).ok) kept.push(cmd);
  }
  return kept;
}

describe('batch equivalence: seeded random sequences', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const seq = fresh();
      const commands = generate(seq.h, seed, 25);
      expect(commands.length).toBeGreaterThan(5);
      const bat = fresh();
      const r = apply(bat.h, commands);
      expect(r, `batch of ${commands.length} commands`).toMatchObject({ ok: true });
      expect(documentToJSON(bat.h.doc)).toEqual(documentToJSON(seq.h.doc));
      expect(bat.h.body()).toEqual(seq.h.body());
    });
  }
});
