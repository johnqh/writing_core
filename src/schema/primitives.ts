import { z } from 'zod/v4';
import { type Id, type IdPrefix, type StyleId, isId, isStyleId } from '../ids/ids.js';
import { LOGICAL_FONT_FAMILIES } from './vocab.js';

export const Emu = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Emu = z.infer<typeof Emu>;

export const EmuSigned = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export type EmuSigned = z.infer<typeof EmuSigned>;

export const Lines = z.number().min(0).max(40).multipleOf(0.25);
export type Lines = z.infer<typeof Lines>;

export const HexColor = z.string().regex(/^#[0-9A-F]{6}$/);
export type HexColor = z.infer<typeof HexColor>;

export const I18nKey = z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/);
export type I18nKey = z.infer<typeof I18nKey>;

export const Bcp47 = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export type Bcp47 = z.infer<typeof Bcp47>;

/** Spec 02 §20.2 grammar is enforced from M2; M1 stores the string verbatim. */
export const TokenString = z.string().max(1000);
export type TokenString = z.infer<typeof TokenString>;

export const Timestamp = z.number().int().min(0);
export type Timestamp = z.infer<typeof Timestamp>;

export function idSchema<P extends IdPrefix>(prefix: P) {
  return z.custom<Id<P>>((v) => isId(prefix, v), { message: `expected ${prefix}_ id` });
}

export const StyleIdSchema = z.custom<StyleId>((v) => isStyleId(v), { message: 'expected style id' });

export const FontFamilyId = z.custom<string>(
  (v) =>
    typeof v === 'string' &&
    ((LOGICAL_FONT_FAMILIES as readonly string[]).includes(v) ||
      (v.startsWith('custom:') && isId('asset', v.slice('custom:'.length)))),
  { message: 'expected logical font family or custom:<assetId>' },
);
export type FontFamilyId = z.infer<typeof FontFamilyId>;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
);
