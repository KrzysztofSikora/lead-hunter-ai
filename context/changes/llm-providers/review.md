# Review: llm-providers

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok (39 files, 497 tests), e2e ok (4), image fail (sandbox: corepack cannot fetch pnpm through the proxy, "self-signed certificate in certificate chain"; environmental, same as the logged Phase 2/4 deviations), mutation n/a (S-05 is not a mutation target) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/config/src/env.ts` | done | D-1 variables, `LlmConfig`, Polish messages, `LLM_PRICES` check |
| `packages/config/src/llm-prices.ts` | done | D-2 table with date and source |
| `packages/config/src/index.ts` | done | exports |
| `packages/config/src/env.test.ts` | done | provider/default/missing/budget/prices tables |
| `apps/api/src/modules/analysis/budget.ts` + test | done | `costMicroUsd` (ceil, null), `budgetGate` (D-3) |
| `apps/api/src/modules/shared/warsaw-day.ts` + test | done | `startOfWarsawMonth` |
| `apps/api/src/modules/analysis/output-guard.ts` + test | done | D-12; see R1 |
| `apps/api/src/infrastructure/logging/logger.ts` | absent | logged `[minor]` deviation (no `llmApiKey` redaction) |
| `.env.example` | done | all new variables, key marked secret |
| `apps/api/package.json`, `pnpm-lock.yaml` | done | exact pins `@anthropic-ai/sdk@1.3.0`, `openai@7.43.0` |
| `apps/api/src/modules/analysis/ports.ts` | done | names, `paid`, `ProviderError`, repository port |
| `apps/api/src/infrastructure/llm/{prompt,parse-json,errors,anthropic,openai-compatible,create-provider}.ts` | done | D-6..D-9; see R2 |
| `apps/api/src/infrastructure/llm/mock.ts` | done | `paid = false` |
| `apps/api/src/infrastructure/llm/{parse-json,prompt}.test.ts` | done | fence, escaping, schema allow-list |
| `apps/api/test/llm-adapters.int.test.ts` + `test/fixtures/llm/*` | done | extra fixtures (`analysis-valid`, `anthropic-truncated`, `openai-length`) serve planned cases |
| `apps/api/src/server.ts`, `apps/api/test/helpers/app.ts` | done | `createLlmProvider`, `llmRunnerDeps` |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0005_sour_riptide.sql` + meta | done | additive columns and index as designed |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | `countSince`, `spentSince`, `findReusable`, `requeue`, `exists` |
| `apps/api/src/modules/analysis/service.ts` | done | flow per *Design*; see R1, R2 |
| `packages/contracts/src/{analysis,opportunities,index}.ts` | done | D-10, D-13 additive |
| `apps/api/src/modules/opportunities/{ports,service}.ts`, `infrastructure/db/opportunity-repository.ts` | done | cost and reuse id on `LatestAnalysis` |
| `apps/api/test/analysis-llm.int.test.ts` | done | AC1–AC5 paths; log canary not asserted (logged) |
| `apps/api/test/analysis.int.test.ts` | done | status shape grew, no assertion removed |
| `apps/api/src/modules/analysis/routes.ts` | done | `POST /api/opportunities/:id/analysis` (logged location) |
| `apps/api/src/app.ts` | absent | not needed: the runner already is `deps.analysis`, `requeue` added to `AnalysisRouteDeps` |
| `apps/api/test/analysis-retry.int.test.ts` | done | 202/409/404/400/401 paths |
| `apps/api/test/openapi.int.test.ts` | absent | planned "no change expected"; passes |
| `apps/web/src/{api/analysis.ts,OpportunityPage.tsx,OpportunitiesPage.tsx,strings.pl.ts}` | done | buttons, cost line, budget messages; see R4 |
| `apps/web/src/OpportunitiesPage.test.tsx`, `apps/web/src/usd.ts` + test | unplanned | budget-message tests and the USD formatter the cost line needs |
| `docs/llm.md`, `README.md`, `context/test-plan.md` | done | see R2, R3 for two inaccuracies in `docs/llm.md` |
| `context/roadmap.md` | unplanned | status column only |
| `context/changes/llm-providers/{plan,plan-review}.md` | unplanned | workflow artifacts |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | fail | guard output can break the schema and is stored unvalidated (R1); billed refusals/truncations escape the cap (R2) |
| Design | ok | adapters behind the port, pure budget module, one `complete()` path for reuse and provider answers |
| Safety | ok | key only in auth header, SDK text never stored, escaped data block, no tools; secret-echo check |
| Tests | concern | broad and behavioural, but no test for a guard edit that crosses a schema limit (R1) or for cost of a refusal/truncation (R2) |
| Simplicity | ok | small modules, no dead code found |
| Plan fidelity | ok | every planned file present or absent with a reason; deviations logged |
| Agent decisions | ok | D-4/D-10/D-13 (costly) each live in one repository method / route / contract block |

## Findings
### R1: Guarded result can violate `OpportunityAnalysis` and is stored without re-validation
- Severity: blocker
- Where: `apps/api/src/modules/analysis/output-guard.ts:129`, `apps/api/src/modules/analysis/service.ts:103-139`
- Problem: `removeInventedLinks` replaces each invented URL/e-mail with `[usunięto]` (10 chars). A shorter invented value (`a@b.pl`, `www.a.pl`) makes the string longer, so a field near its `max` (500/2000) ends up over the limit. `complete()` stores `JSON.stringify(guarded.result)` without parsing it again; on read `parseStored(OpportunityAnalysis, …)` returns `null`, so a `COMPLETE`, scored opportunity shows no analysis on the card. Reproduced with a scratch vitest: `nextAction = 'x'.repeat(493) + ' a@b.pl'` (500 chars, valid) → guarded length 504, `OpportunityAnalysis.safeParse(...).success === false`; `problem = 'see www.a.pl '.repeat(150)` (1950 chars) → 2250 chars, invalid, plus 150 guard notes. This is the exact pattern of the binding lesson "Validate every value against its contract schema before storing it" (analysis-and-scoring R1).
- Fix: in `complete()`, run `OpportunityAnalysis.parse(guarded.result)` before `saveComplete` (a failure falls into the existing `internal_error` path, or better a dedicated `invalid_output: guard`), and make the guard length-safe: clip the replaced string to the field's limit or use a replacement no longer than the removed value; cap the per-analysis link notes (e.g. one note with a count after N). Add a guard test that crosses `SHORT`/`LONG`.
- Effort: small
- Lesson candidate: no (covered by the existing lesson; this is a breach of it)
- Decision: open

### R2: Billed refusals, truncations and non-JSON answers are not costed, so the monthly cap under-counts
- Severity: major
- Where: `apps/api/src/infrastructure/llm/anthropic.ts:59-66`, `apps/api/src/infrastructure/llm/openai-compatible.ts:63-71`, `apps/api/src/infrastructure/llm/parse-json.ts:8`, `apps/api/src/modules/analysis/service.ts:218-229`
- Problem: both adapters have `response.usage` in hand but throw `ProviderError('refusal' | 'truncated' | 'empty')` or a `SyntaxError` from `parseModelJson` before returning it, and the runner stores those `FAILED` rows with `cost_micro_usd = NULL`. None of these kinds stops the drain (D-9), so a model that keeps hitting `max_tokens` (8 000 output tokens on Anthropic, thinking included) burns up to `ANALYSIS_DAILY_LIMIT` billed calls a day that `spentSince` never sees; with `LLM_MODEL=claude-sonnet-5-5` that is about 1.60 USD/day outside a cap the PRD treats as hard (FR-09 AC2, TR-08). The Phase 3 deviation accepts this only for not-JSON; `docs/llm.md` ("Wywołanie, które przekroczyło czas…") does not mention refusal/truncation, so the operator is told something narrower than the code does.
- Fix: carry usage on the failure: give `ProviderError` an optional `usage` (set it for `refusal`/`truncated`/`empty`) and have the adapters catch the `SyntaxError` from `parseModelJson` and rethrow it as a value that also carries usage (e.g. `ProviderError('not_json')` with usage, stored as `invalid_output: not_json`); in the runner's catch, bill `costMicroUsd(error.usage, price)` via the existing `billed` path. Add one integration test per kind asserting the cost row. Truly unknown cases (timeouts, SDK retries) stay documented as uncosted.
- Effort: small
- Lesson candidate: Every provider answer that was billed must be stored with its usage and cost, whatever the outcome.
- Decision: open

### R3: `docs/llm.md` misstates the data-block escaping
- Severity: minor
- Where: `docs/llm.md:26-27`
- Problem: "każdy znak `<` jest zapisany jako `<`" — the replacement is shown as the same character. The code writes `<` (`prompt.ts`, `escapeJson`). This is the page the operator must read and approve in a Phase 4 human check ("confirm it matches what the operator is willing to send"), so it should be exact. The same garbling is in plan D-6.
- Fix: write `` `<` `` in `docs/llm.md` (and in plan D-6).
- Effort: small
- Lesson candidate: no
- Decision: open

### R4: Opportunity page no longer resets to "loading" when the id changes
- Severity: minor
- Where: `apps/web/src/OpportunityPage.tsx:28-38`
- Problem: `setLoad({ state: 'loading' })` was removed from the effect (to avoid a flash on the post-request reload). The effect also runs on an `id` change, so navigating from one opportunity to another keeps rendering the previous one, including its "Ponów analizę" / "Analizuj ponownie" button bound to the old id, until the new fetch resolves; a fetch error leaves the old detail replaced only by the error state. The 1.5 s `setTimeout(onRequested, …)` is also not cleared on unmount.
- Fix: reset to `loading` when `id` changes (e.g. keep `setLoad({ state: 'loading' })` but skip it when only `reloads` changed, or key `<Detail>` / the page on `id`), and clear the timeout in the button's cleanup.
- Effort: small
- Lesson candidate: no
- Decision: open
