export interface SessionRow {
  tokenHash: string;
  /** UTC epoch ms */
  createdAt: number;
  /** UTC epoch ms */
  lastSeenAt: number;
}

export interface SessionRepository {
  create(row: SessionRow): void;
  find(tokenHash: string): SessionRow | undefined;
  touch(tokenHash: string, at: number): void;
  delete(tokenHash: string): void;
  deleteIdleSince(cutoff: number): void;
}

export interface PasswordVerifier {
  verify(password: string): Promise<boolean>;
}

export type { Clock } from '../shared/clock.js';

export interface TokenSource {
  newToken(): string;
}
