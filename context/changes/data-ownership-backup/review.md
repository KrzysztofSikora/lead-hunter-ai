# Review: data-ownership-backup

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (83 files, 1117 tests), image not run (environment: no Docker daemon in this sandbox), image smoke not run (needs the image), e2e not run (environment: Playwright Chromium not installed), mutation n/a (S-15 is not a mutation target) · Round: 3

Re-review after the second `/fix-review` (commits `7bfdb9f`, `795a8a9`).

- R5 is fixed as described: `deleteClosedBefore` now also skips a row with an `offer_drafts` row whose `updated_at >= before`. Both write paths set that column (`insert` sets `createdAt`/`updatedAt` to `at`; `update` sets `updatedAt: at`, including status moves from `act`). A `FAILED` draft also keeps the row, which is the conservative side of D-4. The new test (`retention.int.test.ts`, "keeps a closed row an offer draft was generated for within the period") goes through `POST /api/opportunities/:id/offer-drafts` one day earlier and asserts that only the drafted row survives. That is the round-2 probe turned into a test. The plan's *Risks* line now names offer drafts.
- I checked the other tables that point to `opportunities`. `payments` is already excluded. `analyses` writes move `opportunities.updated_at` (`analysis-repository.ts:75`, `:189`, `:281`, `:298`). `opportunity_evidence`/`signal_identities` hold source merges. `insertEvidence` (`signal-repository.ts:67`) does not move `updated_at`, but it is source input, not operator input, so D-4's "sooner than the operator expects" does not cover it. Nothing else writes per-opportunity operator data, so the R1 lesson is now met.
- R2 is still deferred (`[FOLLOW-UP]` in *Deviations*); it is minor. No new findings this round.

Round 2 notes (kept for history):

Re-review after `/fix-review` (commits `eccd401`, `66796f8`, `18fa4c3`, `5fa91c0`).

- R1 is fixed as described: the retention query now skips rows with a `NOTE` or `WORK` event at or after `before`, and the new test covers a note added yesterday.
- R4 is fixed: `cli/backup.ts` no longer imports `runMigrations`, and it exits 1 with `brak bazy` when the database file is missing (new CLI test).
- R3 is fixed: the *Risks* line is in `plan.md`.
- R2 is deferred with a `[FOLLOW-UP]` in *Deviations*.

Extra check this round: a throwaway vitest probe, removed afterwards and not committed. It took an opportunity `REJECTED` 100 days ago, generated an offer draft for it one day ago (`201`), then ran `runDaily()`. Result: `removed 1`, so the opportunity and its new draft are gone (R5).

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0013_old_pride.sql`, `meta/*` | done | `deleted_usage` plus its index; additive |
| `apps/api/src/infrastructure/db/data-repository.ts` | done | Delete, retention and export. Round 2 adds the `NOTE`/`WORK` guard (R1), round 3 the offer-draft guard (R5) |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | Sums from `deleted_usage`; D-2 paths |
| `apps/api/src/infrastructure/db/offer-draft-repository.ts`, `modules/offers/{ports,service}.ts` | done | `insert` returns `number \| null`; both paths answer `not_found` |
| `apps/api/src/modules/data/{ports,service,routes}.ts` | done | |
| `apps/api/src/modules/data/export-rows.ts` (+ test) | done | |
| `apps/api/src/app.ts`, `apps/api/src/server.ts` | done | |
| `packages/contracts/src/{data,index}.ts` | done | |
| `apps/web/src/api/data.ts`, `OpportunityPage.tsx` (+ css, test), `ProfilePage.tsx` (+ css), `strings.pl.ts` | done | |
| `packages/config/src/env.ts` (+ test), `.env.example` | done | |
| `apps/api/src/infrastructure/backup/sqlite-backup.ts` | done | Deviations logged |
| `apps/api/src/infrastructure/scheduler/schedule.ts` (+ test) | done | |
| `apps/api/src/cli/backup.ts`, `apps/api/package.json`, `package.json` | diverged | No longer migrates (R4 fix). The plan's *Modules* line still says "opens the DB, migrates", so the review decision covers it; no *Deviations* entry needed |
| `CLAUDE.md` | done | |
| `README.md` | done | |
| `scripts/container-smoke.sh` | done | Restores in place (logged); still never executed (`[REVIEW]` line) |
| `apps/api/test/{data-delete,data-export,backup,retention,restore}.int.test.ts`, `cli.int.test.ts` | done | Round 2 adds the note-retention test and the missing-database CLI test; round 3 the draft-retention test |
| `apps/api/test/helpers/app.ts`, `apps/api/test/offer-draft-repository.int.test.ts` | unplanned | Test wiring; trivial |
| `.gitignore` | unplanned | Logged under *Deviations* |
| `context/roadmap.md`, `context/lessons.md` | unplanned | Status column; proposed lesson from R1 |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | Retention now judges the last change by `updated_at`, notes, work entries and offer drafts (R1, R5 fixed) |
| Design | ok | Clean ports, and one `remove` routine serves both delete and retention |
| Safety | ok | The export leaves out secrets (TR-12 test), and the backup CLI no longer touches the schema |
| Tests | concern | Late-save cost paths untested (R2, deferred, minor); retention covers notes and drafts |
| Simplicity | concern | The unknown-cost rule exists in five places (R2, deferred) |
| Plan fidelity | ok | The R3 *Risks* line was added; the R4 change is recorded through this review |
| Agent decisions | ok | D-1 and D-8 each live in one place; D-4's "last change" covers notes, work and drafts |

## Findings
### R1: Retention ignores notes and work entries, so it deletes rows the operator just touched
- Severity: major
- Where: `apps/api/src/infrastructure/db/data-repository.ts:245`; `apps/api/src/infrastructure/db/activity-repository.ts:76`, `:97`
- Problem: Retention judges "last change" only by `opportunities.updated_at`. `addNote` and `addWork` insert an `activity_events` row but never touch `updated_at`. Reproduced with the built code: a `REJECTED` row unchanged for 100 days, plus a note added an hour ago, gives `deleteClosedBefore(now − 90 d)` → `removed: 1`, `notes left: 0`. D-4's own reason ("nothing is deleted sooner than the operator expects") does not hold. A note such as "the client comes back next week" is the operator's own fresh input, and it is lost without any warning. The *Findings* list of what moves `updated_at` (status, analysis, system moves) left out notes and work.
- Fix: Treat the newest operator event as a change. Either add `NOT EXISTS (SELECT 1 FROM activity_events WHERE opportunity_id = o.id AND occurred_at >= before)` to the retention query, or bump `updated_at` in `addNote`/`addWork`. The second is simpler, but it changes the meaning of `updated_at` for the list sort, if anything sorts by it. Add a retention test row: rejected 91 days ago, note 1 day ago → kept.
- Effort: small
- Lesson candidate: When a rule judges "last change" by one column, list every write path to the record and test the ones that do not move that column
- Decision: fixed (eccd401) + lesson proposed

### R2: The spend rule is copied into five places, and the late-save paths that carry cost are untested
- Severity: minor
- Where: `apps/api/src/infrastructure/db/analysis-repository.ts:110`, `:237`, `:318`; `apps/api/src/infrastructure/db/offer-draft-repository.ts:40`; `apps/api/src/infrastructure/db/data-repository.ts:212-218`
- Problem: The "billed answer of unknown cost" and "counted" conditions now live as SQL in `spentSince` and in `remove`, and as TypeScript in `saveComplete`, `saveFailed` and the draft `insert`. If S-05/S-07 change the rule in `spentSince`, the deleted rows keep the old rule and nothing fails. The D-2 tests use only the mock provider, unpaid and with a success result. Two paths are never exercised:
  - `saveFailed` with a deleted opportunity;
  - a late save that carries a non-zero `costMicroUsd` or an unknown cost.

  The plan's "spend includes the call" is asserted only through `countSince`, never through `spentSince`.
- Fix: Extract the two flags into one helper per kind, for example `usageFlags(row)` used by both TypeScript paths. Keep the SQL CASE beside it, and add a test that compares the helper with `spentSince` on the same rows. Extend the D-2 test with a paid provider (non-zero cost and a `null` cost) and a failing analysis, and assert `spentSince` before and after.
- Effort: medium
- Lesson candidate: no
- Decision: deferred (medium effort and touches S-05/S-07 code; FOLLOW-UP in plan.md)

### R3: Plan-review #8 left unanswered: deletes and retention change past insights and run counts, and retained items can return as `NEW`
- Severity: minor
- Where: `context/changes/data-ownership-backup/plan.md` (*Risks and unknowns*, *Deviations*)
- Problem: Plan-review #8 asked for one *Risks* line about two effects. First, insights read `activity_events` for `REJECTED` moves, and per-run outcomes join `raw_signals → opportunities`, so both drop when rows are deleted. Second, with D-3, an item removed by retention that a source lists again comes back as `NEW`. Neither *Risks* nor *Deviations* mentions this, so the PR reviewer is not told about it. The lesson binds only majors, so this is minor.
- Fix: Add the *Risks* line, so the PR decision on D-3/D-4 covers it.
- Effort: small
- Lesson candidate: no
- Decision: fixed (Risks line added in plan.md)

### R4: The backup command migrates the live database before copying it
- Severity: minor
- Where: `apps/api/src/cli/backup.ts:14`
- Problem: `runMigrations(db)` runs before `backup()`. If the command is run with newer code than the server is running (for example `pnpm backup` after `git pull`, or `docker compose run` with a rebuilt image), it changes the schema under the running server. The "before update" copy is then already migrated, which defeats the README's advice in *Aktualizacja*. With the README's `docker compose exec` into the running container, nothing is pending, so the normal path is safe.
- Fix: Drop `runMigrations` from the backup CLI. Let it copy the file as it is, and fail clearly if the database does not exist. A copy of an older schema is migrated at restore time anyway (`restore.int.test.ts`).
- Effort: small
- Lesson candidate: no
- Decision: fixed (66796f8)

### R5: Retention still ignores offer-draft activity, so a draft generated or edited yesterday is deleted
- Severity: major
- Where: `apps/api/src/infrastructure/db/data-repository.ts:234` (`deleteClosedBefore`); `apps/api/src/infrastructure/db/offer-draft-repository.ts:25` (`insert`), `:83` (`update`)
- Problem: The R1 fix added only `NOTE` and `WORK` events. Generating a draft (`POST /api/opportunities/:id/offer-drafts`) and saving or acting on one (`act` → `repository.update`) write `offer_drafts` rows, but they do not move `opportunities.updated_at` and add no activity event. `moveForward` does not move a `REJECTED`/`EXPIRED` row, because that move is not forward. The service lets the operator generate a draft for a closed opportunity. The probe in this round reproduced the problem: `REJECTED` 100 days ago, then a draft generated one day ago (`201`, a billed provider call when the provider is paid), then `runDaily()` gave `retention: removed 1 opportunities`. The draft the operator just asked for is gone. The proposed lesson from R1 says to list every write path that does not move the column, and the fix did not go through `offer_drafts`.
- Fix: Add a third `notExists` to the retention query: an `offer_drafts` row for the opportunity with `updated_at >= before`. `insert` and `update` both set `updated_at`. Add a retention test: rejected 100 days ago, draft generated yesterday → kept. Update the *Risks* line in the plan ("or a note, work entry or offer draft").
- Effort: small
- Lesson candidate: no (covered by the R1 lesson already proposed)
- Decision: fixed (7bfdb9f)
