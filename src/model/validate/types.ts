import type { ValidationContext } from './context.js';

export const INVARIANT_CODES = [
  'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11', 'I12', 'I13', 'I14', 'I15', 'I16', 'I17', 'I18', 'I19', 'I20',
] as const;
export type InvariantCode = (typeof INVARIANT_CODES)[number];
export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: InvariantCode;
  severity: Severity;
  autoRepair: boolean;
  message: string;
  ids: string[];
  repair?: () => void;
}

export interface Invariant {
  code: InvariantCode;
  severity: Severity;
  autoRepair: boolean;
  check(ctx: ValidationContext): Issue[];
}

export function issue(inv: Pick<Invariant, 'code' | 'severity' | 'autoRepair'>, message: string, ids: string[], repair?: () => void): Issue {
  return { code: inv.code, severity: inv.severity, autoRepair: inv.autoRepair && repair !== undefined, message, ids, ...(repair ? { repair } : {}) };
}
