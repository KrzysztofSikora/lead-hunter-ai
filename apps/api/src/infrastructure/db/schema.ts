import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
});

export const operatorProfile = sqliteTable(
  'operator_profile',
  {
    id: integer('id').primaryKey(),
    schemaVersion: integer('schema_version').notNull(),
    /** The whole `OperatorProfile` as JSON (D-1). */
    data: text('data', { mode: 'json' }).notNull(),
    isExample: integer('is_example', { mode: 'boolean' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [check('single_row', sql`${table.id} = 1`)],
);
