import type * as Y from 'yjs';
import { systemOrigin } from '../origins.js';
import { createValidationContext } from './context.js';
import { REFERENCE_INVARIANTS } from './references.js';
import { STRUCTURAL_INVARIANTS } from './structural.js';
import type { Invariant, InvariantCode, Issue } from './types.js';

export * from './types.js';
export { allTexts, createValidationContext, BUILTIN_STYLE_ROLES } from './context.js';

const INVARIANTS: Invariant[] = [...STRUCTURAL_INVARIANTS, ...REFERENCE_INVARIANTS];

export function registerInvariants(extra: readonly Invariant[]): void {
  for (const inv of extra) if (!INVARIANTS.some((i) => i.code === inv.code)) INVARIANTS.push(inv);
}

/**
 * Why a spec 01 §9 code can have no implementation here, for the "not implemented in this build"
 * report below. I14 (locked numbering) is defined in terms of spec 02 §22.2's numbering modes,
 * which milestone M2 owns; there is nothing to validate against until the layout engine exists.
 */
export const UNIMPLEMENTED_INVARIANTS: Readonly<Partial<Record<InvariantCode, string>>> = {
  I14: 'locked numbering is defined by spec 02 §22.2, which milestone M2 (layout) owns',
};

export function validateDocument(
  doc: Y.Doc,
  options: { codeVersion?: number; only?: readonly InvariantCode[] } = {},
): { issues: Issue[]; repair(): number } {
  const ctx = createValidationContext(doc, options.codeVersion);
  const selected = options.only ? INVARIANTS.filter((i) => options.only!.includes(i.code)) : INVARIANTS;
  const issues = selected.flatMap((inv) => inv.check(ctx));
  // `only: ['I14']` used to report a clean document, which reads as "checked and fine" when the
  // truth is "never checked". Asking for a code this build cannot check is answered honestly.
  // A full pass stays silent about it on purpose: a healthy document must report nothing, which
  // is what the repair loop and every caller's "issues.length === 0" depends on.
  for (const code of options.only ?? []) {
    if (INVARIANTS.some((i) => i.code === code)) continue;
    const why = UNIMPLEMENTED_INVARIANTS[code] ?? 'no invariant is registered for this code';
    issues.push({ code, severity: 'info', autoRepair: false, message: `${code} is not implemented in this build: ${why}`, ids: [] });
  }
  return {
    issues,
    repair() {
      const runnable = issues.filter((i) => i.autoRepair && i.repair);
      if (runnable.length === 0) return 0;
      doc.transact(() => {
        for (const i of runnable) i.repair!();
      }, systemOrigin('repair'));
      return runnable.length;
    },
  };
}
