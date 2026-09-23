/**
 * M2 task 32, step 3: "author the cases that need no PDF" — a small, real, committed-snapshot subset
 * of spec 02 §37.2's ~20 rule cases (`more-contd-split`, `scene-continued`, …), each built from real
 * elements through `commandHarness` (not the low-level row-fixture builders `paginate.test.ts`/
 * `continueds.test.ts` use for their OWN, narrower unit tests, though every case here reuses those
 * files' own proven document shapes) and laid out through the real pipeline. Reduced honestly from the
 * spec's full ~20-case list: these five exercise five genuinely distinct rules end to end
 * (continuation cues, scene CONTINUED, a keep chain, dual dialogue, the sentence rule) rather than
 * attempting the full authored-in-Fade-In/Final-Draft catalogue, which needs licensed desktop software
 * this environment does not have (see `golden.test.ts`'s and `docs/verification/V-02.md`'s own notes).
 *
 * Shared by both `golden-cases.test.ts` (compares against the committed snapshot) and
 * `scripts/golden-update.ts` (regenerates it), so the two can never silently drift apart.
 */
import { commandHarness } from '../commands/test-harness.js';
import type { DocumentModel } from '../read-model/open.js';
import { layoutDocument, type DocLayout } from './layout-document.js';

export interface GoldenCase {
  key: string;
  description: string;
  build(): { model: DocumentModel; layout: DocLayout };
}

const SPEECH = Array.from({ length: 7 }, () => 'Hold the door and listen to me.').join(' ');

/** The exact search `continueds.test.ts` uses: the filler count that makes MAYA's speech straddle page 1/2. */
function speechAfterN(): number {
  for (let k = 18; k < 30; k++) {
    const h = commandHarness();
    h.replaceBody([
      ['st_scene_heading', 'INT. STATION - NIGHT'],
      ...Array.from({ length: k }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
      ['st_character', 'MAYA'], ['st_dialogue', SPEECH],
    ]);
    const l = layoutDocument(h.model);
    if (l.pages.length === 2 && l.pages[0]!.lines.some((x) => x.kind === 'more')) return k;
  }
  throw new Error('no straddling speech found');
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    key: 'more-contd-split',
    description: "A dialogue speech straddles a page break: (MORE) under the head, MAYA (CONT'D) atop the continuation.",
    build() {
      const n = speechAfterN();
      const h = commandHarness();
      h.replaceBody([
        ['st_scene_heading', 'INT. STATION - NIGHT'],
        ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
        ['st_character', 'MAYA'], ['st_dialogue', SPEECH],
      ]);
      return { model: h.model, layout: layoutDocument(h.model) };
    },
  },
  {
    key: 'scene-continued',
    description: 'A scene spans a page break with both continueds on: (CONTINUED) at the bottom of page 1, CONTINUED: atop page 2.',
    build() {
      const h = commandHarness();
      h.replaceBody([
        ['st_scene_heading', 'INT. STATION - NIGHT'],
        ...Array.from({ length: 40 }, (_, i): [string, string] => ['st_action', `Beat ${i}.`]),
      ]);
      h.run('template.setContinueds', { sceneBottom: true, sceneTop: true });
      return { model: h.model, layout: layoutDocument(h.model) };
    },
  },
  {
    key: 'keep-heading-chain',
    description: "A scene heading always keeps with its first (unsplittable) action: both move to the next page together rather than the heading orphaning at the bottom.",
    build() {
      const h = commandHarness();
      h.replaceBody([
        ...Array.from({ length: 52 }, (_, i): [string, string] => ['st_action', `Filler ${i}.`]),
        ['st_scene_heading', 'INT. VAULT - NIGHT'],
        ['st_action', 'One.\nTwo.\nThree.'],
      ]);
      return { model: h.model, layout: layoutDocument(h.model) };
    },
  },
  {
    key: 'dual-dialogue-basic',
    description: "dual.create pairs a cue's speech with the next one; the two render side by side (§15.1).",
    build() {
      const h = commandHarness();
      const ids = h.replaceBody([
        ['st_character', 'ALICE'], ['st_dialogue', 'After you.'],
        ['st_character', 'BOB'], ['st_dialogue', 'No, after you.'],
      ]);
      h.run('dual.create', { character: ids[0] });
      return { model: h.model, layout: layoutDocument(h.model) };
    },
  },
  {
    key: 'break-on-sentences',
    description: 'A long action paragraph straddling a page break splits only after a sentence end, never mid-sentence (§13.6 rule 3): every line here ends one, so the largest legal head wins.',
    build() {
      const sentence = 'Hold the door and listen to me now.'; // a 36-char sentence, one per wrapped line at 60 cpi
      const speech = Array.from({ length: 8 }, () => sentence).join(' ');
      // The same search `continueds.test.ts` uses: the filler count that makes THIS paragraph itself
      // (not the fillers before it) straddle page 1/2.
      const rows = (n: number): [string, string][] => [
        ...Array.from({ length: n }, (_, i): [string, string] => ['st_action', `Filler ${i}.`]),
        ['st_action', speech],
      ];
      let n = 0;
      for (; n < 30; n++) {
        const probe = commandHarness();
        const ids = probe.replaceBody(rows(n));
        const speechId = ids[ids.length - 1]!;
        const l = layoutDocument(probe.model);
        const splits = l.pages.length === 2
          && l.pages[0]!.lines.some((line) => line.elementId === speechId)
          && l.pages[1]!.lines.some((line) => line.elementId === speechId);
        if (splits) break;
      }
      const h = commandHarness();
      h.replaceBody(rows(n));
      return { model: h.model, layout: layoutDocument(h.model) };
    },
  },
];
