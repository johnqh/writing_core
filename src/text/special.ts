/**
 * Special-character layout, spec 02 §7.4 (task 10): tab stops, and the width rule for every
 * character/embed kind §7.4's table gives a non-default layout behaviour for. Soft return
 * (U+000A inside `Y.Text`) isn't handled here — it's a mandatory break, the itemizer's concern
 * (a later task), not a measured glyph.
 *
 * **`specialCharWidth`'s unit and second parameter (a decision, flagged in the task 10 report).**
 * The brief names the parameter `faceMetrics`, and this module takes it literally as
 * `FontFaceMetrics` (spec 02 §4.3, `../layout/types.js`) rather than `fonts/fwm.js`'s
 * already-EMU `AdvanceTable` cache — the brief's signature has no `sizeEmu` parameter, and
 * `FontFaceMetrics.advance(cp)` already returns **font units**, not EMU, matching that. This
 * makes `specialCharWidth` a drop-in replacement for `metrics.advance(cp)` wherever a caller
 * (a later task's `advanceOf` closure passed to `advanceTableFor`, `fonts/fwm.ts`) wants special
 * characters folded into the same measurement path rather than special-cased around it: instead
 * of `(cp) => emuFromFontUnits(metrics.advance(cp), sizeEmu, metrics.unitsPerEm)`, that closure
 * becomes `(cp) => emuFromFontUnits(specialCharWidth(cp, metrics), sizeEmu, metrics.unitsPerEm)`.
 * `specialCharWidth` itself never touches EMU or a size, so it stays that one line away from
 * both fitting into the cache and working before one exists.
 */
import type { FontFaceMetrics } from '../layout/types.js';
import type { Embed } from '../schema/text.js';

/** Spec 02 §7.4: tab stops fall every 0.5 in from the paragraph's left text edge. */
export const TAB_STOP_EMU = 457_200;

/** U+200B ZERO WIDTH SPACE — zero-width break opportunity (spec 02 §7.4). */
const ZWSP = 0x200b;
/** U+00A0 NO-BREAK SPACE — space width, no break (spec 02 §7.4). */
const NBSP = 0x00a0;
/** U+0020 SPACE — what NBSP borrows its width from. */
const SPACE = 0x0020;

/**
 * "Control characters other than [tab, soft return, …]" (spec 02 §7.4's last row): not rendered,
 * zero width. This is the exact byte set this repo's own tooling refuses to write literally into
 * source (see any task's "no control bytes" constraint) — 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F. Tab
 * (0x09) and LF (0x0A, the soft-return code unit) are excluded: both get their own §7.4 rows and
 * neither is "not rendered, zero width" — a tab has real advance and LF is a break, not a glyph.
 * CR (0x0D) is excluded for the same reason as LF: `Y.Text` uses `\n` (LB4/LB5's `LF`) for the
 * soft return per spec 01 §5.5, but a stray CR reaching this far is still a line-structural
 * character, not an ordinary control byte, and §7.4 doesn't separately list it — left to the
 * sanitizer spec 01 already requires on import rather than special-cased here.
 */
function isSanitizedControl(cp: number): boolean {
  return (cp >= 0x00 && cp <= 0x08) || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f);
}

/**
 * Width, in **font units** (see header comment), of `cp` at `faceMetrics`'s scale. Handles
 * spec 02 §7.4's per-code-point special cases (NBSP borrows the space glyph's width; ZWSP and
 * the sanitized control range are zero); every other code point falls through to
 * `faceMetrics.advance(cp)` unchanged, so this is safe to call unconditionally rather than only
 * for characters known in advance to be special. Task 10 brief's exact interface.
 */
export function specialCharWidth(cp: number, faceMetrics: FontFaceMetrics): number {
  if (cp === NBSP) return faceMetrics.advance(SPACE);
  if (cp === ZWSP) return 0;
  if (isSanitizedControl(cp)) return 0;
  return faceMetrics.advance(cp);
}

/**
 * Tab stop configuration for `tabAdvance` (spec 02 §7.4). `positions`, when given and
 * non-empty, are a template's own explicit stops — EMU offsets from `textLeft`, ascending; a
 * gap past the last one falls back to the plain `TAB_STOP_EMU` grid continuing from wherever the
 * explicit stops left off. `minAdvanceEmu` is "minimum advance = one space width": normally the
 * space glyph's advance (in EMU, at the paragraph's face/size) at the tab's position.
 */
export interface TabStops {
  readonly positions?: readonly number[];
  readonly minAdvanceEmu: number;
}

/**
 * The pen x position (EMU) after a tab starting at `x`, where `textLeft` is the paragraph's left
 * text edge that stops are measured from (spec 02 §7.4). Task 10 brief's exact interface.
 *
 * Advances to the next tab stop strictly after the current position (so a tab pressed exactly on
 * a stop still moves — standard tab semantics), then enforces the "minimum advance = one space
 * width" floor: if the natural next stop is closer than `stops.minAdvanceEmu`, the tab instead
 * advances by exactly `minAdvanceEmu`, landing short of (not snapping past) that stop. This is
 * the degenerate case only — a tab stop at 0.5 in intervals is normally far wider than one space,
 * so the floor is a no-op for ordinary tabs and only bites when the pen is already very close to
 * the next stop.
 */
export function tabAdvance(x: number, textLeft: number, stops: TabStops): number {
  const rel = Math.max(0, x - textLeft);
  const custom = stops.positions;
  let nextRel: number | undefined = custom?.find((p) => p > rel);
  if (nextRel === undefined) nextRel = (Math.floor(rel / TAB_STOP_EMU) + 1) * TAB_STOP_EMU;
  const target = textLeft + nextRel;
  const minTarget = x + Math.max(0, stops.minAdvanceEmu);
  return Math.max(target, minTarget);
}

/** `embedWidth`'s result: the box a `revDel`/`image` embed occupies (EMU), spec 02 §7.4. */
export interface EmbedSize {
  widthEmu: number;
  heightEmu: number;
}

/**
 * Width/height, in EMU, of a `revDel` or inline-image embed (spec 01 §5.5 `Embed`; spec 02
 * §7.4). Not part of the brief's literal 5-name interface list (`specialCharWidth` is
 * code-point-keyed and an embed is not a code point — flagged in the task 10 report) but the
 * same table row's other two rules, so it lives beside them rather than being invented ad hoc by
 * a later task.
 *
 * - `revDel`: zero width and zero height — "not drawn as text; produces a margin mark" (§25.5,
 *   a later task's concern).
 * - `image`: width clamps to `min(embed.widthEmu, lineWidthEmu)`, height scales proportionally
 *   to that clamp, then rounds **up** to whole `pitchEmu` multiples (never zero — an embed
 *   occupies at least one line pitch, per "unsplittable").
 */
export function embedWidth(embed: Embed, lineWidthEmu: number, pitchEmu: number): EmbedSize {
  if (embed.type === 'revDel') return { widthEmu: 0, heightEmu: 0 };
  const widthEmu = Math.min(embed.widthEmu, lineWidthEmu);
  const scaledHeight = embed.widthEmu > 0 ? embed.heightEmu * (widthEmu / embed.widthEmu) : embed.heightEmu;
  const pitches = Math.max(1, Math.ceil(scaledHeight / pitchEmu));
  return { widthEmu, heightEmu: pitches * pitchEmu };
}
