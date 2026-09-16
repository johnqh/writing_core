/**
 * Thin, hand-written accessor over the generator's `FACE_BYTES` output (spec 02 §4.1). Not
 * itself regenerated — `face-bytes.generated.ts` and `registry.generated.ts` are the
 * generated artifacts; this module just gives `fwmBytesFor` (used by `budget.test.ts` and
 * anything else that wants a face's raw `.fwm` bytes) a stable import path independent of
 * the generated file's internal shape.
 */
import { FACE_BYTES } from './face-bytes.generated.js';

export function fwmBytesFor(faceId: string): Uint8Array {
  const bytes = FACE_BYTES[faceId];
  if (!bytes) throw new Error(`fonts/generated: no .fwm bytes for ${faceId}`);
  return bytes;
}
