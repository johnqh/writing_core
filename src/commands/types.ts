import type * as Y from 'yjs';
import type { z } from 'zod/v4';
import type { IdSource } from '../ids/id-source.js';
import type { ChangeId } from '../ids/ids.js';
import type { Actor } from '../model/origins.js';
import type { DocumentModel } from '../read-model/open.js';
import type { TransactionOrigin } from './origin.js';
import type { WireRange } from './positions.js';

export const CAPABILITIES = ['write', 'comment', 'lockAdmin', 'revisionAdmin'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const REASON_CODES = [
  'unknownCommand', 'invalidParams', 'readOnly', 'capabilityMissing', 'locked', 'notFound', 'contentChanged',
  'invalidPosition', 'notApplicable', 'styleNotInTemplate', 'emptySelection',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const REASON_LABEL_KEYS: Record<ReasonCode, string> = Object.fromEntries(REASON_CODES.map((c) => [c, `writing.reason.${c}`])) as Record<ReasonCode, string>;

export type Availability = { enabled: true } | { enabled: false; reason: ReasonCode };

export interface CommandContext {
  doc: Y.Doc;
  model: DocumentModel;
  actor: Actor;
  origin: TransactionOrigin;
  capabilities: ReadonlySet<Capability>;
  ids: IdSource;
  clock: () => number;
  /** One per command invocation (spec 08 §3.3 item 3). */
  changeId: ChangeId;
  readOnly: boolean;
}

export type CommandEffect = { kind: 'elementCreated' | 'elementRemoved' | 'entityCreated'; id: string };

export type CommandResult =
  | { ok: true; effects?: CommandEffect[]; selection?: WireRange }
  | { ok: false; reason: ReasonCode; detail?: Record<string, unknown> };

/**
 * `run` performs every check that can refuse before its first write, so a single
 * command either refuses without writing or completes.
 *
 * `executeBatch`/`executeCommand` enforce this from the outside too: by default
 * every invocation (single command or multi-command batch) is rehearsed on a
 * throwaway replica first, so a refusal after a partial write never reaches the
 * live document even if `run` misbehaves. `fastPath: true` opts a single command
 * out of that rehearsal (it never applies to a multi-command batch), trading the
 * safety net for one fewer document clone; it is reserved for the typing hot
 * path. A `fastPath` command MUST refuse — via `isEnabled` or as the first thing
 * `run` does — before performing its first write, because nothing rolls back a
 * write that happens before a later refusal in that command.
 */
export interface CommandSpec<P> {
  id: string;
  params: z.ZodType<P>;
  scope: 'document' | 'titlePage' | 'beatBoard' | 'structure' | 'entities' | 'settings';
  mutates: boolean;
  requires: readonly Capability[];
  undo: 'normal' | 'standalone' | 'none';
  labelKey: string;
  /** Default false. See the type doc comment above for the contract a `true` command must uphold. */
  fastPath?: boolean;
  isEnabled(ctx: CommandContext, p: P): Availability;
  run(ctx: CommandContext, p: P): CommandResult;
}

export interface CommandInvocation {
  id: string;
  params: unknown;
}
