# @sudobility/writing_core

> **Git policy.** Commit on `main` while executing a plan task. Push only when
> the user explicitly asks in that turn.

Headless, platform-free writing engine for the Fadewright family: document
model (Yjs), templates, commands, SmartType and per-session undo. Layout and
pagination are a later milestone, not implemented here yet. Knows nothing
about accounts, servers or UI.

## Tech Stack

- TypeScript strict, ESM only, built with `tsc -p tsconfig.esm.json`
- Vitest; Bun for installs and scripts
- Published publicly to npm via unified-cicd on push to main

## Structure

- `src/units.ts` — EMU conversions (914 400/in). Lengths are integers everywhere.
- `src/ids/` — prefixed ULIDs; `IdSource` is injected (`createSeededIdSource` in tests).
- `src/hash/` — canonical JSON, SHA-256 (`@noble/hashes`), v1 content hashes (spec 11 §4.2) with `vectors.json`.
- `src/schema/` — Zod schemas; types are `z.infer`. Vocabularies in `vocab.ts` are the single declaration.
- `src/template/` — style resolution, template validation, Enter/Tab flow.
- `src/templates/` — shared seeds, role table, generated Fade In templates (`builtin/generated`), authored templates, locale variants, catalogue.
- `src/model/` — Yjs document creation, JSON conversion, template apply/export, portable positions, validation (`validate/`).
- `src/migrations/` — `DOC_SCHEMA_VERSION` and idempotent steps.
- `src/read-model/` — `openDocument`: order index, element views, scenes, dialogue blocks, outline tree, entities, suggestions, hashes.
- `src/commands/` — registry, origins, wire positions, atomic batches, write policy, text/mark/element/entity/SmartType commands.
- `src/smarttype/` — name normalization and harvesting.
- `src/undo/` — per-session undo.

## Commands

- `bun run verify` — typecheck (src, tests and `scripts/`), lint (`eslint src scripts`), test, build. Required before every commit.
- `bun run test` — vitest; the byte-for-byte template golden test reads `FADEWRIGHT_TEMPLATES_DIR` (default `../screenwriter_plans/research/templates`) and skips when absent.
- `bun run templates:generate` — regenerate `src/templates/builtin/generated/*` from the research XML.
- `bun run hash:vectors` — regenerate `src/hash/vectors.json`. Only when `HASH_VERSION` changes.

## Patterns

- Every write is a command run through `executeBatch`/`executeCommand`, one `doc.transact` per invocation, carrying a `TransactionOrigin`.
- A command's `run` makes every refusal check before its first write. Every invocation — a single command or a multi-command batch — is rehearsed on a throwaway replica first, so a refusal after a partial write never reaches the live document. `fastPath: true` on a `CommandSpec` opts a *single* command out of that rehearsal (never a batch), trading the safety net for one fewer document clone; it is allowlisted to the keyboard hot path — `text.insert`, `text.insertSoftReturn`, `text.deleteBackward`, `text.deleteForward`, `element.split`, `element.setStyle`, `element.cycleStyle` (`src/commands/builtin.test.ts` pins the list) — because each provably refuses, via `isEnabled` or as the first thing `run` does, before any write. Rehearsal clones the whole document, so it costs O(document size): `src/commands/cost.bench.test.ts` guards the budget at 3000 elements.
- `readOnly` defaults to `isNewerThanCode(doc)` (invariant I20); a caller must pass `false` explicitly to override it.
- Element order is `pos` (fractional, base-62) then id. Never use `Y.Array` for anything people reorder.
- Views from the read model are frozen and replaced, never mutated.

## Gotchas

- **Rebalancing must be deterministic.** `pos` is last-writer-wins per element, so two replicas rebalancing with different keys could interleave into a new order; `rebalancePositions` uses no jitter.
- **Relative positions do not survive a new `Y.Doc`.** `DocumentJSON` stores them as `o:<offset>`; `materializeDocument` rebuilds them.
- **Undo grouping is ours, not Yjs's.** `Y.UndoManager` runs with an infinite capture timeout and the wrapper calls `stopCapturing()` from an injected clock; tracked origins are a per-session subclass so another session's typing is never undone.
- **Harvest sets counts, it does not increment them** — the harvester is debounced after edits and must be idempotent.
- **A `revDel` embed occupies one Y.Text index.** Offsets in `TextJSON.embeds[].at` are Y.Text indices; `plain` excludes embeds.
- **Changing any hash rule bumps `HASH_VERSION`**; never regenerate `vectors.json` for the same version.
- **Built-in templates are generated.** Edit `osf.ts`, `shared.ts` or the authored modules and regenerate; never hand-edit `builtin/generated` — `generated/checksums.json` is vendored and the golden test verifies it with or without the research sources.
- **`executeBatch` gives each command after a mutating one a FRESH throwaway model** (`openDocument(doc, deps, { repair: false })`, disposed right after the command), so batch ≡ sequential (`src/commands/batch-equivalence.test.ts` pins it, seeded random sequences included). Moves, scene moves, range edits, duplicates and merges all resolve through `ctx.model`; before this, inside one batch they saw pre-batch order and diverged or refused. A new command may keep reading `ctx.model` before its own first write.
- **`ctx.model` is stale inside a command.** A command runs inside `doc.transact`, and the read model's order index, element views and caches are only refreshed by its observers when the transaction ENDS. Read `ctx.model` before your first write; after writing, read the Y.Doc directly (see `repairDualRuns` in `commands/element-ops.ts`).
- **`textVersion`/`attrsVersion` are per-id high-water marks**, never reset on delete: an id can come back (undo, a rejected tracked delete, a re-import) and a reused id with reset counters would collide with the previous element's cache entry.
- **The command registry is a process-wide singleton.** Registering the same id twice from two test files throws, so the whole suite in ONE process (`bun test`) fails where the configured runner (`vitest run`, one process per file) passes. Reset or scope the registry before relying on a single-process run.
- **A `fastPath` command skips rehearsal, so it must refuse before its first write.** The allowlist (`text.insert`, `text.insertSoftReturn`, `text.deleteBackward`, `text.deleteForward`, `element.split`, `element.setStyle`, `element.cycleStyle`) is pinned by a guard test, and each is on the keystroke path where whole-document rehearsal costs ~30 ms at 3000 elements. Resolve everything that can throw or refuse — `resolveStyle` included — before touching the document.
- **Speaker names strip only known extensions.** `entityNameKey` folds `(V.O.)`, `(O.S.)`, `(CONT'D)` and the template's own extensions list into the base name, but leaves any other parenthetical alone: `MAYA (YOUNG)` is a different character from `MAYA`.
- **`resolveStyle` is memoized on the template object's identity** (a WeakMap), which is the `(templateRevision, styleId)` key spec 01 §3.4.2 asks for because the read model rebuilds its frozen template object on every template mutation. The cached resolution is frozen; mutate a copy.

## Specs

`~/projects/screenwriter_plans/specs/` — 01 (model), 02 (layout), 08 (commands), 11 §4.2 (content hash). Master registry R1–R31 wins on conflicts.

## Related projects

`writing_formats` · `writing_ui` · `writing_ui_rn` · `screenwriter_types` · `screenwriter_api` · `screenwriter_lib` · `screenwriter_plans`
