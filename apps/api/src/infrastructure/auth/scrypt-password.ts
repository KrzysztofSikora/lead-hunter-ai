import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PASSWORD_HASH_PATTERN } from '@lead-hunter/config';

export interface ScryptParams {
  /** log2 of the CPU/memory cost N */
  ln: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { ln: 15, r: 8, p: 3 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MIN_MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, { ln, r, p }: ScryptParams): Promise<Buffer> {
  const N = 2 ** ln;
  const options: ScryptOptions = { N, r, p, maxmem: Math.max(MIN_MAXMEM, 256 * N * r) };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Encodes as `scrypt:<ln>:<r>:<p>:<salt>:<key>` (base64url), the format of OPERATOR_PASSWORD_HASH. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return `scrypt:${params.ln}:${params.r}:${params.p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

/** Throws on a malformed `encoded` value: the config validates it at start, so that is a bug. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = PASSWORD_HASH_PATTERN.exec(encoded);
  if (!match) throw new Error('malformed password hash');
  const params = { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  const [, , , , salt = '', key = ''] = encoded.split(':');
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
