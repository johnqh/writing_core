import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  return sha256(typeof input === 'string' ? utf8ToBytes(input) : input);
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(input));
}
