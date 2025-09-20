'use client';

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Computes keccak256 hash for the provided File and returns lowercase hex string.
 */
export async function hashFileKeccak256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = keccak_256(new Uint8Array(buffer));
  return bytesToHex(hash);
}
