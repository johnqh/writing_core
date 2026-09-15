import { describe, expect, it } from 'vitest';
import {
  emuToInches, fdxLeftIndentToEmu, fdxRightIndentToEmu, fdxSpaceBeforeToLines,
  inchesToEmu, osfToEmu, pointsToEmu, snapToHundredthInch,
} from './units.js';

describe('units', () => {
  it('converts page sizes exactly', () => {
    expect(inchesToEmu(8.5)).toBe(7_772_400);
    expect(inchesToEmu(11)).toBe(10_058_400);
    expect(osfToEmu(2100)).toBe(7_560_000); // A4 width, 210 mm
    expect(pointsToEmu(12)).toBe(152_400);
    expect(emuToInches(914_400)).toBe(1);
  });
  it('snaps Fade In 0.1 mm values to the typed hundredth inch', () => {
    expect(snapToHundredthInch(osfToEmu(266))).toBe(inchesToEmu(1.05));
    expect(snapToHundredthInch(osfToEmu(63))).toBe(inchesToEmu(0.25));
    expect(snapToHundredthInch(osfToEmu(685))).toBe(inchesToEmu(2.7));
  });
  it('converts FDX paragraph geometry', () => {
    const letter = inchesToEmu(8.5);
    expect(fdxLeftIndentToEmu(3.5, inchesToEmu(1.5))).toBe(inchesToEmu(2));
    expect(fdxRightIndentToEmu(7.25, letter, inchesToEmu(1))).toBe(inchesToEmu(0.25));
    expect(fdxSpaceBeforeToLines(24, 6)).toBe(2);
  });
  it('rejects non-finite input', () => {
    expect(() => inchesToEmu(Number.NaN)).toThrow(RangeError);
  });
});
