import { describe, expect, it } from 'vitest';
import { extractPdfLines, type PageGeometryPt } from '../../scripts/extract-pdf-lines.js';

/**
 * A minimal, hand-built single-page PDF (standard Helvetica, no embedding, no library) with text at
 * known coordinates — this extractor's own real, verifiable test coverage (see the script's own
 * header for why there is no genuine Fade In/Final Draft PDF to run it against instead).
 */
function buildTestPdf(lines: { text: string; x: number; y: number }[]): Uint8Array {
  const content = [
    'BT', '/F1 12 Tf',
    ...lines.map((l) => `1 0 0 1 ${l.x} ${l.y} Tm (${l.text.replace(/([()\\])/g, '\\$1')}) Tj`),
    'ET',
  ].join('\n');

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); // 2
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'); // 3
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 4
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); // 5

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

const GEOMETRY: PageGeometryPt = { heightPt: 792, bodyTopPt: 72, pitchPt: 12 };

describe('extractPdfLines', () => {
  it('groups text items into lines by baseline and buckets x/y', async () => {
    // Two runs sharing one baseline (a heading), and one on a different line 24pt (2 pitches) lower.
    // (pdf.js trims a trailing space at the very end of an unembedded, widthless font's text run —
    // "INT. " comes back as "INT." — a font-metrics quirk of this minimal fixture, not something this
    // extractor's own grouping logic controls; the merge itself, which IS what this asserts, still happens.)
    const pdf = buildTestPdf([
      { text: 'INT. ', x: 72, y: 720 },
      { text: 'KITCHEN', x: 90, y: 720 },
      { text: 'Rain on the window.', x: 72, y: 696 },
    ]);
    const pages = await extractPdfLines(pdf, GEOMETRY);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.label).toBe('1');
    const [first, second] = pages[0]!.lines;
    expect(first!.text).toBe('INT.KITCHEN'); // one merged line, not two separate ones
    expect(second!.text).toBe('Rain on the window.');
    // Line 1's baseline is at PDF y=720: top distance = 792 - 720 - 72 = 0 -> yBucket 0.
    expect(first!.yBucket).toBe(0);
    // Line 2's baseline is 24pt lower (2 pitches of 12pt): yBucket 2.
    expect(second!.yBucket).toBe(2);
    expect(first!.xBucket).toBe(Math.round(72 / (0.05 * 72)));
  });

  it('normalizes whitespace and applies the kind heuristic', async () => {
    const pdf = buildTestPdf([
      { text: '  Extra   spaces  ', x: 72, y: 700 },
      { text: '(MORE)', x: 300, y: 680 },
      { text: 'ALICE (CONT\'D)', x: 200, y: 660 },
      { text: 'CONTINUED:', x: 72, y: 640 },
      { text: 'CONTINUED', x: 500, y: 620 },
    ]);
    const pages = await extractPdfLines(pdf, GEOMETRY);
    const [extra, more, cue, contdTop, contdBottom] = pages[0]!.lines;
    expect(extra!.text).toBe('Extra spaces');
    expect(extra!.kind).toBe('text');
    expect(more!.kind).toBe('more');
    expect(cue!.kind).toBe('contdCue');
    expect(contdTop!.kind).toBe('continuedTop');
    expect(contdBottom!.kind).toBe('continuedBottom');
  });

  it('orders same-baseline items left to right regardless of their order in the content stream, and drops empty lines', async () => {
    const pdf = buildTestPdf([
      { text: 'Second', x: 300, y: 700 }, // appears first in the content stream, but is physically to the right
      { text: 'First', x: 72, y: 700 },
      { text: '', x: 72, y: 650 }, // an empty run: dropped, not a blank line
    ]);
    const pages = await extractPdfLines(pdf, GEOMETRY);
    expect(pages[0]!.lines.map((l) => l.text)).toEqual(['FirstSecond']);
  });
});
