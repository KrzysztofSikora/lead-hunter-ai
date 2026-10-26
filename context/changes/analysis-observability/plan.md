# Plan: analysis-observability (S-20)

## Goal and end state
From a phone, the operator opens **Analiza** (`/analiza`, linked from the analysis status line on
`/okazje`) and sees what the analysis queue is doing: queued entries, the active entry (opportunity
link, provider/model, stage, start time, elapsed time against the configured timeout, attempt
number, retry/backoff state) and a bounded history of terminal entries with sanitised reason codes
(FR-34 AC1, AC2). "Anuluj analizę" aborts the app's own request and pending retries, keeps the
opportunity and source, records the outcome as cancelled and leaves the queue paused until
"Wznów kolejkę" (AC3). For an OpenAI-compatible (Ollama) backend the view says the backend may keep
inferring until it notices the closed connection (AC4). CPU temperature and load are shown with
units and measurement time, or "niedostępne" (AC5). The history is bounded by count and age and
only an operator session can read it (AC6). No token-level progress and no ETA (roadmap, issue #35).

## Scope
- In:
  - `LlmProvider.analyzeOpportunity` takes an `AbortSignal`; both SDK adapters pass it on.
  - The analysis provider runs with SDK `maxRetries: 0`; the runner retries itself, so the attempt
    number and backoff are observable (D-1).
  - An in-memory activity tracker in `modules/analysis` (D-2) and `GET /api/analysis/activity`.
  - `POST /api/analysis/cancel`, `POST /api/analysis/resume`; the paused flag persisted in
    `app_meta` (D-4).
  - A host-metrics reader (`/sys/class/thermal/thermal_zone0/temp`, `os.loadavg()`) (D-7).
  - Web page `/analiza` with polling, the two buttons and Polish strings.
- Out:
  - Token-level progress, ETA (decided up front).
  - Stopping Ollama, unloading models or touching other model sessions (AC4 forbids it).
  - Offer-draft calls (`createOfferDrafter` keeps its SDK retries; FR-34 is about the analysis queue).
  - Persisting the activity history across restarts (D-2; `[FOLLOW-UP]` if wanted).
  - A compose mount for `/sys/class/thermal` unless the Pi check shows it is needed (D-7).
  - New e2e specs (test budget: at most two, both exist).

## Findings
- Runner: `apps/api/src/modules/analysis/service.ts:291-321` drains one opportunity at a time
  (`nextWaiting(1)`), `analyseOne` at `:181-264` calls `active.analyzeOpportunity(input)` with no
  signal. Provider-wide errors (`auth`, `rate_limited`, `unavailable`, `timeout`, `:69-74`) save a
  `FAILED` row and stop the drain. `drain()` coalesces concurrent calls with `inFlight`/`again`
  (`:302-319`). There is no state about the call in flight.
- Retries are hidden inside the SDKs: `create-provider.ts:8-10` sets `TIMEOUT_MS = 120_000` and
  `MAX_RETRIES = 2`, passed as SDK client options (`openai-compatible.ts:42-47`,
  `anthropic.ts:49-54`). The runner cannot see attempt 2 or the backoff. Test helpers already build
  providers with `{ maxRetries: 0 }` (`apps/api/test/helpers/app.ts:124`).
- Errors: `toProviderError` (`infrastructure/llm/errors.ts:14-26`) maps SDK errors to
  `ProviderError.kind`; an SDK abort (`APIUserAbortError`, exported by both SDKs) currently falls
  through to `'unavailable'`. Failure rows store `provider_error: <kind> <status>`,
  `invalid_output: not_json`, `invalid_output: <paths>`, `invalid_output: guard|secret_echo`,
  `internal_error: <message>` (`service.ts:217-262`). The last one may carry an arbitrary message,
  so the activity view must not show raw error strings (AC2).
- Both SDK versions in use (`openai` 7.43.0, `@anthropic-ai/sdk` 1.3.0) accept a per-request
  `signal?: AbortSignal` in request options (`node_modules/openai/internal/request-options.d.ts:56`,
  `node_modules/@anthropic-ai/sdk/internal/request-options.d.ts:92`) and throw
  `APIUserAbortError` when it fires. SDK `APIError` carries `headers`, so `retry-after` is readable.
- Backoff precedent: `infrastructure/sources/rss/retry.ts:1-23` (2 s · 2^(n-1), honour
  `Retry-After` up to 30 s, otherwise stop) with an injected `sleep` (`sources/compose.ts:29`).
  Modules may not import infrastructure (ESLint layers, `lint-layers.int.test.ts`), so the analysis
  policy gets its own small copy.
- `app_meta` (`schema.ts:13-16`, key/value text) exists since F-01 and is unused by code: a paused
  flag needs no migration.
- Auth is deny-by-default on every `/api/*` route (`modules/auth/routes.ts:54-62`); the TR-13 test
  iterates the route table, so new routes are covered without extra tests. The OpenAPI test
  (`openapi.int.test.ts`) requires every route to be documented with Zod schemas.
- UI: the analysis status line is `AnalysisLine` in `apps/web/src/OpportunitiesPage.tsx:386-418`;
  routes in `apps/web/src/App.tsx:34-43`; strings in `apps/web/src/strings.pl.ts`.
- Ollama behaviour on a closed connection: `UNVERIFIED` (roadmap unknown). AC4 asks the UI to say
  so when it cannot be confirmed; the app has no way to confirm it, so the caveat is always shown
  for `openai-compatible` (D-6).
- Temperature in a container: Docker mounts `/sys` read-only but does not mask
  `/sys/class/thermal`, so `thermal_zone0/temp` (millidegrees Celsius) is expected to be readable
  without a mount; `/proc/loadavg` is not namespaced, so `os.loadavg()` reports the host load.
  Both `UNVERIFIED` on the Pi; a human check confirms.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How do attempt number and backoff become visible (AC1)? | The analysis provider is built with SDK `maxRetries: 0`; the runner retries `rate_limited`, `unavailable` and `timeout` up to 2 more times with `max(2 s · 2^(n-1), Retry-After)`, giving up (as today: `FAILED` and the drain stops) when `Retry-After` > 30 s; the wait goes through an injected `sleep` that the abort signal ends | B: keep SDK retries and wrap the SDK `fetch` option to count attempts (no behaviour change, but backoff timing stays invisible and the hook is SDK-internal); C: show attempt 1 always (breaks AC1) | Only owning the loop makes attempt and backoff state true, and lets cancel stop a pending retry (AC3); the rule mirrors `rss/retry.ts` | cheap | agent |
| D-2 | Where does the activity history live? | In memory in the runner: a ring of terminal entries, at most 100 and at most 7 days old, pruned on every write and read; the view says the history starts at the last app start | B: a new `analysis_attempts` table with pruning (survives restarts, but a migration and a persisted data shape); C: derive from `analyses` rows (persists, but has no attempt, stage or backoff data) | AC6 asks for bounded retention, not persistence; the persistent record of each outcome stays in `analyses`; in-memory is additive-later | cheap | agent |
| D-3 | What is a cancelled analysis stored as? | An `analyses` row `FAILED` with error `cancelled`, opportunity `analysisStatus` `FAILED` (never `COMPLETE`); the existing retry button re-queues it; no usage, cost `null` | B: a new `CANCELLED` status (exact, but changes the `AnalysisStatus` contract, filters and the card); C: put it back to `PENDING` (it would run first again after resume, the item that was slow) | Keeps every contract; the reason code `cancelled` is distinct in the activity view and the card shows "Powód: cancelled"; cheapest to replace by B later | costly (persisted value) | agent |
| D-4 | Is the paused queue persisted? | Yes, `app_meta` key `analysis_paused` = `'1'`, read at start; a paused runner still pre-filters but makes no provider call; requeue and retry still queue | B: in memory only (a restart or reboot would silently resume what the operator stopped, e.g. an overheating Pi) | AC3 "stays paused until the operator resumes it"; no migration needed | cheap | agent |
| D-5 | Cancel API shape | `POST /api/analysis/cancel` → 200 `{ cancelled: boolean, paused: true }` (idempotent; pauses even when nothing was active, because the active one may have just finished); `POST /api/analysis/resume` → 200 `{ paused: false }` and kicks the drain | B: 409 when nothing is active (stricter, but a race between the poll and the click shows an error for a request the operator meant) | Cancel's intent is "stop"; idempotent is simpler for a phone with a slow poll | costly (public API) | agent |
| D-6 | When is the AC4 caveat shown? | Always for `openai-compatible` after a cancel and next to the button: "Lokalny backend może kontynuować obliczenia, dopóki nie zauważy zamkniętego połączenia (niepotwierdzone)." Exposed as `backendMayContinue: true` in the activity response | B: probe Ollama `/api/ps` after cancel to confirm (an extra request to the backend and touching its session API, which AC4 forbids in spirit); C: never show it (breaks AC4) | The app cannot confirm it; honest by default | costly (AC wording) | agent |
| D-7 | Where do temperature and load come from? | `infrastructure/host/host-metrics.ts`: `readFile('/sys/class/thermal/thermal_zone0/temp')` / 1000 → °C (1 decimal), `os.loadavg()` with `os.cpus().length`; any error, non-finite value or non-Linux platform → `null` ("niedostępne"); `measuredAt` is the clock at the read | B: an env var for the thermal path (flexible, but a config change nobody needs yet); C: a compose bind mount (needed only if sysfs is hidden, which the Pi check shows) | Smallest; a mount or env var is a later additive change | cheap | agent |
| D-8 | Activity response shape and reason codes | `GET /api/analysis/activity` → `{ paused, active \| null, queued: { total, items (≤ 20) }, history (newest first), timeoutMs, backendMayContinue, host }`; reason codes are a closed enum mapped from `ProviderError.kind` and the runner's own rejections: `timeout`, `provider_unavailable`, `rate_limited`, `auth`, `bad_request`, `refusal`, `truncated`, `empty`, `invalid_json`, `schema_validation`, `output_rejected`, `internal_error`, `cancelled`; entries carry opportunity id and title (≤ 120 chars), never text, raw errors or responses | B: show the stored `analyses.error` string (leaks `internal_error` messages, AC2) | AC2 asks for sanitised codes; a closed enum cannot leak | costly (public API) | agent |
| D-9 | Polling | The page polls the activity every 3 s while visible (`document.visibilityState`), elapsed time is computed client-side from `startedAt` and the server time in the response | B: SSE (live, but a new transport and reconnect logic for one page) | Simplest; the Pi serves a small JSON | cheap | agent |

## Design

### Ports (`modules/analysis/ports.ts`)
- `LlmProvider.analyzeOpportunity(input: AnalysisInput, options?: { signal?: AbortSignal }): Promise<ProviderOutput>`
  and `readonly timeoutMs: number` (the configured per-request timeout; the mock reports 0 and the
  view says "brak limitu" for it).
- `ProviderErrorKind` gains `'cancelled'`; `ProviderError` gains optional `retryAfterMs`.
- `RunnerState` (new, `ports.ts`): `{ isPaused(): boolean; setPaused(paused: boolean): void }`.
- `HostMetrics` (new): `read(): Promise<HostSnapshot>`, with
  `HostSnapshot = { temperatureC: number | null; load1: number | null; cpuCount: number | null; measuredAt: Date }`.

### Runner (`modules/analysis/service.ts`, tracker in `modules/analysis/activity.ts`)
- `activity.ts` exports `createActivityTracker({ clock, maxEntries: 100, maxAgeMs: 7 days })` with
  `start(entry)`, `stage(stage, extra)`, `finish(outcome, reason)`, `active()`, `history()`.
  Stages: `requesting`, `backoff` (with `nextAttemptAt`), `saving`. Outcomes: `complete`
  (with `reused`), `failed` (with reason), `cancelled`.
- `analyseOne` creates an `AbortController` per opportunity, stored as `current`; every provider
  call and every backoff `sleep` gets its signal. The retry loop (D-1) lives in a small pure helper
  `modules/analysis/retry-policy.ts`: `nextDelay(attempt, error): number | 'give_up'`.
- `cancel()`: if `current`, abort it; set paused (persisted via `RunnerState`); return
  `{ cancelled }`. When the signal fires, `analyseOne` saves `FAILED`/`cancelled` (D-3),
  finishes the tracker entry as `cancelled` and returns `'stop'`.
- `drainOnce` returns after the pre-filter when paused. `resume()` clears the flag and kicks.
- `reasonCode(error | rejection): ReasonCode` maps every failure branch in `analyseOne` to the
  D-8 enum; it is the only place a code is chosen.
- `activity()` assembles the response: tracker state, `repository.nextWaiting(20)` (id, title)
  plus `waitingCount()`, provider meta, host snapshot.

### Contracts (`packages/contracts/src/analysis.ts`)
`AnalysisActivity`, `AnalysisActivityEntry`, `AnalysisReasonCode`, `AnalysisCancelResult`,
`AnalysisResumeResult` (all `.strict()`, ISO datetimes in UTC). `AnalysisServiceStatus` gains
`paused: boolean` so the status line on `/okazje` can say the queue is paused.

### Error model
- A cancel never throws to the route; abort errors inside the runner are expected and mapped.
- The host reader never throws; a missing value is `null`, never 0.
- The activity response never contains source text, `analyses.error`, provider bodies, keys or
  session tokens; the integration test asserts it with canaries.

## Phases

### Phase 1: Abortable provider calls, runner-owned retries and the activity view API
- Files:
  - `apps/api/src/modules/analysis/ports.ts`: signal option, `timeoutMs`, `'cancelled'` kind,
    `retryAfterMs`. Contract: `LlmProvider.analyzeOpportunity(input, { signal })`.
  - `apps/api/src/infrastructure/llm/errors.ts`: `APIUserAbortError` → `cancelled`; read
    `retry-after` header (seconds or HTTP-date) into `retryAfterMs`.
  - `apps/api/src/infrastructure/llm/{anthropic,openai-compatible,mock}.ts`: pass `{ signal }` to
    `create`; expose `timeoutMs`; the mock honours an already-aborted signal.
  - `apps/api/src/infrastructure/llm/create-provider.ts`: `createLlmProvider` builds with
    `maxRetries: 0` (D-1); `createOfferDrafter` unchanged. Contract: `TIMEOUT_MS` is what the view
    shows as the configured timeout.
  - `apps/api/src/modules/analysis/retry-policy.ts` (new): `nextDelay`. Invariant: at most 3
    attempts; `Retry-After` > 30 s gives up.
  - `apps/api/src/modules/analysis/activity.ts` (new): tracker with count and age bounds.
  - `apps/api/src/modules/analysis/service.ts`: retry loop with injected `sleep`, tracker updates,
    `reasonCode`, `activity()`; `AnalysisDeps` gains `sleep?` and `hostMetrics?` (absent → host
    `null`s until Phase 2 wires it).
  - `packages/contracts/src/analysis.ts`, `index.ts`: `AnalysisActivity*`, `AnalysisReasonCode`.
  - `apps/api/src/modules/analysis/routes.ts`: `GET /api/analysis/activity`.
  - `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wiring (`sleep` no-op in tests).
  - `apps/api/test/analysis-activity.int.test.ts` (new).
- Proves: FR-34 AC1 (queued → requesting → backoff → requesting → complete, attempt numbers and
  `nextAttemptAt` observed through the route with a gated fake provider), AC2 (failed attempts
  show only reason codes; canaries for the API key, a source body and an `internal_error` message
  never appear in the response), AC6 (count bound with 101 finished entries; age bound with the
  fake clock); integration level. Existing `llm-adapters.int.test.ts` keeps proving SDK error
  mapping; one case added there for `retry-after` and abort → `cancelled`.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Cancel, paused queue and host metrics
- Files:
  - `apps/api/src/infrastructure/db/runner-state-repository.ts` (new): `app_meta`
    `analysis_paused`. Contract: `RunnerState`.
  - `apps/api/src/infrastructure/host/host-metrics.ts` (new): D-7 reader with an injectable root
    path for tests. Contract: `HostMetrics`.
  - `apps/api/src/modules/analysis/service.ts`: `cancel()`, `resume()`, paused gate in
    `drainOnce`, `paused` in `status()`, D-3 save on abort, `backendMayContinue`.
  - `apps/api/src/modules/analysis/routes.ts`: `POST /api/analysis/cancel`,
    `POST /api/analysis/resume`.
  - `packages/contracts/src/analysis.ts`: `AnalysisCancelResult`, `AnalysisResumeResult`,
    `paused` on `AnalysisServiceStatus`.
  - `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts`: wiring.
  - `apps/api/test/analysis-activity.int.test.ts`: cancel cases.
  - `apps/api/src/infrastructure/host/host-metrics.test.ts` (new, unit): AC5 table (readable file,
    missing file, garbage, non-Linux → `null`, never 0).
- Proves: FR-34 AC3 (cancel during `requesting` and during `backoff`: the signal fired, no further
  provider call, opportunity and signal rows kept, `analyses` row `FAILED`/`cancelled`, not
  `COMPLETE`, queue paused, a requeue and a scheduler kick do not call the provider, paused
  survives a new runner over the same DB, resume runs the queue), AC4 (`backendMayContinue` for
  `openai-compatible`; a `MockAgent` OpenAI-compatible cancel records exactly one request to the
  backend and none to any other path), AC5 (unit table); integration and unit level.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none (the Pi checks are in Phase 3, after the UI exists).

### Phase 3: Phone view `/analiza`
- Files:
  - `apps/web/src/api/analysis.ts`: `getAnalysisActivity`, `cancelAnalysis`, `resumeAnalysis`.
  - `apps/web/src/AnalysisPage.tsx`, `AnalysisPage.module.css` (new): sections *W toku*,
    *Kolejka*, *Historia* (since app start), host line, buttons "Anuluj analizę" / "Wznów
    kolejkę", AC4 caveat; times in Europe/Warsaw via `warsawTime.ts`; polling per D-9; one column
    at 360 px.
  - `apps/web/src/App.tsx`: route `/analiza`; `OpportunitiesPage.tsx` `AnalysisLine`: link
    "Aktywność analizy" and the paused message.
  - `apps/web/src/strings.pl.ts`: every new label, reason-code texts, "niedostępne".
  - `context/test-plan.md`: TR-12 and a new TR-28 (test) row for cancel/paused queue, marked
    covered.
- Proves: no new automated test (test budget: no component tests, no new e2e); the e2e main path
  still passes with the extra link.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`; a Playwright screenshot
  of `/analiza` at 360 px with the mock provider saved under `evidence/`.
- Human checks:
  - On a phone, `/analiza` is readable at 360 px, no horizontal scroll, labels clear.
  - On the Pi with local Ollama: start an analysis, see it under *W toku* with model, stage,
    elapsed time and timeout; press "Anuluj analizę": the entry moves to *Historia* as
    cancelled, the queue shows paused, the caveat is shown; `docker compose restart` keeps it
    paused; "Wznów kolejkę" resumes it.
  - On the Pi: temperature (°C) and load show with a measurement time; note whether
    `/sys/class/thermal` was readable in the container without a mount (D-7).
  - Whether Ollama stopped inference after the cancel (`ollama ps` / CPU in `top`), recorded as
    evidence for the AC4 `UNVERIFIED`.

## Risks and unknowns
- Ollama may keep inferring after the abort (AC4, `UNVERIFIED`); the UI says so; the Pi check
  records what happens.
- `/sys/class/thermal` may be hidden in the container on some Docker setups; then the view says
  "niedostępne" and a `[FOLLOW-UP]` adds a read-only mount.
- Moving retries from the SDK to the runner changes the retry timing for analyses (D-1); the SDK
  also retried 408/409 and connection errors, which map to `timeout`/`unavailable` and stay
  retried.
- A cancelled paid request may still be billed by the provider for tokens already processed; the
  row stores cost `null` and status `FAILED`, so `unknownCostCount` does not count it. Logged as
  a known gap, not fixed here (no usage is returned for an aborted request).
- An abort that arrives after the provider answered but before the save: the answer is kept
  (the call completed); the tracker records `complete`, and the queue still pauses.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [ ] Phase 1: Abortable provider calls, runner-owned retries and the activity view API
- [ ] Phase 2: Cancel, paused queue and host metrics
- [ ] Phase 3: Phone view `/analiza`

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
