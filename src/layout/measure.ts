/**
 * Measurement, spec 02 §4.3 / §5.1. `layoutAdvance` is the one door every advance goes through;
 * nothing on the measurement path calls `face.advance()` directly.
 */
import { FONT_ALIASES } from '../fonts/aliases.js';
import { advanceTableFor } from '../fonts/fwm.js';
import type { FontFamilyId } from '../schema/primitives.js';
import { graphemeClusters } from '../text/grapheme.js';
import { upperCaseWithMap } from '../text/casing.js';
import { isZeroWidthSpecial } from '../text/special.js';
import { generalCategory } from '../text/ucd.generated.js';
import { iso15924, type Item } from './itemize.js';
import { emuFromFontUnits, roundHalfEven } from './round.js';
import type { FontFaceMetrics, FontRegistry, LayoutDiagnostic, Shaper } from './types.js';

const COURIER_FAMILIES: ReadonlySet<string> = new Set([
  'courier-screenplay',
  'courier-new',
  ...Object.entries(FONT_ALIASES).filter(([name]) => name.includes('courier')).map(([, id]) => id),
]);

/** True for `courier-screenplay`, `courier-new` and any family the §3.2 alias table maps a Courier name to. */
export function isCourierFamily(familyId: FontFamilyId): boolean {
  return COURIER_FAMILIES.has(familyId);
}

/**
 * The 10 cpi ruling (spec 02 §3.2, V-02-7): every monospaced Courier family lays out at exactly
 * `roundHalfEven(sizeEmu x 3 / 5)` per glyph (91 440 EMU at 12 pt) whatever its own advance says.
 * Proportional families keep their true metrics.
 */
export function layoutAdvance(face: FontFaceMetrics, familyId: FontFamilyId, cp: number, sizeEmu: number): number {
  if (isCourierFamily(familyId) && face.monospace) return roundHalfEven((sizeEmu * 3) / 5);
  return emuFromFontUnits(face.advance(cp), sizeEmu, face.unitsPerEm);
}

const SPACE = 0x20;
const NBSP = 0xa0;

/** `layoutAdvance` plus §7.4's per-code-point specials (ZWSP/controls zero, NBSP = space width). */
export function measuredAdvance(face: FontFaceMetrics, familyId: FontFamilyId, cp: number, sizeEmu: number): number {
  if (isZeroWidthSpecial(cp)) return 0;
  return layoutAdvance(face, familyId, cp === NBSP ? SPACE : cp, sizeEmu);
}

export interface MeasuredItem {
  item: Item;
  /** The text that was measured: `item.text`, uppercased when `item.smallCaps`. */
  text: string;
  /** UTF-16 offset (into `text`) of each cluster start. */
  clusters: Uint32Array;
  /** EMU advance per cluster (kerning to the next cluster is not included; it is in `width`). */
  clusterAdvances: Int32Array;
  /** Per-cluster UTF-16 offset into `item.text` (identity unless small caps expanded the text). */
  clusterSource: Uint32Array;
  width: number;
  /** Set when a tier-2 item was measured by summation because no shaper was supplied. */
  approximateShaping: boolean;
  diagnostics: LayoutDiagnostic[];
}

function isNonSpacing(cp: number): boolean {
  const gc = generalCategory(cp);
  return gc === 'Mn' || gc === 'Me' || gc === 'Cf';
}

function measureTier1(item: Item, text: string): { clusters: Uint32Array; advances: Int32Array; width: number } {
  const { face, familyId, sizeEmu } = item;
  const table = advanceTableFor(face, sizeEmu, familyId, (cp) => measuredAdvance(face, familyId, cp, sizeEmu));
  const noKern = isCourierFamily(familyId) && face.monospace;
  const starts = graphemeClusters(text);
  const advances = new Int32Array(starts.length);
  let width = 0;
  let prevBase = -1;
  for (let c = 0; c < starts.length; c++) {
    const cs = starts[c] as number;
    const ce = c + 1 < starts.length ? (starts[c + 1] as number) : text.length;
    const base = text.codePointAt(cs) as number;
    let adv = table.get(base);
    for (let i = cs + (base > 0xffff ? 2 : 1); i < ce; ) {
      const cp = text.codePointAt(i) as number;
      i += cp > 0xffff ? 2 : 1;
      if (!isNonSpacing(cp)) adv += table.get(cp);
    }
    if (!noKern && prevBase >= 0) {
      const k = face.kern(prevBase, base);
      if (k !== 0) adv += emuFromFontUnits(k, sizeEmu, face.unitsPerEm);
    }
    advances[c] = adv;
    width += adv;
    prevBase = base;
  }
  return { clusters: Uint32Array.from(starts), advances, width };
}

function measureTier2(item: Item, text: string, shaper: Shaper): { clusters: Uint32Array; advances: Int32Array; width: number } {
  const shaped = shaper.shape({
    faceId: item.face.faceId, text, script: iso15924(item.script), direction: item.bidiLevel % 2 === 1 ? 'rtl' : 'ltr',
    language: item.lang, sizeEmu: item.sizeEmu,
  });
  // Aggregate glyph advances by cluster offset.
  const byCluster = new Map<number, number>();
  let width = 0;
  for (let g = 0; g < shaped.glyphIds.length; g++) {
    const cl = shaped.clusters[g] as number;
    const adv = shaped.advancesEmu[g] as number;
    byCluster.set(cl, (byCluster.get(cl) ?? 0) + adv);
    width += adv;
  }
  const offsets = [...byCluster.keys()].sort((a, b) => a - b);
  return {
    clusters: Uint32Array.from(offsets),
    advances: Int32Array.from(offsets.map((o) => byCluster.get(o) as number)),
    width,
  };
}

export function measureItem(item: Item, _fonts: FontRegistry, shaper: Shaper | null): MeasuredItem {
  let text = item.text;
  let source: Uint32Array | null = null;
  if (item.smallCaps) {
    const up = upperCaseWithMap(item.text, item.lang);
    text = up.display;
    source = up.clusterSource;
  }
  const diagnostics: LayoutDiagnostic[] = [];
  let approximateShaping = false;
  let r: { clusters: Uint32Array; advances: Int32Array; width: number };
  if (item.tier === 2 && shaper) {
    r = measureTier2(item, text, shaper);
  } else {
    if (item.tier === 2) {
      approximateShaping = true;
      diagnostics.push({ code: 'approximateShaping', elementId: null, pageIndex: null, detail: { script: item.script } });
    }
    r = measureTier1(item, text);
  }
  const clusterSource = source && source.length === r.clusters.length ? source : Uint32Array.from(r.clusters);
  return {
    item, text, clusters: r.clusters, clusterAdvances: r.advances, clusterSource, width: r.width, approximateShaping, diagnostics,
  };
}
