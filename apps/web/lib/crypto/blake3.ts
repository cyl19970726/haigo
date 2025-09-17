'use client';

import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Computes a 256-bit BLAKE3 hash for the provided File and returns it as lowercase hex.
 */
export async function hashFileBlake3(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = blake3(new Uint8Array(buffer));
  return bytesToHex(hash);
}
