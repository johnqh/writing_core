# @sudobility/writing_core

> **Git policy.** Commit on `main` while executing a plan task. Push only when
> the user explicitly asks in that turn.

Headless, platform-free writing engine for the Fadewright family: document
model (Yjs), templates, commands, SmartType, layout and pagination. Knows
nothing about accounts, servers or UI.

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
- A command's `run` makes every refusal check before its first write; multi-command batches are rehearsed on a replica first.
- Element order is `pos` (fractional, base-62) then id. Never use `Y.Array` for anything people reorder.
- Views from the read model are frozen and replaced, never mutated.

## Gotchas

- **Rebalancing must be deterministic.** `pos` is last-writer-wins per element, so two replicas rebalancing with different keys could interleave into a new order; `rebalancePositions` uses no jitter.
- **Relative positions do not survive a new `Y.Doc`.** `DocumentJSON` stores them as `o:<offset>`; `materializeDocument` rebuilds them.
- **Undo grouping is ours, not Yjs's.** `Y.UndoManager` runs with an infinite capture timeout and the wrapper calls `stopCapturing()` from an injected clock; tracked origins are a per-session subclass so another session's typing is never undone.
- **Harvest sets counts, it does not increment them** — the harvester is debounced after edits and must be idempotent.
- **A `revDel` embed occupies one Y.Text index.** Offsets in `TextJSON.embeds[].at` are Y.Text indices; `plain` excludes embeds.
- **Changing any hash rule bumps `HASH_VERSION`**; never regenerate `vectors.json` for the same version.
- **Built-in templates are generated.** Edit `osf.ts`, `shared.ts` or the authored modules and regenerate; never hand-edit `builtin/generated`.

## Specs

`~/projects/screenwriter_plans/specs/` — 01 (model), 02 (layout), 08 (commands), 11 §4.2 (content hash). Master registry R1–R31 wins on conflicts.

## Related projects

`writing_formats` · `writing_ui` · `writing_ui_rn` · `screenwriter_types` · `screenwriter_api` · `screenwriter_lib` · `screenwriter_plans`
