import { EMU_PER_POINT } from '../units.js';

/**
 * Half-to-even rounding (spec 02 §2). Layout must never use `Math.round`:
 * half-up biases every tie the same direction, and a paginator sums hundreds
 * of rounded advances per line, so the bias accumulates into a real column of
 * drift between two runs split at different points.
 */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Font units → EMU at a given size (spec 02 §2). Integer in, integer out. */
export function emuFromFontUnits(units: number, sizeEmu: number, unitsPerEm: number): number {
  return roundHalfEven((units * sizeEmu) / unitsPerEm);
}

/** Point size (spec 01 stores points) → EMU. */
export function sizeEmuFromPoints(pt: number): number {
  return roundHalfEven(pt * EMU_PER_POINT);
}

/**
 * Bumped by any change that can alter layout output for some input: algorithm,
 * UCD version, dictionaries, default parameters, rounding (spec 02 §36.1).
 */
export const LAYOUT_ENGINE_VERSION = 1;
