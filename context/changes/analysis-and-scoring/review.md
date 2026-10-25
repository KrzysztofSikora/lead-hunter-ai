# Review: analysis-and-scoring

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (32 files, 376 tests), e2e ok (4 tests), image fail (environment: corepack cannot fetch pnpm 12.15.0 inside the build, "self-signed certificate in certificate chain" from the sandbox proxy, at `RUN pnpm install --frozen-lockfile --prod`, before any project code; same as round 1 and the Phase 3 deviation), mutation not re-run (`mutation.md`: 98.5 %, target 80 %) · Round: 2

Round 2 re-checked the fix commits `54c05d7..01de258` against R1-R6. All six are fixed in the code and covered by new tests (R1: `listed()` caps names, excluded term trimmed to 80, `ScoreBreakdown.parse` before `saveComplete` inside the `internal_error` catch; R2: `quoteStates` plus empty-needle rejection; R3: grouped-thousands regex with decimals; R4: `analysisOf` returns a summary for `COMPLETE` rows with a provider; R5: country uppercased, decimal amount, `maxAgeDays <= 3650`, currency message; R6: both sections added and match `prefilter.ts`, `output-guard.ts` and `strings.pl.ts`). Two new problems found in the R2/R3 fixes: R7, R8.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/analysis.ts`, `index.ts` | done | D-7 union, breakdown refine, enums, constants |
| `packages/contracts/src/analysis.test.ts` | done | schema boundaries (TR-07) |
| `packages/contracts/src/classification.ts` | unplanned | logged under *Deviations* (Phase 4, import cycle) |
| `packages/contracts/src/opportunities.ts` | done | `SKIPPED`, `demo`, `prefilter`, `latestAnalysis`, D-13 query params with refine |
| `apps/api/src/modules/scoring/rubric.ts`, `score.ts` + tests | done | D-2/D-3; profitability change logged as `[REVIEW]` (plan-review #7) |
| `docs/scoring.md` | done | pre-filter (D-6) and guard (D-14) sections added in round 1 fixes (R6) |
| `apps/api/src/modules/analysis/cues.ts`, `prefilter.ts`, `output-guard.ts` | done | D-6, D-14 |
| `apps/api/src/modules/analysis/output-guard.test.ts` | done | TR-01, FR-10 AC3 |
| `apps/api/src/modules/analysis/prefilter.test.ts` | unplanned | logged (Phase 2) |
| `apps/api/src/modules/analysis/ports.ts` | done | record types logged (Phase 2) |
| `apps/api/src/modules/shared/warsaw-day.ts` + test | done | test logged (Phase 2) |
| `apps/api/src/infrastructure/llm/mock.ts` + test | done | D-15; test logged (Phase 2) |
| `apps/api/test/fixtures/llm/*` | done | five DEMO fixtures |
| `packages/config/src/env.ts`, `env.test.ts`, `.env.example` | done | three variables, defaults stated |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0004_*`, `meta/*` | done | D-8, additive |
| `apps/api/src/infrastructure/db/analysis-repository.ts` | done | `moveTo` logged (Phase 3) |
| `apps/api/src/modules/analysis/service.ts` | done | runner, shared in-flight promise logged (Phase 3) |
| `apps/api/src/modules/analysis/routes.ts` | done | `GET /api/analysis/status` |
| `apps/api/src/modules/signals/routes.ts` | done | `onCreated` after `created` only |
| `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts` | done | wiring, timer and start-up kick in `server.ts` only |
| `apps/api/test/helpers/analysis.ts` | unplanned | test helper for the integration tests; harmless |
| `apps/api/test/analysis.int.test.ts` | done | every planned case present, plus a save-failure case |
| `apps/api/src/modules/opportunities/{ports,service}.ts`, `opportunity-repository.ts` | done | D-12/D-13; `clock` dep logged (Phase 4) |
| `apps/api/test/opportunities.int.test.ts` | done | FR-10 AC6 and DTO tests |
| `apps/web/src/api/analysis.ts`, `api/opportunities.ts` | done | major→minor units logged (Phase 5) |
| `apps/web/src/OpportunitiesPage.tsx`, `.module.css` | done | status line, badge, filters, "Tylko ≥ 65" |
| `apps/web/src/OpportunityPage.tsx`, `.module.css` | done | *Analiza* section |
| `apps/web/src/strings.pl.ts` | done | `seeking_work` = "oferta wykonawcy, nie zlecenie"; `amountNeedsCurrency` (R5) |
| `apps/web/src/OpportunitiesPage.test.tsx` | unplanned | added by the R5 fix; component tests for the filter form |
| `context/lessons.md` | unplanned | two proposed lessons from R1, R2 |
| `e2e/smoke.spec.ts` | done | analysed state, five components, hypothesis label, screenshots |
| `README.md` | done | *Co działa*, *Co wymaga kluczy*, variables |
| `context/changes/analysis-and-scoring/{plan,plan-review,mutation}.md`, `evidence/*.png` | done | workflow artifacts |
| `context/roadmap.md` | done | status column only |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | concern | R1-R6 fixed; the new mock regex reads "1,500 USD" as 500 USD (R8) |
| Design | ok | ports respected, runner small and serial, costly decisions each in one place |
| Safety | concern | the budget guard now checks the amounts, but not the currency nor where the quote starts and ends in the source (R7) |
| Tests | ok | each fix has a behaviour test; the gaps in R7/R8 are untested cases, not weak assertions |
| Simplicity | ok | integer tables, small helpers, no premature abstraction |
| Plan fidelity | ok | `docs/scoring.md` now complete; all other files as planned or logged |
| Agent decisions | ok | D-5/D-7/D-8/D-11/D-12/D-13 each implemented in one place; the profitability `[REVIEW]` deviation is documented in `docs/scoring.md` and needs the user's call at the PR |

## Findings
### R1: Breakdown longer than the contract is stored unvalidated and then silently dropped on read
- Severity: major
- Where: `apps/api/src/modules/scoring/rubric.ts:99`, `apps/api/src/modules/analysis/service.ts:132`, `apps/api/src/modules/opportunities/service.ts:91`
- Problem: the skill-fit justification joins every matched profile term (up to 20 terms of up to 80 characters each), but `ScoreComponent.justification` allows at most 500 characters. `scoreAnalysis` output is saved without a `ScoreBreakdown` parse, and `parseStored` turns a failing parse into `null`. Checked with a script: 15 profile skills of about 40 characters, all in `relevantSkills`, give a 665-character justification and `ScoreBreakdown.safeParse(...).success === false`. The opportunity then shows a score in the list, but the detail has `breakdown: null` and shows no components, with no error anywhere. This breaks FR-10 AC1 for that row and the "nothing swallowed" rule. The excluded-technology text can also go over 500 characters, because it embeds the untrimmed model string (up to 500 characters).
- Fix: limit the generated justifications so they fit (for example, list at most the first N matched names plus "i N innych", and use the trimmed profile term instead of the raw model string), and validate with `ScoreBreakdown.parse` in the runner before `saveComplete`, so a violation becomes `internal_error` instead of unreadable stored data. Add a rubric test with 20 long matched terms.
- Effort: small
- Lesson candidate: Validate every value against its contract schema before storing it, not only when reading it back.
- Decision: fixed (54c05d7) + lesson proposed

### R2: The output guard keeps any budget amount as long as the quote text occurs somewhere
- Severity: major
- Where: `apps/api/src/modules/analysis/output-guard.ts:241-245`
- Problem: `sourceBudget` survives when `quote` is a substring of the source. The amounts are not compared with the quote. Checked with a script: the source "We are hiring. What is your budget? …", with `quote: "budget"` and `minMinor 5 000 000 / maxMinor 9 000 000 PLN`, keeps the budget with no note. The UI shows "50 000–90 000 PLN — ze źródła: „budget”", the amount column feeds the `minAmount` filter, and profitability scores it. D-14 claims TR-01 (an invented budget shown as fact, impact H) holds "for any provider", so S-05's real models would get no protection here. The same guard also keeps an empty string `""` as a verified source fact, because `includes('')` is always true and the schema allows empty strings.
- Fix: require the quote to contain both amounts. For example, extract the digit groups of the quote (separators normalised) and require `minMinor/100` and `maxMinor/100` among them, otherwise drop the budget and add a note. Reject empty or whitespace-only facts and quotes (`.min(1)` on the fact items or a guard check). Add both cases to `output-guard.test.ts`.
- Effort: small
- Lesson candidate: A guard that verifies a quote must also verify the values derived from it.
- Decision: fixed (1ea746a) + lesson proposed

### R3: Mock budget regex misreads decimal separators and neighbouring numbers
- Severity: minor
- Where: `apps/api/src/infrastructure/llm/mock.ts:23-27`
- Problem: `whole()` strips every non-digit, so "Budżet: 1.500,00 zł" becomes `minMinor = maxMinor = 15 000 000` (150 000 PLN), and "start w 2026 500 zł" becomes 2 026 500 PLN (both checked with a script). The quote is real, so the guard keeps it, and the detail shows the wrong amount labelled "ze źródła". It also drives profitability and the `minAmount` filter. The result is DEMO-labelled, but the number sits next to a source-fact label.
- Fix: parse a decimal part (`[.,]\d{1,2}` at the end) as minor units and treat space/dot only as thousands separators in groups of three (`\d{1,3}(?:[ .]\d{3})*`), so "2026 500" no longer joins. Add the two strings to `mock.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d4180a8)

### R4: An INSUFFICIENT_DATA mock result is shown in the list without the DEMO / MOCK label
- Severity: minor
- Where: `apps/api/src/modules/opportunities/service.ts:51`, `apps/web/src/OpportunitiesPage.tsx:322`
- Problem: `analysisOf` returns `null` while category, evidence, score and confidence are all null, which is exactly the insufficient-data case. `demo` is therefore never sent, and the list shows "Analiza: gotowa · brak oceny" plus the `NEEDS_VERIFICATION` status the mock caused, with no `DEMO / MOCK` badge. FR-08 AC6 says every view that shows mock results labels them. The detail does show the banner.
- Fix: return a summary (with `demo`) whenever `analysis_provider` is set and the status is `COMPLETE`, or show the badge from a top-level `demo` derived from `analysis_provider`. Assert the badge for the 50-character case in the DTO test.
- Effort: small
- Lesson candidate: no
- Decision: fixed (fb775ed)

### R5: Filter form silently drops or breaks on some inputs
- Severity: minor
- Where: `apps/web/src/OpportunitiesPage.tsx:46-52`, `apps/web/src/api/opportunities.ts:55`
- Problem: (a) a minimum amount without a currency stays in the form and the URL but is never sent (`filters.currency` falsy), so the list looks filtered but is not; (b) a lowercase country ("pl") fails `/^[A-Z]{2}$/` and is ignored; (c) a decimal amount ("1500.50") fails `positiveInt` and is ignored; (d) `maxAgeDays` above 3650 passes `positiveInt`, then the API answers 400 and the list shows the generic load error.
- Fix: uppercase the country before checking it, accept decimals for the amount (or set `step=1` and say so), cap `maxAgeDays` at the contract's 3650 (`max` on the input and in `readQuery`), and when a minimum amount has no currency, show a field message (or make currency `required` once an amount is entered).
- Effort: small
- Lesson candidate: no
- Decision: fixed (21aab4a)

### R6: `docs/scoring.md` lacks the pre-filter rules and the evidence guard the plan puts there
- Severity: minor
- Where: `docs/scoring.md`
- Problem: Phase 1 lists "pre-filter rules (D-6) and the evidence guard (D-14)" as content of `docs/scoring.md`. The file covers only the rubric, confidence and versions. The human check "the rubric is understandable and the numbers match" holds, but nothing documents why a post was rejected or downgraded, and no deviation records the omission.
- Fix: add two short sections: the D-6 rule order with the Polish UI texts, and the D-14 guard (quote check, dropped facts, `DIRECT_REQUEST`/paid-category downgrade without a hiring/payment cue, notes).
- Effort: small
- Lesson candidate: no
- Decision: fixed (01de258)

### R7: The budget guard accepts a quote cut from the middle of a number and any currency
- Severity: major
- Where: `apps/api/src/modules/analysis/output-guard.ts:28-31`, `:40-43`, `:56-62`
- Problem: after the R2 fix the guard checks that the quote is a substring of the source and that the quote's numbers include `minMinor`/`maxMinor`. It checks neither the quote's boundaries in the source nor the currency. Checked with a script against `guardAnalysis`: (a) source "Szukam programisty. Budżet 1 500 zł za całość.", budget `{ minMinor: 50 000, maxMinor: 50 000, PLN, quote: "500 zł" }` is kept with no note, so the UI would show "500 PLN — ze źródła: „500 zł”" for a 1 500 PLN post; (b) source "budżet 8000-12000 PLN", budget with `currency: "EUR"` and the exact quote is kept with no note, so the amount column, the `minAmount`/`currency` filter and profitability use EUR. The mock itself produces case (a) end to end (R8), which shows the guard does not catch it. D-14 claims TR-01 (invented budget shown as a source fact) holds for any provider; currency and digits are both values derived from the quote, which is what the R2 lesson candidate asks the guard to verify.
- Fix: in `quoteStates`, also require the quote's currency token (`PLN|zł|EUR|€|USD|$`, mapped as in the mock) to map to `budget.currency`, and require the quote not to start or end inside a number in the source (find the squashed quote in the squashed source and reject when the character before its first digit, or after its last digit, is a digit or a `[ .,]` followed/preceded by a digit). Add both cases to `output-guard.test.ts`.
- Effort: small
- Lesson candidate: no (covered by the R2 lesson candidate)
- Decision: fixed (2143ff0)

### R8: Mock reads a comma thousands separator as the start of a new number
- Severity: minor
- Where: `apps/api/src/infrastructure/llm/mock.ts:24`
- Problem: the R3 fix allows only space or dot between groups of three, so "Budget: 1,500 USD" no longer matches as one number: the `(?<!\d)` lookbehind lets the match start at "500", giving `{ minMinor: 50 000, maxMinor: 50 000, USD, quote: "500 USD" }` (checked with a script; before the fix this string gave 1 500 USD). Because the quote is a real substring and contains 500, the guard keeps it (R7), and the detail shows a DEMO-labelled 500 USD as "ze źródła". The English comma-thousands form is common in the `en` posts the profile accepts.
- Fix: accept a comma as a thousands separator when followed by exactly three digits and not by a decimal pair (`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?`, and keep the decimal tail rule), and make the start lookbehind also reject a preceding `[ .,]\d` group (e.g. `(?<![\d][ .,]?)`), so a match never begins mid-number. Add "Budget: 1,500 USD" and "1,500.50 USD" to `mock.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (476211b)
