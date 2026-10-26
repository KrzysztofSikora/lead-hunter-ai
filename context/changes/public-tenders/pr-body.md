# feat(public-tenders): BZP and TED public tenders as signals with a "Przetarg publiczny" card

Roadmap item S-18 (FR-32): Polish (e-Zamówienia BZP) and EU (TED) tenders for software, IT services and R&D now arrive as signals through the existing source loop. The Sources view has two presets with editable CPV prefixes (`72`, `48`, `73`) and, for TED, countries (`PL`). An analysed tender gets evidence level `PUBLIC_TENDER` (never `DIRECT_REQUEST`), and the card shows buyer, submission deadline (Europe/Warsaw) and estimated value, tagged "ze źródła". A failing API is an explicit source error. Covers FR-32 AC1–AC3 and keeps FR-04 AC3. `docs/source-policy.md` has an entry for each API and records that Baza Konkurencyjności stays manual.
Closes #32

> **Status:** Ready for review. **Neither API was reachable from the planning or implementing sessions**, so both response shapes (and the fixtures) are `UNVERIFIED` until the two real-run human checks below are done.

## ⚠ Needs your decision
- **Unverified API shapes.** `bzp/map-notice.ts`, `ted/map-notice.ts` and `ted/query.ts` follow the docs, not a real response. The Phase 2 checkpoint did not stop the run (`WORKFLOW_STOPS=none`), so Phases 3–5 build on that unverified shape. Do the first two human checks before trusting the change.
- **D-13 (costly):** do `bzp`/`ted` skip the pre-filter's `no_profile_match`? → chose **yes, exempt**. Every CPV-matched notice then goes to the paid LLM; volume is bounded by the daily analysis limit (FR-09) and the three CPV divisions, to be read from the checkpoint run's ignored/kept counts. Alternatives: B: keep the rule (most notices rejected before analysis, because Polish titles rarely name the profile's technologies). Switching costs: one line in `modules/analysis/prefilter.ts` (+ test).
- **D-3 (costly):** `PUBLIC_TENDER` is added to the evidence-level axis, which now also encodes a channel. Set by the guard for every `bzp`/`ted` signal whatever the model says. Alternatives: B: a new category (evidence level would still be `DIRECT_REQUEST`, which AC3 rules out); C: a separate flag column. Switching costs: contracts enum, guard, rubric, card, `docs/scoring.md`.
- **D-2 (costly):** tender facts live in a tender-only nullable column `raw_signals.tender_json` (migration `0012`). Plan review 14 asks whether a typed `metadata_json` should come first, because S-19 (code bounties) will need structured facts too. Alternatives: B: generic/typed `metadata_json`; C: `tender_notices` table; D: text only. Switching costs: one migration plus the repository, opportunity and analysis readers, cheap while the column is new.
- **D-1 (costly):** `Source.type` becomes `rss | bzp | ted` and `SourceType` gains `bzp`, `ted`; `SourceAdapter` becomes generic over its config with a registry in `compose.ts`. Additive API contract change that the web app switches on. Alternatives: B: one generic JSON adapter with mapping rules; C: a separate tender job. Switching costs: the contract, service registry and both adapters.
- **D-7 (costly):** CPV prefixes and countries are per-source config (`PATCH /api/sources/:id` accepts `tender`), not env variables. Alternatives: B: env variables; C: fixed defaults.
- **D-18 (cheap but hides a block):** every BZP 403 is read as `rate_limited` (the UZP page's over-limit answer); the reason still carries `httpStatus: 403`. A real access block would wait an hour per attempt. Alternative: `http_status 403`.
- **[REVIEW]** BZP and TED read UTC-day slices (D-21), not one window query; a first run makes at least 4 requests.
- **[REVIEW]** Cursor resume inside a capped day (changed D-9/D-21, review R1/R4/R6): the adapters return `resumeAt` (BZP page number, TED `iterationNextToken`); the service keeps it beside `resumeFrom` and drops it when tender settings are patched or after a failed run that used it. **Assumption, `UNVERIFIED`:** BZP's page order is stable between runs at least 60 minutes apart (no sort is set); otherwise a resumed run can skip notices silently. Alternative: no resume inside a day, move to the next day and log `day_capped` (loses the rest of the day, no ordering assumption). The last human check tests it.
- **Review leftovers:** none open (R1–R6 fixed; R6 by plan edit). `docker:build` / `docker:smoke` were not run (no Docker daemon); run them in CI.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) One real BZP run: result, one sample signal against its notice page, no 403 or 429, the response shape against `bzp/map-notice.ts` (field names, `noticeType` spelling, whether `htmlBody` and the value are present, the notice page URL), the page size in bytes, and the ignored/kept counts in the log. Run: `pnpm db:migrate && pnpm dev`, add "e-Zamówienia (BZP) — IT i oprogramowanie" in Sources and press run, or `pnpm discover` with only it enabled; correct `map-notice.ts` / `adapter.ts` if the shape differs. Evidence: none (needs the real API). Until ticked, Phases 3–4 build on an unverified shape.
- [ ] (Phase 3) One real TED run: result, one sample signal against its notice page, the response shape against `ted/map-notice.ts` and `ted/query.ts` (field names, the `buyer-country` alpha-3 filter and date syntax, date/time forms, multilingual objects, value fields, the link), requests per run and page size in bytes. Run: `pnpm db:migrate && pnpm dev`, add "TED — przetargi IT w Polsce" in Sources and press run, or `pnpm discover` with only it enabled; correct `ted/map-notice.ts` / `ted/query.ts` if the shape differs. Evidence: none (needs the real API).
- [ ] (Phase 4) Open one analysed BZP card at phone width: deadline (Warsaw time), buyer and value read correctly and "Przetarg publiczny" is clear. Run: `pnpm db:migrate && pnpm dev`, run the BZP source, analyse, open the card. Evidence: none (unit-tested in `opportunityCard.test.ts`; needs a real run).
- [ ] (Phase 5) In Sources add both tender presets, change the BZP prefixes to `72, 48` and save; try `7` and a country such as `US` on TED and read the server messages; check the editor and access wording at phone width. Run: `pnpm db:migrate && pnpm dev`, open Źródła. Evidence: none (component-tested in `SourcesPage.test.tsx`; needs a person to judge the wording).
- [ ] (Phase 5) Read the BZP and TED entries in `docs/source-policy.md` ("API: e-Zamówienia…", "API: TED…") against the APIs' current terms pages and tick or correct every `DO WERYFIKACJI` item (terms and licence, TED fair-use scope, field and parameter names after the Phase 2–3 checks). Evidence: none (terms pages unreachable).
- [ ] (Review R6) While running the BZP check, read the same day twice at least 60 minutes apart and compare the order of its pages (the resume position of a capped day assumes a stable order). Evidence: none (needs the real API).

## Other decisions made by the agent (cheap to change)
Full table with reasons: [`plan.md#decisions`](context/changes/public-tenders/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | What does `PUBLIC_TENDER` score? | Same row as `DIRECT_REQUEST` (30 / 22), counts as direct in `confidenceFor`; `SCORING_VERSION` stays 1 | lower row; bump version |
| D-5 | Text of a tender signal | Labelled Polish lines (buyer, deadline, value only if stated, CPV, number) plus the description | API text only; JSON |
| D-6 | Who sets `sourceBudget` | The guard, from `TenderFacts.estimatedValue`; model's value replaced | leave it to the model |
| D-8 | Sources per type | One per type, created from its preset | several with different CPV sets |
| D-9 | Time window | `lastSuccessAt − 24 h` (first run 3 days); page caps; capped run is `partial` (amended, see [REVIEW] above) | adapter-owned cursor; last N days |
| D-10 | 30 req/min to BZP | Spacing in the adapter, injected clock in tests | token bucket in the client |
| D-11 | TED POST | `HttpClient.post`, same SSRF check, semaphore, size cap, no redirects | undici directly |
| D-12 | robots.txt for the APIs | Not consulted; documented API access | check as for feeds |
| D-14 | Fixtures | Synthetic, `DEMO`, marked `UNVERIFIED` (APIs unreachable) | trimmed real pages; recorder |
| D-15 | Card | `SourceFacts.tender`; origin items tagged "ze źródła" | snippet lines only |
| D-16 | Same tender in BZP and TED / manual first | First source owns the opportunity; the other becomes `REPEAT_IMPORT` evidence if URL or hash match; documented, tested | cross-source matching |
| D-17 | Prompt | One rule + enum value; `PROMPT_VERSION` `analysis-2` | no change |
| D-19 | TED country filter | `buyer-country`, alpha-2 in config mapped to alpha-3 | `place-of-performance`; alpha-3 config |
| D-20 | Notice HTML | Cut to 200 000 chars, linear strip, narrow labelled value pattern | linkedom; page size 25 |
| D-22 | "not stated" vs "not read" | `valueState` `stated`/`absent`/`unknown`; "nie podano" only for `absent` | `'not_stated' \| null` |
| D-23 | Page limit | 5 MiB per list request (`too_large` over it); buyer confirmed from `TenderFacts.buyer` | 8 MiB |
| D-24 | BZP spacing | 2 100 ms, health check included | 2 000 ms |
| D-25 | TED notice types | `qu-sy` left out | include it |
| D-26 | TED country allow-list | `TED_COUNTRY_CODES` in `packages/contracts`; PATCH `['US']` is 400 | `validateConfig` in `update` |

## Quality
- Gates ([`review.md`](context/changes/public-tenders/review.md)): typecheck ok, lint ok, unit tests ok (72 files, 1031 tests), e2e ok (5); **image and image smoke not run** (no Docker daemon in the session).
- Review: APPROVE WITH FOLLOW-UPS, 3 rounds. R1–R6 all fixed or answered (R1 `e0b3f01`, R2 `39bc5e3`, R3 `e0b3f01`, R4 and R5 `790ba72`, R6 plan edit); rejected: none; deferred: none. Findings: R1 (a capped day blocked later days), R2 (threshold sentences read as an estimated value), R3 (TED cap made routine runs `partial`), R4 (stale TED token), R5 (service cursor untested), R6 (plan out of date). The final fix commit `790ba72` came after the round-3 review text; its R4/R5 changes were not re-reviewed.
- Mutation: skipped: no `mutation.md` exists for this change (no mutation step ran).  `bug` mutants: none recorded. In review, a manual mutation of `saveCursor` (R5) showed the service cursor was untested; that test now exists.
- Plan review: READY WITH NOTES; 14 findings, answered by D-21–D-26 and plan edits.
- Proposed lessons (commits `7caded4`, `1495958`; drop them to reject): "A resume cursor must make progress on every run; test a unit of work larger than the per-run budget"; "A pattern that extracts a source fact needs negative tests with the domain's look-alike phrasing"; "Drop a stored opaque continuation token when its query changes and after a failed run that used it".

## Follow-ups
- [FOLLOW-UP] Replace the synthetic `bzp-page.json` and `ted-page.json` fixtures with trimmed real pages after the human checks (D-14); `fixtures:record` has no support for API sources.
- [FOLLOW-UP] Bound a TED run by a total request budget as well (e.g. 5 × slices, at most 40).
- [FOLLOW-UP] `llm/prompt.test.ts` does not assert the D-17 rule line (the guard enforces the level anyway).
- Unverified: BZP notice page URL constant, zone-less deadline read as Europe/Warsaw, TED field names and date forms, notice text licence (all `DO WERYFIKACJI` in the policy).

## Commits
```
1bda62e docs(public-tenders): triage review round 3
1495958 docs(public-tenders): propose lessons
790ba72 fix(public-tenders): drop the stored in-day position on a config change or a failed resumed run; test the cursor in the service (R4, R5)
7510e22 docs(public-tenders): review round 3
0d533d2 docs(public-tenders): triage review round 2
7caded4 docs(public-tenders): propose lessons
e0b3f01 fix(public-tenders): keep the position inside a capped day in the cursor; cap TED pages per day (R1, R3)
39bc5e3 fix(public-tenders): read an estimated value only from a label directly followed by the amount (R2)
073109b docs(public-tenders): review round 2
c475b69 docs(public-tenders): pr-body
e73cb3e docs(public-tenders): review
2716067 feat(public-tenders): tender config editor in Sources and source policy entries
60bdc09 feat(public-tenders): classify tenders as PUBLIC_TENDER and show them on the card
6ce063b feat(public-tenders): TED search adapter and preset
4337e09 feat(public-tenders): e-Zamówienia BZP adapter and preset
194a5a7 feat(public-tenders): source types, tender facts storage and the POST client
0b4fff1 docs(public-tenders): plan-review
5829ab0 docs(public-tenders): plan
```

<details><summary>Run</summary>

Base main, stops none, branch `change/public-tenders`. No failed step, no draft reason in the final run. Earlier attempt (07:33–08:39): plan $3.29, plan-review $1.46, five implement sessions $1.18 + $1.35 + $1.08 + $0.92 + $0.50, review $1.84; `fix-review` then failed twice at 08:39 (findings still `open`), and the run was re-run from review.
Final run (12:29–12:48): review round 1 $1.31 (3 open) → fix-review $0.36 → review round 2 $1.08 (3 open) → fix-review $0.25 → 0 open findings. Phases ticked 5/5. Costs listed sum to about $14.
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
