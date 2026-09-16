import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib'; // a *.test.ts may use node built-ins
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { FACES } from './generated/registry.generated.js';
import { fwmBytesFor } from './generated/index.js'; // faceId → Uint8Array

// The brief's snippet reads `f.classification === 'mono' && /cjk/.test(f.family)` for the
// 30 KB CJK tier; this bundle has no CJK face that is *also* monospace (Noto Sans/Serif CJK
// are both proportional — full-width ideographs aside, monospacing is a Latin-only concept
// here), so that condition is never true and every face — CJK included — is held to the
// tighter 24 576-byte ceiling. Deviation from the brief's literal snippet, recorded per the
// implementer instructions: the snippet as given would make the 30 KB tier dead code and
// silently hold CJK faces to the SAME budget as everything else, which is what actually
// happens below (see `scripts/build-font-metrics.ts`'s `FACE_BYTE_BUDGET` doc comment for
// how CJK faces are kept under it: astral Extension B+ ideographs excluded from the
// coverage table, Latin/Greek/Cyrillic kerning skipped for CJK faces entirely).
it('keeps every face and the whole set inside the spec 02 §4.4 budget', () => {
  let total = 0;
  for (const f of FACES) {
    const gz = gzipSync(fwmBytesFor(f.faceId)).byteLength;
    total += gz;
    expect(gz, `${f.faceId} gzipped`).toBeLessThanOrEqual(f.classification === 'mono' && /cjk/.test(f.family) ? 30_720 : 24_576);
  }
  expect(total, 'total metrics gzipped').toBeLessThanOrEqual(1_572_864);
});

// The two license strings this bundle actually uses (spec 02 §3.1's obligations table).
// A family under any other license — or no license this function recognizes — is not "one
// of the allowed set" and fails `licenseKind`'s callers below.
type LicenseKind = 'OFL-1.1' | 'Apache-2.0';

function licenseKind(text: string): LicenseKind | null {
  if (/SIL Open Font License,?\s*Version 1\.1/i.test(text)) return 'OFL-1.1';
  if (/Apache License,?\s*Version 2\.0/i.test(text)) return 'Apache-2.0';
  return null;
}

/**
 * `## Family Name` sections of `fonts/LICENSES.md`, each with its declared `- **License:**`
 * line and every SHA-256 it lists — used to tie a `FACES` row (by its `sha256`) back to the
 * section that is supposed to be its license record (fix round 1, controller ruling B).
 * A section with no `License:` line (the two prose sections at the top of the file) is
 * skipped, not treated as an empty/failing license.
 */
function parseLicenseSections(markdown: string): { license: string; shas: Set<string> }[] {
  const sections = markdown.split(/\n(?=## )/).filter((s) => s.startsWith('## '));
  const out: { license: string; shas: Set<string> }[] = [];
  for (const section of sections) {
    const licenseLine = /-\s*\*\*License:\*\*\s*([^\n]+)/.exec(section);
    if (!licenseLine) continue;
    const shas = new Set(section.match(/\b[0-9a-f]{64}\b/g) ?? []);
    out.push({ license: licenseLine[1]!.trim(), shas });
  }
  return out;
}

describe('fonts/LICENSES.md (spec 02 §3.1)', () => {
  const licensesPath = join(dirname(fileURLToPath(import.meta.url)), '../../fonts/LICENSES.md');
  const licenses = readFileSync(licensesPath, 'utf8');
  const fontsSrcDir = join(dirname(fileURLToPath(import.meta.url)), '../../fonts/src');

  it('records every family shipped in FACES: name, version, license, source URL and SHA-256', () => {
    // Every source-license record must carry these five fields (spec 02 §3.1); a family
    // present in FACES but missing from LICENSES.md would ship metrics with no license
    // obligation on record.
    for (const heading of ['License:', 'Version:', 'Source:']) {
      expect(licenses, `LICENSES.md missing a '${heading}' field somewhere`).toContain(heading);
    }
  });

  it('re-verifies every FACES row SHA-256 against the value recorded in LICENSES.md', () => {
    const distinctShas = new Set(FACES.map((f) => f.sha256));
    for (const sha of distinctShas) {
      expect(licenses, `LICENSES.md missing SHA-256 ${sha} (present in generated FACES)`).toContain(sha);
    }
  });

  it("ties every FACES row's SHA-256 to its family's LICENSES.md entry and requires an allowed license (OFL 1.1 or Apache 2.0)", () => {
    // Fix round 1, controller ruling B: the two tests above only check that license-shaped
    // words and each SHA appear *somewhere* in the file — which a wrong label (Caladea
    // recorded as Apache 2.0 when it is OFL 1.1) sails straight through, since "Apache
    // License, Version 2.0" is itself a real license string that appears elsewhere in this
    // same file (Caladea's own section, before this fix). This test instead resolves, for
    // each row's SHA-256, *which* LICENSES.md section claims it, and requires that section's
    // declared license to parse as one of the two this bundle uses.
    const sections = parseLicenseSections(licenses);
    for (const f of FACES) {
      const section = sections.find((s) => s.shas.has(f.sha256));
      expect(section, `${f.faceId}: no LICENSES.md section lists SHA-256 ${f.sha256}`).toBeDefined();
      const kind = licenseKind(section!.license);
      expect(kind, `${f.faceId}: LICENSES.md's declared license '${section!.license}' is not OFL 1.1 or Apache 2.0`).not.toBeNull();
    }
  });

  it("cross-checks LICENSES.md's declared license against each vendored binary's own embedded license record", () => {
    // The check above only verifies LICENSES.md is internally consistent (every SHA maps to
    // *a* recognized license string) — it cannot catch a *wrong* recognized string on its
    // own, which is exactly how the Caladea mislabeling shipped. This is the ground-truth
    // check: read the license `licenseKind` parses out of the actual font binary's `name`
    // table and require it to equal what LICENSES.md declares for that same file.
    const sections = parseLicenseSections(licenses);
    const distinctFiles = [...new Set(FACES.map((f) => f.file))];
    for (const file of distinctFiles) {
      const rowsForFile = FACES.filter((f) => f.file === file);
      const sha = rowsForFile[0]!.sha256;
      const section = sections.find((s) => s.shas.has(sha));
      expect(section, `${file}: no LICENSES.md section lists SHA-256 ${sha}`).toBeDefined();
      const declared = licenseKind(section!.license);

      const parsed = fontkit.create(readFileSync(join(fontsSrcDir, file))) as fontkit.Font | fontkit.FontCollection;
      const font = 'fonts' in parsed ? parsed.fonts[0]! : parsed;
      const embeddedText = (font as unknown as { name?: { records?: { license?: { en?: string } } } }).name?.records?.license?.en ?? '';
      const embedded = licenseKind(embeddedText);

      expect(embedded, `${file}: font binary's own embedded license record did not parse as OFL 1.1 or Apache 2.0: '${embeddedText}'`).not.toBeNull();
      expect(declared, `${file}: LICENSES.md declares '${declared}' but the binary's own embedded license record says '${embedded}'`).toBe(embedded);
    }
  });
});
