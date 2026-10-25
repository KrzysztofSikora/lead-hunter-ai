# Review: today-brief

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok, e2e ok (5 passed), image not run (no Docker daemon in this environment; the diff does not touch `Dockerfile` or compose) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/digest.ts` | done | `DigestQuery`, `DigestItem`, `DigestToday` as in *Design*; `WEAK_CATEGORIES` / `WEAK_EVIDENCE` shared by repository and `select.ts` |
| `packages/contracts/src/index.ts` | done | exports |
| `packages/contracts/src/opportunities.ts` | unplanned | `type SourceError` export; logged under *Deviations* |
| `apps/api/src/modules/digest/ports.ts` | done | `countScoredSince` is named `countMainScoredSince` (D-16), same intent |
| `apps/api/src/modules/digest/select.ts` | done | D-4, D-5, D-6, D-7, D-15; `WEAK_LIMIT` added for the weak section |
| `apps/api/src/modules/digest/service.ts` | done | D-2, D-3, D-9, D-10; `DigestToday.parse` before return |
| `apps/api/src/modules/digest/routes.ts` | done | `GET /api/digest/today`, Zod query/response, 400 schema |
| `apps/api/src/modules/digest/select.test.ts` | unplanned | unit tests for the pure selection, incl. the A~B~C chain asked by plan-review 6 |
| `apps/api/src/infrastructure/db/digest-repository.ts` | done | D-11, D-14 (null columns excluded in SQL), latest analysis per candidate |
| `apps/api/src/modules/pipeline/service.ts` | unplanned | `toItem` exported; logged under *Deviations* (plan-review 8) |
| `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts` | done | wiring |
| `apps/api/test/digest.int.test.ts` | done | seeds rows directly instead of a fake provider; logged under *Deviations* |
| `apps/web/src/api/digest.ts` | done | parses the response with the contract |
| `apps/web/src/TodayPage.tsx`, `TodayPage.module.css` | done | §11.1 order, empty state, "wniosek modelu" label, DEMO badge |
| `apps/web/src/App.tsx` | done | `/` renders `TodayPage`; `StatusView` removed |
| `apps/web/src/PipelinePage.tsx` | done | `DueFollowUps` removed, `Item` exported (logged) |
| `apps/web/src/strings.pl.ts` | done | `nav.start = 'Dziś'`, `today` group |
| `e2e/vertical-main-path.spec.ts` | done | clicks "Dziś", `/Nowe sygnały: \d+/`, evidence directory argument |
| `e2e/smoke.spec.ts` | done | empty-state text on `/` after login (plan-review 3) |
| `context/changes/today-brief/evidence/today-360.jpg` | done | Today at 360 px |
| `context/roadmap.md`, `plan.md`, `plan-review.md` | done | workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | FR-16 AC1–AC3, FR-12 AC1 and FR-14 AC4 met; null-score rows cannot make Today 500; near-duplicate invariant holds along chains |
| Design | ok | module behind a port, repository in `infrastructure/db`, pure selection in `select.ts`; one small duplication (R2) |
| Safety | ok | route guarded by auth, query validated with a strict schema, output parsed with the contract, no secrets |
| Tests | concern | the `opportunity` branch of the best next step is never asserted (R1) |
| Simplicity | ok | small functions, constants in one place |
| Plan fidelity | ok | every divergence is logged under *Deviations*; plan-review majors answered (D-14, deviations) |
| Agent decisions | ok | D-1 (costly) lives only in `packages/contracts/src/digest.ts`; a `text` field (alternative B) is additive |

## Findings
### R1: The "opportunity" best next step is never tested
- Severity: minor
- Where: `apps/api/src/modules/digest/service.ts:47`
- Problem: D-10 has three outcomes. The integration tests assert `null` (fresh database) and `follow_up` (seeded day), but no test asserts `kind: 'opportunity'`. The `minScore` test builds a TOP without any follow-up, so it reaches that branch, yet it never checks `bestNextStep`. If the branch were dropped, or picked something other than `top[0]`, the gates would still pass.
- Fix: in the `minScore` test (or a new short case), assert `bestNextStep` equals `{ kind: 'opportunity', opportunityId: <top[0].id>, title, nextAction: 'DEMO krok' }`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (76d0d51)

### R2: Source-error mapping and the DEMO rule are duplicated
- Severity: minor
- Where: `apps/api/src/infrastructure/db/digest-repository.ts:28`, `apps/api/src/modules/digest/service.ts:26`
- Problem: `sourceHealth()` repeats the query and the row→`SourceError` mapping of `createSourceStatusReader` (`apps/api/src/infrastructure/db/source-status-reader.ts`) line for line. Its `ok + error` is also the reader's `checked`. The service repeats `isDemo` (`provider === 'mock'`) from `modules/opportunities/service.ts:74`. When a `SourceError` field or the DEMO rule changes, Today and the list's empty state can drift apart.
- Fix: move the row→`SourceError` mapping into a shared helper in `infrastructure/db` and use it in both readers. Export `isDemo` from one shared module (for example `modules/shared`) and use it in both services.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ee03279, 76d0d51)

### R3: A partial token sum is shown as today's token count
- Severity: minor
- Where: `apps/api/src/infrastructure/db/digest-repository.ts:161`, `apps/web/src/TodayPage.tsx:122`
- Problem: `sum()` skips `NULL`. On a day that mixes mock analyses (tokens `null`) with real-provider analyses, the UI shows "tokeny: wejście 1500, wyjście 300" as if that were the whole day, while some analyses reported nothing. The seeded test shows this: 9 analyses, 2 with tokens, `inputTokens: 1500`. `llm.analyses` is returned but never displayed. The truth-first rule keeps unknowns separate from known values.
- Fix: return the number of analyses that reported tokens (for example `llm.reported`, `count(input_tokens)`) and show "tokeny (n z m analiz): …" when they differ. This is an additive contract field.
- Effort: small
- Lesson candidate: no
- Decision: fixed (76d0d51)
