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

export function validateDocument(
  doc: Y.Doc,
  options: { codeVersion?: number; only?: readonly InvariantCode[] } = {},
): { issues: Issue[]; repair(): number } {
  const ctx = createValidationContext(doc, options.codeVersion);
  const selected = options.only ? INVARIANTS.filter((i) => options.only!.includes(i.code)) : INVARIANTS;
  const issues = selected.flatMap((inv) => inv.check(ctx));
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
