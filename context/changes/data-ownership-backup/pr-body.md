# feat(data-ownership-backup): delete, export, retention, backup and restore

Roadmap item S-15 (Data ownership and backup). The operator can delete one opportunity with everything attached to it (API and *Usuń okazję* on the card), download all their data as one JSON file (*Eksportuj dane (JSON)* in *Profil*), and have closed opportunities removed after `RETENTION_DAYS`. A verified SQLite copy is written by `pnpm backup` and by a daily 03:30 Europe/Warsaw job, with the newest `BACKUP_KEEP` copies kept. The README restore procedure is tested by vitest and by the container smoke. Covers PRD FR-21 AC1–AC3 and FR-22 AC1–AC2.
Closes #16

> **Status:** Ready for review. Two checks could not run in the autonomous sandbox (`pnpm docker:build` and `pnpm docker:smoke`, see below), so please run them before merging.

## ⚠ Needs your decision
- **[REVIEW] Docker gates never ran.** `pnpm docker:build` failed at `pnpm install` with `SELF_SIGNED_CERT_IN_CHAIN` from the sandbox proxy, and TLS checks were not disabled. The new smoke step 5/5 (backup, in-place restore) was checked only with `bash -n`. Please see `pnpm docker:build && pnpm docker:smoke` pass on a machine with Docker. The restore logic itself is covered by `apps/api/test/restore.int.test.ts` (passes).
- **D-1 (costly):** Deleting removes analyses and drafts that the monthly cap and daily limits are summed from. → chose **new table `deleted_usage`** (migration `0013`), where the delete transaction copies the current month's usage rows and the cap queries add its sums. Alternatives: B: ignore it (simplest, but a delete lets the cap be passed); C: soft delete (fails "removed"); D: a full spend ledger written on every call (cleaner long term, rewrites the budget code of S-05/S-07). Switching costs: schema migration and the two budget queries in `analysis-repository.ts`.
- **D-3 (costly):** Dedup identities are deleted with the opportunity → chose **yes (cascade)**, so the same item seen again comes back as a new opportunity (including `NEW` after retention, and past insights and run counts shrink). Alternative: keep identities as tombstones (stores the URL/hash of data the operator asked to remove; needs a schema change because the FK cascades).
- **D-4 (costly):** Retention deletes `REJECTED`/`EXPIRED` rows with `updated_at < now − RETENTION_DAYS` and **no payment** → this narrows FR-21 AC3 ("they are deleted") for rows with revenue records. Review rounds extended "last change" to also count a note, a work entry or an offer draft within the period (R1, R5). Alternatives: B: by `created_at`; C: by last status event; D: include rows with payments (deletes revenue records silently).
- **D-8 (costly):** Export shape `{ format: "lead-hunter-export", version: 1, exportedAt, profile, sources, signals, opportunities, evidence, analyses, offerDrafts, events, payments }`. Tables use an explicit per-table column allowlist (plan-review #3), with a test that fails when a new column is not classified. Sources leave out cursor and last-error fields; sessions, `app_meta`, job runs and `deleted_usage` are not exported. Built in memory. Alternatives: B: hand-written DTO per table (stable, about 300 lines more); C: zip with a file per table (needs a dependency); D: raw epoch numbers.
- **D-9 (costly):** `DELETE /api/opportunities/:id` → `204` / `404 { error: "not_found" }`. Alternatives: `POST /api/opportunities/:id/delete`; return counts.
- **[REVIEW]** `apps/api/src/cli/backup.ts` no longer migrates the database (review R4), so the plan's *Modules* line ("opens the DB, migrates") is outdated. A copy of an older schema is migrated at restore time.
- **Plan review / review leftovers:** Plan-review verdict was READY WITH NOTES (3 majors, all answered before implementing and listed under *Deviations*). Review round 3: APPROVE, 0 open findings. Deferred: **R2** (minor), see *Follow-ups*.

Reply in a review comment, e.g. `D-3: take B`, `R2: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) At phone width the *Usuń okazję* two-step confirm on a card reads clearly and cannot be hit by accident. Run: `docker compose up --build`, open an opportunity, narrow the window to ~375 px, tap *Usuń okazję*, then *Anuluj*. Evidence: none (Chromium is not installed in the autonomous run; take screenshots with `E2E_EVIDENCE=1 pnpm e2e` after `pnpm exec playwright install chromium` if wanted).
- [ ] (Phase 2) The *Eksportuj dane (JSON)* link in *Profil* downloads `lead-hunter-export-<date>.json` that opens as JSON. Run: `docker compose up --build`, log in, open *Profil*, click the link. Evidence: none (the response is asserted in `apps/api/test/data-export.int.test.ts`).
- [ ] (Phase 3) On the Pi, the backup command writes a file owned by uid 1000. Run: `docker compose exec app node apps/api/dist/cli/backup.js`, then `ls -l data/backups/`. Evidence: none (needs the Pi; the CLI is covered by `apps/api/test/cli.int.test.ts`).
- [ ] (Phase 5) On the Pi, follow the README *Kopia zapasowa i przywracanie* steps with a copy from `data/backups/`; the panel shows that copy's data and `docker compose ps` is healthy. Evidence: none yet (put the command output in `context/changes/data-ownership-backup/evidence/`).
- [ ] (Phase 5) `pnpm docker:build` then `pnpm docker:smoke` pass with the new step 5/5 (backup, in-place restore). Run: both commands on a machine with Docker access to the npm registry. Evidence: none (sandbox build failed with `SELF_SIGNED_CERT_IN_CHAIN`).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Provider call finishes after its opportunity was deleted | Usage row written to `deleted_usage` in the save transaction, result dropped; offer request answers 404 | B: refuse delete (409) while a call runs; C: cancel the in-flight call |
| D-5 | When retention runs | Daily, after the 03:30 backup; skipped (logged as error) if that backup failed | B: own schedule; C: run even when the backup failed |
| D-6 | Backup file and rotation | `lead-hunter-YYYYMMDDTHHMMSSZ.db`, written as `.partial`, `quick_check`, renamed; rotation touches only matching names | B: `VACUUM INTO`; C: Warsaw-time names; D: gzip |
| D-7 | Configuration | `BACKUP_DIR`, `BACKUP_KEEP` (1–365, 14), `RETENTION_DAYS` (7–3650, 90); 03:30 fixed in code | B: `BACKUP_TIME` variable |
| D-10 | Where in the UI | Two-step inline confirm on the card; *Twoje dane* section in *Profil* | B: `window.confirm`; C: new *Dane* view |
| D-11 | Restore mechanism | Documented file copy (stop, move aside, copy, start); no restore command | B: `pnpm restore <file>` CLI |
| D-12 | How the backup command is offered | CLI only, no HTTP endpoint or button | B: `POST /api/backup` + button |
| D-13 | App was off at 03:30 | No catch-up; the next day's job runs | B: back up at start when the newest copy is older than 24 h |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (83 files, 1117 tests); image not run (no Docker daemon in the sandbox); image smoke not run (needs the image); e2e not run (Playwright Chromium not installed).
- Review: APPROVE, 3 rounds. Round 1 findings: fixed 4 (R1 major, R3, R4, R5 major found in round 2's probe), deferred 1 (R2), rejected 0.
- Mutation: n/a (S-15 is not a mutation target); `bug` mutants: none.
- Proposed lessons: one, from R1 ("When a rule judges 'last change' by one column, list every write path to the record and test the ones that do not move that column"); drop commit `18fa4c3` to reject it.

## Follow-ups
- **[FOLLOW-UP] Review R2 (minor, medium effort):** the unknown-cost/counted rule exists as SQL in `spentSince` and `remove`, and as TypeScript in `saveComplete`, `saveFailed` and the draft `insert`. Extract one helper per kind and add tests for a deleted opportunity with a failing analysis and with a paid provider (non-zero and `null` cost), asserting `spentSince` before and after. Touches S-05/S-07 code.
- Export is built in memory; if 10 000 `DEMO` signals are too heavy on the Pi, stream it.
- Backups share the SD card with the database; the README tells the operator to copy `data/backups/` off the Pi (automating that is out of scope).

## Commits
```
60e795e docs(data-ownership-backup): review
795a8a9 docs(data-ownership-backup): triage review round 2
7bfdb9f fix(data-ownership-backup): retention keeps rows with a recent offer draft (R5)
b99ec7e docs(data-ownership-backup): review
5fa91c0 docs(data-ownership-backup): triage review round 1
18fa4c3 docs(data-ownership-backup): propose lessons
66796f8 fix(data-ownership-backup): backup command no longer migrates the live database (R4)
eccd401 fix(data-ownership-backup): retention keeps rows with a recent note or work entry (R1)
d118db6 docs(data-ownership-backup): review
ac0a95e feat(data-ownership-backup): restore procedure in the README, tested by vitest and the container smoke
c181bb0 feat(data-ownership-backup): retention of closed opportunities after the daily backup
123ab05 feat(data-ownership-backup): backup command and daily 03:30 job with rotation
314d3e7 feat(data-ownership-backup): JSON export, delete button and export link
1de7bac feat(data-ownership-backup): delete an opportunity, keeping the month's spend
582cf37 docs(data-ownership-backup): plan-review
6a4ca9e docs(data-ownership-backup): plan
```

<details><summary>Run</summary>

ship data-ownership-backup (S-15), base main, no requested stop. Branch `change/data-ownership-backup`, started 2026-10-26T22:00:17+00:00.

- review round 1 (opus): $0.87, APPROVE WITH FOLLOW-UPS, 1 open finding
- fix-review (sonnet): $0.27, 8 turns, success
- review round 2 (opus): $0.36, APPROVE, 0 open findings
- Failed step: none · Draft reason: none · Plan review: READY WITH NOTES · Phases ticked: 5/5
- Costs of the plan, plan-review and implement steps are not in the run summary.
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
