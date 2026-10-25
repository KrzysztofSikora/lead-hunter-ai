# feat(scheduler-and-jobs): scheduled and on-demand discovery with a shared lock and visible run history

Roadmap item S-12. Discovery now runs at 08:00 and 18:00 Europe/Warsaw (`DISCOVERY_TIMES`), and on demand from the UI (**Uruchom teraz** / **Uruchom źródło**), `POST /api/jobs/discover`, `POST /api/sources/:id/run` and `pnpm discover`. One SQLite job lock allows a single run at a time. A stale lock is released at start and orphaned runs show as `interrupted`. Every run appears in `GET /api/jobs` and in a **Przebiegi** section of the Sources view with its counters, error and cost. A failed analysis can be retried (`POST /api/opportunities/:id/analyze`, **Ponów analizę**) and a failed source run with **Uruchom źródło**, with no duplicates. Covers PRD FR-17 AC1–AC5 and FR-18 AC1–AC2.
Closes #13

> **Status:** Ready for review

## ⚠ Needs your decision
Plan review: READY WITH NOTES. Review: APPROVE (round 2, 0 open findings). Nothing is `[STUCK]` and there are no `[REVIEW]` deviations. These decisions are costly to reverse ([full table](context/changes/scheduler-and-jobs/plan.md#decisions)):

- **D-13 (costly):** The PRD (FR-17 AC4) names **Uruchom teraz** for a whole cycle, but S-10 used that label for the per-source button. → chose **cycle button "Uruchom teraz", per-source button renamed "Uruchom źródło"**. Alternatives: B: cycle "Uruchom wszystkie teraz", per-source keeps its label (contradicts AC4's wording); C: both say "Uruchom teraz" (two identical labels with different effects); D: a separate Jobs view. Switching costs: strings only, all in `apps/web/src/strings.pl.ts`.
- **D-4 (costly):** A single-source run takes the same `discovery` lock. → chose **yes**, so `POST /api/sources/:id/run` can answer `409 { error: "busy" }` while a cycle runs. Alternative: only cycles take the lock (then "one at a time" would not hold and D-3 could not tell orphaned runs from live ones). Switching costs: `jobs.runSource`, the route schema, and D-3's orphan rule.
- **D-16 (cheap, but changes behaviour):** A scheduled slot that finds the lock busy (for example a short manual run at 07:59:40) retries every 30 s for up to 30 min, instead of being dropped. This came from review R1 (plan-review round 2 #1). Alternative: write a visible `failed` cycle row with reason `busy`, which would still lose the 08:00 cycle.
- **D-3 (costly):** Runs left `running` after a crash become `failed` with reason `interrupted` (history is kept). Alternatives: leave them `running`, or delete them.
- **D-5 (costly, data shape):** `job_runs.scheduled_for` plus a unique index on `(job_type, scheduled_for)` makes a slot idempotent. The slot instant is rounded to the nearest minute. Alternatives: rely on croner and the lock alone, or a `schedule_slots` table.
- **D-8 (costly, data shape):** `raw_signals.job_run_id`; `rejected`, `analysed` and the analysis part of `failed` are computed at read time, so they stay current after a retry. `no_text` is not counted as `rejected`. Alternative: write the counters into `job_runs` when analysis finishes.
- **D-1 (costly, data shape):** The lock is a `job_locks` table (one row while held; token-keyed acquire, heartbeat and release). Alternatives: a row in `app_meta`, or a `flock` lock file.
- **D-9 / D-10 / D-12 (costly, public API):** `cost` is `{ inputTokens, outputTokens } | null`, and `null` ("brak danych") with the mock; the money value comes with S-05. `POST /api/jobs/discover` answers `202` and the cycle continues in the background. `POST /api/opportunities/:id/analyze` retries only a `FAILED` analysis, answering `409 not_failed` otherwise. Alternatives: `costUsd` now, a synchronous cycle route, re-analysis of `COMPLETE`.
- **Roadmap default to confirm:** a run missed while the Pi was off is not caught up (`context/roadmap.md`, S-12 *Decided up front*).

Reply in a review comment, e.g. `D-13: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
All come from [plan.md](context/changes/scheduler-and-jobs/plan.md#human-checks); none were run in this environment. The real scheduled run on the Pi is S-16's check.
- [ ] `docker compose up --build`, log in, **Źródła**, add `hn-freelance`, press **Uruchom teraz** above the list: the run shows "w toku" and turns `ok`/`częściowy` with counters within a minute without reloading; pressing again during the run shows "Przebieg w toku." Evidence: [`jobs-sample.json`](context/changes/scheduler-and-jobs/evidence/jobs-sample.json) (API shape only).
- [ ] At 360 px (DevTools on `/zrodla`) the **Przebiegi** list is readable without horizontal scrolling and status reads without colour. Evidence: none.
- [ ] During a run, `docker compose restart`: afterwards the run shows "przerwany (restart)" and a new **Uruchom teraz** works at once. Evidence: none.
- [ ] While a UI run is in progress, `docker compose exec app pnpm discover` prints `przebieg w toku`. Evidence: [`cli-busy.txt`](context/changes/scheduler-and-jobs/evidence/cli-busy.txt) (local, synthetic lock).
- [ ] The schedule line on **Źródła** shows the next run as 08:00 or 18:00 Warsaw time. Evidence: none.
- [ ] Cycle button **Uruchom teraz** and row button **Uruchom źródło** read clearly side by side (D-13); **Ponów analizę** appears next to "Analiza: nieudana" on a failed card. Evidence: none.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | When a held lock is stale | At start: same host and (own pid, dead pid, or heartbeat older than 2 min). In `acquire`: a token minted by this process is always held; otherwise a dead pid on the same host or a heartbeat older than 2 min | Heartbeat only; pid only |
| D-6 | Is the schedule configurable | Env `DISCOVERY_TIMES`, `HH:MM` list, default `08:00,18:00`, 1–6 distinct times, 02:xx rejected | Fixed constants; raw cron expression |
| D-7 | Analysis vs the lock and the CLI | Analysis stays the server's single-flight runner outside the lock; the 10-min tick moves into the scheduler; `pnpm discover` never analyses | Cycle awaits a drain under the lock; CLI drains too |
| D-11 | Cycle status and skipped sources | `failed` when every attempted source failed, `partial` when any failed, else `ok`; `too_soon` sources count in `skipped` | `too_soon` as failed; no skipped count |
| D-14 | `pnpm discover` output and exit code | Per-source lines, then `przebieg <id>: <status>`; exit 1 on any failure or when busy | Exit 0 when busy |
| D-15 | Tests within budget | Fake-timer DST unit tests, config rows, `jobs.int.test.ts`, CLI busy case, seeded 0007→0008 upgrade; no web tests | Also a lock-repository unit test |

## Quality
- Gates ([review.md](context/changes/scheduler-and-jobs/review.md)): typecheck ok, lint ok, unit tests ok (47 files, 667 tests), e2e ok (5). **Image not run** (no Docker daemon in this environment).
- Review: APPROVE, round 2. Round 1: R1 (major), R2, R3, R4 fixed. Round 2: R5, R6 fixed. Deferred 0, rejected 0.
- Mutation: skipped: not a target in `context/test-plan.md` (off by default); no `mutation.md`. `bug` mutants: none.
- Proposed lessons: "Answer every plan-review finding of major or above with a Decisions row or a Deviations line before implementing" (from R1). Drop the commit `dba4cb3 docs(scheduler-and-jobs): propose lessons` to reject it.

## Follow-ups
- [FOLLOW-UP] S-05: add the money value of cost to `JobRun.cost` once the price table exists (D-9).
- [FOLLOW-UP] S-15: register the 03:30 backup in `startScheduler` and decide its lock name.
- [minor] `DISCOVERY_TIMES` DST tests cover one 24 h window around each change day (Sunday slots); Saturday and Monday are not asserted.
- [minor] The web part has no automated test (D-15); the Przebiegi list uses plain `setInterval` polling and stacked cards instead of hooks and a table.

## Commits
```
4d46500 docs(scheduler-and-jobs): triage review round 2
8c611cc fix(scheduler-and-jobs): remove unused JobRunRepository.isRunning (R6)
a3e3222 fix(scheduler-and-jobs): a throwing slot retry is logged, not fatal; settled retries are pruned (R5)
5ef8157 docs(scheduler-and-jobs): review
d40c7b6 docs(scheduler-and-jobs): triage review round 1
dba4cb3 docs(scheduler-and-jobs): propose lessons
06331fa fix(scheduler-and-jobs): Przebiegi refreshes after Uruchom źródło (R3)
cd01681 fix(scheduler-and-jobs): running follows a live lock; shutdown stops the cycle (R2, R4)
1a75730 fix(scheduler-and-jobs): retry a scheduled slot while the lock is busy (R1)
f57cf38 docs(scheduler-and-jobs): review
0421aff feat(scheduler-and-jobs): Sources view runs and analysis retry on the card
4128cd8 feat(scheduler-and-jobs): jobs API, locked source runs and analysis retry
04d95e1 feat(scheduler-and-jobs): croner schedule and server wiring
412856e feat(scheduler-and-jobs): job lock, run history columns and a locked CLI
67ccf8a docs(scheduler-and-jobs): plan-review
29ca74e docs(scheduler-and-jobs): plan
b356fd1 docs(scheduler-and-jobs): plan-review
ef4ba6b docs(scheduler-and-jobs): plan
```

<details><summary>Run</summary>

Base `main`, branch `change/scheduler-and-jobs`, started 2026-10-25 16:23 UTC. No failed step, no draft reason. Plan review round 1: NEEDS CHANGES, round 2: READY WITH NOTES. Phases ticked 4/4. Review round 1: APPROVE WITH FOLLOW-UPS (4 open), round 2: APPROVE.

| Step | Model | Cost |
|------|-------|------|
| plan | opus | $2.15 |
| plan-review (round 1) | opus | $0.92 |
| plan (revise) | opus | $0.84 |
| plan-review (round 2) | opus | $0.94 |
| implement, phases 1–4 | sonnet | $0.91 + $0.52 + $1.01 + $0.49 |
| review (round 1) | opus | $1.29 |
| fix-review (round 1) | sonnet | $0.39 |
| review (round 2) | opus | $0.72 |
| fix-review (round 2) | sonnet | $0.14 |

Total before this step: about $10.32. Every step had one attempt.
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
