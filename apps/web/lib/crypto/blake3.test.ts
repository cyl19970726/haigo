import { TextEncoder } from 'util';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { hashFileBlake3 } from './blake3';

const encoder = new TextEncoder();

describe('hashFileBlake3', () => {
  it('produces a 64-character lowercase hex BLAKE3 hash', async () => {
    const contents = 'haigo-network';
    const file = new File([encoder.encode(contents)], 'network.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => encoder.encode(contents).buffer
    });

    const result = await hashFileBlake3(file);
    const expected = bytesToHex(blake3(encoder.encode(contents)));

    expect(result).toHaveLength(64);
    expect(result).toBe(expected);
  });
});
