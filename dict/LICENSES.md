# ICU dictionary license and provenance

`writing_core` compiles four Southeast Asian word-break dictionaries from the ICU source
tree into compact DAWG payloads (`src/text/generated/dict-{th,lo,km,my}.ts`, built by
`scripts/build-dictionaries.ts`) for spec 02 §6.4's dictionary word segmentation. Per spec
02 §6: "Data whose provenance is not recorded is not shippable." This file is that record,
mirroring `ucd/LICENSES.md` and `fonts/LICENSES.md`'s structure and obligations, per §3.1's
licence obligation extended to this data.

**Do not re-license, re-badge, or strip the notices below from any redistributed copy of
these dictionary payloads or of the vendored license texts in this directory.**

## License identification method — and a correction to the task brief

The task brief that commissioned this generator states the ICU break dictionaries are
**Unicode License v3** for all four files. That claim was **not** taken on trust — but the
per-file header inside each of the four `.txt` files is **not** what settles it. All four
carry the same two-line boilerplate pointer
(`# Copyright (C) 2016 and later: Unicode, Inc. and others.` /
`# License & terms of use: http://www.unicode.org/copyright.html`), byte-identical in the
lines that matter for licensing; reading only that pointer would wrongly suggest all four
are covered by the same license. What actually distinguishes them is ICU's own **top-level**
`LICENSE` file (fetched directly from the pinned source tag below, not from memory or from
the brief), which carries a separate "Third-Party Software Licenses" section overriding that
default pointer for specific data files:

- **`thaidict.txt` and `khmerdict.txt`** have **no** dedicated entry in that
  "Third-Party Software Licenses" section — nothing overrides their header's pointer to
  `unicode.org/copyright.html`, whose current terms are the Unicode License v3 (verified:
  ICU's top-level `LICENSE` file's own default grant, the same file just checked for
  overrides, has an operative "Permission is hereby granted, free of charge..." paragraph
  byte-identical to `ucd/UNICODE-LICENSE.txt`, already vendored from
  `https://www.unicode.org/license.txt` and verified there). So for these two files
  **the brief is correct** — Unicode License v3 applies, and `ucd/UNICODE-LICENSE.txt` is
  reused rather than re-vendored, per the task instructions.
- **`laodict.txt`** has a dedicated section, "Lao Word Break Dictionary Data (laodict.txt)",
  quoting a **2-clause BSD-style license**, copyright (C) 2013 Brian Eugene Wilson and
  Robert Martin Campbell (project `github.com/rober42539/lao-dictionary`) — **not** Unicode
  License v3. Vendored verbatim at `dict/ICU-LAO-DICTIONARY-LICENSE.txt`.
- **`burmesedict.txt`** has a dedicated section, "Burmese Word Break Dictionary Data
  (burmesedict.txt)", quoting a **3-clause-BSD-style license** (redistribution clause plus a
  non-endorsement clause), copyright (c) 2013 LeRoy Benjamin Sharon (project
  `github.com/kanyawtech/myanmar-karen-word-lists`) — **not** Unicode License v3. Vendored
  verbatim at `dict/ICU-BURMESE-DICTIONARY-LICENSE.txt`.

**Both third-party licenses are permissive (BSD-family) and compatible with redistribution
inside this package**, so this does not change what is shippable — only what must be
attributed, and the brief's blanket "Unicode License v3" for all four files is wrong and is
flagged in the task 9 report accordingly.

## ICU version and source

- **Source:** `https://github.com/unicode-org/icu`, `icu4c/source/data/brkitr/dictionaries/`
- **Pin:** tag `release-78.3` (an immutable tag, not a moving branch — same reproducibility
  rationale as `fonts/LICENSES.md`'s pinned-commit font sources).
- **ICU `LICENSE` file at this tag:** SHA-256
  `e55522d81edc687a341a4411e0776e54ca654e90147f354a90458aaced4116af` (fetched by
  `scripts/build-dictionaries.ts`, not committed — its two relevant third-party sections are
  vendored standalone below instead).

### Source dictionary files consumed by the generator

Each generated file's own header records the same SHA-256 as its source below (the SHA is
of the fetched response body's decoded text, matching `scripts/build-ucd.ts`'s identical
convention — note this differs from a raw-bytes-on-disk hash whenever a source file carries
a UTF-8 BOM, as all four of these do: `Response.text()` decodes and does not preserve it).

| Source file | License | SHA-256 |
| --- | --- | --- |
| `thaidict.txt` | Unicode License v3 | `06068a50f7cc893fc61992b27911b6a0cee85b34544b8874e53a87f3a55d1b9d` |
| `laodict.txt` | BSD-2-Clause-style (Wilson/Campbell, 2013) | `efbf26586998f196dd017645c81394999f3caec76048b278f966bf4e0b10c9d0` |
| `khmerdict.txt` | Unicode License v3 | `bd11e629d10b72ba3cd4e888cc61359d5da0a924cf9a687bc3785b17b0827dec` |
| `burmesedict.txt` | BSD-3-Clause-style (Sharon, 2013) | `50a3a5cc7402adb7810c3a878249707284e4cce7bab0fd1bf0ec0efe04f5037b` |

### Vendored license texts

- **Unicode License v3** (Thai, Khmer): `ucd/UNICODE-LICENSE.txt` (reused, not duplicated —
  already verified byte-identical to `https://www.unicode.org/license.txt` per
  `ucd/LICENSES.md`).
- **Lao dictionary license:** `dict/ICU-LAO-DICTIONARY-LICENSE.txt` — the exact
  "Lao Word Break Dictionary Data (laodict.txt)" section of ICU's `LICENSE` at the pinned
  tag, SHA-256 `ac417c37e07f4e3a88cf0077a63f72ce024a98b74ade254ddf4c563477ae8aa9`.
- **Burmese dictionary license:** `dict/ICU-BURMESE-DICTIONARY-LICENSE.txt` — the exact
  "Burmese Word Break Dictionary Data (burmesedict.txt)" section of the same file, SHA-256
  `475afb93d39773400e1f10fe1797a5407aa7ff2ca8d4aaeaa970c478975040d6`.

## Compiled DAWG payloads

`scripts/build-dictionaries.ts` compiles each word list into a minimized DAWG (the classic
incremental construction for a sorted word list) and serializes it as a compact columnar
binary, base64-encoded into `src/text/generated/dict-{th,lo,km,my}.ts`, decoded lazily by
`src/text/dict.ts`'s `loadDictionary` — never imported unless a document actually needs
Thai, Lao, Khmer or Myanmar segmentation (spec 02 §6.4's laziness requirement).

### Measured sizes vs. spec 02 §6.4's approximate figures

Spec 02 §6.4 gives approximate gzipped sizes: Thai ≈ 260 KB, Lao ≈ 90 KB, Khmer ≈ 180 KB,
Myanmar ≈ 210 KB. This construction's **actual measured** gzipped sizes of the generated
`.ts` files:

| Language | Words | DAWG nodes | Generated file (raw) | Gzipped | Spec 02 §6.4 estimate |
| --- | --- | --- | --- | --- | --- |
| Thai (`th`) | 26 383 | 17 325 | 201 271 B | 112 252 B | ≈ 260 KB |
| Lao (`lo`) | 30 550 | 24 794 | 265 142 B | 146 125 B | ≈ 90 KB |
| Khmer (`km`) | 81 028 | 67 897 | 1 065 236 B | 459 508 B | ≈ 180 KB |
| Myanmar (`my`) | 41 120 | 44 828 | 425 998 B | 227 081 B | ≈ 210 KB |

Thai lands comfortably under the spec's estimate; Lao, Khmer (most severely) and Myanmar
land over it. A plain minimized-DAWG construction (this generator) does not reach the same
density as ICU's own production break-iterator data (a bytecode trie with linear-match-run
collapsing and other optimizations this generator does not implement). Recorded here as a
factual finding — see the task 9 report — not adjusted to match by excluding data or
weakening the DAWG's correctness guarantee (`scripts/build-dictionaries.ts`'s `verifyDawg`
round-trips every source word through the built automaton before emission).
