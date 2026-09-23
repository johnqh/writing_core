# Golden corpus

M2 task 32, step 3/4. `<case>/fadewright.layout.json` is this pipeline's own committed snapshot (the
compact form `src/layout/golden-snapshot.ts` defines) of `GOLDEN_CASES` (`src/layout/golden-cases.ts`)
— a small, real, working subset of spec 02 §37.2's rule-case catalogue: five cases exercising five
distinct rules end to end (`more-contd-split`, `scene-continued`, `keep-heading-chain`,
`dual-dialogue-basic`, `break-on-sentences`), each built from real elements and laid out through the
real pipeline, not the spec's full ~20-case list authored in licensed Fade In 5 / Final Draft 13 (no
such install exists in this environment — see `docs/verification/V-02.md`).

`src/layout/golden-cases.test.ts` compares each case's fresh `layoutDocument()` output against its
committed snapshot here, `it.skipIf`-guarded per case (green on a checkout missing one, meaningful once
it exists) plus a non-skippable guard that every declared case actually has a snapshot, so the suite
can never silently assert nothing.

Regenerate after an intentional change to break placement:

```
bun run golden:update
```

Review the diff before committing — an unreviewed regeneration defeats the whole point of a
regression snapshot — and bump `LAYOUT_ENGINE_VERSION` if the change is genuinely output-affecting
rather than a fix to how the case itself is built.

What the spec's own fuller shape (`test/golden/<case>/{fadein.fadein, finaldraft.fdx, fadein.pdf,
finaldraft.pdf, fadein.lines.json, finaldraft.lines.json}` plus a `bun run golden:report` HTML diff
viewer) would add, once real Fade In/Final Draft exports exist to compare against: those files, and a
report overlaying this pipeline's own rendered page on the reference PDF with mismatched lines
highlighted. `scripts/extract-pdf-lines.ts` already produces the `*.lines.json` shape from any PDF
(tested against a minimal hand-built one, `src/layout/extract-pdf-lines.test.ts`); the comparison and
report are not built, since there is nothing here to compare or report on yet.
