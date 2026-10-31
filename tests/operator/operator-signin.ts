import { createHmac } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';

/** The authenticator code for the current 30 second window, or for a window `offset` steps away. */
export function totp(secret: string, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offsetByte = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offsetByte) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

/**
 * Sign-in and two-factor requests are limited to 5 per minute and earlier suites sign in from the
 * same test address (KI-01). Start with empty counters in the local browser test database only.
 */
export async function clearSignInLimits(ownerPassword: string) {
  const limits = new Pool({
    host: '127.0.0.1',
    port: 54329,
    database: 'corridra_browser',
    user: 'postgres',
    password: ownerPassword,
  });
  try {
    await limits.query('DELETE FROM identity."rateLimit"');
  } finally {
    await limits.end();
  }
}
