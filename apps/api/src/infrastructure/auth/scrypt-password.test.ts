import { PASSWORD_HASH_PATTERN } from '@lead-hunter/config';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './scrypt-password.js';

const FAST = { ln: 10, r: 8, p: 1 };

describe('scrypt password hash (TR-13)', () => {
  it('verifies the password it was made from', async () => {
    const hash = await hashPassword('correct horse battery', FAST);
    expect(hash).toMatch(PASSWORD_HASH_PATTERN);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery', FAST);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('reads the cost parameters from the stored string', async () => {
    const hash = await hashPassword('another password 1', { ln: 11, r: 4, p: 2 });
    expect(hash.startsWith('scrypt:11:4:2:')).toBe(true);
    expect(await verifyPassword('another password 1', hash)).toBe(true);
  });

  it('salts: two hashes of the same password differ', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password 12', FAST),
      hashPassword('same password 12', FAST),
    ]);
    expect(a).not.toBe(b);
  });

  it('throws on a malformed hash', async () => {
    await expect(verifyPassword('x', 'placeholder')).rejects.toThrow(/malformed/);
  });
});
