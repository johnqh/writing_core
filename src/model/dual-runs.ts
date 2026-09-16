import type { StyleRole } from '../schema/vocab.js';
import { SPEAKER_ROLES, SPEECH_MEMBER_ROLES } from '../schema/vocab.js';

/** One element, reduced to what spec 01 §5.3.4 / invariant I7 needs to judge a dual-dialogue run. */
export interface DualMember {
  id: string;
  /** `dual.group`, or null when the element carries no (or a malformed) dual record. */
  group: string | null;
  /** `dual.side`, or null when absent/malformed. */
  side: 'left' | 'right' | null;
  role: StyleRole | null;
  /** The element's resolved style allows dual dialogue. */
  dualAllowed: boolean;
}

export interface DualRun {
  group: string;
  ids: string[];
  wellFormed: boolean;
}

const has = (list: readonly string[], role: StyleRole | null): boolean => role !== null && list.includes(role);

/**
 * Spec 01 §5.3.4. The single definition of a well-formed dual-dialogue run, shared by invariant I7
 * (which reports malformed runs) and by the commands that can create one (which repair what they
 * just broke, rather than leaving the document for a later validate pass to find).
 *
 * A run is a maximal span of adjacent elements carrying the same `dual.group`. It is well formed
 * when: every member's style allows dual dialogue and has a speaker or speech-member role; the
 * sides read left…left right…right with at least one of each; each side opens with a speaker role;
 * and the group occurs in exactly one run of the document.
 */
export function dualRuns(elements: readonly DualMember[]): DualRun[] {
  const runs: DualMember[][] = [];
  let current: DualMember[] = [];
  let group: string | null = null;
  for (const el of elements) {
    if (el.group !== null && el.group === group) current.push(el);
    else {
      if (current.length > 0) runs.push(current);
      current = el.group !== null ? [el] : [];
    }
    group = el.group;
  }
  if (current.length > 0) runs.push(current);

  const occurrences = new Map<string, number>();
  for (const run of runs) {
    const g = run[0]!.group!;
    occurrences.set(g, (occurrences.get(g) ?? 0) + 1);
  }

  return runs.map((run) => {
    const g = run[0]!.group!;
    const sides = run.map((el) => el.side);
    const firstRight = sides.indexOf('right');
    const wellOrdered = firstRight > 0
      && sides.slice(firstRight).every((s) => s === 'right')
      && sides.slice(0, firstRight).every((s) => s === 'left');
    const rolesOk = run.every((el) => el.dualAllowed && (has(SPEAKER_ROLES, el.role) || has(SPEECH_MEMBER_ROLES, el.role)));
    const startsWithSpeakers = wellOrdered && has(SPEAKER_ROLES, run[0]!.role) && has(SPEAKER_ROLES, run[firstRight]!.role);
    return { group: g, ids: run.map((el) => el.id), wellFormed: wellOrdered && rolesOk && startsWithSpeakers && occurrences.get(g) === 1 };
  });
}
