// One-time codes of authenticator apps (TOTP, RFC 6238), for the tests: the backend tests and the browser check
// answer Supabase Auth's two-step verification with the factor's secret. No dependency: node:crypto only.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (the secret shown when enrolling) → bytes; spaces, padding and case are ignored. */
export function base32Decode(text) {
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.toUpperCase().replace(/[\s=]/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`base32 inválido: "${ch}"`);
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP code (RFC 4226) of a key for a counter. */
export function hotp(key, counter, digits = 6, algorithm = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

/** Code of a base32 secret at a moment (milliseconds; default now), in 30-second steps. */
export function totp(secret, at = Date.now(), { digits = 6, step = 30, algorithm = 'sha1' } = {}) {
  return hotp(base32Decode(secret), Math.floor(at / 1000 / step), digits, algorithm);
}

/**
 * A code that was not handed out before for this secret: waits for the next 30-second step when needed, so two
 * verifications in a row never reuse a code (servers may refuse a code twice).
 */
export async function freshTotp(secret, used = new Set()) {
  for (;;) {
    const code = totp(secret);
    if (!used.has(`${secret}:${code}`)) {
      used.add(`${secret}:${code}`);
      return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
