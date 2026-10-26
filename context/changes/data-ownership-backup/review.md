# Review: data-ownership-backup

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (83 files, 1114 tests), image not run (environment: `pnpm install` inside the build fails with SELF_SIGNED_CERT_IN_CHAIN from the sandbox proxy), image smoke not run (needs the image), e2e not run (environment: the Chromium download fails), mutation n/a (S-15 is not a mutation target) · Round: 1

Extra checks this review ran: `pnpm build`, then the built `node apps/api/dist/cli/backup.js` against a temp `DATA_DIR`. The copy was written, the same-second rerun was refused with exit 1, and a `BACKUP_DIR` below a regular file failed with exit 1. The new smoke step 5/5 is still unexecuted, as the plan's `[REVIEW]` line says.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0013_old_pride.sql`, `meta/*` | done | `deleted_usage` plus its index; additive |
| `apps/api/src/infrastructure/db/data-repository.ts` | done | Delete, retention and export; the column allowlist answers plan-review #3 |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | Sums from `deleted_usage`; D-2 paths |
| `apps/api/src/infrastructure/db/offer-draft-repository.ts`, `modules/offers/{ports,service}.ts` | done | `insert` returns `number \| null`; both paths answer `not_found` |
| `apps/api/src/modules/data/{ports,service,routes}.ts` | done | |
| `apps/api/src/modules/data/export-rows.ts` (+ test) | done | |
| `apps/api/src/app.ts`, `apps/api/src/server.ts` | done | |
| `packages/contracts/src/{data,index}.ts` | done | |
| `apps/web/src/api/data.ts`, `OpportunityPage.tsx` (+ css, test), `ProfilePage.tsx` (+ css), `strings.pl.ts` | done | `ProfilePage.tsx` is mostly re-indentation (wrapped in a fragment) |
| `packages/config/src/env.ts` (+ test), `.env.example` | done | |
| `apps/api/src/infrastructure/backup/sqlite-backup.ts` | done | Deviations logged (single step, `journal_mode = DELETE`, same-second refusal) |
| `apps/api/src/infrastructure/scheduler/schedule.ts` (+ test) | done | |
| `apps/api/src/cli/backup.ts`, `apps/api/package.json`, `package.json` | done | |
| `CLAUDE.md` | done | |
| `README.md` | done | |
| `scripts/container-smoke.sh` | done | Restores in place (logged); never executed |
| `apps/api/test/{data-delete,data-export,backup,retention,restore}.int.test.ts`, `cli.int.test.ts` | done | |
| `apps/api/test/helpers/app.ts`, `apps/api/test/offer-draft-repository.int.test.ts` | unplanned | Test wiring for `data` and the `number \| null` return; trivial |
| `.gitignore` | unplanned | `!apps/api/src/modules/data/`, logged under *Deviations* |
| `context/roadmap.md` | unplanned | Status column only |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | Retention can delete a row the operator wrote a note on today (R1) |
| Design | ok | Clean ports, one `remove` routine for delete and retention, and the allowlist test forces a decision for every new column |
| Safety | ok | The export reads no sessions, hash or keys (TR-12 test); the session cookie is SameSite strict; the backup refuses to overwrite a copy |
| Tests | concern | The D-2 failed-analysis path and the cost carried on a late save are untested (R2) |
| Simplicity | concern | The unknown-cost rule now exists in five places (R2) |
| Plan fidelity | concern | Plan-review #8 (history effects, rows returning as `NEW`) was not added to *Risks* (R3) |
| Agent decisions | ok | D-1 (`deleted_usage`) and D-8 (allowlist) each live in one place and could be swapped as claimed |

## Findings
### R1: Retention ignores notes and work entries, so it deletes rows the operator just touched
- Severity: major
- Where: `apps/api/src/infrastructure/db/data-repository.ts:245`; `apps/api/src/infrastructure/db/activity-repository.ts:76`, `:97`
- Problem: Retention judges "last change" only by `opportunities.updated_at`. `addNote` and `addWork` insert an `activity_events` row but never touch `updated_at`. Reproduced with the built code: a `REJECTED` row unchanged for 100 days, plus a note added an hour ago, gives `deleteClosedBefore(now − 90 d)` → `removed: 1`, `notes left: 0`. D-4's own reason ("nothing is deleted sooner than the operator expects") does not hold. A note such as "the client comes back next week" is the operator's own fresh input, and it is lost without any warning. The *Findings* list of what moves `updated_at` (status, analysis, system moves) left out notes and work.
- Fix: Treat the newest operator event as a change. Either add `NOT EXISTS (SELECT 1 FROM activity_events WHERE opportunity_id = o.id AND occurred_at >= before)` to the retention query, or bump `updated_at` in `addNote`/`addWork`. The second is simpler, but it changes the meaning of `updated_at` for the list sort, if anything sorts by it. Add a retention test row: rejected 91 days ago, note 1 day ago → kept.
- Effort: small
- Lesson candidate: When a rule judges "last change" by one column, list every write path to the record and test the ones that do not move that column
- Decision: open

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
- Decision: open

### R3: Plan-review #8 left unanswered: deletes and retention change past insights and run counts, and retained items can return as `NEW`
- Severity: minor
- Where: `context/changes/data-ownership-backup/plan.md` (*Risks and unknowns*, *Deviations*)
- Problem: Plan-review #8 asked for one *Risks* line about two effects. First, insights read `activity_events` for `REJECTED` moves, and per-run outcomes join `raw_signals → opportunities`, so both drop when rows are deleted. Second, with D-3, an item removed by retention that a source lists again comes back as `NEW`. Neither *Risks* nor *Deviations* mentions this, so the PR reviewer is not told about it. The lesson binds only majors, so this is minor.
- Fix: Add the *Risks* line, so the PR decision on D-3/D-4 covers it.
- Effort: small
- Lesson candidate: no
- Decision: open

### R4: The backup command migrates the live database before copying it
- Severity: minor
- Where: `apps/api/src/cli/backup.ts:14`
- Problem: `runMigrations(db)` runs before `backup()`. If the command is run with newer code than the server is running (for example `pnpm backup` after `git pull`, or `docker compose run` with a rebuilt image), it changes the schema under the running server. The "before update" copy is then already migrated, which defeats the README's advice in *Aktualizacja*. With the README's `docker compose exec` into the running container, nothing is pending, so the normal path is safe.
- Fix: Drop `runMigrations` from the backup CLI. Let it copy the file as it is, and fail clearly if the database does not exist. A copy of an older schema is migrated at restore time anyway (`restore.int.test.ts`).
- Effort: small
- Lesson candidate: no
- Decision: open
