/**
 * Scene length in eighths of a page and running time (spec 02 §27; M2 task 33).
 *
 * Adapted to the thin cut: the input is the `DocLayout` `layoutDocument` returns (not the plan's `LayoutResult`), and
 * a line's scene comes from the read model (`model.scenes()`), because a `DocLine` carries an element id, not a scene.
 * Everything is integer arithmetic on EMU.
 */
import type { ElementId } from '../ids/ids.js';
import type { DocumentModel } from '../read-model/open.js';
import type { EmbeddedTemplateJSON } from '../schema/document.js';
import type { SettingsJSON } from '../schema/document.js';
import type { DocLayout, DocPage } from './layout-document.js';

export interface SceneEighths {
  sceneId: ElementId;
  /** Sum over the pages the scene occupies; 0 for an omitted scene. */
  eighths: number;
  /** Per body page (`DocPage.index`), only pages where the scene has body extent. */
  pages: { pageIndex: number; eighths: number }[];
  /** `W N/8`, unreduced (`4/8`, `1 3/8`, `2`, `0`). */
  display: string;
}

/** §27.1 step 4: whole pages plus unreduced eighths (Final Draft's display). */
export function formatEighths(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (rest === 0) return String(whole);
  return whole === 0 ? `${rest}/8` : `${whole} ${rest}/8`;
}

/**
 * §27.1 step 3, the largest-remainder method. `extents` are non-negative EMU heights of the scenes on ONE page; the
 * page total is `round(Σraw)` capped at 8 (a page filled by one scene is exactly 8), every scene with extent > 0 gets at
 * least 1 (which may lift the total above `round(Σraw)`, never above the number of positive scenes when that exceeds 8).
 */
export function distributeEighths(extents: readonly number[], bodyHeight: number): number[] {
  const scaled = extents.map((e) => e * 8);
  const base = scaled.map((s) => Math.floor(s / bodyHeight));
  const rem = scaled.map((s, i) => s - base[i]! * bodyHeight);
  const sum = extents.reduce((a, b) => a + b, 0);
  const total = Math.min(8, Math.floor((16 * sum + bodyHeight) / (2 * bodyHeight)));
  for (let i = 0; i < base.length; i++) if (extents[i]! > 0 && base[i] === 0) base[i] = 1;
  let have = base.reduce((a, b) => a + b, 0);
  // Hand out the shortfall to the largest remainders (earlier scene wins a tie).
  while (have < total) {
    let best = -1;
    for (let i = 0; i < base.length; i++) if (extents[i]! > 0 && (best < 0 || rem[i]! > rem[best]!)) best = i;
    if (best < 0) break;
    base[best]!++;
    rem[best] = -1; // each scene takes at most one extra per round
    have++;
    if (rem.every((r) => r < 0)) for (let i = 0; i < rem.length; i++) rem[i] = 0;
  }
  // A minimum-1 bump can overshoot: take it back from the largest scenes with the smallest remainder, never below 1.
  while (have > total) {
    let worst = -1;
    for (let i = 0; i < base.length; i++) if (base[i]! > 1 && (worst < 0 || rem[i]! < rem[worst]! || (rem[i] === rem[worst] && base[i]! > base[worst]!))) worst = i;
    if (worst < 0) break;
    base[worst]!--;
    have--;
  }
  return base;
}

/** Height a scene's text lines occupy on a page: union of [y − space before, y + pitch], so dual sides are not counted twice. */
function extentsOnPage(page: DocPage, bodyTop: number, sceneOf: (id: ElementId) => ElementId | undefined): Map<ElementId, number> {
  const intervals = new Map<ElementId, [number, number][]>();
  let bottom = bodyTop;
  for (const l of page.lines) {
    const end = l.y + l.pitch;
    if (l.kind === 'text') {
      const scene = sceneOf(l.elementId);
      if (scene) {
        const list = intervals.get(scene) ?? intervals.set(scene, []).get(scene)!;
        list.push([Math.min(l.y, Math.max(bottom, bodyTop)) === l.y ? l.y : Math.max(bottom, bodyTop), end]);
      }
    }
    if (end > bottom) bottom = end;
  }
  const out = new Map<ElementId, number>();
  for (const [scene, list] of intervals) {
    list.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [s, e] = list[0]!;
    for (const [a, b] of list.slice(1)) {
      if (a <= e) e = Math.max(e, b);
      else { total += e - s; s = a; e = b; }
    }
    out.set(scene, total + (e - s));
  }
  return out;
}

/** §27.1: eighths per scene, in document order, for every scene of the model (omitted scenes are 0). */
export function sceneEighths(layout: DocLayout, model: DocumentModel): SceneEighths[] {
  const scenes = model.scenes();
  const of = new Map<ElementId, ElementId>();
  for (const s of scenes) if (!s.omitted) for (const id of s.elementIds) of.set(id, s.id);
  const bodyHeight = layout.bodyBottom - layout.bodyTop;
  const perScene = new Map<ElementId, { pageIndex: number; eighths: number }[]>();
  for (const page of layout.pages) {
    const extents = extentsOnPage(page, layout.bodyTop, (id) => of.get(id));
    const ids = [...extents.keys()];
    const shares = distributeEighths(ids.map((id) => extents.get(id)!), bodyHeight);
    ids.forEach((id, i) => (perScene.get(id) ?? perScene.set(id, []).get(id)!).push({ pageIndex: page.index, eighths: shares[i]! }));
  }
  return scenes.map((s) => {
    const pages = perScene.get(s.id) ?? [];
    const eighths = pages.reduce((a, p) => a + p.eighths, 0);
    return { sceneId: s.id, eighths, pages, display: formatEighths(eighths) };
  });
}

export interface SceneRunningTime {
  sceneId: ElementId;
  seconds: number;
  /** `estimate` when `scene.estimatedSeconds` replaced the computed value (§27.2). */
  source: 'computed' | 'estimate';
  display: string;
}

export interface RunningTime {
  scenes: SceneRunningTime[];
  totalSeconds: number;
  /** `m:ss`. */
  display: string;
}

/** §27.2: `m:ss`. */
export function formatRunningTime(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SPOKEN_ROLES: ReadonlySet<string> = new Set(['dialogue', 'lyrics']);

function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * §27.2. `pages`: `eighths / 8 × secondsPerPage`. `words`: spoken words (dialogue and lyrics) at `wordsPerMinute` plus
 * `soundCueSeconds` per sound-cue element. A scene's `estimatedSeconds` replaces its computed value; omitted scenes are 0.
 * (`settings` is `model.settings()`; the template supplies the method, words per minute and cue seconds.)
 */
export function runningTime(
  layout: DocLayout, model: DocumentModel, template: EmbeddedTemplateJSON, settings: Pick<SettingsJSON, 'secondsPerPage'>,
): RunningTime {
  const rt = template.pagination.runningTime;
  const eighths = rt.method === 'pages' ? new Map(sceneEighths(layout, model).map((e) => [e.sceneId, e.eighths])) : null;
  const byId = new Map(model.elements().map((e) => [e.id, e]));
  const scenes = model.scenes().map((s): SceneRunningTime => {
    let seconds = 0;
    let source: SceneRunningTime['source'] = 'computed';
    if (s.omitted) seconds = 0;
    else if (s.estimatedSeconds !== null) { seconds = s.estimatedSeconds; source = 'estimate'; }
    else if (eighths) seconds = (eighths.get(s.id)! / 8) * settings.secondsPerPage;
    else {
      let words = 0;
      let cues = 0;
      for (const id of s.elementIds) {
        const el = byId.get(id);
        if (!el || el.role === null) continue;
        if (SPOKEN_ROLES.has(el.role)) words += wordCount(el.text.plain);
        else if (el.role === 'soundCue') cues++;
      }
      seconds = (words / rt.wordsPerMinute) * 60 + cues * rt.soundCueSeconds;
    }
    return { sceneId: s.id, seconds, source, display: formatRunningTime(seconds) };
  });
  const totalSeconds = scenes.reduce((a, s) => a + s.seconds, 0);
  return { scenes, totalSeconds, display: formatRunningTime(totalSeconds) };
}
