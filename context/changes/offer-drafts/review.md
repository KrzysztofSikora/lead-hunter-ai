# Review: offer-drafts

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (61 files, 848 tests), e2e ok (5 passed, tree clean afterwards), image not run (no Docker daemon in the review sandbox), mutation not run (no S-07 module in *Mutation targets*) · Round: 1

Base: `e27f4a4` (the merge base with `main`; `main` has since gained S-16 pi-deployment, and
`context/roadmap.md` will need a merge).

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/offer-drafts.ts`, `index.ts` | done | Content, statuses, `nextDraftStatus` with D-16 `changed`, patch union, refusal/failure/conflict bodies; `pricing.model` is `BillingModel \| UNKNOWN` (D-19) |
| `packages/contracts/src/opportunities.ts` | done | `offerDraft`, `offerDraftHistory` |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0010_*` (+ meta) | done | D-1 columns, FK cascade, both indexes |
| `apps/api/src/infrastructure/db/offer-draft-repository.ts` | done | Plus `createOfferSourceReader` (logged deviation) |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | `spentSince` sums both tables (D-8) |
| `apps/api/src/infrastructure/db/digest-repository.ts` | done | D-18 tokens added; `analyses` now counts drafts too (logged [minor]; see R3) |
| `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/ports.ts`, `service.ts` | done | Current draft + up to 20 history rows; `content` through `parseStored` |
| `packages/config/src/env.ts`, `.env.example` | done | `OFFER_DRAFT_DAILY_LIMIT` 1–100, default 5 |
| `apps/web` compile fixes (`opportunityCard.test.ts`) | done | |
| `apps/api/test/analysis-llm.int.test.ts` | done | Seeded paid draft raises spend and blocks analysis at the cap |
| `apps/api/src/modules/offers/ports.ts` | done | Created in Phase 1 (logged) |
| `apps/api/src/infrastructure/llm/prompt.ts` | done | `toModelSchema`, exported `escapeJson` (logged) |
| `apps/api/src/infrastructure/llm/offer-prompt.ts` | done | Fixed prompt; Polish working notes (logged) |
| `anthropic.ts`, `openai-compatible.ts` | done | One private `request`; offer effort `medium`, 8000 / 6000 tokens |
| `mock.ts`, `mock.test.ts` | done | Deterministic DEMO / MOCK templates, pl/en |
| `create-provider.ts` | done | `createOfferDrafter`, `offerDrafterDeps` priced for the offer model |
| `llm-adapters.int.test.ts`, `fixtures/llm/*-offer-valid.json` | done | |
| `docs/llm.md` | done | Section "Szkic oferty (prompt `offer-1`)" |
| `apps/api/src/modules/analysis/output-guard.ts` | done | `removeInventedLinks` exported, unchanged |
| `apps/api/src/modules/offers/output-guard.ts` | done | URLs and e-mails only (D-17) |
| `apps/api/src/modules/offers/service.ts` | done | `generate`, `act`; global in-flight guard (D-20) |
| `apps/api/src/modules/offers/routes.ts` | done | POST and PATCH with typed responses |
| `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts` | done | `AppDeps.offers` is the built service (logged) |
| `apps/api/test/offer-drafts.int.test.ts` | diverged | All planned cases present; D-12's second assertion ("no `MockAgent` interceptor other than the LLM was registered") is missing (R4) |
| `apps/web/src/OfferDraftPanel.tsx`, `OpportunityPage.module.css`, `OpportunityPage.tsx` | done | Plan sections in a collapsed `<details>` (logged) |
| `apps/web/src/CardActions.tsx` | done | Working button, busy text, per-code messages; `offerLater` removed |
| `apps/web/src/offerMarkdown.ts`, `clipboard.ts`, `api/offerDrafts.ts`, `strings.pl.ts` | done | |
| `e2e/vertical-main-path.spec.ts` | done | Draft step replaces "Oznacz jako kontakt"; evidence only with `E2E_EVIDENCE=1` |
| `context/test-plan.md` | done | TR-01, TR-04 |
| `context/changes/offer-drafts/evidence/draft-360.jpg` | done | |
| `apps/web/src/CardPipeline.tsx` | unplanned | D-13 hint next to the follow-up form, which is what D-13 says; fine |
| `e2e/smoke.spec.ts` | unplanned | Logged under *Deviations* |
| `apps/api/src/modules/digest/ports.ts`, `apps/api/test/digest.int.test.ts` | unplanned | D-18 doc comment and its test |
| `packages/contracts/src/offer-drafts.test.ts`, `apps/api/test/offer-draft-repository.int.test.ts`, `packages/config/src/env.test.ts`, `apps/web/src/clipboard.test.ts`, `apps/web/src/offerMarkdown.test.ts` | unplanned | Unit tests for planned code; fine |
| `context/roadmap.md`, `plan.md`, `plan-review.md` | unplanned | Workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | ACs met and tested; generate/act write the draft and the business move in separate steps, so an error after the insert leaves a double-billed pair of rows (R1) |
| Design | ok | New `modules/offers` respects layering; `OfferDrafter` port keeps analysis code and fakes unchanged |
| Safety | ok | Fixed system prompt, JSON-escaped blocks, explicit D-10 profile pick, secret-echo check, reason codes only, nothing sent but the LLM call |
| Tests | ok | Behavioural integration tests for AC1–AC5, limits, cap, failures, two-step D-16 path; recording dispatcher for AC4; e2e covers the UI path |
| Simplicity | concern | `history()` repository method is unused by production; history mapping parses each row's content to read its status (R2) |
| Plan fidelity | ok | All deviations logged; one planned AC4 assertion missing (R4) |
| Agent decisions | ok | D-1 and D-8 (costly) each live in one place (`offer_drafts` schema; `spentSince`) and could be swapped as claimed |

## Findings
### R1: A failure after the draft insert stores a second, billed FAILED row and answers 502
- Severity: minor
- Where: `apps/api/src/modules/offers/service.ts:244-252`
- Problem: `stored('DRAFT', …)` and `moveForward(opportunityId, 'OFFER_DRAFTED')` sit in the same `try` whose `catch` calls `fail('internal_error', billed)`. If anything after the insert throws (the status transaction, `ActivityMetadata.parse`), a `FAILED` row with the same usage and cost is inserted next to the `DRAFT` row. The month spend then counts that one provider call twice, the daily limit counts two attempts, and the route answers 502 although a current draft now exists. `act` has the same split for `sent` (`repository.update` then `moveForward`, two transactions), so a throw there leaves `SENT_MANUALLY` with a 500 and no `CONTACTED` move.
- Fix: insert the draft and apply the D-4 move in one `db.transaction` (a repository method such as `insertWithMove`), or at least move `moveForward` out of the `try` so a failure there cannot add a second billed row. Same for `sent` in `act`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d3b8b57; generate only. act `sent` still updates then moves in two steps, FOLLOW-UP in plan.md)

### R2: Dead `history()` repository method and a content parse per history row
- Severity: minor
- Where: `apps/api/src/infrastructure/db/offer-draft-repository.ts:51`, `apps/api/src/modules/opportunities/service.ts:226`
- Problem: `OfferDraftRepository.history` is only called from `offer-draft-repository.int.test.ts`; the card reads the same rows through a second query in `opportunity-repository.ts` with its own limit constant (`OFFER_HISTORY_LIMIT + 1`). Two definitions of "current + history" can drift. Separately, `toOfferHistory` builds a full `toOfferDraft(row)` (Zod parse of `content_json` and guard notes) only to read `status`, for up to 20 rows on every card load.
- Fix: drop `history()` from the port and repository (or use it from the opportunity repository), and map `status: row.status as OfferDraftStatus` directly in `toOfferHistory`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d3b8b57)

### R3: The Today brief now calls drafts "analiz"
- Severity: minor
- Where: `apps/api/src/infrastructure/db/digest-repository.ts:174`, `apps/web/src/strings.pl.ts:152-153`
- Problem: D-18 (logged as [minor]) makes `llm.analyses` count analyses plus drafts, but the UI still renders `(${reported} z ${analyses} analiz)` under "Koszt analizy dzisiaj". With one paid analysis that reported tokens and one draft that failed without usage (e.g. a timeout, stored with null tokens), the brief says "(1 z 2 analiz)" although only one analysis ran. The contract field name may stay, but the visible text is now untrue (CLAUDE.md "Truth first").
- Fix: change the two strings to name LLM calls ("wywołań LLM", "Koszt LLM dzisiaj"), keeping the contract field.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d3b8b57; only the parenthetical, the label "Koszt analizy dzisiaj" is fixed by PRD)

### R4: AC4 test omits the planned "no other interceptor" assertion
- Severity: minor
- Where: `apps/api/test/offer-drafts.int.test.ts:454`
- Problem: D-12 chose "recorded origins equal exactly `[LLM origin]` **and** no `MockAgent` interceptor other than the LLM was registered". Only the first half is asserted. The recorder alone already catches any dispatched request, so the proof holds, but the plan and the test disagree and no *Deviations* line says why.
- Fix: add `expect(mocks.pendingInterceptors()).toEqual([])` (the LLM one is consumed) after the steps, or log a `[minor]` deviation that the recorder makes the second check redundant.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d3b8b57)
