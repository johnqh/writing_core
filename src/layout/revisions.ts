/**
 * Revision display (spec 02 §25), speed-mode subset. Layout only READS what commands wrote: `rev` runs and `revDel`
 * embeds in each element's text (spec 01 §5.10) and the `revisions` map (sets, display filter, mark column).
 * Adds, after pagination, without affecting it:
 *  - `DocLine.revisionMark` on body text lines that hold a visible mark (mark char of the highest visible set on the line),
 *  - `DocPage.revisionSetId/pageColor/revisionLabel` (the highest visible set on the page; else the latest full-draft set),
 *  - `DocPage.revisedSetIds`, every set with a mark on the page whatever the display filter (feeds the Revised Pages list).
 * Speed-mode gaps: generated lines (MORE / CONT'D cues) never carry a mark, omit marks and lock `revisionSetId`
 * overrides are ignored, revised-text styling (underline/bold/colour) is not applied to glyph runs.
 */
import type { DocumentModel } from '../read-model/open.js';
import type { ElementView } from '../read-model/views.js';
import type { RevisionsJSON } from '../schema/document.js';
import type { DocLayout, DocLine, DocPage } from './layout-document.js';

type RevSet = RevisionsJSON['sets'][number];

export interface LineRevisionMark {
  setId: string;
  /** The set's mark glyph(s), e.g. `*`. */
  text: string;
  /** x from the page's left edge (`revisions.markColumn`). */
  x: number;
  color: string;
}

export interface RevisedPageRef { index: number; label: string }

export interface RevisionReportSet {
  setId: string;
  name: string;
  color: string;
  mark: string;
  date: number | null;
  /** Body elements holding at least one mark (run or deletion) of this set. */
  markedElements: number;
  pages: RevisedPageRef[];
}

/** `Blue Revision` -> `Blue`. */
export function revisionShortName(set: Pick<RevSet, 'name'>): string {
  return set.name.replace(/\s+Revision$/i, '');
}

/** `M/D/YY` from a UTC date: the stored date is UTC midnight of the calendar date the writer chose. */
export function formatRevisionDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
}

/** `Blue Revised 9/21/26` (no date until the set has one). */
export function revisionLabel(set: RevSet): string {
  return set.date === null ? `${revisionShortName(set)} Revised` : `${revisionShortName(set)} Revised ${formatRevisionDate(set.date)}`;
}

interface Mark { start: number; end: number; setId: string }

/** Marks of one element in plain-text offsets; a `revDel` embed is a zero-width mark at its deletion point. */
export function elementRevisionMarks(el: Pick<ElementView, 'text'>): Mark[] {
  const out: Mark[] = [];
  let at = 0;
  for (const r of el.text.runs) {
    const rev = r.attrs.rev;
    if (typeof rev === 'string') {
      const last = out[out.length - 1];
      if (last && last.setId === rev && last.end === at) last.end = at + r.text.length;
      else out.push({ start: at, end: at + r.text.length, setId: rev });
    }
    at += r.text.length;
  }
  el.text.embeds.forEach((e, i) => {
    if (e.embed.type === 'revDel') out.push({ start: e.at - i, end: e.at - i, setId: e.embed.rev });
  });
  return out;
}

const orderOf = (sets: readonly RevSet[]): Map<string, number> => new Map(sets.map((s, i) => [s.id as string, i]));

/** Fill revision data into an already paginated layout. */
export function applyRevisionDisplay(model: DocumentModel, pages: readonly DocPage[]): void {
  const state = model.revisionState();
  const order = orderOf(state.sets);
  const setById = new Map(state.sets.map((s) => [s.id as string, s]));
  const cache = new Map<string, { marks: Mark[]; length: number }>();
  const marksOf = (id: string) => {
    let c = cache.get(id);
    if (!c) {
      const el = model.element(id as never);
      cache.set(id, (c = { marks: el ? elementRevisionMarks(el) : [], length: el ? el.text.plain.length : 0 }));
    }
    return c;
  };
  const lastFull = [...state.sets].reverse().find((s) => s.fullDraft);
  const lastFullOrder = lastFull ? (order.get(lastFull.id as string) as number) : -1;
  const passes = (setId: string): boolean => {
    switch (state.display) {
      case 'none': return false;
      case 'active': return setId === state.activeSetId;
      case 'selected': return state.selectedSetIds.includes(setId as never);
      case 'sinceLastFull': return (order.get(setId) ?? -1) >= lastFullOrder;
      default: return true; // all, collated (per page below)
    }
  };
  const higher = (a: string | null, b: string): string => (a === null || (order.get(b) ?? -1) > (order.get(a) ?? -1) ? b : a);

  // Highest set with any mark in the document: the ceiling for a full-draft page colour.
  let docHighest = null as string | null;
  const perPage = pages.map((page) => {
    // Which set marks each line, unfiltered: line -> setId[].
    const hits: { line: DocLine; sets: string[] }[] = [];
    const present = new Set<string>();
    for (const line of page.lines) {
      if (line.kind !== 'text') continue;
      const { marks, length } = marksOf(line.elementId);
      if (marks.length === 0) continue;
      const sets: string[] = [];
      for (const m of marks) {
        const inside = m.start === m.end
          ? m.start >= line.sourceStart && (m.start < line.sourceEnd || (m.start === line.sourceEnd && line.sourceEnd === length))
          : m.start < line.sourceEnd && m.end > line.sourceStart;
        if (inside && !sets.includes(m.setId)) sets.push(m.setId);
      }
      if (sets.length > 0) {
        hits.push({ line, sets });
        for (const s of sets) {
          present.add(s);
          docHighest = higher(docHighest, s);
        }
      }
    }
    return { page, hits, present };
  });

  for (const { page, hits, present } of perPage) {
    page.revisedSetIds = [...present].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    let collatedTop: string | null = null;
    if (state.display === 'collated') for (const s of present) collatedTop = higher(collatedTop, s);
    const visible = (setId: string) => (state.display === 'collated' ? setId === collatedTop : passes(setId));
    let pageTop: string | null = null;
    for (const h of hits) {
      let top: string | null = null;
      for (const s of h.sets) if (visible(s)) top = higher(top, s);
      if (!top) continue;
      pageTop = higher(pageTop, top);
      const set = setById.get(top);
      if (set && set.mark !== '') h.line.revisionMark = { setId: top, text: set.mark, x: state.markColumn, color: set.textColor };
    }
    let pageSet = pageTop ? setById.get(pageTop) ?? null : null;
    if (!pageSet && state.display !== 'none' && lastFull && docHighest !== null && lastFullOrder <= (order.get(docHighest) ?? -1)) pageSet = lastFull;
    page.revisionSetId = pageSet ? (pageSet.id as string) : null;
    page.pageColor = pageSet && state.showPageColor ? pageSet.pageColor : null;
    page.revisionLabel = pageSet ? revisionLabel(pageSet) : null;
  }
}

/** Per-set summary for the Revisions panel: marked element counts and the pages carrying each set's marks. */
export function revisionReport(model: DocumentModel, layout: Pick<DocLayout, 'pages'>): RevisionReportSet[] {
  const state = model.revisionState();
  const counts = new Map<string, number>();
  for (const el of model.elements()) {
    for (const s of new Set(elementRevisionMarks(el).map((m) => m.setId))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return state.sets.map((s) => ({
    setId: s.id as string, name: s.name, color: s.textColor, mark: s.mark, date: s.date, markedElements: counts.get(s.id as string) ?? 0,
    pages: layout.pages.filter((p) => p.revisedSetIds?.includes(s.id as string)).map((p) => ({ index: p.index, label: p.label })),
  }));
}
