# Plan: scheduler-and-jobs (S-12)

## Goal and end state
Discovery runs by itself at 08:00 and 18:00 Europe/Warsaw, and on demand from the UI, the API
and the CLI. Only one job runs at a time across processes. The schedule survives restarts and
DST changes, and every run can be seen with its counters and errors.

Observably true when done:
- At 08:00 and 18:00 Warsaw time the server runs exactly one discovery cycle per slot, including
  on 2026-10-25, 2027-03-28 and 2027-10-31 (FR-17 AC1).
- While a cycle or a single-source run is in progress, a second one from the scheduler, the UI
  (**Uruchom wszystkie teraz** / **Uruchom teraz**), `POST /api/jobs/discover`,
  `POST /api/sources/:id/run` or `pnpm discover` is refused with "przebieg w toku" and nothing
  runs twice (FR-17 AC2, AC4).
- After a crash or restart, a lock held by a dead process is released at start, runs it left
  `running` show as `failed` with reason `interrupted`, and the scheduler starts again with no
  duplicated slot (FR-17 AC3).
- A cycle in which one source fails finishes the others and is recorded as `partial` (FR-17 AC5).
- `GET /api/jobs` and the Sources view show each run: type, source, trigger, status, start/end,
  counters (fetched, new, duplicates, rejected, analysed, failed, skipped), error and cost
  (FR-18 AC1).
- A failed analysis can be retried (`POST /api/opportunities/:id/analyze`, **Ponów analizę** on
  the card). A failed source run is retried with **Uruchom teraz**. Neither creates a duplicate
  opportunity (FR-18 AC2).

## Scope
- In: SQLite job lock with heartbeat and stale-lock release; `job_runs` extended for cycles,
  triggers, scheduled slots and skipped sources; `raw_signals.job_run_id`; croner schedule from
  `DISCOVERY_TIMES` (default `08:00,18:00`, Europe/Warsaw); the jobs module
  (`POST /api/jobs/discover`, `GET /api/jobs`); per-source runs through the same lock;
  `pnpm discover` through the same lock; analysis retry
  (`POST /api/opportunities/:id/analyze`); the analysis tick moves from `server.ts` into the
  scheduler; a **Przebiegi** section and **Uruchom wszystkie teraz** in the Sources view;
  **Ponów analizę** on the card; `.env.example`.
- Out: notifications (FR-29, P1); catching up runs missed while the Pi was off (*Decided up
  front*: not done); the money value of LLM cost (S-05 brings the price table, FR-09); a
  schedule editor in the UI (env only); re-analysis of a `COMPLETE` opportunity; the daily
  raw-signal limit (brief §12.1, not an AC of this item); backups at 03:30 (S-15 adds that job to
  this scheduler); Today/brief (S-13); measurements on the Pi (S-16).

## Findings
- `job_runs` exists since S-10 (`apps/api/src/infrastructure/db/schema.ts:56-73`, migration
  `0007`). It has `job_type 'source_run'`, `source_id`, `status running/ok/partial/failed`,
  `started_at`, `finished_at`, `fetched/new/duplicates/failed` and `error_reason/error_status`.
  S-10 D-2 left `rejected`, `analysed`, `cost` and `GET /api/jobs` to this item. There is no
  list route yet.
- `SourceService.run(id)` (`apps/api/src/modules/sources/service.ts:152`) claims the source
  atomically (S-10 D-5, per-source interval). It writes its `job_runs` row through
  `repository.startRun(id, at)` (`source-repository.ts:143`). It never leaves a `running` row on
  an exception, but a process crash does (S-10 deviation, Phase 3). `runEnabled()`
  (`service.ts:339`) runs every enabled source in turn; one that fails never stops the next.
  That is FR-17 AC5's mechanism already, and it is tested in `apps/api/test/sources.int.test.ts`
  ("records an explicit error per failing source…").
- `pnpm discover` (`apps/api/src/cli/discover.ts`) calls `runEnabled()` with no lock (S-10
  D-16). Only the per-source claim keeps it from overlapping a UI run of the same source.
  `apps/api/test/cli.int.test.ts` spawns the CLI with tsx against a temp `DATA_DIR`.
- `server.ts:128-131` kicks the analysis drain every 10 minutes with `setInterval`.
  analysis-and-scoring *Risks* says S-12 must replace this with its job and lock, "or two drains
  could overlap across processes (`pnpm discover`)". Today the CLI never drains analysis, so the
  overlap only appears if the CLI starts to analyse. D-7 keeps it that way.
- `AnalysisRunner` (`modules/analysis/service.ts:36-45`) is single-flight in one process.
  `nextWaiting` selects only `PENDING` rows that passed the pre-filter
  (`analysis-repository.ts:21-25`). A `FAILED` opportunity is therefore never picked up again,
  and no retry exists yet. `countSince` counts every analysis row, failed ones included, so a
  retry counts against the daily limit.
- `ingest()` (`modules/signals/ingest.ts:73`) inserts a raw signal only on the `created` path.
  A duplicate adds evidence and inserts no signal. So `raw_signals.job_run_id` identifies exactly
  the signals (and, under the S-03 rule of one opportunity per signal, the opportunities) that a
  run created.
- Mock provider usage is `{ inputTokens: null, outputTokens: null }`
  (`infrastructure/llm/mock.ts:102`): with the mock, cost is "brak danych".
- The brief's §15 names the retry route `POST /api/opportunities/:id/analyze` ("ponowna
  analiza"). The brief's §12 says the default schedule is 08:00/18:00 "(możliwość zmiany)" and
  asks for a lock per job, idempotency and history.
- List routes use `page`/`pageSize` (default 20, max 100), see
  `packages/contracts/src/opportunities.ts:295-296`.
- **croner 10.0.1** (npm, MIT, ESM + CJS, own `.d.ts`; read from the published tarball's
  README):
  - `new Cron(pattern, { timezone, protect, catch, unref }, fn)`;
  - `nextRun(from?)` and `nextRuns(n, from?)`; `stop()` is permanent.
  - DST: "Jobs scheduled during DST gaps are skipped; jobs in DST overlaps run once at first
    occurrence." 08:00 and 18:00 lie outside both. D-6 rejects 02:00–02:59 so that no
    configured time can fall into either.
  - Timers: it schedules with `setTimeout`, capped to a maximum delay and re-armed. So Vitest
    fake timers (`vi.useFakeTimers({ now })` + `advanceTimersByTimeAsync`) drive it with no real
    waiting.
  - It does not catch up missed runs: after a restart the next run is the next matching time.
    That is what the roadmap decided.
  - croner is not yet a dependency. tech-stack.md already chose it (*Scheduling and job
    locking*), so adding it is the planned dependency, not a new choice.
- In Docker the server is a child of `tini` (`init: true`). After `docker restart` the
  container keeps its hostname and the node process often gets the **same pid**. A plain "is the
  pid alive" check would then think the dead owner is alive (it is us). D-2 handles that case.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Shape of the lock | Table `job_locks(name TEXT PK, owner_host TEXT, owner_pid INTEGER, owner_token TEXT, acquired_at INTEGER, heartbeat_at INTEGER)`, one row `discovery` while held. Acquire, takeover and release are each one `BEGIN IMMEDIATE` transaction. Only the token's owner can heartbeat or release (`WHERE owner_token = ?`) | B: a row in `app_meta` (no migration, but no typed columns and an awkward compare-and-set); C: a lock file with `flock` (OS-native, but not visible in the DB, hard to test, and behaviour differs on bind-mounted volumes) | Same DB both processes already share; atomic with better-sqlite3; testable with a fake clock | costly (data shape) | agent |
| D-2 | When is a held lock stale (FR-17 AC3) | Stale if (a) the heartbeat is older than 2 min (heartbeat every 20 s while held), or (b) `owner_host` equals `os.hostname()` and either `owner_pid === process.pid` (after a container restart the dead owner may have had our pid) or the pid is not alive (`process.kill(pid, 0)` → `ESRCH`). The server releases a stale lock at start. `acquire` also takes over a stale lock. | B: heartbeat only (simplest, but right after a crash the scheduler waits up to 2 min, and the start-up step "released on start" does nothing); C: pid only (fast, but wrong across containers or hosts sharing the volume, and wrong when the pid is reused) | (b) frees the lock at once in the common case (same container restarts). (a) covers a CLI in another container. A live holder keeps its heartbeat fresh, so it is never taken over. | cheap | agent |
| D-3 | What happens to runs left `running` | When a lock is released as stale (at start or on takeover), every `job_runs` row still `running` is set to `failed`, with `error_reason 'interrupted'` and `finished_at = now`, in the same transaction. That is safe because every run is started under the lock (D-4). On a graceful shutdown (SIGTERM/SIGINT) the server stops the schedule, marks its own running rows `interrupted` and releases the lock, without waiting for a cycle that may take minutes. | B: leave them `running` (the UI would show a run that never ends); C: delete them (loses history the brief wants) | Truthful history; the lesson about two-step paths is tested: crash → restart → acquire, and an old owner's late release does not free the new owner's lock | cheap | agent |
| D-4 | Does a single-source run (`POST /api/sources/:id/run`) take the lock? | Yes, the same `discovery` lock. While a cycle runs it answers `409 { error: "busy" }`, and while it runs a cycle is refused. **Sprawdź** (health check) does not take the lock (it writes no `job_runs`, S-10 D-21). | B: only cycles take the lock (a source run during a cycle would still be stopped by the per-source claim, but the state "one at a time" would not hold, and D-3 could not tell orphaned runs from live ones) | The roadmap goal says "one at a time". It makes D-3 sound. The cost is that the button waits while a cycle runs, which is rare. | cheap | agent |
| D-5 | Idempotency of a scheduled slot (FR-17 AC1 "no double run", AC3 "no job duplicated") | `job_runs.scheduled_for INTEGER NULL` with a unique index. A scheduled cycle inserts its row with the slot instant (the UTC ms of the croner fire time, rounded down to the minute) right after it gets the lock. On a conflict the slot has already run: the cycle releases the lock and logs `slot already ran`. Manual and CLI cycles leave it null. | B: rely on croner and the lock alone (no column, but two server processes on one DB, or a firing a few ms early and then again on time, could run one slot twice); C: a separate `schedule_slots` table (same guarantee, one more table) | Makes "no double run" a database fact, not an assumption about timers; one column | costly (data shape) | agent |
| D-6 | Is the schedule configurable (brief §12 "możliwość zmiany")? | Env `DISCOVERY_TIMES`, a comma-separated `HH:MM` list, default `08:00,18:00`, 1–6 distinct times, always Europe/Warsaw. The 02:00–02:59 hour is rejected at start ("godzina zmiany czasu"), so DST never skips or doubles a slot. Empty value = default. One croner job per time (`M H * * *`). | B: fixed constants (simplest, against the brief's "can change"); C: a raw cron expression `DISCOVERY_CRON` (flexible, but it needs croner in `packages/config` to validate, and an operator can write a DST-gap pattern) | Operator-friendly; validated with Zod in `packages/config` alone; the DST guarantee holds for every valid value | cheap | agent |
| D-7 | Where analysis runs relative to the lock and to the CLI (analysis-and-scoring *Risks*) | Analysis stays the server's single-flight `AnalysisRunner`, outside the lock. A cycle's new signals kick it (existing `onSignalCreated`). The 10-minute tick moves into the scheduler module (`startScheduler` owns it and stops it on shutdown). **`pnpm discover` never analyses**: signals it creates are analysed by the server's next tick, or at server start. | B: the cycle awaits a drain while holding the lock (counters would be final when the run ends, but an import's kick and the cycle's drain would need the lock too, and the CLI would analyse in a second process: two drains, double cost); C: the CLI drains too, under the lock (work done at once without a server, but the server's own kicks would then need the lock) | Only one process ever spends LLM money; the counters are read live (D-8), so they need no drain inside the run | cheap | agent |
| D-8 | Where `rejected`, `analysed` and the analysis part of `failed` come from (FR-18 AC1) | `raw_signals.job_run_id INTEGER NULL` (FK → `job_runs`, index), set by `ingest` for feed items (null for manual imports and for older rows). `GET /api/jobs` computes them at read time per source run, over the opportunities of its signals: `rejected` = pre-filter rule set; `analysed` = `analysis_status = 'COMPLETE'`; `failed` = stored item failures + `analysis_status = 'FAILED'`. A cycle shows the sums over its child runs (`parent_run_id`). | B: write the counters into `job_runs` when analysis finishes (no read-time join, but analysis runs after the run ended, so the run row would be updated by another module, and a retry would make the stored numbers stale); C: count analyses inside the run's time window (no column, but it mixes in manual imports and is not exact) | Always current, including after a retry (AC2); exact attribution; additive nullable column | costly (data shape) | agent |
| D-9 | What "cost" is in this slice (FR-18 AC1, brief §12.1 "do not fake precise cost") | `cost: { inputTokens, outputTokens } \| null`: sums of the reported token usage of the analyses of the run's opportunities. `null` ("brak danych") when no analysis reported usage, which is always the case with the mock. The money value arrives with S-05's price table as an additive field. | B: `costUsd: number \| null` now (matches the brief's wording, but always null until S-05 and against "money as integer minor units" for sub-cent amounts); C: omit cost (contract shorter, AC1 incomplete) | Facts only; additive later | costly (public API) | agent |
| D-10 | HTTP contract | `POST /api/jobs/discover` → `202 JobRun` (the new cycle, `running`), or `409 { error: "busy" }`. The cycle continues in the background. `GET /api/jobs?page&pageSize&sourceId` → `JobList { items: JobRun[], total, page, pageSize, running: boolean, schedule: { timezone: "Europe/Warsaw", times: string[], nextRunAt: iso \| null } }`, newest first. `POST /api/sources/:id/run` adds `409 { error: "busy" }`. `POST /api/opportunities/:id/analyze` → `202 { analysisStatus: "PENDING" }`, `409 { error: "not_failed" }`, `404`. `JobRun = { id, type: 'discovery' \| 'source_run', trigger: 'schedule' \| 'manual' \| 'cli' \| null, parentId, source: { id, name } \| null, status, startedAt, finishedAt, scheduledFor, counters: { fetched, new, duplicates, rejected, analysed, failed, skipped }, error: { reason: JobErrorReason, httpStatus? } \| null, cost }`, where `JobErrorReason = SourceFailureReason \| 'interrupted'`. | B: a synchronous `POST /api/jobs/discover` (no polling, but it holds an HTTP request for several minutes with many sources, and Tailscale serve or the phone may time out); C: nested `children` per cycle (one row per cycle in the UI, but the shape is harder to page) | Brief §15 route names; S-10 D-7 said the whole-cycle run can be async; flat list pages like the other lists | costly (public API) | agent |
| D-11 | Cycle status and skipped sources (FR-17 AC5) | A cycle is `failed` when every attempted source run failed (at least one attempted), `partial` when any run failed or was partial, and `ok` otherwise, including zero sources. Sources refused `too_soon` (interval, S-10 D-5) are not attempted and count in the new column `job_runs.skipped`. The cycle's `fetched/new/duplicates/failed` are the sums of its child runs, written when it finishes. | B: `too_soon` counts as failed (louder, but a politeness wait is not an error, PRD §5); C: no skipped count (an empty run would look like an empty source) | Truthful; the `failed` status needs real failures | cheap | agent |
| D-12 | What "retry a failed signal" means (FR-18 AC2) | A failed **source run** is retried with **Uruchom teraz**, which re-runs the source. Items whose ingest failed are not in the cursor (S-10 D-3), so they are processed again. The identity table prevents duplicates (S-10 D-4). A failed **analysis** is retried with `POST /api/opportunities/:id/analyze`: `FAILED` → `PENDING` (the earlier `FAILED` analysis row stays as history), then `runner.kick()`. Only `FAILED` can be retried. | B: a "retry this run" route that replays a stored run (needs stored item payloads, which S-10 deliberately does not keep); C: allow re-analysis of `COMPLETE` too (brief §15 hints at it, but it spends money and no AC asks for it) | Reuses existing mechanisms; no new storage | cheap | agent |
| D-13 | What the Sources view shows | Above the source list: a schedule line ("Harmonogram: 08:00 i 18:00 (Europe/Warsaw), następny przebieg: …") and **Uruchom wszystkie teraz**. Below it, a **Przebiegi** table of the last 20 runs: start (Warsaw), type and trigger, source, status as a text label (NFR-07), the seven counters, error (reused Polish reasons plus `interrupted` → "przerwany (restart)") and cost ("brak danych" when null). While `running` is true, the list refetches every 3 s. `busy` shows "Przebieg w toku." On the card, **Ponów analizę** appears next to "Analiza: nieudana". | B: a separate Jobs view (more room, but the PRD names Sources for runs, FR-18 AC1, and it adds a view to the seven) | FR-18 AC1 wording; reuses existing strings and patterns | cheap | agent |
| D-14 | `pnpm discover` output and exit code | Under the lock: the existing per-source lines, then `przebieg <id>: <status>` (`ok` / `częściowy` / `nieudany`), exit 1 if any source failed. With the lock held: prints `przebieg w toku`, exit 1. With no sources: `brak skonfigurowanych źródeł`, exit 0 (unchanged). The CLI sets trigger `cli`. | B: exit 0 when busy (a cron wrapper would not notice) | Keeps the S-10 output; makes being refused visible to scripts | cheap | agent |
| D-15 | Tests within the test budget (TR-11 is `test`) | Unit `apps/api/src/infrastructure/scheduler/schedule.test.ts`: croner wrapper under fake timers across 2026-10-24→26, 2027-03-27→29 and 2027-10-30→11-01, exactly one fire per slot at the right UTC instant; `DISCOVERY_TIMES` validation rows in the existing config test. Integration `apps/api/test/jobs.int.test.ts`: cycle partial + counters + live read after retry (AC5, FR-18 AC1, AC2); busy refusals across cycle/source/API (AC2, AC4); stale lock released at start for dead pid, own pid and old heartbeat, orphans marked `interrupted`, live foreign lock kept (AC3); two-step: takeover then old owner's release/heartbeat leaves the new lock (lesson); slot run twice → one cycle row (D-5); analysis retry without duplicate opportunity. `cli.int.test.ts`: discover prints `przebieg w toku` and exits 1 under a live lock. No web tests (budget). | B: also a unit test of the lock repository alone (finer, but the integration test covers the same SQL through the service) | Every AC this item covers is proved; only TR-11/TR-06 (test risks) get tests | cheap | agent |

## Design

### Data (migration `0008`, generated with `pnpm --filter @lead-hunter/api db:generate`)
- `job_locks` (D-1).
- `job_runs` gets the following additive columns; existing rows keep `trigger`, `parent_run_id`
  and `scheduled_for` null and `skipped` 0:
  - `trigger TEXT NULL`;
  - `parent_run_id INTEGER NULL REFERENCES job_runs(id)`;
  - `scheduled_for INTEGER NULL` with a unique index `job_runs_slot_uq`;
  - `skipped INTEGER NOT NULL DEFAULT 0`;
  - index `job_runs_parent_idx` and index `job_runs_started_idx` (`started_at`) for the list.
- `raw_signals.job_run_id INTEGER NULL REFERENCES job_runs(id)` + index (D-8).
- `job_type` values: `source_run` (existing) and `discovery`.

### Ports (`apps/api/src/modules/jobs/ports.ts`)
```ts
interface JobLock {            // D-1, D-2; implemented in infrastructure/scheduler/job-lock.ts
  acquire(): { ok: true; handle: LockHandle } | { ok: false };
  releaseStale(): boolean;     // at server start; also marks orphans interrupted (D-3)
}
interface LockHandle { heartbeat(): boolean; release(): void }
interface JobRunRepository {   // infrastructure/db/job-run-repository.ts
  startCycle(trigger, at, scheduledFor: number | null): number | 'slot_taken';
  finishCycle(id, summary): void;
  interruptRunning(at): number;
  list(query): { items: JobRunRow[]; total: number };   // counters joined at read (D-8)
  isRunning(): boolean;
}
```
`SourceService.run(id, ctx?: { parentRunId: number | null; trigger: JobTrigger })` passes the
context to `repository.startRun` and its run id as `jobRunId` into `ingest`. `runEnabled(ctx)`
forwards it. Without ctx the behaviour stays as in S-10 (tests unchanged).

### Jobs service (`apps/api/src/modules/jobs/service.ts`)
- `startCycle(trigger, scheduledFor?)` is synchronous. It acquires the lock (else
  `{ kind: 'busy' }`) and inserts the cycle row (else `{ kind: 'slot_taken' }`, releasing the
  lock). It starts the heartbeat (`setInterval` 20 s, `unref`) and returns
  `{ kind: 'started', run, done: Promise<CycleSummary> }`. `done` runs
  `sources.runEnabled({ parentRunId, trigger })`, computes the status (D-11), writes the cycle row
  and, in `finally`, stops the heartbeat and releases the lock. An exception inside is recorded
  as cycle `failed` / `internal`, never left `running`.
- `runSource(id)`: the same lock around `sources.run(id, { parentRunId: null, trigger: 'manual' })`;
  `busy` is a refusal.
- `list(query)` maps rows to `JobRun` and adds `running` and `schedule` (from an injected
  `ScheduleInfo { times, nextRunAt(): Date | null }`).
- `idle()` resolves when no cycle started by this process is in flight (tests and shutdown).

### Scheduler (`apps/api/src/infrastructure/scheduler/schedule.ts`)
`startScheduler({ times, onSlot(slotMs), analysisTick, tickMs, clock })` creates one
`new Cron('M H * * *', { timezone: 'Europe/Warsaw', protect: true, catch: onError, unref: true })`
per time, plus the 10-minute analysis interval (D-7). It returns `{ nextRunAt(), stop() }`.
`onSlot` calls `jobs.startCycle('schedule', slot)` and logs `busy` / `slot_taken` at `warn` /
`info` with the slot time only.

### Error model
- Lock busy → `busy` (HTTP 409, CLI exit 1, scheduler: log, slot not retried).
- Slot already ran → `slot_taken` (scheduler only, logged).
- A run killed by a crash → `failed` + `interrupted` after the next start (D-3).
- A heartbeat that finds the lock lost (taken over) logs a warning. The run finishes and records
  normally, but it does not release a lock it no longer owns.

## Phases

### Phase 1: Job lock, run history columns and a locked CLI
- Files:
  - `apps/api/src/infrastructure/db/schema.ts`, `apps/api/migrations/0008_*.sql` + `meta`: D-1,
    D-5, D-8, D-11 columns and indexes. Contract: the *Data* section above.
  - `apps/api/src/modules/jobs/ports.ts`: `JobLock`, `LockHandle`, `JobRunRepository`,
    `JobTrigger = 'schedule' | 'manual' | 'cli'`.
  - `apps/api/src/infrastructure/scheduler/job-lock.ts`: `createJobLock({ sqlite/db, clock,
    host, pid, isAlive, staleMs })`. Implements D-1–D-3; `isAlive` defaults to
    `process.kill(pid, 0)`, treating `EPERM` as alive.
  - `apps/api/src/infrastructure/db/job-run-repository.ts`: start/finish cycle, the slot
    conflict (catch the unique-constraint error → `'slot_taken'`), `interruptRunning`,
    `isRunning`. `list` arrives in Phase 3.
  - `apps/api/src/modules/sources/{ports,service}.ts`, `infrastructure/db/source-repository.ts`:
    the optional run context (trigger, parent) on `startRun`; `jobRunId` passed to `ingest`.
    Contract: `SourceService.run(id, ctx?)`, `runEnabled(ctx?)`.
  - `apps/api/src/modules/signals/ingest.ts`, `infrastructure/db/signal-repository.ts`:
    `IngestCandidate.jobRunId: number | null` (manual import passes null).
  - `apps/api/src/modules/jobs/service.ts`: `startCycle`, `runSource`, `idle` (D-4, D-11).
  - `apps/api/src/infrastructure/sources/compose.ts`: `createSourceRuntime` also returns
    `jobs` (one wiring point for server, CLI and tests).
  - `apps/api/src/cli/discover.ts`: `startCycle('cli')`, then await `done`; output and exit code
    per D-14.
  - `apps/api/test/jobs.int.test.ts` (lock and cycle cases without HTTP: stale/dead/own-pid/
    heartbeat, orphans `interrupted`, live foreign lock kept, two-step takeover, slot twice,
    partial cycle); `apps/api/test/cli.int.test.ts` (busy case).
- Proves: FR-17 AC2 (service level), AC3, AC5, D-5; TR-11 (lock part). Integration.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Schedule (croner) and server wiring
- Files:
  - `apps/api/package.json`, `pnpm-lock.yaml`: `croner` `10.0.1` (exact).
  - `packages/config/src/env.ts` (+ its existing test): `DISCOVERY_TIMES` per D-6, with a Polish
    message for each invalid value (format, 02:xx, duplicates, more than 6).
    Contract: `Config.discoveryTimes: string[]`.
  - `.env.example`: `# DISCOVERY_TIMES=08:00,18:00` with a comment (Europe/Warsaw, 02:xx not
    allowed, missed runs are not caught up).
  - `apps/api/src/infrastructure/scheduler/schedule.ts`: `startScheduler` per *Design*.
  - `apps/api/src/infrastructure/scheduler/schedule.test.ts`: the DST cases of D-15, the analysis
    tick fires every 10 min, `stop()` stops both.
  - `apps/api/src/server.ts`: `jobLock.releaseStale()` before `listen`; `startScheduler`
    replaces the `setInterval` (`server.ts:128-131`); shutdown per D-3 (stop the schedule, mark
    the process's own running rows `interrupted`, release the lock, then close).
- Proves: FR-17 AC1 (unit, fake timers), AC3 "scheduler resumes" (unit: a fresh
  `startScheduler` after `stop()` fires at the next slot and not at the missed one).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none (the real scheduled run on the Pi is S-16's human check).

### Phase 3: Jobs API, locked source runs and analysis retry
- Files:
  - `packages/contracts/src/jobs.ts` (+ `index.ts`): `JobTrigger`, `JobErrorReason`, `JobRun`,
    `JobList`, `JobListQuery` (`page`, `pageSize`, `sourceId`), `RetryAnalysisResult`
    (D-9, D-10).
  - `apps/api/src/infrastructure/db/job-run-repository.ts`: `list(query)` with read-time
    counters and cost (D-8, D-9) in one grouped query per page, newest first.
  - `apps/api/src/modules/jobs/routes.ts`: `POST /api/jobs/discover` (202 / 409 busy),
    `GET /api/jobs`.
  - `apps/api/src/modules/sources/routes.ts`: `/run` calls `jobs.runSource`; `409 busy` added to
    the response schema.
  - `apps/api/src/modules/analysis/{ports,service,routes}.ts`,
    `infrastructure/db/analysis-repository.ts`: `retryFailed(id, at): 'reset' | 'not_failed' |
    'not_found'` (one `UPDATE … WHERE analysis_status = 'FAILED'`), then `kick()`;
    route `POST /api/opportunities/:id/analyze` (D-12).
  - `apps/api/src/app.ts`, `apps/api/src/server.ts`: register the jobs routes; pass the schedule
    info.
  - `apps/api/test/jobs.int.test.ts`: the HTTP cases. Two feeds via `MockAgent` (one 500, one OK)
    → `POST /api/jobs/discover` 202 → `idle()` → `GET /api/jobs` shows a `partial` cycle and two
    source runs with every counter, `rejected`/`analysed` from the mock analysis, and
    `cost: null`. A second `POST` while a delayed feed holds the cycle → 409 `busy`; `/api/sources/:id/run`
    → 409 `busy`. A failed source run retried after the feed recovers → signals created once;
    a forced `FAILED` analysis → `/analyze` → `COMPLETE`, still one opportunity, two analysis
    rows, and the run's `failed` count drops on the next `GET`. 401 without a session is covered
    by the existing route-wide auth test.
- Proves: FR-17 AC2, AC4 (API), AC5; FR-18 AC1, AC2; TR-06 (no duplicates on retry).
  Integration. The existing OpenAPI test proves that the new routes are documented (FR-25 AC3).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Sources view runs and card retry
- Files:
  - `apps/web/src/api/jobs.ts`: `useJobs()` (refetch every 3 s while `running`),
    `useDiscoverNow()`; `apps/web/src/api/sources.ts`: `busy` refusal;
    `apps/web/src/api/analysis.ts`: `useRetryAnalysis(id)`.
  - `apps/web/src/SourcesPage.tsx` + `.module.css`: schedule line, **Uruchom wszystkie teraz**,
    the **Przebiegi** table (D-13), responsive at 360 px (stacked rows).
  - `apps/web/src/OpportunityPage.tsx` (analysis section): **Ponów analizę** when
    `analysisStatus === 'FAILED'`.
  - `apps/web/src/strings.pl.ts`: `strings.jobs.*` (labels, trigger and status words,
    `interrupted`, `busy` "Przebieg w toku.", "brak danych"), `strings.opportunity.retryAnalysis`.
  - `context/changes/scheduler-and-jobs/evidence/`: `jobs-sample.json` (a `GET /api/jobs`
    response from the integration fixture data) and `cli-busy.txt`.
- Proves: FR-17 AC4 (UI path: button → same API, already proved in Phase 3), FR-18 AC1 (view).
  No automated web test (D-15).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (the main path must stay
  green; it does not touch the new UI).
- Human checks:
  - `docker compose up --build`, log in, open **Źródła**, add the `hn-freelance` preset, press
    **Uruchom wszystkie teraz**: the run appears as "w toku" and turns into `ok`/`częściowy` with
    counters within a minute, without reloading. Pressing the button again during the run shows
    "Przebieg w toku.".
  - At 360 px width (phone or DevTools) the **Przebiegi** table is readable without horizontal
    scrolling, and status is readable without colour.
  - During a run, `docker compose restart`. After the start the run shows "przerwany (restart)",
    and a new **Uruchom wszystkie teraz** works at once.
  - While a UI run is in progress, `docker compose exec app pnpm discover` prints
    `przebieg w toku`.
  - The schedule line shows the next run as 08:00 or 18:00 Warsaw time.

## Risks and unknowns
- croner's DST behaviour is taken from its README and proved by our fake-timer test. Fake timers
  also fake `Date`, which croner uses for its time-zone arithmetic (`Intl`). If the test shows a
  mismatch, the fallback is to test `nextRuns()` from fixed instants (same guarantee, no timer)
  and log a `[minor]` deviation.
- `os.hostname()` in a container is the container id. A CLI run with `docker compose run`
  (new container) is seen as a foreign host, so its crashed lock clears only after 2 minutes
  (D-2 a). Documented in `.env.example`'s comment and the README line for `pnpm discover`.
- Counters are computed at read time (D-8). With the S-16 target of about 10 000 signals, the
  grouped query over one page of runs uses the `raw_signals.job_run_id` index. S-16 measures it.
- A cycle with many sources is bounded per source by S-10 D-6 (about 2 min each). The heartbeat
  keeps the lock while it runs; graceful shutdown does not wait for it (D-3).
- S-11 (IMAP) and S-15 (backup at 03:30) build on this scheduler. The backup job needs its own
  lock name, or to share `discovery`. S-15 decides; `job_locks` is keyed by name to allow both.
- The test for the PRD AC3 phrase "data and configuration are intact" relies on the existing
  file-backed DB tests (TR-20); this item adds no new persistence beyond the migration.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [ ] Phase 1: Job lock, run history columns and a locked CLI
- [ ] Phase 2: Schedule (croner) and server wiring
- [ ] Phase 3: Jobs API, locked source runs and analysis retry
- [ ] Phase 4: Sources view runs and card retry

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [FOLLOW-UP] S-05: add the money value of cost to `JobRun.cost` once the price table exists
  (D-9).
- [FOLLOW-UP] S-15: register the 03:30 backup in `startScheduler` and decide its lock name.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
