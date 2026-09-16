# Unicode Character Database license and provenance

`writing_core` generates its segmentation tables (`src/text/generated/*.generated.ts`,
barrelled as `src/text/ucd.generated.ts`) and vendors several official
conformance test files (`test/ucd/*.txt`) from the **Unicode Character
Database (UCD)**, fetched by `scripts/build-ucd.ts`. Per spec 02 §6: "Data
whose provenance is not recorded is not shippable." This file is that record,
mirroring `fonts/LICENSES.md`'s structure and obligations for the bundled
font binaries — put alongside it (`ucd/` is a sibling of `fonts/` at the repo
root) so a reader looking for third-party licenses finds both in one place.

**Do not re-license, re-badge, or strip the notice below from any
redistributed copy of these data files or of `ucd/UNICODE-LICENSE.txt`.**

## License identification method

The license named below was **not** taken from a secondary source or from
memory (the standard this record is held to, after an earlier finding that
`fonts/LICENSES.md` once mislabeled Caladea's license from exactly that kind
of shortcut). It was read out of the data itself:

1. Every file `scripts/build-ucd.ts` downloads carries this line in its own
   header (verified verbatim in the fetched `GraphemeBreakProperty.txt`,
   `DerivedBidiClass.txt`, and every other source file — reproduced here from
   `GraphemeBreakProperty.txt`):

   ```
   # For terms of use and license, see https://www.unicode.org/terms_of_use.html
   ```

2. That page (`https://www.unicode.org/terms_of_use.html`), fetched directly,
   states: "All Unicode Data Files and Unicode Software are subject to the
   terms and conditions of the free and open-source **Unicode License v3**,
   unless otherwise indicated by specific restriction, permission, or license
   identified at the point of release or in such software, data file, or
   other documentation," and gives the license text's own URL as
   `https://www.unicode.org/license.txt`.
3. That URL's content — fetched directly, not paraphrased — is vendored
   unmodified at `ucd/UNICODE-LICENSE.txt` in this directory. Its own text
   names itself "UNICODE LICENSE V3" and states the copyright as
   "Copyright © 1991-2026 Unicode, Inc."

No source `.txt` file in this pipeline carries a per-file "otherwise
indicated" override, so the Unicode License v3 above applies to all of them.

## Unicode Character Database

- **Data:** Unicode Character Database (UCD)
- **Version:** 16.0.0
- **License:** Unicode License v3 (SPDX `Unicode-3.0`) — full text vendored
  at `ucd/UNICODE-LICENSE.txt`, fetched from `https://www.unicode.org/license.txt`
  per the terms-of-use chain above.
- **Copyright:** Copyright © 1991-2026 Unicode, Inc. (per the vendored
  license text's own notice; individual data files additionally carry
  "© 2024 Unicode®, Inc." for this 16.0.0 release).
- **Source URL base:** `https://www.unicode.org/Public/16.0.0/ucd`
  (property data files under this base and its `auxiliary/`, `extracted/`
  and `emoji/` subdirectories; the two bidi conformance files below are at
  the base itself, not under `auxiliary/`).

### Source files consumed by the generator (`scripts/build-ucd.ts`'s `SOURCES`)

Fetched into `scratch/ucd/` (gitignored — always re-fetched, never read back)
and consumed to emit `src/text/generated/*.generated.ts`. Each generated
file's own header records the same SHA-256 as its source below, so the two
never drift silently.

| Source file | SHA-256 |
| --- | --- |
| `GraphemeBreakProperty.txt` (`auxiliary/`) | `c29360bd6f7132811d701d29069541e827eb44bfc4c8fbde8c370d6982689dc1` |
| `LineBreak.txt` | `e97e4259d0d20fab150b9c7b4b28abfae5cd78ca97e7f4ac6ed20d685d5f4a7c` |
| `DerivedBidiClass.txt` (`extracted/`) | `71ed943a49c58568d8d92e80ecc2ba2f06e62aee9c8ebb0e6e8bd2c3ed8b180e` |
| `Scripts.txt` | `9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039` |
| `DerivedGeneralCategory.txt` (`extracted/`) | `7676ab755a41ef82108460238569e60ad65c191ddafe61b36c6765ec1353f293` |
| `WordBreakProperty.txt` (`auxiliary/`) | `476464e71a4b7b779b8ba7c5671f4338fea77da8e6b6b05fb82b3fdd14603779` |
| `SentenceBreakProperty.txt` (`auxiliary/`) | `20aab5eca3842c7a27cc6756d74488a4a5f744c8dca2948ec1128f26a60d1f79` |
| `emoji-data.txt` (`emoji/`) | `f1365a5173eee18e1f98b240cdc492e84a25f1ce7e0c9d1094eb29c41a22696a` |
| `BidiBrackets.txt` | `b8f32554c6f658821fb0ee742d21c5b1f2086b9bf13071fed04894b022f93d67` |
| `BidiMirroring.txt` | `d7afdadd1bbd66f5a663ac0e8f7958f18fd9491fc0bc59ec5877cb82db71db7d` |
| `DerivedCoreProperties.txt` | `39d35161f2954497f69e08bdb9e701493f476a3d30222de20028feda36c1dabd` |
| `EastAsianWidth.txt` | `43adc76c0686a42cb370764eb8cfe2b2a45b10b855e5572a2db4a0eecce15d5b` |

### Conformance files consumed (`scripts/build-ucd.ts`'s `CONFORMANCE`)

Fetched into `test/ucd/` and committed, per spec 02 §6's "Conformance files"
rule: a generator that fetches data without also fetching the conformance
file for it is incomplete. `BidiTest.txt` and `BidiCharacterTest.txt` were
added in Task 6 fix round 1 to provision Task 8 (bidi, UAX #9); no bidi
algorithm is implemented against them yet.

| Conformance file | Consumed by | SHA-256 |
| --- | --- | --- |
| `GraphemeBreakTest.txt` (`auxiliary/`) | `src/text/grapheme.test.ts` (Task 6) | `ee2b9354d270ac061b29f09662cafea06341d77e704b8cc6bd72aaeeda363cb5` |
| `LineBreakTest.txt` (`auxiliary/`) | `src/text/linebreak.test.ts` (Task 7) | `910759a611a479f37df4f535d2e64d7589be3c5ac5f7491cf1fb4fa4cdb211e9` |
| `BidiTest.txt` | not yet — Task 8 | `93e5eb9d88ca89dcf895f5576486a3363762ad2aa8f2db2fa56fe60cb82b9520` |
| `BidiCharacterTest.txt` | not yet — Task 8 | `d04a51a90052dcd71c4e91ee5b3a9d973ee35c12406b5a99875ac8163c8f2804` |
| `WordBreakTest.txt` (`auxiliary/`) | `src/text/words.test.ts` (Task 9) | `ad985d5721f3fa6b45495663dfe44180f2f68976100dee0ea7451ef1a8f838e8` |
| `SentenceBreakTest.txt` (`auxiliary/`) | `src/text/sentences.test.ts` (Task 9) | `0aef84034ee1789eb71021454fac384e83080b05922272d63cf297f4bf08150e` |

Every SHA-256 above is re-verified against the actually-committed
`test/ucd/*.txt` files (and, for source files, against the corresponding
generated file's own embedded `Source SHA-256:` header) by
`src/text/ucd-licenses.test.ts` on every test run — see that file's comment
for how it fails, for the right reason, if a new source or conformance file
is added to `scripts/build-ucd.ts` without a matching entry above.
