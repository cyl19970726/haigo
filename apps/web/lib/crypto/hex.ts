'use client';

export const normalizeHex = (value: string): string => {
  if (!value) return '';
  return value.startsWith('0x') ? value.slice(2) : value;
};

export const hexToBytes = (value: string): Uint8Array => {
  const normalized = normalizeHex(value);
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('Hash must be a valid hexadecimal string.');
  }
  const pairs = normalized.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
};
