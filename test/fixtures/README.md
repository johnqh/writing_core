# Fixtures

`act-2.doc.json` / `ending-updated.doc.json` — plain `DocumentJSON`, loadable via `materializeDocument`.
M2 task 32, step 1. Converted once, by hand, from the two real screenplay documents spike
S2 (`../../../screenwriter_plans/research/spikes/s2-metrics-pagination.md`) used: `Act 2.fadein`
(`<info pagecount="12"/>`) and `Ending-updated.fadein` (`pagecount="10"`).

`writing_core` has no `.fadein`/OSF **document** importer (that is spec 04 / `writing_formats`, a
later milestone) — only an OSF **template** importer (`src/templates/generator/osf.ts`), which these
two source documents have no need of: spike S2 recorded their `<settings>`/`<styles>` as Letter page,
Courier New 12, the same spacing/indents `screenplayStandard` already encodes at its defaults, so that
built-in template is used as-is. `scripts/build-fixtures.ts` (run by hand, not in CI) reads
`process.env.FADEWRIGHT_FIXTURES_DIR` (default `~/projects/writing`), converts each file's
`<paragraphs><para>` body directly (the only shape spike S2 found either file actually using: no dual
dialogue, no soft returns, no per-paragraph `pageBreakBefore`) and writes the committed JSON here. The
title page (a separate `<titlepage>` in the source XML) is not converted — the golden test in
`src/layout/golden.test.ts` only checks body pagination.

Parenthetical text is restored to include its parentheses (the source XML strips them —
`<text>To Shane</text>`, spike S2's own finding — but this codebase's own convention, and every real
screenplay's own convention, stores them: `'(quietly)'`).

`src/layout/golden.test.ts` reads this committed JSON, never the `.fadein` files, so it runs everywhere
— no env var and no licensed file needed. It is `it.skipIf`-guarded on the file existing anyway, in
case these two are ever removed; regenerate with `FADEWRIGHT_FIXTURES_DIR=... bun scripts/build-fixtures.ts`.

True `.fadein` → layout parity, importer included, belongs to a `writing_formats` golden test in a
later milestone (M3). What this repo's own golden test proves today: `writing_core`'s independently
built layout pipeline reaches the *same total page count* Fade In itself reported for both documents
(12 and 10 — the one invariant that can be checked without a PDF or the original application), and its
own per-page breakdown is pinned so a future change to break placement is visible immediately, not just
whenever a page count happens to shift.
