export const EMU_PER_INCH = 914_400;
export const EMU_PER_CM = 360_000;
export const EMU_PER_POINT = 12_700;
export const EMU_PER_OSF_UNIT = 3_600; // OSF lengths are 0.1 mm
export const EMU_PER_HUNDREDTH_INCH = 9_144;

function finite(n: number, what: string): number {
  if (!Number.isFinite(n)) throw new RangeError(`${what} must be finite, got ${n}`);
  return n;
}

export function inchesToEmu(inches: number): number {
  return Math.round(finite(inches, 'inches') * EMU_PER_INCH);
}

export function emuToInches(emu: number): number {
  return finite(emu, 'emu') / EMU_PER_INCH;
}

export function pointsToEmu(pt: number): number {
  return Math.round(finite(pt, 'points') * EMU_PER_POINT);
}

export function osfToEmu(value: number): number {
  return Math.round(finite(value, 'osf length')) * EMU_PER_OSF_UNIT;
}

/** Built-in templates only (spec 01 §1.1): recover the hundredth inch the author typed. */
export function snapToHundredthInch(emu: number): number {
  return Math.round(finite(emu, 'emu') / EMU_PER_HUNDREDTH_INCH) * EMU_PER_HUNDREDTH_INCH;
}

export function fdxLeftIndentToEmu(inchesFromEdge: number, marginLeft: number): number {
  return inchesToEmu(inchesFromEdge) - marginLeft;
}

export function fdxRightIndentToEmu(inchesFromEdge: number, pageWidth: number, marginRight: number): number {
  return pageWidth - marginRight - inchesToEmu(inchesFromEdge);
}

export function fdxSpaceBeforeToLines(pt: number, linesPerInch: number): number {
  return finite(pt, 'points') / (72 / finite(linesPerInch, 'linesPerInch'));
}
