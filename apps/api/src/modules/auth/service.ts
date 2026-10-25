import { createHash } from 'node:crypto';
import type { Clock, PasswordVerifier, SessionRepository, TokenSource } from './ports.js';

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** `last_seen_at` is bumped at most this often, to spare the SD card. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthDeps {
  sessions: SessionRepository;
  /** Absent when no OPERATOR_PASSWORD_HASH is configured: login is then disabled (D-2). */
  verifier?: PasswordVerifier;
  clock: Clock;
  tokens: TokenSource;
}

export type LoginResult =
  { ok: true; token: string } | { ok: false; reason: 'invalid_password' | 'not_configured' };

export type AuthenticateResult = { valid: false } | { valid: true; refreshCookie: boolean };

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createAuthService(deps: AuthDeps) {
  const nowMs = (): number => deps.clock.now().getTime();

  return {
    async login(password: string): Promise<LoginResult> {
      if (!deps.verifier) return { ok: false, reason: 'not_configured' };
      if (!(await deps.verifier.verify(password))) return { ok: false, reason: 'invalid_password' };
      const now = nowMs();
      deps.sessions.deleteIdleSince(now - SESSION_IDLE_MS);
      const token = deps.tokens.newToken();
      deps.sessions.create({ tokenHash: hashToken(token), createdAt: now, lastSeenAt: now });
      return { ok: true, token };
    },

    authenticate(token: string | undefined): AuthenticateResult {
      if (!token) return { valid: false };
      const tokenHash = hashToken(token);
      const row = deps.sessions.find(tokenHash);
      if (!row) return { valid: false };
      const now = nowMs();
      if (now - row.lastSeenAt >= SESSION_IDLE_MS) {
        deps.sessions.delete(tokenHash);
        return { valid: false };
      }
      if (now - row.lastSeenAt >= TOUCH_INTERVAL_MS) {
        deps.sessions.touch(tokenHash, now);
        return { valid: true, refreshCookie: true };
      }
      return { valid: true, refreshCookie: false };
    },

    logout(token: string | undefined): void {
      if (token) deps.sessions.delete(hashToken(token));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
