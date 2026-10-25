export interface StoredRow {
  /** The profile document as stored; validated by the service on read. */
  data: unknown;
  isExample: boolean;
  /** UTC epoch ms */
  updatedAt: number;
  schemaVersion: number;
}

export interface ProfileRepository {
  get(): StoredRow | undefined;
  insertIfMissing(row: StoredRow): void;
  upsert(row: StoredRow): void;
}
