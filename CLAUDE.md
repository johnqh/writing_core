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

## Commands

- `bun install`
- `bun run verify` — typecheck + lint + test + build; run before every commit
- `bun run test` — Vitest, tests co-located as `src/**/*.test.ts`; guard tests in `src/__guards/`
- `bun run build` — emit `dist/`

## Structure

- `src/index.ts` — single sectioned export surface; consumers import only the package root
- `src/__guards/` — platform-free guard (and later architecture / single-source guards)

## Rules

- **Platform-free.** No DOM, `window`, `navigator`, `import.meta`, `process.env`, `Buffer`, `Bun`, `node:` imports or `require` in shipping code. The guard test enforces it, because this package runs in browsers, Hermes and Bun and a host-specific call fails only on the host nobody tried. `tsconfig.json` deliberately has no DOM lib.
- **Units are EMU** (914 400/in, 12 700/pt), integers only (registry R2).
- **IDs are prefixed ULIDs** (registry R1).
- **Closed vocabularies** are `const X = [...] as const` with the type derived; labels are `Record<T, i18nKey>`.

## Specs

`~/projects/screenwriter_plans/specs/` — 01 (model), 02 (layout), 08 (commands), 11 §4.2 (content hash). Master registry R1–R31 wins on conflicts.

## Related projects

`writing_formats` · `writing_ui` · `writing_ui_rn` · `screenwriter_types` · `screenwriter_api` · `screenwriter_lib` · `screenwriter_plans`
