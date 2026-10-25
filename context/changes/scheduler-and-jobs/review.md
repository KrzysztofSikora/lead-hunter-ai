# Review: scheduler-and-jobs

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (47 files, 663 tests), e2e ok (5), image not run (no Docker daemon in this environment), mutation not run (not a target in `context/test-plan.md`, off by default) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0008_equal_lord_tyger.sql` + `meta/*` | done | `job_locks`, `trigger`, `parent_run_id`, `scheduled_for`, `skipped`, `raw_signals.job_run_id`, indexes; slot index on `(job_type, scheduled_for)` (logged deviation) |
| `apps/api/src/modules/jobs/ports.ts` | done | `JobLock`, `LockHandle`, `JobRunRepository`, `JobTrigger` |
| `apps/api/src/infrastructure/scheduler/job-lock.ts` | done | D-1 to D-3: start-only own-pid rule, minted-token set, orphan cleanup with no lock row |
| `apps/api/src/infrastructure/db/job-run-repository.ts` | done | start/finish cycle with `status = 'running'` guard, slot conflict, read-time counters and cost (D-8, D-9) |
| `apps/api/src/modules/sources/{ports,service,routes}.ts`, `infrastructure/db/source-repository.ts` | done | run context, `shouldContinue`, guarded `finishRun`, `/run` through `jobs.runSource` with `409 busy` |
| `apps/api/src/modules/signals/{ingest,ports}.ts` | done | optional `jobRunId` |
| `apps/api/src/infrastructure/db/signal-repository.ts` | absent | no change needed: `insertSignal` passes the whole `NewSignal` to `values()` |
| `apps/api/src/modules/jobs/service.ts` | done | `startCycle`, `runSource` (shared heartbeat, logged deviation), `list`, `idle`, `shutdown` |
| `apps/api/src/infrastructure/sources/compose.ts` | done | also returns `jobs` and `lock` |
| `apps/api/src/cli/discover.ts` | done | D-14 output and exit codes |
| `apps/api/package.json`, `pnpm-lock.yaml` | done | `croner` 10.0.1 exact |
| `packages/config/src/env.ts`, `env.test.ts` | done | `DISCOVERY_TIMES` per D-6 (stored sorted, logged) |
| `.env.example`, `README.md`, `CLAUDE.md` | done | both README lines updated (plan-review #6) |
| `apps/api/src/infrastructure/scheduler/schedule.ts`, `schedule.test.ts` | done | croner per time + analysis tick; DST, early fire, resume, tick tests |
| `apps/api/src/server.ts` | done | `releaseStale()` before scheduling; shutdown order schedule → `app.close()` → `jobs.shutdown` → `runner.idle()` → close (plan-review #5) |
| `packages/contracts/src/jobs.ts`, `index.ts` | done | D-9, D-10 contract |
| `apps/api/src/modules/jobs/routes.ts` | done | `POST /api/jobs/discover` 202/409, `GET /api/jobs`; `ScheduleInfo` in route deps (logged) |
| `apps/api/src/modules/analysis/{ports,service,routes}.ts`, `infrastructure/db/analysis-repository.ts` | done | `retryFailed` one guarded UPDATE, `runner.retry`, `POST /api/opportunities/:id/analyze` |
| `apps/api/src/app.ts` | done | registers job routes |
| `apps/api/test/jobs.int.test.ts`, `cli.int.test.ts`, `db.int.test.ts`, `test/helpers/app.ts` | done | every case listed in Phases 1 and 3 is present |
| `apps/web/src/api/{jobs,sources,analysis}.ts` | done | plain functions instead of hooks (logged) |
| `apps/web/src/SourcesPage.tsx`, `SourcesPage.module.css` | done | schedule line, **Uruchom teraz**, **Przebiegi** as stacked cards (logged); see R3 |
| `apps/web/src/OpportunityPage.tsx` | done | **Ponów analizę** next to "Analiza: nieudana" |
| `apps/web/src/strings.pl.ts` | done | `Uruchom źródło`, `strings.jobs.*`, retry strings |
| `context/changes/scheduler-and-jobs/evidence/*` | done | `jobs-sample.json` (fixture data, demo source names), `cli-busy.txt` |
| `context/roadmap.md` | unplanned | status bookkeeping only |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | concern | A busy lock at slot time drops the scheduled cycle with no record (R1); `running` can stay true after a foreign crash (R2) |
| Design | ok | Lock, run history and schedule each live in one place; the analysis tick moved into the scheduler as planned |
| Safety | ok | Inputs validated by Zod at the routes; logs carry ids and counts only; no secrets; nothing sent automatically |
| Tests | ok | Behavioural integration tests over the real DB, two-step takeover, same-process busy, DST under fake timers; all gates green |
| Simplicity | ok | Small functions; the cycle-counter reduce in `list` is the only dense spot |
| Plan fidelity | concern | Plan-review (round 2) #1, a `major`, has neither a *Decisions* row nor a *Deviations* line (R1) |
| Agent decisions | ok | D-1, D-5, D-8, D-9, D-10 are each implemented in one module and swappable as claimed |

## Findings
### R1: A scheduled slot that finds the lock busy is dropped with no trace in the run history
- Severity: major
- Where: `apps/api/src/server.ts:144`
- Problem: `onSlot` calls `jobs.startCycle('schedule', slot)`; on `busy` it only logs `scheduled slot … skipped` and nothing retries. Since D-4 makes every **Uruchom źródło** and every `pnpm discover` take the same lock, a single-source run started at 07:59:40 (up to about 2 min, S-10 D-6) or a cron'd CLI run cancels the whole 08:00 cycle until 18:00. FR-17 AC1 says "When the clock reaches 08:00 or 18:00 … Then one discovery cycle runs", and FR-18 AC1 expects every run to be visible in Sources / `GET /api/jobs`; the skip is only in the log. The plan-review (round 2, #1, `major`) raised exactly this. The plan's *Deviations* log #2, #3 and #4 of that review as applied, but #1 has no *Decisions* row and no deviation, and the *Error model* still says "slot not retried".
- Fix: On `busy`, retry `startCycle('schedule', slot)` every 30 s for a bounded window (for example 30 min); the `(job_type, scheduled_for)` unique index already makes repeats idempotent. Add a fake-timer test: a held lock at 08:00 released at 08:01 gives exactly one cycle with `scheduledFor` 08:00. Alternative with less behaviour change: insert a visible `failed` cycle row with reason `busy` and the slot key, so the skip shows in **Przebiegi**. Record the choice as a *Decisions* row.
- Effort: small
- Lesson candidate: Answer every plan-review finding of `major` or above with a *Decisions* row or a *Deviations* line before implementing.
- Decision: open

### R2: After a CLI crash in another container, the UI reports "Przebieg w toku." and disables **Uruchom teraz** until the next slot
- Severity: minor
- Where: `apps/api/src/infrastructure/db/job-run-repository.ts:166`, `apps/web/src/SourcesPage.tsx:227`
- Problem: `JobList.running` is "any `job_runs` row is `running`". A `pnpm discover` killed in a `docker compose run` container leaves its lock row (foreign host) and its `running` rows. The lock only counts as stale when someone calls `acquire()` after 2 minutes, and `releaseStale()` runs only at server start. Meanwhile the Sources view shows `running`, keeps polling every 3 s and disables the cycle button (`disabled={starting || running}`), so the operator cannot make the attempt that would take the stale lock over. The state lasts until the next scheduled slot (up to about 10 h), a **Uruchom źródło** click, or a restart. `.env.example`, the README and `CLAUDE.md` say such a lock "frees … after 2 minutes", which the UI contradicts.
- Fix: Derive `running` from a live lock: a lock row exists and is not stale by the `acquire` rule (heartbeat within `LOCK_STALE_MS`, or a live pid on this host). Expose that as `JobLock.isHeld()` and use it in `jobs.list`. Alternatively, keep the button enabled and let the server answer 409 when the lock is really live.
- Effort: small
- Lesson candidate: no
- Decision: open

### R3: **Przebiegi** does not refresh after **Uruchom źródło**
- Severity: minor
- Where: `apps/web/src/SourcesPage.tsx:348` (`SourceItem onChanged={load}`), `apps/web/src/SourcesPage.tsx:342`
- Problem: `SourceItem.perform('run')` calls `onChanged`, which is `SourcesPage.load` and reloads only `listSources()`. The `Jobs` component keeps its own state and refetches only on mount, after its own button, or while `running` was true at its last fetch. A synchronous source run started from the row therefore never shows up in **Przebiegi** until the page is reloaded. That covers both the run and its retry case (D-12: "a failed source run is retried with **Uruchom źródło**"), so the FR-18 AC1 view is stale exactly where the plan sends the operator.
- Fix: Lift a `reloadJobs` callback (or a `version` counter) into `SourcesPage` and call it from `onChanged` together with `load`.
- Effort: small
- Lesson candidate: no
- Decision: open

### R4: Graceful shutdown frees the lock but does not stop the in-flight cycle
- Severity: minor
- Where: `apps/api/src/modules/jobs/service.ts:282`, `apps/api/src/modules/jobs/service.ts:356`, `apps/api/src/server.ts:165-166`
- Problem: `shutdown()` calls `handle.releaseInterrupted(at)`, which deletes the lock row and marks the rows `interrupted`. The cycle's `shouldContinue` only checks `heart.lost()`, and that turns true only at the next 20 s heartbeat tick. While the server awaits `runner.idle()` (a real LLM call can take seconds), the cycle can start the next source. That writes a new `running` `job_runs` row and signals without holding the lock, and a `pnpm discover` can acquire the freed lock and run at the same time. A restart cleans the orphan row (`releaseStale` with no lock row), so no data is lost, but "one at a time" does not hold in that window.
- Fix: In `shutdown`, set a `stopping` flag that the cycle's `shouldContinue` also checks, for example `() => !heart.lost() && !stopping`. Add one assertion to the existing "marks our live cycle interrupted" test: a second enabled source is not started after `shutdown`.
- Effort: small
- Lesson candidate: no
- Decision: open
