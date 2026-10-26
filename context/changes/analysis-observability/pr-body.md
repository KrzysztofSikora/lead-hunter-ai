# feat(analysis-observability): analysis activity view, cancel and paused queue

Roadmap S-20 (FR-34). From a phone the operator opens **Analiza** (`/analiza`, linked from `/okazje` and the nav) and sees queued entries, the active entry (opportunity, provider/model, stage, start time, elapsed time against the timeout, attempt number, retry/backoff) and a bounded history with sanitised reason codes. "Anuluj analizę" aborts the app's own request and pending retries, keeps the opportunity and source, and leaves the queue paused until "Wznów kolejkę". An OpenAI-compatible backend gets the caveat that it may keep inferring. CPU temperature and load show with units and measurement time, or "niedostępne". Covers FR-34 AC1–AC6 (AC4 and the Pi parts of AC5 still need the human checks below). No token-level progress and no ETA.
Closes #35

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-3 (costly):** What is a cancelled analysis stored as? → chose **an `analyses` row `FAILED` with error `cancelled`** (opportunity `analysisStatus` `FAILED`, cost `null`). Alternatives: B: a new `CANCELLED` status (exact, but changes the `AnalysisStatus` contract, filters and the card); C: back to `PENDING` (would run first again after resume). Switching costs: contract change plus migration of stored `cancelled` rows. Side effects, accepted in the Phase 2 deviation: a cancel uses a daily analysis slot (`countSince`) and counts as `analysisFailed` in job-run statistics; excluding `cancelled` from `countSince` is the cheaper fix.
- **D-5 (costly):** Cancel API shape → chose **idempotent `POST /api/analysis/cancel` → 200 `{ cancelled, paused: true }`, pauses even when nothing is active**; `POST /api/analysis/resume` → `{ paused: false }`. Alternatives: B: 409 when nothing is active. Switching costs: `routes.ts`, contracts, web client. Note from fix-review R1: when the provider's answer resolved before the abort, the answer is kept (`COMPLETE`), but `cancel()` may still report `cancelled: true`; the UI only reacts to `cancelled: false`.
- **D-6 (costly):** AC4 caveat → chose **always shown for `openai-compatible`** ("Lokalny backend może kontynuować obliczenia, dopóki nie zauważy zamkniętego połączenia (niepotwierdzone)."), `backendMayContinue: true` in the response. Alternatives: B: probe Ollama `/api/ps` after cancel; C: never show it. Switching costs: `service.ts`, strings, one contract field. Whether Ollama actually stops is `UNVERIFIED` until the Pi check.
- **D-8 (costly):** Activity response and reason codes → chose **a closed enum** (`timeout`, `provider_unavailable`, `rate_limited`, `auth`, `bad_request`, `refusal`, `truncated`, `empty`, `invalid_json`, `schema_validation`, `output_rejected`, `internal_error`, `cancelled`), titles ≤ 120 chars, never raw errors. Alternatives: B: show stored `analyses.error` (leaks `internal_error` messages). Switching costs: public API shape, contracts, web.
- **D-1 (behaviour change):** The analysis provider now runs with SDK `maxRetries: 0`; the runner retries `rate_limited`, `unavailable`, `timeout` up to 2 more times (`max(2 s · 2^(n-1), Retry-After)`), and gives up when `Retry-After` > 30 s, where the SDK waited its own limit. Offer drafts keep their SDK retries. Alternative: B: keep SDK retries and wrap `fetch` (backoff stays invisible).

Reply in a review comment, e.g. `D-3: take B`, `R1: revert`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] `/analiza` readable at 360 px, no horizontal scroll, labels clear — run: open `/analiza` on a phone after login — evidence: [analiza-360.png](context/changes/analysis-observability/evidence/analiza-360.png) (idle state, mock provider; overflow 0)
- [ ] On the Pi with local Ollama: start an analysis, see it under *W toku* (model, stage, elapsed against timeout); "Anuluj analizę" moves it to *Historia* as cancelled, queue paused, AC4 caveat shown; `docker compose restart` keeps it paused; "Wznów kolejkę" resumes — run: `/okazje` → retry an analysis, then `/analiza` — evidence: none yet
- [ ] On the Pi: temperature (°C) and load show with a measurement time; note whether `/sys/class/thermal` was readable in the container without a mount (D-7) — run: `/analiza`, section *Urządzenie* — evidence: none yet
- [ ] Whether Ollama stopped inference after the cancel (AC4 `UNVERIFIED`) — run: `ollama ps` and `top` on the Pi after pressing "Anuluj analizę" — evidence: none yet

Plan: [context/changes/analysis-observability/plan.md](context/changes/analysis-observability/plan.md#human-checks)

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Where does the activity history live? | In memory: ring of ≤ 100 entries, ≤ 7 days, history starts at the last app start | B: `analysis_attempts` table (survives restarts, needs a migration); C: derive from `analyses` (no attempt/stage data) |
| D-4 | Is the paused queue persisted? | Yes, `app_meta` key `analysis_paused`, no migration | B: in memory only (a restart would silently resume) |
| D-7 | Where do temperature and load come from? | `/sys/class/thermal/thermal_zone0/temp` and `os.loadavg()`; any failure → `null` ("niedostępne") | B: env var for the path; C: compose bind mount |
| D-9 | Polling | Page polls every 3 s while visible; elapsed computed client-side from server `now` | B: SSE |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (63 files, 870 tests), e2e ok (5/5); **image and image smoke not run** (no Docker daemon in the review environment); mutation n/a (no target from the test plan touched)
- Review: APPROVE, round 2: fixed 4 (R1 major: a resolved provider answer was dropped as cancelled; R2: race test now asserts exact rows; R3: elapsed-against-timeout only while `requesting`; R4: unused `discard()` removed), deferred 0, rejected 0. See [review.md](context/changes/analysis-observability/review.md)
- Plan review: READY WITH NOTES, 9 findings, applied in the phases (see plan *Deviations*). See [plan-review.md](context/changes/analysis-observability/plan-review.md)
- Mutation: skipped: not a mutation-target change (mutation runs only for S-04 and S-09); `bug` mutants: none
- Proposed lessons: one lesson from R2 ("Assert the exact outcome of a race test, and check it fails when the guard it names is removed"); drop commit `c691e48` to reject it

## Follow-ups
- Persisting the activity history across restarts is out of scope (D-2); add `analysis_attempts` if wanted.
- If `/sys/class/thermal` is hidden in the container on the Pi, add a read-only compose mount (D-7, plan *Risks*).
- Known gap: a cancelled paid request may still be billed by the provider for tokens already processed; the row stores cost `null` and is not counted in `unknownCostCount` (plan *Risks*).
- Unplanned small changes logged as `[minor]`: `AnalysisRepository.waitingPreview` (id and title only, instead of full rows on every poll); nav link "Analiza" besides the one on `/okazje`.

## Commits
```
ce4cd9f docs(analysis-observability): review
a1fda94 docs(analysis-observability): triage review round 1
c691e48 docs(analysis-observability): propose lessons
9411760 fix(analysis-observability): remove unused tracker discard (R4)
d73019c fix(analysis-observability): show elapsed time only while requesting (R3)
37f4214 fix(analysis-observability): keep a provider answer that resolved before the abort (R1, R2)
050f691 docs(analysis-observability): review
b5ccc25 feat(analysis-observability): phone view /analiza
f5ff020 feat(analysis-observability): cancel, paused queue and host metrics
cf6800a feat(analysis-observability): abortable provider calls, runner-owned retries and the activity view API
96cae56 docs(analysis-observability): plan-review
e86d93e docs(analysis-observability): plan
```

<details><summary>Run</summary>

Ship analysis-observability (S-20), base main, started 2026-10-26T07:27:51+00:00.

| Step | Model | Attempt | Cost | Result |
|------|-------|---------|------|--------|
| plan | opus | 1 | $1.50 | success |
| plan-review | opus | 1 | $1.04 | READY WITH NOTES |
| implement (phase 1) | sonnet | 1 | $0.97 | success |
| implement (phase 2) | sonnet | 1 | $0.63 | success |
| implement (phase 3) | sonnet | 1 | $0.37 | success |
| review (round 1) | opus | 1 | $1.49 | APPROVE WITH FOLLOW-UPS, 4 open |
| fix-review | sonnet | 1 | $0.26 | success |
| review (round 2) | opus | 1 | $0.49 | APPROVE, 0 open |

Failed step: none. Phases ticked: 3/3. Costs listed so far total $6.75 (the pr-body step was still running when the summary was read).
</details>
