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

## Later families (Task 4)

Liberation Mono/Serif/Sans, Carlito, Caladea, Gelasio and the Noto families
listed in spec 02 §3.1 are added in Task 4 of this milestone, which will
extend this table with the same fields (name, version, license, source URL,
SHA-256).
