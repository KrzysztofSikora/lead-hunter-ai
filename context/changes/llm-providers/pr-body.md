# feat(llm-providers): real Anthropic and OpenAI-compatible analysis with budget cap, cost, reuse and retry

Roadmap S-05: with `LLM_PROVIDER=anthropic` or `openai-compatible` the existing analysis runner now calls a real model, with the same Zod validation, output guard and deterministic scoring as the mock. A paid provider without `LLM_MONTHLY_BUDGET_USD` analyses nothing, and a reached monthly cap pauses analyses while imports go on. Each analysis stores its cost (or "brak danych"), identical content is reused instead of paid for again, and the card has "Ponów analizę" / "Analizuj ponownie". Covers PRD FR-08 AC1–AC3 and AC7, FR-08 AC4 **partly** (see below), FR-09 AC1–AC5 (AC3 for analyses only, see D-11), and FR-24 AC3.
Closes #6

> **Status:** Ready for review. One gate could not run in the sandbox: `pnpm docker:build` (see Quality).

## ⚠ Needs your decision
- **[REVIEW] FR-08 AC4 is only partly covered.** URLs and e-mails are removed from every text field and `buyerConfirmed` is false unless the buyer is named in the source. Person and company names in free prose are **not** detected; they rely on the card's "wniosek modelu" label (TR-01, S-06). Decide whether that is enough for AC4 or whether name detection should be a follow-up item. ([plan](context/changes/llm-providers/plan.md#deviations))
- **D-3 (costly):** a paid provider whose model has no price is **blocked** (`price_unknown`), which differs from the roadmap's "unknown model → cost 'brak danych'". "brak danych" still applies to free providers and to answers without usage. A paid answer without usage runs uncapped (stored with cost `null`, counted and shown). → chose **block**. Alternatives: B: a paid answer without usage also blocks further analyses (strict cap, one quirky endpoint stops everything); C: charge an estimated upper bound for missing usage. Switching costs: `budgetGate` in `budget.ts` and its tests.
- **D-6 (costly):** prompt-injection boundary. Source content goes only inside `<source_data>` as JSON with every `<` written as `<`; the source URL, operator name, contacts and config are never sent; no tools. → chose **escaped JSON block**. Alternatives: B: per-request random boundary tokens; C: plain text block with "do not follow instructions". Switching costs: `prompt.ts`, `prompt.test.ts`, request assertions in `llm-adapters.int.test.ts`, `docs/llm.md`. Please read `docs/llm.md` "Co jest wysyłane do dostawcy" (human check below).
- **D-8 (costly):** SDK clients use `timeout: 120_000` and `maxRetries: 2`. The SDK retries timeouts and 5xx too, so one analysis can be sent up to three times; if those calls were billed, no usage is reported and the cap never sees them. Documented in `docs/llm.md`, accepted as is. → chose **SDK retries**. Alternatives: B: `maxRetries: 0` and our own backoff, or no retry on timeouts. Switching costs: the two adapter constructors and the timeout tests.
- **D-4 (costly, data shape):** reuse by `content_hash` + prompt version + schema version, new column `analyses.reused_from_analysis_id`. Real providers share one prompt version, so switching Anthropic ↔ OpenAI-compatible reuses earlier results until "Analizuj ponownie" forces. A `null` hash never matches. → chose **key on prompt and schema version only**. Alternatives: B: also key on provider and model; C: reuse only within one opportunity. Switching costs: `findReusable` query, migration `0005` column if B/C drops it.
- **D-10 (costly, public API, data shape):** `POST /api/opportunities/:id/analysis` with `{ force?: boolean }`, column `opportunities.analysis_force`. Without force a `COMPLETE` opportunity is a rescore from the reused result, not a new call. → chose **one additive route**. Alternatives: B: synchronous analysis (bypasses daily limit and budget loop); C: two routes `/retry` and `/reanalyse`. Switching costs: `routes.ts`, contracts, web API client, `analysis-retry.int.test.ts`.
- **D-13 (costly, public API):** `GET /api/analysis/status` gains `provider`, `model`, `paid`, `blocked`, `budget{capMicroUsd, spentMicroUsd, unknownCostCount, monthStart}`; `LatestAnalysis` gains `costMicroUsd`, `reusedFromAnalysisId`. → chose **extend the status**. Alternatives: B: a separate `GET /api/llm/budget`. Switching costs: contracts, service, two web pages.
- **Anthropic structured-output schema is UNVERIFIED.** The model schema is an allow-list transform of `z.toJSONSchema` (`oneOf` → `anyOf`, lengths/ranges/`countries` pattern dropped; Zod still enforces them) and its root stays an `anyOf`. Whether Anthropic accepts a root-level `anyOf` is only known from a real call (human check 1). Fallback D-7 B (prompt-only JSON) is a one-line change in `anthropic.ts` (remove `format`).
- **Plan review leftovers:** none open (verdict READY WITH NOTES; findings #1–#10 are handled in the plan, see Deviations). Review leftovers: none open.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) One real analysis with Anthropic: is the structured-output schema (root `anyOf`, no lengths/ranges) accepted, and is usage reported? `LLM_MONTHLY_BUDGET_USD` was not enforced in Phase 2, but it is now; use a small test key. Run: `.env` with `LLM_PROVIDER=anthropic`, `LLM_API_KEY=<key>`, `pnpm dev`, import `apps/api/test/fixtures/llm/synthetic-direct-pl.txt`, open the card. Evidence: `context/changes/llm-providers/evidence/real-providers.md` (provider, model, tokens, schema accepted yes/no; no key). **Not yet recorded: the `evidence/` directory does not exist.**
- [ ] (Phase 2) One real analysis with an OpenAI-compatible endpoint (Groq free tier or Ollama): was `json_object` accepted and usage reported? Run: `.env` with `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_MODEL` (try `LLM_JSON_MODE=off` if rejected), same import. Evidence: `context/changes/llm-providers/evidence/real-providers.md` (closes the `UNVERIFIED` note). **Not yet recorded.**
- [ ] (Phase 4) Blocked message: with `LLM_PROVIDER=anthropic` and no `LLM_MONTHLY_BUDGET_USD`, open *Okazje* at 360 px width and judge the wording. Run: `pnpm dev`, `.env` as stated, import any text. Evidence: none.
- [ ] (Phase 4) Limit reached message: with `LLM_MONTHLY_BUDGET_USD=0.01` and a real analysis done, open *Okazje* and judge the `budget_reached` wording. Run: as above plus one real analysis. Evidence: none.
- [ ] (Phase 4) Buttons: press "Ponów analizę" on a failed card (wrong `LLM_API_KEY`) and "Analizuj ponownie" on a complete one. Run: open `/okazje/<id>`. Evidence: none.
- [ ] (Phase 4) Read `docs/llm.md` and confirm it matches what the operator is willing to send. Run: `docs/llm.md` section "Co jest wysyłane do dostawcy". Evidence: none.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | Config shape and start-up errors | `LLM_PROVIDER` = `mock` \| `anthropic` \| `openai-compatible`; missing key/URL/model is a `ConfigError` at start, Polish messages | B: "not configured" at runtime; C: one `LLM_URL` DSN |
| D-2 | Price table and overrides | `llm-prices.ts` for Haiku 5.5 and Sonnet 5.5, `LLM_PRICES` override, cost in integer micro-USD rounded up | B: `LLM_PRICE_INPUT/OUTPUT`; C: prices only from `.env` |
| D-5 | Where the budget lives | Pure `budget.ts`, spend = sum of `analyses.cost_micro_usd` in the Warsaw month | B: `llm_usage` ledger table; C: UTC month |
| D-7 | How JSON is requested | Anthropic: structured outputs + `effort: 'low'`, `max_tokens: 8000`; OpenAI-compatible: `json_object` unless `LLM_JSON_MODE=off`; one `parseModelJson`, then always Zod | B: prompt-only JSON; C: tool call with `strict: true` |
| D-9 | Provider error model | `ProviderError { kind, status? }`; stored as `provider_error: <kind>[ <status>]`, never SDK text; drain stops after `auth`/`rate_limited`/`unavailable`/`timeout`; key echo → `invalid_output: secret_echo` | B: keep transient failures `PENDING` with auto-retry; C: store the SDK message |
| D-11 | FR-09 AC3 in this item | Only the analysis limit (20/day) is proved with a real provider; raw-signal (100) and draft (5) limits come with S-10/S-12 and S-07, the brief count with S-13 | B: all three counters now |
| D-12 | FR-08 AC4 guard | Invented URLs/e-mails replaced by `[usunięto]` (or `[…]` when shorter), buyer not in source → `buyerConfirmed = false` | B: flag the whole analysis; C: capitalised-word name heuristics |
| D-14 | Cost of an unpaid provider (plan-review #4) | `LLM_PAID=false` → cost 0; `unknownCount` = non-mock, non-reused rows with `cost IS NULL` | B: `analyses.paid` column |

## Quality
- Gates (review round 2): typecheck ok, lint ok, unit tests ok (39 files, 501 tests), e2e ok (4), mutation n/a (S-05 is not a mutation target), **image fail**: `pnpm docker:build` stops at `pnpm install` inside the image (corepack: "self-signed certificate in certificate chain" from the sandbox proxy), also on the unchanged baseline. Run it on a machine with direct registry access.
- Review: APPROVE, round 2 of 2 (round 1: CHANGES REQUESTED). Fixed 6 (R1 blocker: guard could push a field over its schema limit, now length-safe and re-validated; R2 major: billed refusals/truncations/non-JSON answers now costed; R3–R6 minor: docs escaping, page reset on id change, error table, Polish plural), deferred 0, rejected 0. See [review.md](context/changes/llm-providers/review.md).
- Mutation: skipped: not a mutation target in `context/test-plan.md`; `bug` mutants: none.
- Proposed lessons: "Every provider answer that was billed must be stored with its usage and cost, whatever the outcome." (commit `e134dd0 docs(llm-providers): propose lessons`; drop that commit to reject it).

## Follow-ups
- [FOLLOW-UP] Free-prose person and company names are not detected (FR-08 AC4, TR-01/S-06).
- [FOLLOW-UP] Candidates once a real run shows the need: structured outputs/JSON mode beyond D-7, streaming, prompt caching; Haiku 5.5's > 100K-token price tier is not modelled.
- [FOLLOW-UP] Timeouts and SDK-retried calls are uncosted, so the cap can under-count them (stated in `docs/llm.md`).
- [FOLLOW-UP] Logger `SECRET_KEYS` not extended with `llmApiKey`; `*.apiKey` is one level deep, so a logged `config` object would not be redacted (nothing logs it; the canary test checks DB rows, status and detail, not captured logs).
- [FOLLOW-UP] Race accepted: a forced re-queue arriving while the runner analyses that same row is overwritten by the save; press "Analizuj ponownie" again.
- [FOLLOW-UP] The reused-result line shows no original date (the API exposes only `reusedFromAnalysisId`); after "queued" the card reloads once after 1.5 s, a slower call needs a manual refresh.
- [FOLLOW-UP] Daily limits for raw signals and offer drafts (S-10/S-12, S-07); `LLM_MODEL_OFFER` is parsed but unused until S-07.

## Commits
```
d4eb988 docs(llm-providers): triage review round 2
bcc117c fix(llm-providers): guard note wording and error table (R5, R6)
95f8833 docs(llm-providers): review
9da243c docs(llm-providers): triage review round 1
e134dd0 docs(llm-providers): propose lessons
e2d2c19 fix(llm-providers): state the data-block escaping exactly in docs and plan (R3)
09c75ad fix(llm-providers): reset the opportunity page on id change and clear the reload timer (R4)
e8569ee fix(llm-providers): validate the guarded result and cost billed refusals, truncations and non-JSON answers (R1, R2)
89de5a3 docs(llm-providers): review
3fc551a feat(llm-providers): retry route, cost and budget messages in the UI, provider docs
5e2d0ba feat(llm-providers): runner budget gate, cost, reuse by content hash and failure handling
a1c41d7 feat(llm-providers): Anthropic and OpenAI-compatible adapters
229b0b5 feat(llm-providers): LLM config, price table, budget rules and AC4 output guard
5ed9d47 docs(llm-providers): plan-review
46198e9 docs(llm-providers): plan
```

<details><summary>Run</summary>

Branch `change/llm-providers`, base `main`, started 2026-10-25 12:20 UTC, no failed step, no stop requested.

| Step | Model | Result | Cost |
|------|-------|--------|------|
| plan | opus | success | $2.41 |
| plan-review | opus | READY WITH NOTES | $1.31 |
| implement ×4 (one per phase) | sonnet | success | $0.59 + $0.86 + $0.91 + $0.81 |
| review round 1 | opus | CHANGES REQUESTED, 4 findings | $1.65 |
| fix-review | sonnet | success | $0.50 |
| review round 2 | opus | APPROVE, 2 minor findings | $0.63 |
| fix-review | sonnet | success | $0.10 |

Total about $9.77 (pr-body step not included). Phases ticked 4/4. All steps ran on attempt 1.
</details>

