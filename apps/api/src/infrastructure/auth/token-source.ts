import { randomBytes } from 'node:crypto';
import type { TokenSource } from '../../modules/auth/ports.js';

export const randomTokenSource: TokenSource = {
  newToken: () => randomBytes(32).toString('base64url'),
};
