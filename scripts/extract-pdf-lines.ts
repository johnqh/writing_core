// M2 task 32, step 2 (spec 02 §37.2). Extracts per-page, per-line text + position from a PDF exported
// by Fade In or Final Draft, for comparison against this pipeline's own `getResult`.
//
// Honest limitation: there is no reference PDF anywhere in this environment to run this against (no
// licensed Fade In/Final Draft install, and this repo produces none itself — PDF export is
// `screenwriter_api`'s job, a sibling repo, not `writing_core`'s). `extract-pdf-lines.test.ts` proves
// the extractor's own line-grouping/bucketing/kind-heuristic logic against a minimal, hand-built PDF
// (a handful of raw `Tj` text-showing operators at known coordinates — no PDF-writing library needed
// for that), so this is real, working, tested code; it has simply never been run against a genuine
// Fade In/Final Draft export, because none exists here to run it against.
import { readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedLine {
  yBucket: number;
  xBucket: number;
  text: string;
  kind: 'text' | 'more' | 'contdCue' | 'continuedTop' | 'continuedBottom';
}

export interface ExtractedPage {
  label: string;
  lines: ExtractedLine[];
}

export interface PageGeometryPt {
  /** Page height, PDF points (1/72 in). */
  heightPt: number;
  /** Distance from the page's top edge to the first body line's baseline-adjacent top, PDF points. */
  bodyTopPt: number;
  /** Line pitch, PDF points (`72 / linesPerInch`). */
  pitchPt: number;
}

const XBUCKET_PT = 0.05 * 72; // 0.05 in

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function kindOf(text: string): ExtractedLine['kind'] {
  const t = text.trim();
  if (t === '(MORE)' || t.endsWith('(MORE)')) return 'more';
  // A PDF's own font substitution can turn a straight apostrophe into a typographic one (observed
  // from `extract-pdf-lines.test.ts`'s own minimal fixture); match either.
  if (/\(CONT[’']D\)\s*$/.test(t)) return 'contdCue';
  if (/^CONTINUED:/.test(t)) return 'continuedTop';
  if (/^CONTINUED\b/.test(t) && /^CONTINUED:/.test(t) === false) return 'continuedBottom';
  return 'text';
}

interface TextItem { str: string; transform: number[] }

/**
 * Groups raw text items into lines by baseline (±1pt) — items on one line are NOT assumed to already
 * arrive in left-to-right order (a PDF content stream may emit them in any order; `str.sort` below is
 * what makes this method-independent), so each group's own members are sorted by `x` before joining.
 */
function groupLines(items: readonly TextItem[]): { baseline: number; x: number; text: string }[] {
  const groups: { baseline: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const baseline = item.transform[5] as number;
    const x = item.transform[4] as number;
    const existing = groups.find((g) => Math.abs(g.baseline - baseline) <= 1);
    if (existing) existing.parts.push({ x, str: item.str });
    else groups.push({ baseline, parts: [{ x, str: item.str }] });
  }
  return groups.map((g) => {
    const parts = [...g.parts].sort((a, b) => a.x - b.x);
    return { baseline: g.baseline, x: parts[0]!.x, text: parts.map((p) => p.str).join('') };
  });
}

export async function extractPdfLines(pdfBytes: Uint8Array, geometry: PageGeometryPt): Promise<ExtractedPage[]> {
  const doc = await getDocument({ data: pdfBytes }).promise;
  const pages: ExtractedPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const raw = groupLines(content.items as unknown as TextItem[]);
    raw.sort((a, b) => b.baseline - a.baseline || a.x - b.x); // top to bottom, then left to right
    const lines: ExtractedLine[] = raw.map((l) => {
      const text = normalize(l.text);
      const topDistance = geometry.heightPt - l.baseline - geometry.bodyTopPt;
      return {
        yBucket: Math.round(topDistance / geometry.pitchPt),
        xBucket: Math.round(l.x / XBUCKET_PT),
        text, kind: kindOf(text),
      };
    }).filter((l) => l.text.length > 0);
    pages.push({ label: String(p), lines });
  }
  return pages;
}

// CLI: `bun scripts/extract-pdf-lines.ts <pdf> <out.json> [heightPt] [bodyTopPt] [pitchPt]`.
if (import.meta.main) {
  const [pdfPath, outPath, heightPt, bodyTopPt, pitchPt] = process.argv.slice(2);
  if (!pdfPath || !outPath) {
    console.error('usage: extract-pdf-lines.ts <pdf> <out.json> [heightPt=792] [bodyTopPt=72] [pitchPt=12]');
    process.exit(1);
  }
  const geometry: PageGeometryPt = { heightPt: Number(heightPt ?? 792), bodyTopPt: Number(bodyTopPt ?? 72), pitchPt: Number(pitchPt ?? 12) };
  const pages = await extractPdfLines(readFileSync(pdfPath), geometry);
  writeFileSync(outPath, `${JSON.stringify(pages, null, 2)}\n`);
  console.log(`wrote ${outPath}: ${pages.length} pages`);
}
