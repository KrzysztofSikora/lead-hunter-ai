# Plan review: scheduler-and-jobs

Verdict: READY WITH NOTES

Previous review (8 findings, 1 blocker): every finding has a line in *Review response*, and the
plan text changed to match. #1 is fixed: D-2 now has a start-only own-pid rule plus "a lock whose
`owner_token` this process minted … is always held → `busy`", and Phase 1 adds the same-process
`pid: process.pid` test. #2 through #8 are also reflected in D-3, D-5, D-8, D-13, the *Error model*
and the Phase 1 and Phase 2 file lists.

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | major | Agent decisions / Failure paths (FR-17 AC1) | The *Error model* says "Lock busy → `busy` (… scheduler: log, slot not retried)", and D-4 makes every single-source run take the same lock. So a 30-second **Uruchom źródło** started at 07:59:40, or a `pnpm discover` from cron, drops the whole 08:00 cycle until 18:00. The only trace is a log line, and nothing appears in `GET /api/jobs` or the **Przebiegi** table (FR-18 AC1 "each run shows…"). AC1 says "Then one discovery cycle runs". No *Decisions* row weighs this. The roadmap's *Decided up front* covers only "missed while the Pi was off". | Add a decision row. Simplest option that keeps AC1: when the slot finds the lock busy, re-try `startCycle('schedule', slot)` every 30 s for a bounded window (for example 30 min). D-5's `scheduled_for` key already makes the retry idempotent. Alternative: record a visible refused row (`status 'failed'`, reason `busy`, `scheduled_for` set). Either way, test it in Phase 1 or Phase 2. |
| 2 | minor | Failure paths (D-3, FR-17 AC3) | Orphans are marked `interrupted` only "when a lock is released as stale". The plan's own *Findings* say an S-10 process crash already leaves `running` rows. Those rows have no `job_locks` row, so they are never cleaned. If `isRunning()` reads `job_runs.status`, then `JobList.running` stays `true` and the UI "refetches every 3 s" forever. | In `releaseStale()`, when no lock is held after the release step, also mark any `running` rows `interrupted`. That is safe because, by D-4, nothing runs without the lock. Alternatively, derive `running` from the presence of the lock row. Add the case to the AC3 tests. |
| 3 | minor | Design (D-2, D-4) | Only `startCycle` "starts the heartbeat (`setInterval` 20 s…)". `runSource(id)` is described only as "the same lock around `sources.run(...)`". One source run can take about 2 min (S-10 D-6, *Risks* bullet 4), which is the staleness threshold, so a CLI in another container could take over a live source run. | Make the heartbeat part of holding any handle (for example a `withLock(fn)` helper in the jobs service that both paths use), and say so in *Design*. |
| 4 | minor | Design (D-5, costly data shape) | The unique index `job_runs_slot_uq` is on `scheduled_for` alone. *Risks* says S-15 adds a 03:30 backup to this scheduler, and `DISCOVERY_TIMES` may legally contain `03:30`. If S-15 records its runs in `job_runs` with a slot key, the two jobs collide on the same minute, and fixing the index later needs another migration. | Make the index `(job_type, scheduled_for)` now. The guarantee is the same, and the change is one line. |
| 5 | minor | Grounding / Phasing (D-3 shutdown) | The planned order is "stop the schedule, `app.close()`, `jobs.shutdown(now)` …, exit". Today's shutdown (`apps/api/src/server.ts:132-137`) also does `await runner.idle()` and `sqlite.close()`. The plan neither keeps nor drops them explicitly. | State the full order, for example: stop schedule and tick → `app.close()` → `jobs.shutdown()` → `await runner.idle()` → `sqlite.close()` → exit. If `runner.idle()` is dropped, say why. |
| 6 | minor | Lesson (no comment describing what does not exist) | `README.md:70` says "przebiegów dojdzie ze slice'em S-12; do tego czasu przebiegi są ręczne lub przez `pnpm discover`". After this change that sentence is false. Phase 2 edits only "the `pnpm discover` line" (`README.md:41`). | Add `README.md:70` to the Phase 2 README edit. |
| 7 | minor | Design (D-8 vs D-11) | D-11 says the cycle's "`fetched/new/duplicates/failed` are the sums of its child runs, written when it finishes". D-8 says `failed` = "stored item failures + `analysis_status = 'FAILED'`" and that "A cycle shows the sums over its child runs". It is unclear whether a cycle's `failed` drops after an analysis retry (FR-18 AC2), as its child's does. | State that a cycle's counters at read time are the sums of its children's read-time counters, so the stored cycle columns are not shown as `failed`. Extend the Phase 3 retry assertion to the cycle row as well. |

## Decisions the PR reviewer should look at
- D-4 together with the *Error model* "slot not retried": a short single-source run can cancel a scheduled cycle (finding #1).
- D-2: staleness rules (start-only own-pid, in-memory token set, 2-minute heartbeat); a cross-container CLI crash blocks runs for 2 min.
- D-5: unique `scheduled_for` as the slot idempotency key (data shape, finding #4).
- D-8: read-time counters through `raw_signals.job_run_id` (data shape).
- D-10: async `202` cycle and the `JobRun`/`JobList` contract (public API).
- D-13: renaming the per-source button to **Uruchom źródło** so that the cycle button matches the AC4 wording **Uruchom teraz**.

## What is good
- Grounding holds. I checked `job_runs` at `schema.ts:56-73` and migrations up to `0007`; `SourceService.run` (`service.ts:152`), `runEnabled` (`service.ts:339`), `startRun`/`finishRun` (`source-repository.ts:143,150`); the `setInterval` at `server.ts:128-131`; `moveFor` and the `waiting` predicate; the per-attempt `input_tokens`/`output_tokens` in `analyses`; `SourceFailureReason` including `internal`; `createSourceRuntime` in `compose.ts`; the `hn-freelance` preset; and `strings.pl.ts:71` `run: 'Uruchom teraz'`. `croner@10.0.1` exists on npm under MIT, and `croner` is already in the ESLint `DRIVERS` list, so placing it in `infrastructure/scheduler/` respects the layers.
- No e2e spec clicks **Uruchom teraz** on Sources, so the D-13 rename leaves `pnpm e2e` green.
- Rejecting 02:xx (D-6) removes the DST gap and overlap for every valid config. The fake-timer test covers all three dates named in TR-11.
- The two-step lesson is honoured: takeover followed by the old owner's late release or heartbeat, and the `WHERE status = 'running'` guard against a late `done`.
- D-7 keeps LLM spend in one process and settles the overlap risk raised in analysis-and-scoring.
- The phases are ordered by dependency, each one runs the Gates commands, Phase 4 adds `pnpm e2e`, and the human checks are concrete and observable.
