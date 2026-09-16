# fonts/

Source font binaries and the generated `.fwm` metrics tables for Fadewright's
bundled font families (spec 02 §3, §4).

## Layout

- `fonts/src/` — original font binaries (`.ttf`/`.otf`) as downloaded from
  their upstream source. **Not shipped in `dist`** — these are the generator's
  input only, kept in the repo (and in CI) so `bun run fonts:generate` is
  reproducible, but `package.json`'s `files` field never includes them and the
  npm-published package does not contain this directory.
- `fonts/LICENSES.md` — per-family name, version, license, source URL and
  SHA-256 for every binary under `fonts/src/`.
- `src/fonts/generated/*.fwm.ts` — the generated `.fwm` metrics tables (spec
  02 §4.2), one module per face, plus `registry.generated.ts` (the `FACES`
  list, spec 02 §4.1). **These are what ships**: small, binary-derived
  metrics, not the font files themselves.

## Regenerating

```
bun run fonts:generate
```

reads every font under `fonts/src/`, and for each face writes
`src/fonts/generated/<family>-<style>.fwm.ts` (the encoded `.fwm` bytes) and
regenerates `src/fonts/generated/registry.generated.ts`. Output is committed;
CI regenerates and fails on any difference, so the committed tables always
match the shipped binaries' SHA-256.

## Renderer obligation (spec 02 §4.5)

Every renderer (`writing_ui`, `writing_ui_rn`, the PDF writer) must draw text
with the **same font file** the metrics were generated from, verified by the
SHA-256 prefix stored in each face's `.fwm` header
(`FontFaceMetrics` does not expose the SHA directly; the source of truth is
`FACES[i].sha256` in `registry.generated.ts`, cross-checked against the
low 8 bytes encoded in the `.fwm` header). A renderer that substitutes a
different build of "the same" font family — even a different version of
Courier Prime — can produce different glyph advances than the metrics this
package shipped, which would break the determinism invariant (spec 02 §1.1):
two collaborators viewing the same document must compute the same pagination
regardless of which renderer drew it.
