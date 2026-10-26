# Review: analysis-observability

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (63 files, 870 tests), e2e ok (5/5), image not run (no Docker daemon in this environment), image smoke not run (no Docker daemon), mutation n/a (no target from the test plan touched) · Round: 2

## Round 2 (re-review after fix-review)
Re-read the fix commits `37f4214`, `d73019c`, `9411760` and the triage in `a1fda94`; no new findings.
- R1 fixed: `service.ts:321-323` no longer checks the signal after a resolved call; the answer goes through the guard, score and save with its usage and cost. The *Deviations* line for Phase 2 records the superseded behaviour and that `cancel()` may then report `cancelled: true` for a saved answer; the UI only reacts to `cancelled: false`, so nothing contradicts the stored `COMPLETE`.
- R2 fixed: the "pause between two items" test lands the cancel through a wrapped `RunnerState` at the second flag check and asserts the exact rows (`COMPLETE` for the first, none for the second, `paused: true`); the new R1 test asserts `{ cancelled: true }` and `COMPLETE`. Verified both against the guard they name with temporary edits (restored, tree clean): re-adding `if (controller.signal.aborted) return cancelledOut();` after the call fails "keeps an answer that resolved before the abort won the race (R1)" (`FAILED` vs `COMPLETE`); moving the paused check from the loop to the start of `drainOnce` makes "does not take the next item..." take a second call and time out.
- R3 fixed: the elapsed-against-timeout row renders only for `stage === 'requesting'` (`AnalysisPage.tsx:96`).
- R4 fixed: `discard()` removed from the interface and the implementation; no references left.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/src/modules/analysis/ports.ts` | done | signal option, `timeoutMs`, `cancelled` kind, `retryAfterMs`, `RunnerState`, `HostMetrics`, `waitingPreview` |
| `apps/api/src/infrastructure/llm/errors.ts` | done | abort mapped before the generic `APIError` branch; `Retry-After` parsed and capped at a day |
| `apps/api/src/infrastructure/llm/anthropic.ts` | done | passes `{ signal }`, exposes `timeoutMs` |
| `apps/api/src/infrastructure/llm/openai-compatible.ts` | done | same |
| `apps/api/src/infrastructure/llm/mock.ts` | done | honours an already-aborted signal, `timeoutMs = 0` |
| `apps/api/src/infrastructure/llm/create-provider.ts` | done | analysis provider `maxRetries: 0`, offer drafter unchanged |
| `apps/api/src/modules/analysis/retry-policy.ts` | done | `nextDelay`, 3 attempts, `Retry-After` > 30 s gives up |
| `apps/api/src/modules/analysis/activity.ts` | done | count and age bounds; R4 fixed |
| `apps/api/src/modules/analysis/service.ts` | done | retry loop, tracker, reason codes, cancel/resume, per-item paused gate as planned; round 2: a resolved answer is kept as the plan's *Risks* say (R1 fixed) |
| `apps/api/src/modules/analysis/routes.ts` | done | activity, cancel, resume, Zod response schemas |
| `packages/contracts/src/analysis.ts`, `index.ts` | done | closed reason-code enum, strict schemas, `paused` on status |
| `apps/api/src/infrastructure/db/runner-state-repository.ts` | done | `app_meta` `analysis_paused` |
| `apps/api/src/infrastructure/host/host-metrics.ts` | done | D-7, `null` never 0 |
| `apps/api/src/infrastructure/host/host-metrics.test.ts` | done | AC5 table |
| `apps/api/src/server.ts` | done | Phase 1 needed no change (logged); Phase 2 wiring |
| `apps/api/test/helpers/app.ts` | done | `sleep` override, `runnerState`; round 2: `wrapRunnerState` test hook (R2) |
| `apps/api/test/analysis-activity.int.test.ts` | done | AC1–AC4, AC6; round 2: exact race assertions (R2 fixed) |
| `apps/api/test/llm-adapters.int.test.ts` | done | `Retry-After` and abort for the Anthropic adapter |
| `apps/web/src/api/analysis.ts` | done | three calls, parsed with contracts |
| `apps/web/src/AnalysisPage.tsx`, `AnalysisPage.module.css` | done | sections, buttons, caveat, polling; R3 fixed |
| `apps/web/src/App.tsx` | done | route and nav link (logged) |
| `apps/web/src/OpportunitiesPage.tsx` | done | link and paused message |
| `apps/web/src/strings.pl.ts` | done | D-6 wording matches |
| `context/test-plan.md` | done | TR-12 note, TR-28 |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | unplanned | `waitingPreview`, logged under *Deviations* |
| `apps/api/test/analysis.int.test.ts`, `apps/api/test/jobs.int.test.ts`, `apps/web/src/OpportunitiesPage.test.tsx` | unplanned | `timeoutMs` / `paused` in fixtures, logged (plan-review 5) |
| `context/changes/analysis-observability/evidence/analiza-360.png` | unplanned | human-check evidence, 58 KB |
| `context/roadmap.md` | unplanned | status column only |
| `context/lessons.md` | unplanned | round 2: one proposed lesson from R2 |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | ACs met; a resolved answer is kept with its usage and cost when the abort races it (R1 fixed) |
| Design | ok | retry policy and tracker are small pure module pieces; layering respected; one place picks a reason code |
| Safety | ok | closed reason-code enum, titles clipped, canary test for key/body/error, routes behind the session hook, `Retry-After` bounded |
| Tests | ok | behaviour-level and deterministic; both race tests assert exact outcomes and fail when their guard is removed (checked) |
| Simplicity | ok | dead `discard()` removed (R4 fixed) |
| Plan fidelity | ok | behaviour matches the plan's *Risks*; the superseded deviation is annotated |
| Agent decisions | ok | D-1, D-3, D-5, D-6, D-8 each live in one place (`retry-policy.ts`, `cancelledOut`, `routes.ts`, `backendMayContinue`, `AnalysisReasonCode`) and are swappable as claimed |

## Findings
### R1: A provider answer that already resolved is dropped as "cancelled", with its usage
- Severity: major
- Where: `apps/api/src/modules/analysis/service.ts:322`
- Problem: after `await active.analyzeOpportunity(...)` resolves, `if (controller.signal.aborted) return cancelledOut();` stores `FAILED`/`cancelled` with no usage and no cost, discarding `provided` and its `usage`. The plan's *Risks* say "An abort that arrives after the provider answered but before the save: the answer is kept"; the Phase 2 deviation turns this into "its answer is dropped" as `[minor]`, but for a paid provider that is a billed answer stored without cost, which breaches the lesson "Store every billed provider answer with its usage and cost, whatever its outcome". Demonstrated with the existing test "does not take the next item when the pause lands between two items": the gated provider's `resolve()` is called, yet the stored row for the first item is `{"status":"FAILED","error":"cancelled","cost":null}` (probe run of a temporary copy of that test, since removed). With the real SDKs the window is narrow, but the branch exists only for this case.
- Fix: in that branch keep the answer and fall through to the normal guard/score/save (the plan's stated behaviour; the queue is already paused by `cancel()`, so nothing else runs); `cancel()` then reports `cancelled: true` for a request whose answer was kept, so set `cancellable = undefined` before the check or report from the outcome. Second option: keep "cancelled" but store `provided.usage` and its cost on the `FAILED` row, and record the choice as a *Decisions* row.
- Effort: small
- Lesson candidate: no (covered by the existing billed-answer lesson)
- Decision: fixed (37f4214)

### R2: The "pause between two items" test exercises the abort path, and the plan-review 1 case is missing
- Severity: minor
- Where: `apps/api/test/analysis-activity.int.test.ts:352`, `:334`
- Problem: in "does not take the next item when the pause lands between two items" the cancel reaches the runner before it resumes, so the first item is stored as `FAILED`/`cancelled` (probe above) and the per-item gate in `drainOnce` (`service.ts:395`) is never the thing that stops the drain; the assertion `storedFor(t, first).length <= 1` accepts either branch. "keeps an answer that arrived before the cancel..." cancels after `idle()`, when nothing runs. Plan-review 1 (major) asked for: cancel after the provider resolved, assert one call, `COMPLETE` stored, next item `PENDING`, `paused: true`, `cancelled: false`; the deviation says it was applied, but no test pins it, and moving the gate back to the start of the drain would not fail any test.
- Fix: after R1, make the test deterministic: resolve the gated call, wait until the first row is `COMPLETE` while the drain is still in flight (e.g. a second gated call is not yet allowed because a held `sleep` or a stub `nextWaiting` hook pauses between items), then cancel; assert `COMPLETE` for the first, nothing for the second, `paused: true`. Replace `toBeLessThanOrEqual(1)` with the exact expected row.
- Effort: small
- Lesson candidate: Assert the exact outcome of a race test, and check it fails when the guard it names is removed.
- Decision: fixed (37f4214) + lesson proposed

### R3: "Upłynęło … z limitu" keeps counting through backoff and saving
- Severity: minor
- Where: `apps/web/src/AnalysisPage.tsx:83`
- Problem: elapsed time is always `now - attemptStartedAt` and shown against `timeoutMs`. During `backoff`, `attemptStartedAt` is the failed attempt's start, so the line grows past the request time while no request runs (e.g. a 30 s `Retry-After` after a 100 s attempt shows "2 min 10 s z limitu 2 min 0 s"), suggesting a request over its timeout. Same during `saving`.
- Fix: render the elapsed-against-timeout row only when `entry.stage === 'requesting'`; during `backoff` the existing "Następna próba" row already says when the next attempt starts.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d73019c)

### R4: Unused `discard()` on the activity tracker
- Severity: minor
- Where: `apps/api/src/modules/analysis/activity.ts:31`, `:142`
- Problem: `discard()` ("drops the active entry without a history record") has no caller in `src` or `test`; `tracker.start` happens after the budget gate, so there is no path that needs it.
- Fix: remove it from the interface and the implementation.
- Effort: small
- Lesson candidate: no
- Decision: fixed (9411760)
