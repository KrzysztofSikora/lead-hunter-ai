# feat(offer-drafts): editable offer drafts on the card, generated on request and never sent

Roadmap S-07 (offer-drafts). "Przygotuj ofertę" on an opportunity card now asks the configured LLM (or the deterministic mock) for one offer draft, guards it and stores it as the card's current draft. The operator edits, approves, copies, exports Markdown and marks it as sent by hand; the app sends nothing. Regenerating creates a new current draft and keeps the earlier ones readable in the card's history. Drafts count against the same monthly cap as analyses and have their own daily limit (`OFFER_DRAFT_DAILY_LIMIT`, default 5). Covers PRD FR-13 AC1–AC5, FR-09 AC2–AC3 for drafts, FR-24 AC3 for the offer prompt, and the draft step in the e2e main path.
Closes #8

> **Status:** Ready for review

## ⚠ Needs your decision
- **Merge with `main`:** `main` has gained S-16 pi-deployment since this branch started, and `context/roadmap.md` will need a merge (noted in [review.md](context/changes/offer-drafts/review.md)). The run never merges, so this is yours.
- **D-1 (costly):** draft storage shape → chose **one table `offer_drafts`** (editable `subject`, `message_markdown`, `proposal_markdown`; generated plan sections in `content_json`, never edited; failed attempts stored as `FAILED` rows). Alternatives: B: brief §14 columns `scope_json`/`pricing_json`; C: a draft table plus a revisions table with every edit. Switching costs: migration `0010_*`, `schema.ts`, `offer-draft-repository.ts`.
- **D-8 (costly, money):** shared monthly cap → chose **month spend = sum over `analyses` and `offer_drafts`** (`spentSince` in `analysis-repository.ts`), drafts priced with the offer model. Alternatives: B: a separate `llm_usage` ledger (migrates S-05 data); C: separate caps (FR-09 AC2 says one cap stops both). Switching costs: one query.
- **D-19 (costly, schema):** `pricing.model` in the persisted `content_json` v1 → chose **`BillingModel` plus `UNKNOWN`** (`FIXED_PRICE, HOURLY, DAILY, RETAINER, UNKNOWN`) so daily and retainer billing can be stated. Alternative: B: `MonetizationModel` (does not match the profile's billing models). Switching costs: a schema version bump and stored-data handling.
- **D-4 (side effect on the funnel):** generating a draft moves the opportunity to `OFFER_DRAFTED` and "Oznacz jako wysłane" moves it to `CONTACTED`, each only when it is a forward move. Alternative: B: never touch the business status.
- **D-11 / D-17 (what the guard removes):** URLs and e-mails missing from the source and the profile `experience` are removed with a visible note. Phone numbers are not removed (plan-review 2: a digit pattern would cut price ranges). Invented client names, references and past projects in free prose are **not detected**: the prompt forbids them, and the real-provider human check below covers them.
- **[FOLLOW-UP] R1 left open:** `act` with `sent` updates the draft and then moves the business status in two steps; a throw between them leaves `SENT_MANUALLY` without `CONTACTED`. `generate` was fixed (no double billing); `act` was not.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 5) Card at 360 px and on a laptop: plan sections, estimates and the DEMO label are clearly separated from the editable message. Run: `docker compose up --build`, import a DEMO post, press "Przygotuj ofertę". Evidence: `context/changes/offer-drafts/evidence/draft-360.jpg`
- [ ] (Phase 5) Over the LAN IP (plain HTTP), "Kopiuj treść" copies through the fallback or says to select the text by hand. Run: open `http://<pi-ip>:8080`, press "Kopiuj treść", paste elsewhere. Evidence: none
- [ ] (Phase 5) Real provider: with `LLM_PROVIDER=anthropic` and a cap, make one draft for a Polish and one for an English DEMO import; the message is in the source's language, with no references, clients or experience beyond the profile; note the cost shown. Run: "Przygotuj ofertę" on each card. Evidence: save the guarded JSON (no key) under `context/changes/offer-drafts/evidence/`

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/offer-drafts/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | What is editable; what "Kopiuj treść" copies | Editable: subject, short message, B2B proposal; plan sections read-only ("szkic modelu"). Copy = subject + message; "Kopiuj wariant B2B" copies the proposal | One editable document; all sections as a form |
| D-3 | Draft status rule | Pure `nextDraftStatus`, linear `DRAFT → REVIEWED → COPIED_OR_EXPORTED → SENT_MANUALLY`, never back; no action on `SENT_MANUALLY` | Copy straight from `DRAFT`; allow edits after sent |
| D-5 | Synchronous or queued | Synchronous POST, 409 `in_progress` while one runs | Queue with a `GENERATING` state and polling |
| D-6 | Provider shape | New port `OfferDrafter`; adapters implement it next to `LlmProvider` | `draftOffer` on `LlmProvider`; separate adapter classes |
| D-7 | Daily limit | `OFFER_DRAFT_DAILY_LIMIT` (1–100, default 5), failed attempts count | Hard-coded 5; count successes only |
| D-9 | Failed generation | `FAILED` row with reason code, usage and cost; 502; no current draft | Store nothing |
| D-10 | What the model receives | Source, current analysis fields, an explicit profile subset, target language; JSON-escaped, no URL or contact data | Source only; whole profile |
| D-12 | How AC4 detects outbound calls | Recording dispatcher over `MockAgent`; origins must equal exactly the LLM origin | `disableNetConnect()` alone; spy on `node:net` |
| D-13 | Follow-up hint for sent drafts | One string next to the follow-up form; nothing scheduled | Leave to a later item |
| D-14 | No completed analysis | Allowed, card says "Szkic bez analizy" | Refuse with 409 |
| D-15 | Alternative variant | Main = short message; alternative = full B2B proposal | Model picks |
| D-16 | Edits after copying | `save` with changed text from `COPIED_OR_EXPORTED` goes back to `REVIEWED`; UI copies/exports only saved text | Keep the status on save |
| D-18 | Today brief cost | Draft tokens added to `llmUsageSince` | `[FOLLOW-UP]` only |
| D-20 | Concurrency | One draft at a time (global in-flight guard); latency bound about 3 × 120 s | Per-opportunity guard |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (61 files, 848 tests), e2e ok (5 passed); image not run (no Docker daemon in the review sandbox).
- Plan review: READY WITH NOTES. Its 4 majors and 4 minors led to D-16 to D-20 and corrected references in the plan ([plan-review.md](context/changes/offer-drafts/plan-review.md)).
- Review: APPROVE, round 1: fixed 4 (R1 for `generate` only, R2, R3, R4), deferred 1 part (R1 for `act` `sent`, see Follow-ups), rejected 0 ([review.md](context/changes/offer-drafts/review.md)).
- Mutation: skipped: no S-07 module is listed in *Mutation targets* of `context/test-plan.md`; `bug` mutants: none (not run).
- Proposed lessons: none.

## Follow-ups
- [FOLLOW-UP] R1: make `act` with `sent` one transaction (draft status and `CONTACTED` move together, e.g. a repository method taking the move).
- [FOLLOW-UP] FR-09 AC3: show the number of drafts made today, against the limit, in the Today brief (`GET /api/digest/today`). The card shows the limit refusal; the brief does not show the count yet.
- [FOLLOW-UP] S-14: Pipeline/Insights "sent" should count `SENT_MANUALLY` drafts (S-08 D-9).

## Commits
```
d4247f4 docs(offer-drafts): triage review round 1
d3b8b57 fix(offer-drafts): one billed row per call, drop dead history(), honest brief wording, AC4 no-interceptor check (R1-R4)
e5152c1 docs(offer-drafts): review
71de25c feat(offer-drafts): draft panel on the card and the e2e draft step
9932e46 feat(offer-drafts): operator actions on a draft and the no-send proof
a6c1a14 feat(offer-drafts): generate an offer draft with guard, limits and shared cap
57a5257 feat(offer-drafts): offer prompt, adapters and mock draftOffer
1793260 feat(offer-drafts): contracts, offer_drafts table and shared spend
15c6c81 docs(offer-drafts): plan-review
482ec7c docs(offer-drafts): plan
```

<details><summary>Run</summary>

Base `main`, no requested stop, no failed step. Plan review round 1: READY WITH NOTES. Review round 1: APPROVE. Phases ticked 5/5.

| Step | Model | Attempts | Cost |
|------|-------|----------|------|
| plan | opus | 1 | $2.61 |
| plan-review | opus | 1 | $0.94 |
| implement (5 phases) | sonnet | 1 each | $0.83, $0.63, $0.83, $0.36, $0.65 |
| review | opus | 1 | $1.80 |
| fix-review | sonnet | 1 | $0.25 |

Total before pr-body: about $8.90.
</details>
