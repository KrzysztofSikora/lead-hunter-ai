# Plan: data-ownership-backup (S-15)

## Goal and end state
The operator owns their data and can get it back after a failure:

- **FR-21 AC1:** `DELETE /api/opportunities/:id` (and *Usuń okazję* on the card) removes the
  opportunity with its signal, evidence, analyses, drafts, events, payments and dedup
  identities. The month's LLM spend and the daily counters stay as they were (D-1).
- **FR-21 AC2:** `GET /api/export` (link *Eksportuj dane (JSON)* in the *Profil* view) downloads
  one JSON file with profile, sources (no secrets), signals, opportunities, evidence, analyses,
  drafts, events and payments.
- **FR-21 AC3:** every day after the backup, opportunities in `REJECTED` or `EXPIRED` whose last
  change is older than `RETENTION_DAYS` (default 90) are deleted, and the count is logged.
- **FR-22 AC1:** `pnpm backup` (in the container `node apps/api/dist/cli/backup.js`) and the daily
  job at 03:30 Europe/Warsaw write a consistent copy (SQLite online backup) to `BACKUP_DIR`
  (default `DATA_DIR/backups`), then keep the newest `BACKUP_KEEP` (default 14) copies.
- **FR-22 AC2:** the README restore procedure (stop, move the current files aside, copy a backup,
  start) brings the instance up with the restored data and migrations applied. CI runs it in
  `pnpm docker:smoke`, and a vitest test runs backup → new data dir → restore → migrate → read.

## Scope
- In: delete one opportunity (API + card button); JSON export (API + link); retention; backup
  CLI + daily job + rotation; restore procedure in the README, tested in CI; config variables
  and `.env.example`; README section "Kopia zapasowa" replacing the temporary one; the README
  section "Co działa"; the `CLAUDE.md` *Commands* table.
- Out: bulk delete, deleting sources, importing an export, CSV export (FR-30, P1), showing the
  last backup in the UI, catching up a missed daily backup (D-13), off-device backup copies,
  encrypting backups.

## Findings
- Child tables of `opportunities` already cascade (`onDelete: 'cascade'`): `analyses`
  (`apps/api/src/infrastructure/db/schema.ts:189`), `opportunity_evidence` (:233),
  `activity_events` (:253), `signal_identities` (:278), `payments` (:294), `offer_drafts` (:320).
  `foreign_keys = ON` is set on every connection (`infrastructure/db/client.ts:15`).
- `raw_signals` does **not** cascade: `opportunities.primary_signal_id` references it (:145), as
  does `opportunity_evidence.raw_signal_id`. Each opportunity owns exactly one raw signal: a
  duplicate adds evidence that points at the owner's primary signal
  (`modules/signals/ingest.ts:63-66`), a new signal creates a new opportunity (:77-104). So
  delete = delete the opportunity, then its primary signal.
- The monthly cap and daily limits are computed from stored rows:
  `analysis-repository.ts:75-106` (`countSince`, `spentSince` over `analyses` and
  `offer_drafts`), `offer-draft-repository.ts:51-55` (`countSince`). Deleting rows would lower
  month-to-date spend and let the cap be exceeded (lesson "Store every billed provider answer
  with its usage and cost"). → D-1.
- `saveComplete`/`saveFailed` (`analysis-repository.ts:193-298`) and the draft `insert`
  (`offer-draft-repository.ts:24-36`) insert child rows without checking that the opportunity
  still exists; after a delete during a provider call they throw an FK error and the billed
  usage is lost. → D-2.
- `analyses.reused_from_analysis_id` is `ON DELETE SET NULL` (:209). A reused row whose source
  analysis is deleted would then count as a provider call. Reuse finds analyses by the
  opportunity's own content hash (`analysis-repository.ts:107-140`) and the content hash is a
  dedup identity, so the source is in practice the same opportunity and is deleted with it.
  Listed under *Risks*.
- Business statuses `REJECTED`, `EXPIRED` exist (`packages/contracts/src/status.ts:38`); there
  is no "status changed at" column, `opportunities.updated_at` moves on every status change,
  analysis and system move. → D-4.
- Source configs hold no secrets: credentials come from `.env`, and URLs with userinfo are
  refused (`infrastructure/sources/http/address-guard.ts:38`). Sessions, the password hash and
  API keys are not in tables the export reads (sessions are in `sessions`, excluded).
- Scheduler: croner with `timezone: 'Europe/Warsaw'`, `protect: true`, `unref: true`
  (`infrastructure/scheduler/schedule.ts:73-80`); `server.ts:182-226` wires slots and shutdown.
  03:30 is outside the DST hour (02:xx), so it fires exactly once on change days.
- better-sqlite3 `db.backup(destination)` returns a Promise and copies the database with the
  SQLite online backup API in steps, safe while other connections write (better-sqlite3
  `docs/api.md`, "backup"). It is the method `context/tech-stack.md:71-72` names.
- The temporary README section "Kopia zapasowa (tymczasowo, do slice'a S-15)" (`README.md:92`)
  documents cold copies into `data/backups/<date>/`; the new rotation must not delete those
  directories (D-6). `backups/` is gitignored (`.gitignore:19`).
- CLI convention: `apps/api/src/cli/*.ts`, `node --env-file-if-exists=../../.env --conditions=source
  --import tsx` scripts in `apps/api/package.json`, root alias in `package.json`; tests spawn them
  (`apps/api/test/cli.int.test.ts:20-28`).
- The container smoke (`scripts/container-smoke.sh`) already creates a volume, imports one
  `DEMO` text and recreates the container; CI job `image` runs it.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Deleting (by the operator or retention) removes analyses and drafts whose cost the monthly cap and daily limits are summed from. How do limits stay correct? | New table `deleted_usage` (`kind` analysis/offer_draft, `created_at`, `cost_micro_usd` nullable, `counted` 0/1, `unknown_cost` 0/1). The delete transaction copies there every analysis and draft of the current Warsaw month with the same flags `countSince`/`spentSince` use; those queries add the table's sums. No source content, no link to the deleted row. | B: ignore it (simplest; a delete during the month lowers spend and lets the cap be passed, against the lesson on billed answers); C: soft delete (rows stay, hidden; fails AC1 "removed"); D: a full monthly spend ledger written on every call (cleaner long term, rewrites the budget code of S-05/S-07) | Keeps the cap honest with an additive table and two query changes; holds no personal data | costly | agent |
| D-2 | An analysis or draft provider call finishes after its opportunity was deleted. | Inside the save transaction, if the opportunity is gone, write the usage row into `deleted_usage` and drop the result; `saveComplete`/`saveFailed` return quietly, draft `insert` returns `null` and the offer request answers 404. | B: refuse the delete (409) while an analysis or draft runs for it (needs runner state in the delete path; the operator retries); C: cancel the in-flight call on delete (saves money, but the billed part is still lost without A) | The billed answer is recorded whatever happens (lesson); no new coupling between delete and the runner | cheap | lesson |
| D-3 | Are dedup identities deleted with the opportunity? | Yes (they cascade): the same item seen again later comes back as a new opportunity. | B: keep the identities as tombstones so it never returns (stores the URL/hash of deleted data, which the operator asked to remove, and needs a schema change because the FK cascades) | AC1 says removed; the stored identity is itself source data; RSS cursors already prevent most repeats | costly | agent |
| D-4 | Which rows does retention delete, judged by which time? | Opportunities with `business_status IN ('REJECTED','EXPIRED')`, `updated_at < now − RETENTION_DAYS`, and **no payment**; deleted through the same routine as D-1, 500 per transaction. | B: by `created_at` (deletes a row rejected yesterday if it was found 3 months ago); C: by the time of the last status event (one more join, same result in practice); D: include rows with payments (deletes revenue records silently) | `updated_at` is never earlier than the move to the closed status, so nothing is deleted sooner than the operator expects; payments are revenue facts insights read | costly | agent |
| D-5 | When does retention run, and what if the backup failed? | Once a day inside the 03:30 maintenance job, right after the backup; skipped (logged as error) when that backup failed. No separate CLI. | B: its own schedule (one more cron, the delete may precede the day's copy); C: run even when the backup failed (data older than 90 days is in older copies anyway) | Nothing is deleted without a fresh copy; one job, one log place | cheap | agent |
| D-6 | Backup file and rotation. | `BACKUP_DIR/lead-hunter-YYYYMMDDTHHMMSSZ.db` (UTC); written as `….db.partial`, checked with `PRAGMA quick_check` on the copy, then renamed. Rotation sorts only files matching `^lead-hunter-\d{8}T\d{6}Z\.db$` and deletes beyond `BACKUP_KEEP`; leftover `.partial` files of that pattern are removed; anything else in the directory is never touched. | B: `VACUUM INTO` (smaller file, but one long blocking statement on the Pi); C: Warsaw-time names (ambiguous in the DST hour); D: gzip (smaller; restore needs one more step) | Online API is the tech-stack choice; a half-written or corrupt file never counts as a copy; manual cold copies from the old README survive | cheap | agent |
| D-7 | Configuration. | `BACKUP_DIR` (default `${DATA_DIR}/backups`), `BACKUP_KEEP` (1–365, default 14), `RETENTION_DAYS` (7–3650, default 90). The time 03:30 is fixed in code. | B: `BACKUP_TIME` variable (more config to validate against the DST hour; nobody asked) | Roadmap *Decided up front* fixes 03:30, 14 and the directory; the PRD AC asks for a configured directory and count | cheap | prd |
| D-8 | Export shape. | `GET /api/export` → `200 application/json`, `Content-Disposition: attachment; filename="lead-hunter-export-<Warsaw date>.json"`, body `{ format: "lead-hunter-export", version: 1, exportedAt, profile, sources, signals, opportunities, evidence, analyses, offerDrafts, events, payments }`. Rows are the stored columns in camelCase; epoch-ms columns ending in `At` become ISO 8601 UTC strings; `…Json` text columns are parsed and named without the suffix. Sources leave out `cursorJson` and last-error fields. Not exported: sessions, `app_meta`, job runs and locks, `deleted_usage`. Built in memory. | B: a hand-written DTO per table in contracts (stable, about 300 more lines and a second place to update for every column); C: a zip with one file per table (streams, needs a dependency); D: raw epoch numbers (no conversion code; harder to read) | One generic mapping covers every column now and later; one file is what AC2 asks for | costly | agent |
| D-9 | Delete API. | `DELETE /api/opportunities/:id` → `204` or `404 { error: "not_found" }`; no body. | B: `POST /api/opportunities/:id/delete` (matches the POST action style of the card); C: return the counts removed | REST verb for a removal; nothing in the UI needs counts | costly | agent |
| D-10 | Where in the UI? | *Usuń okazję* at the bottom of the card as a two-step inline confirm (*Usuń okazję* → *Tak, usuń na zawsze* / *Anuluj*), then back to *Okazje*; export as a section *Twoje dane* with a download link in *Profil*. | B: `window.confirm` (no styling, awkward to test); C: a new *Dane* view (more nav for one link) | Smallest change, testable with Testing Library, nothing the operator can trigger with one tap | cheap | agent |
| D-11 | Restore mechanism. | Documented file copy: `docker compose stop`, move `data/lead-hunter.db*` to `data/before-restore-<date>/`, copy the chosen backup to `data/lead-hunter.db`, `docker compose start` (migrations run at start). No restore command. | B: `pnpm restore <file>` CLI (must detect a running server across containers; more code to get wrong) | A backup is a plain SQLite file; the steps are short and the CI smoke runs exactly them | cheap | agent |
| D-12 | How is "the backup command" offered? | CLI `pnpm backup` / `node apps/api/dist/cli/backup.js` (prints the file and the removed copies, exit 1 on failure). No HTTP endpoint or button. | B: `POST /api/backup` + button (useful from the phone; a new public route to secure) | AC1 names a command; the daily job covers the normal case | cheap | agent |
| D-13 | The app was off at 03:30. | No catch-up; the next day's job runs (same as discovery slots, S-12). | B: at start, back up when the newest copy is older than 24 h | Consistent with the scheduler; the Pi runs continuously | cheap | agent |

## Design

### Schema (migration `0013_*`, generated by `pnpm --filter @lead-hunter/api db:generate`)
`deleted_usage`: `id integer pk autoincrement`, `kind text not null` (`analysis` | `offer_draft`),
`created_at integer not null` (the original row's time), `cost_micro_usd integer` (nullable),
`counted integer not null` (1 when the row counted toward the daily limit: analyses with no
`reused_from_analysis_id`, every draft), `unknown_cost integer not null` (same CASE as
`spentSince`). Index on `(kind, created_at)`. Additive only.

### Modules
- `apps/api/src/modules/data/ports.ts`: `DataRepository { deleteOpportunity(id, usageSince): boolean;
  deleteClosedBefore(before, usageSince, batch): number; exportAll(): ExportTables }`,
  `BackupStore { write(at: Date): Promise<{ file: string; bytes: number }>; prune(keep: number): string[] }`.
- `apps/api/src/modules/data/service.ts`: `createDataService({ repository, backups, clock,
  backupKeep, retentionDays, logger })` with `deleteOpportunity(id)`, `exportData()` (adds
  `format`, `version`, `exportedAt`, Warsaw date for the file name), `backup()` (write + prune)
  and `runDaily()` (backup, then retention unless the backup failed; logs
  `backup: <file> (<bytes> B), removed <n> old copies` and
  `retention: removed <n> opportunities (REJECTED/EXPIRED, unchanged for <days> days)`).
  `usageSince` = `startOfWarsawMonth(now)`.
- `apps/api/src/modules/data/export-rows.ts`: pure mapping (D-8): `toExportRow(row)`.
- `apps/api/src/modules/data/routes.ts`: `DELETE /api/opportunities/:id`, `GET /api/export`.
- `apps/api/src/infrastructure/db/data-repository.ts`: the transactions (`behavior: 'immediate'`).
  Delete order: copy usage → read `primary_signal_id` → delete opportunity (cascade) → delete the
  raw signal.
- `apps/api/src/infrastructure/backup/sqlite-backup.ts`: `createSqliteBackupStore(sqlite, dir)`.
- `apps/api/src/cli/backup.ts`: opens the DB, migrates, runs `backup()`.
- `packages/contracts/src/data.ts`: `DataExport` (top-level keys typed, rows as
  `z.record(z.string(), z.unknown())`), used as the 200 response schema.
- `packages/config`: `backupDir`, `backupKeep`, `retentionDays` (D-7).
- `infrastructure/scheduler/schedule.ts`: optional `maintenance(): void` callback run by a
  `30 3 * * *` Europe/Warsaw cron with the same `protect`/`catch`/`unref` options.

### Error model
- Delete: unknown id → 404. FK errors cannot happen (cascade + explicit signal delete in one tx).
- Export: errors are 500 like any route; nothing partial is sent (body built first).
- Backup: a failing `backup()`, `quick_check` other than `ok`, or rename → the `.partial` file is
  removed, the error is logged (`backup failed: <message>`), CLI exits 1, retention is skipped.
- Prune errors are logged and do not fail the backup that was written.

## Phases

### Phase 1: Delete an opportunity (API, spend kept)
- Files:
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0013_*.sql` + `meta/`:
    add `deleted_usage` (D-1). Contract: additive table.
  - `apps/api/src/infrastructure/db/data-repository.ts` (new): `deleteOpportunity(id, usageSince)`
    in one immediate transaction. Contract: returns `false` when the id is unknown.
  - `apps/api/src/infrastructure/db/analysis-repository.ts`: `countSince`/`spentSince` add the
    `deleted_usage` sums for their kind(s); `saveComplete`/`saveFailed` write to `deleted_usage`
    when the opportunity is gone (D-2). Contract: same signatures, no throw on a missing row.
  - `apps/api/src/infrastructure/db/offer-draft-repository.ts`, `apps/api/src/modules/offers/ports.ts`,
    `apps/api/src/modules/offers/service.ts`: `countSince` adds `deleted_usage`; `insert` returns
    `number | null` (null = opportunity gone, usage recorded); the service answers `not_found`.
  - `apps/api/src/modules/data/{ports,service,routes}.ts` (new): `deleteOpportunity` and
    `DELETE /api/opportunities/:id` (D-9).
  - `apps/api/src/app.ts`, `apps/api/src/server.ts`: wire `data` deps.
  - `apps/api/test/data-delete.int.test.ts` (new).
- Proves: FR-21 AC1 (integration, TR-21): an opportunity with signal, two evidence rows, a
  completed and a failed analysis, a draft, status and note events, a payment, follow-up and
  identities → `DELETE` 204 → every child table and `raw_signals` empty for it, a second
  opportunity untouched, `GET` 404, a repeat `DELETE` 404. Spend: a billed analysis and draft of
  this month → `spentSince`, `countSince` (both kinds) and the unknown-cost count are equal
  before and after the delete; a row from last month is not copied. D-2: delete between the
  provider call and `saveComplete` (mock provider holding the call) → no throw, no analysis row,
  spend includes the call; same for a draft → 404 and spend kept. Re-import of the same text
  after delete creates a new opportunity (D-3). OpenAPI route test covers the new route.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Export and the UI (delete button, export link)
- Files:
  - `packages/contracts/src/data.ts` (new), `packages/contracts/src/index.ts`: `DataExport`.
  - `apps/api/src/modules/data/export-rows.ts` (new): D-8 mapping; unit test
    `export-rows.test.ts` (epoch → ISO for `…At`, `null` kept, `…Json` parsed, bad JSON kept as the
    raw string under the original key rather than dropped).
  - `apps/api/src/infrastructure/db/data-repository.ts`: `exportAll()` selecting the allowlisted
    tables and columns.
  - `apps/api/src/modules/data/{service,routes}.ts`: `GET /api/export` with the attachment header.
  - `apps/web/src/api/data.ts` (new): `deleteOpportunity(id)`; export URL constant.
  - `apps/web/src/OpportunityPage.tsx` (+ `.module.css`): two-step delete (D-10), then navigate to
    `/okazje`.
  - `apps/web/src/ProfilePage.tsx`: section *Twoje dane* with the download link.
  - `apps/web/src/strings.pl.ts`: the new strings.
  - `apps/api/test/data-export.int.test.ts` (new), `apps/web/src/OpportunityPage.test.tsx` (new or
    extended).
- Proves: FR-21 AC2 (integration): seeded profile, RSS source with cursor, opportunity with all
  child rows → every key present with the seeded rows, ISO times, money as integer minor units,
  no `cursor`/`lastError…` on sources; TR-12: config with `LLM_API_KEY=sk-LEAK-CANARY`, the
  password hash, a logged-in session cookie → the export body contains none of them; header
  `content-disposition` with the Warsaw date (fake clock 2026-10-25T23:30Z → `2026-10-26`);
  unauthenticated → 401. Component test: one click does not delete; confirm calls `DELETE` and
  navigates; cancel restores the button.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: on a phone width, the delete confirm on the card reads clearly and cannot be hit
  by accident; the export link in *Profil* downloads a file that opens as JSON (evidence:
  Playwright screenshots of both states in `evidence/`).

### Phase 3: Backup command and daily job
- Files:
  - `packages/config/src/env.ts` (+ `env.test.ts`), `.env.example`: `BACKUP_DIR`, `BACKUP_KEEP`
    (D-7). Contract: `Config.backupDir` (absolute after resolve), `Config.backupKeep`.
  - `apps/api/src/infrastructure/backup/sqlite-backup.ts` (new): D-6 write/check/rename and prune.
  - `apps/api/src/modules/data/{ports,service}.ts`: `backup()` and `runDaily()` (retention hook
    added in phase 4).
  - `apps/api/src/infrastructure/scheduler/schedule.ts` (+ test): `maintenance` cron at 03:30.
  - `apps/api/src/server.ts`: create the store, pass `maintenance: () => void data.runDaily()`.
  - `apps/api/src/cli/backup.ts` (new), `apps/api/package.json`, `package.json`: `pnpm backup`.
  - `apps/api/test/backup.int.test.ts` (new), `apps/api/test/cli.int.test.ts`.
  - `CLAUDE.md` *Commands*: `pnpm backup`.
- Proves: FR-22 AC1: integration on a file-backed DB: a backup while another connection holds an
  open write transaction and keeps inserting → the copy opens, `quick_check` = ok, it has every
  committed row; 16 copies + a `.partial` + a `2026-10-01-0830/` directory + an unrelated file →
  after backup with keep 14 exactly the 14 newest named copies remain and the directory and file
  are untouched; a failing write (directory not writable) → no `.partial` left, error logged,
  CLI exits 1. Scheduler unit test with fake timers over 2026-10-25 and 2027-03-28: exactly one
  maintenance call per day, at 03:30 Warsaw (01:30Z / 02:30Z). CLI test prints the file name.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: on the Pi, `docker compose exec app node apps/api/dist/cli/backup.js` prints a
  file in `/data/backups` and the file appears in `data/backups/` owned by uid 1000.

### Phase 4: Retention
- Files:
  - `packages/config/src/env.ts` (+ test), `.env.example`: `RETENTION_DAYS` (D-7).
  - `apps/api/src/infrastructure/db/data-repository.ts`: `deleteClosedBefore(before, usageSince,
    batch)` (D-4), reusing the phase 1 delete routine per row.
  - `apps/api/src/modules/data/service.ts`: `runDaily()` runs retention after a successful
    backup and logs the count (D-5).
  - `apps/api/test/retention.int.test.ts` (new).
- Proves: FR-21 AC3: fake clock; rows: REJECTED unchanged 91 days, EXPIRED unchanged 91 days,
  REJECTED unchanged 89 days, NEW unchanged 200 days, REJECTED 91 days with a payment, a
  REJECTED row created 200 days ago but rejected 10 days ago (real status change through the
  pipeline repository, lesson on real links) → exactly the first two deleted with all child rows,
  log line `retention: removed 2 …`; 1 201 eligible rows → all deleted in batches, count 1201;
  failing backup → nothing deleted and an error logged; `RETENTION_DAYS=30` moves the boundary.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 5: Restore procedure, tested in CI
- Files:
  - `README.md`: replace "Kopia zapasowa (tymczasowo…)" with "Kopia zapasowa i przywracanie":
    the daily job, `BACKUP_*`, the command, the restore steps (D-11), copying backups off the Pi;
    update "Aktualizacja" (run the backup command first) and "Co działa" (delete, export,
    retention, backup); "Co wymaga ręcznej weryfikacji": backup and restore on the Pi.
  - `scripts/container-smoke.sh`: step 5: `docker exec … node apps/api/dist/cli/backup.js`, copy
    the newest backup into a fresh volume mounted at `/data` (so it gets the image's ownership),
    start a container on it, log in, the `DEMO smoke` opportunity is listed and health reports
    the migrations; cleanup removes the second volume.
  - `apps/api/test/restore.int.test.ts` (new): backup → new temp data dir → copy as
    `lead-hunter.db` → `openDb` + `runMigrations` → rows equal, applied migration count equals the
    journal.
- Proves: FR-22 AC2 (integration + CI script), TR-20.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm docker:build`,
  `pnpm docker:smoke`.
- Human checks: on the Pi, follow the README restore steps with a copy from `data/backups/`; the
  panel shows the data of that copy and `docker compose ps` is healthy (evidence: command output
  in `evidence/`).

## Risks and unknowns
- A reused analysis whose source analysis lived in another, deleted opportunity loses its
  `reused` marker (`ON DELETE SET NULL`) and then counts as a provider call. Dedup by content
  hash makes this practically impossible (Findings); the error direction is safe (counts more).
- Export is built in memory: with 10 000 `DEMO` signals expect tens of MB. Acceptable on a 4/8 GB
  Pi; if not, stream it ([FOLLOW-UP] then).
- Backups share the SD card with the database; a dead card loses both. The README tells the
  operator to copy `data/backups/` off the Pi; automating that is out of scope.
- `db.backup()` restarts when another connection writes during the copy; on a busy DB a copy can
  take longer, but the 03:30 slot is idle.
- Retention deletes what the operator never looked at again; D-4 keeps rows with payments and
  judges by the last change.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Delete an opportunity (API, spend kept)
- [ ] Phase 2: Export and the UI (delete button, export link)
- [ ] Phase 3: Backup command and daily job
- [ ] Phase 4: Retention
- [ ] Phase 5: Restore procedure, tested in CI

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Plan-review #7 (D-2, draft path): when the opportunity is gone, both the successful and the failed draft path answer `404` (`insert` returns `null`, the service returns `not_found`); asserted for both in `data-delete.int.test.ts`.
- [minor] Plan-review #5: the second evidence row in the phase 1 test comes from a real duplicate import, not a direct insert.
- [minor] Plan-review #10: FK line numbers in *Findings* are off by a few lines (`analyses.opportunity_id` is `schema.ts:194`, evidence 228, events 249, identities 272, payments 288, drafts 312); the code is unaffected.
- [minor] `.gitignore` has `data/`, which hid the new module `apps/api/src/modules/data/`; added the negation `!apps/api/src/modules/data/`.
- [minor] `POST /api/opportunities/:id/payments` answers `200` (not `201`); the phase 1 test asserts what the route does.
- Plan-review majors (answered before implementing, per lesson): #3 phase 2 uses an explicit per-table column allowlist in `data-repository.ts` plus a test comparing `getTableColumns` with allowlist + "not exported" list; #1 phase 3 bounds the writer in the test and passes a large `progress` page count / aborts after bounded restarts; #2 phase 5 restores from a backup of a DB migrated only up to an earlier journal entry and asserts `0013` applies, and the smoke restores in place on the same volume.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
