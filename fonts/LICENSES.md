# Bundled font licenses

`writing_core` redistributes unmodified, open-source font binaries so layout,
rendering and PDF embedding always agree on metrics. This file records the
source, version and SHA-256 of every binary under `fonts/src/`, per spec 02
§3.1. The OFL/Apache license text is shipped with every distribution (spec 02
§3.1); this file is the per-family obligations record, not the license text
itself — see `fonts/src/*/OFL.txt` (vendored alongside each family once
added) for the full text.

**Do not sell the fonts standalone. Do not use a Reserved Font Name for a
modified version — we distribute unmodified binaries; subsetting for PDF
embedding is permitted by OFL §2, since a per-PDF subset is not a "Modified
Version" distributed standalone.**

## Reproducibility of the download step (Task 4)

Every source below is fetched from a URL pinned to an immutable git commit
(not a branch or tag ref that can move), except Liberation, which has no
prebuilt-TTF release on GitHub (2.x ships only FontForge `.sfd` sources in
its own repo) and is instead vendored from a specific, versioned Ubuntu
archive package — `archive.ubuntu.com`'s pool paths do not change contents
once published, and the recorded SHA-256 of each extracted `.ttf` is the
ultimate reproducibility check regardless: `bun run fonts:generate` fails
`src/fonts/budget.test.ts`'s cross-check (below) if any vendored binary's
hash ever drifts from what is recorded here.

- **Google Fonts** (`github.com/google/fonts`), commit
  `1ac2012c34919f5fa2675aacf723fa98edb30b5f` (`ofl/` directory) — Carlito,
  Caladea, Gelasio, Noto Serif, Noto Sans, Noto Sans Mono, Noto Sans/Serif
  Thai, Noto Sans/Serif Hebrew, Noto Naskh Arabic, the eight bundled Indic
  families, Noto Sans Symbols 2, Noto Sans Math, Noto Emoji.
- **Noto CJK** (`github.com/googlefonts/noto-cjk`) — Sans at tag `Sans2.004`
  (commit `523d033d6cb47f4a80c58a35753646f5c3608a78`), Serif at tag
  `Serif2.003` (commit `9b0f1436e455d902de067a2501422e5dc71ad16b`).
- **Liberation** (`archive.ubuntu.com/ubuntu/pool/main/f/fonts-liberation2/`)
  — package `fonts-liberation2_2.1.5-1_all.deb`, itself Debian/Ubuntu's
  FontForge build of upstream `liberation-fonts` release `2.1.5`
  (`github.com/liberationfonts/liberation-fonts`, tag `2.1.5`).

### Variable-font instancing

Gelasio, Noto Serif, Noto Sans, Noto Sans Mono, Noto Sans/Serif Thai, Noto
Sans/Serif Hebrew, Noto Naskh Arabic, the eight Indic families and Noto Emoji
ship from Google Fonts only as `wght`-variable binaries (no static build).
The **vendored file in `fonts/src/` is the unmodified variable font**
exactly as downloaded (its SHA-256 below is of that file, unchanged); the
generator (`scripts/build-font-metrics.ts`) reads two in-memory instances
from it per weight needed (400 for regular/italic, 700 for bold/bolditalic)
purely to extract metrics — no derived binary is ever written to disk or
shipped. This is within OFL §2 the same way PDF subsetting is (§3.1 above):
no "Modified Version" of the font software is distributed, only numbers read
out of the original, unmodified file.

## Courier Prime

- **Family:** Courier Prime (Regular, Bold, Italic, Bold Italic)
- **Version:** 3.018
- **License:** SIL Open Font License, Version 1.1
- **Designer:** Alan Dague-Greene (Quote-Unquote Apps)
- **Copyright:** Copyright 2015 The Courier Prime Project Authors
  (https://github.com/quoteunquoteapps/CourierPrime)
- **Source:** https://github.com/google/fonts/tree/main/ofl/courierprime
  (Google Fonts mirror, `main` branch, fetched 2026-09-15)
- **SHA-256** (`shasum -a 256 fonts/src/*.ttf`):
  - `CourierPrime-Regular.ttf`: `72f793376f8e2841656bf21d77a5de010f2929bd6956a22ee848ad0c7eb978af`
  - `CourierPrime-Bold.ttf`: `ff1f38786c849d1c41fa8e447960abdb2bd75fdfb0cfcdeb524fad65a5af3638`
  - `CourierPrime-Italic.ttf`: `f1b9a5829789f7e56432a9f3bc7665ef4531dbba1c112639e48bef39621a006b`
  - `CourierPrime-BoldItalic.ttf`: `3355273f3ea6d6362658f9564f4e83d59e156cf1a182e3c1592b5c5943627dcc`

The SHA-256 above is the value stored in each face's `.fwm` header
(`sourceSha256Prefix`, spec 02 §4.2) and the identity a renderer must match
per spec 02 §4.5's renderer obligation.

## Liberation Mono / Liberation Serif / Liberation Sans

- **Family:** Liberation Mono, Liberation Serif, Liberation Sans (each
  Regular, Bold, Italic, Bold Italic)
- **Version:** 2.1.5
- **License:** SIL Open Font License, Version 1.1 (Liberation 2.x)
- **Copyright:** Copyright 2012 Red Hat, Inc.
- **Source:** `fonts-liberation2_2.1.5-1_all.deb`,
  https://archive.ubuntu.com/ubuntu/pool/main/f/fonts-liberation2/fonts-liberation2_2.1.5-1_all.deb
  (Ubuntu archive; Debian/Ubuntu's FontForge-built binaries of upstream
  `liberationfonts/liberation-fonts` release `2.1.5`, which ships only `.sfd`
  sources on GitHub, no prebuilt TTF release)
- **SHA-256** (of the extracted `.ttf`, matching `.fwm`'s `sourceSha256Prefix`):
  - `LiberationMono-Regular.ttf`: `6b3809450cf6253b36d157198dc15004a5fbade9abad5543c377feb7bb29139c`
  - `LiberationMono-Bold.ttf`: `29534b0aad22fa386843365da6f04102df8d6a076e06a2a5ce270f83dd1bf351`
  - `LiberationMono-Italic.ttf`: `b35c3fc2f2d607782bcac01367f419a4a36d0fc48b2115ce6d17498343c3086e`
  - `LiberationMono-BoldItalic.ttf`: `f9f61b3d7f06f2f3f79faa961d77395cf35ade72cdec8521d7e60397194774da`
  - `LiberationSerif-Regular.ttf`: `29d12439831b7f59194efec85872f24f54eff05738933f9a860220d2abff88ba`
  - `LiberationSerif-Bold.ttf`: `446a4421f297698427170fd7db20e59169a4188baaaf940e9bea58af6341a723`
  - `LiberationSerif-Italic.ttf`: `c1830c433ab41379f1139fac388989d37c9f08c81e1bd643efdcc7946db30753`
  - `LiberationSerif-BoldItalic.ttf`: `36dd6965be8915f6d7efb259757f1f7546a7c6f72c53a20bbe4ae7092f2cd558`
  - `LiberationSans-Regular.ttf`: `8d91388f1d3604b3b8ae0e3ee2d140e50cd6122f9214514f4aca772540a4076d`
  - `LiberationSans-Bold.ttf`: `ba0e0dc3f7aca5b0afbc31e800531ee43be3aa79ae35b2ef1f6470a9547765c4`
  - `LiberationSans-Italic.ttf`: `01f559e5c501d3d5777647c6a92b3ff37a4523bcf4f3b6e97ae052af567618b1`
  - `LiberationSans-BoldItalic.ttf`: `15c1068175252e4adee6d3721bf74064ffe437f679d9dbaeacd03fa7711a041b`

## Carlito

- **Family:** Carlito (Regular, Bold, Italic, Bold Italic)
- **Version:** 1.104
- **License:** SIL Open Font License, Version 1.1
- **Copyright:** Copyright 2010-2012 Google Corporation; Copyright 2010-2012
  tyPoland Lukasz Dziedzic (Carlito font, http://www.typoland.com/)
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`, `ofl/carlito/`)
- **SHA-256:**
  - `Carlito-Regular.ttf`: `f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595`
  - `Carlito-Bold.ttf`: `bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db`
  - `Carlito-Italic.ttf`: `0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c`
  - `Carlito-BoldItalic.ttf`: `b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517`

## Caladea

- **Family:** Caladea (Regular, Bold, Italic, Bold Italic)
- **Version:** 1.001
- **License:** Apache License, Version 2.0
- **Copyright:** Copyright 2012 Google Inc.; Copyright 2012 Huerta Tipográfica
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`, `ofl/caladea/`)
- **SHA-256:**
  - `Caladea-Regular.ttf`: `f1e899278b7b4491aba5b6a8253c4b04c050cc59b21865be5c37559a775153cd`
  - `Caladea-Bold.ttf`: `ae3cb2dcbc925809dd29d2a44e9802211cab66be541bacbfc9c08c74b27c3742`
  - `Caladea-Italic.ttf`: `4359a8e24f748b6447b1ff6d7a174febe70961d29f8bb8634b56dacd740a3deb`
  - `Caladea-BoldItalic.ttf`: `ccabaa7b7e2fdf253d2b1a5fa699dd8a3df8d835a9eb285ad82631a677eb76c0`

## Gelasio

- **Family:** Gelasio (Regular, Bold, Italic, Bold Italic — instanced from
  two `wght`-variable files, see "Variable-font instancing" above)
- **Version:** 1.008
- **License:** SIL Open Font License, Version 1.1
- **Copyright:** Copyright 2017 The Gelasio Project Authors
  (https://github.com/googlefonts/gelasio)
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`, `ofl/gelasio/`)
- **SHA-256** (of the two vendored variable-font files):
  - `Gelasio[wght].ttf` (Regular + Bold instances): `4daecea457258c9ebeb8bc99ed3fd24353618bfad3ea4b93fa0b5d0468fc04e4`
  - `Gelasio-Italic[wght].ttf` (Italic + Bold Italic instances): `52559e845a4d33514e5f93bb9ae7dbeae1894a53f2c565a15f18af40cd337c09`

## Noto Serif / Noto Sans / Noto Sans Mono

- **Family:** Noto Serif, Noto Sans (Regular, Bold, Italic, Bold Italic —
  instanced), Noto Sans Mono (Regular, Bold only — no italic published)
- **Version:** Noto Serif 2.015, Noto Sans 2.015, Noto Sans Mono 2.014
- **License:** SIL Open Font License, Version 1.1
- **Copyright:** Copyright 2014-2021 Adobe (for Source Serif/Sans-derived
  glyphs) and The Noto Project Authors (https://github.com/notofonts)
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`)
- **SHA-256:**
  - `NotoSerif[wdth,wght].ttf` (`ofl/notoserif/`): `4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713`
  - `NotoSerif-Italic[wdth,wght].ttf`: `e87acbc6c0efd0d9a20d6a8cbbda2b266c14be3a3a6f5af8ec9d7b2460570ad1`
  - `NotoSans[wdth,wght].ttf` (`ofl/notosans/`): `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`
  - `NotoSans-Italic[wdth,wght].ttf`: `58e6e0ebd1931b29a365aa2d3e2ee9a9e831a3af7cf3ad1462d4e72154f0b291`
  - `NotoSansMono[wdth,wght].ttf` (`ofl/notosansmono/`): `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081`

## Noto Sans CJK / Noto Serif CJK (SC, TC, JP, KR)

- **Family:** Noto Sans CJK SC/TC/JP/KR, Noto Serif CJK SC/TC/JP/KR (each
  Regular, Bold)
- **Version:** Noto Sans CJK 2.004, Noto Serif CJK 2.003
- **License:** SIL Open Font License, Version 1.1
- **Copyright:** Copyright 2014-2021 Adobe (Source Han Sans/Serif) and The
  Noto Project Authors
- **Source:** https://github.com/googlefonts/noto-cjk — Sans at tag
  `Sans2.004` (commit `523d033d6cb47f4a80c58a35753646f5c3608a78`), Serif at
  tag `Serif2.003` (commit `9b0f1436e455d902de067a2501422e5dc71ad16b`). Each
  weight ships as one OTC (OpenType Collection) covering all regions —
  vendored whole rather than as four ~17 MB single-region OTFs per weight.
- **SHA-256** (of the vendored `.ttc`; all four regions of a weight share
  one file and therefore one hash):
  - `NotoSansCJK-Regular.ttc` (`Sans/OTC/`): `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`
  - `NotoSansCJK-Bold.ttc`: `faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb`
  - `NotoSerifCJK-Regular.ttc` (`Serif/OTC/`): `5d9c31a059600193c9d7968a998bde886ccdc77e934006ad243b41794c496a7d`
  - `NotoSerifCJK-Bold.ttc`: `1505ee3b9c0890fae6302ee0e9c6fd74d690f4a55a6ace1d9944f3f6352d622d`

Astral-plane CJK Extension B+ ideographs (U+20000 and above) are excluded
from the generated `.fwm` coverage tables to stay inside spec §4.4's per-face
budget (`scripts/build-font-metrics.ts`'s `ASTRAL_CJK_LIMIT`); the BMP CJK
Unified block (U+4E00–U+9FFF) and Extension A (U+3400–U+4DBF) are fully
covered. A document using an astral-plane historical ideograph falls through
to the symbols/math/emoji/tofu tail of the fallback chain (§3.3) rather than
this face.

## Noto Sans Thai / Noto Serif Thai

- **Version:** Noto Sans Thai 2.002, Noto Serif Thai 2.002
- **License:** SIL Open Font License, Version 1.1
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`)
- **SHA-256:**
  - `NotoSansThai[wdth,wght].ttf` (`ofl/notosansthai/`): `5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8`
  - `NotoSerifThai[wdth,wght].ttf` (`ofl/notoserifthai/`): `34a7ad11647c845303aabdde639059806c56b84719e5d2ceb28eb038711bdf53`

## Noto Sans Hebrew / Noto Serif Hebrew

- **Version:** Noto Sans Hebrew 3.001, Noto Serif Hebrew 2.004
- **License:** SIL Open Font License, Version 1.1
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`)
- **SHA-256:**
  - `NotoSansHebrew[wdth,wght].ttf` (`ofl/notosanshebrew/`): `7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88`
  - `NotoSerifHebrew[wdth,wght].ttf` (`ofl/notoserifhebrew/`): `93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165`

Note: the vendored `NotoSansHebrew[wdth,wght].ttf`'s legacy family name
(nameID 1) is "Noto Sans Hebrew Thin" (its default named instance is Thin,
not Regular); the generator reads the typographic family name (nameID 16,
"Noto Sans Hebrew") instead, so this bundle's face/family slug is unaffected
(`noto-sans-hebrew:regular`/`:bold`, not `noto-sans-hebrew-thin:*`).

## Noto Naskh Arabic

- **Version:** 2.021
- **License:** SIL Open Font License, Version 1.1
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`, `ofl/notonaskharabic/`)
- **SHA-256:** `NotoNaskhArabic[wght].ttf`: `67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f`

Only Noto Naskh Arabic is bundled (not the Noto Sans Arabic alternate spec 02
§3.1's own table also lists), per the brief's Step 1 list verbatim.

## Noto Sans Devanagari / Bengali / Tamil / Telugu / Gujarati / Gurmukhi / Kannada / Malayalam

- **License:** SIL Open Font License, Version 1.1
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`)
- **SHA-256:**
  - `NotoSansDevanagari[wdth,wght].ttf` (v2.007, `ofl/notosansdevanagari/`): `14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e`
  - `NotoSansBengali[wdth,wght].ttf` (v3.011, `ofl/notosansbengali/`): `dcd42978094e584a849c84a51450eeac40c8826057d566ea6d4b9627a403a05a`
  - `NotoSansTamil[wdth,wght].ttf` (v2.004, `ofl/notosanstamil/`): `aa3a9b321f4b0bb2c40203ffbde9af89713227866e0e13f76e5b9eeea727cf88`
  - `NotoSansTelugu[wdth,wght].ttf` (v2.005, `ofl/notosanstelugu/`): `e618af7bf999df192ed4f388eba2e563f2b5015034e9cbb317b5bd793bd7334d`
  - `NotoSansGujarati[wdth,wght].ttf` (v2.106, `ofl/notosansgujarati/`): `9901d8552f1dd5d2c50dbd4caa6f6e174e74e8264f06594ab259ae6e7b1ac428`
  - `NotoSansGurmukhi[wdth,wght].ttf` (v2.004, `ofl/notosansgurmukhi/`): `1e6f728fa620e566f842d81e220265813faa12771214765d289c98e035adc5f2`
  - `NotoSansKannada[wdth,wght].ttf` (v2.006, `ofl/notosanskannada/`): `cca4f3b3a8cb12fb261f1b43baf5d2f7f59d90fe123d41f0065ed3a183997ec9`
  - `NotoSansMalayalam[wdth,wght].ttf` (v2.104, `ofl/notosansmalayalam/`): `312e0e7c3cc15fa09eb42a8f749eeb246b593ed420e3c81aafe8d910c3a6fb56`

## Noto Sans Symbols 2 / Noto Sans Math / Noto Emoji

- **Version:** Noto Sans Symbols 2 v2.008, Noto Sans Math v3.000, Noto Emoji v3.002
- **License:** SIL Open Font License, Version 1.1
- **Source:** https://github.com/google/fonts (commit `1ac2012c34919f5fa2675aacf723fa98edb30b5f`)
- **SHA-256:**
  - `NotoSansSymbols2-Regular.ttf` (`ofl/notosanssymbols2/`): `7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21`
  - `NotoSansMath-Regular.ttf` (`ofl/notosansmath/`): `3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d`
  - `NotoEmoji[wght].ttf` (`ofl/notoemoji/`, Regular instance only — this
    bundle ships no Emoji Bold face; metrics only, drawing font is Noto
    Color Emoji per spec §3.1/§3.4, not part of this package): `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`

Every SHA-256 above is the value stored in the corresponding face(s)'
`.fwm` header (`sourceSha256Prefix`, spec 02 §4.2) — `src/fonts/budget.test.ts`
cross-checks each one against the generated `FACES` table on every test run.
