import { describe, expect, it } from 'vitest';
import { base32Decode, totp } from '../scripts/lib/totp.mjs';

// RFC 6238, appendix B (SHA-1, key "12345678901234567890"), codes of 8 digits and their last 6
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('códigos de aplicativo autenticador (TOTP) usados nos testes', () => {
  it('base32 do segredo', () => {
    expect(new TextDecoder().decode(base32Decode(SECRET))).toBe('12345678901234567890');
    expect(new TextDecoder().decode(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'))).toBe('12345678901234567890');
    expect(() => base32Decode('1@')).toThrow(/base32/);
  });
  it('vetores de teste da RFC 6238', () => {
    for (const [t, code] of VECTORS) {
      expect(totp(SECRET, t * 1000, { digits: 8 })).toBe(code);
      expect(totp(SECRET, t * 1000)).toBe(code.slice(2));
    }
  });
});
