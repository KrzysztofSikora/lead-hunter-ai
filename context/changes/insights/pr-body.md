# feat(insights): weekly and monthly insights from recorded facts

Roadmap item S-14: the operator can open *Wyniki* and see, per ISO week (Europe/Warsaw) and per calendar month, stage transitions, offers sent, contacts, replies with a reply rate, meetings, wins and payments per currency, also per source and per category. A metric that cannot be computed is `null` / "brak danych", never 0 by assumption. Time spent and costs can be entered on an opportunity and appear only when entered. Covers PRD FR-19 AC1–AC3.
Closes #15

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-6 (costly):** where time and costs are entered → chose **a new `WORK` event type in `activity_events`** (`POST /api/opportunities/:id/work`, `metadata_json = { minutes?, cost? }`, no migration). Alternatives: B: a `work_entries` table (plain SQL sums, but a migration and a second place for operator events); C: no entry (AC3's condition could never be met). Switching costs: only `workEntries` in `insights-repository.ts` and `addWork` in `activity-repository.ts` would be replaced (review, Agent decisions), plus a migration; stored JSON shape and the public route change.
- **D-1 / D-10 (costly):** the public API shape → chose **one route `GET /api/insights` with `week=YYYY-Www` or `month=YYYY-MM`**, one `Insights` response for both, with `work: { minutes, costs, net }`. Alternatives: B: two routes `/weekly` and `/monthly`; C: free `from`/`to` ranges (weeks would no longer be ISO weeks); D-10 B: work block for the month only. Switching costs: `packages/contracts/src/insights.ts`, the module's routes and `apps/web/src/api/insights.ts`. Plan review finding 2 asked that D-10 be marked costly; it is.
- **D-4 (cheap to change, but the number you will read most):** reply rate = `replied / (replied + noReply)` over contacts first made in the period. `noReply` means not replied and now `LOST`, `REJECTED` or `EXPIRED`; unanswered open contacts are `awaiting` and stay out of the rate. A past week's rate can still change as outcomes arrive. Alternative: `replied / contacted` (always computable, but counts every unanswered contact as a failure, which PRD §10.3 forbids).
- **Wording:** with no known outcome the reply line reads "0 z 0 z wynikiem (1 bez wyniku)", which the implementer called awkward (Deviations, Phase 3). Say if you want other text.
- **Plan review / review leftovers:** None. All ten plan-review notes were handled (Deviations); review round 1 found R1 (major) and R2 (minor), both fixed; round 2 is APPROVE with 0 open findings.

Reply in a review comment, e.g. `D-6: take B`, `D-4: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 3) *Wyniki* at 360 px: totals readable, per-source table scrolls inside its box without page scroll, wording of the reply line ("X z Y z wynikiem (Z bez wyniku)") and of "brak danych". Run: `pnpm dev`, log in, open `/wyniki` at 360 px after an import → draft → "Oznacz jako wysłane" → payment. Evidence: [`insights-360.jpg`](context/changes/insights/evidence/insights-360.jpg)
- [ ] (Phase 4) Time and cost form: enter "1,5" h and "120" PLN on a card → history shows "czas: 1 h 30 min · koszt: 120,00 zł"; *Wyniki* → Miesiąc shows 1 h 30 min, the cost and the result in PLN only. Run: `pnpm dev`, open `/okazje/<id>`, section *Czas i koszty*, then `/wyniki`. Evidence: none (API path covered by `apps/api/test/insights.int.test.ts`)

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/insights/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | What a stage transition is | Every operator `STATUS_CHANGE` event, counted per event; system moves excluded | Include system moves; distinct opportunities per stage |
| D-3 | Offers sent vs. contacts | Two numbers: `offersSent` (drafts at `SENT_MANUALLY`) and `contacted` (first contact, S-08 D-9 rule) | One number from drafts only / from contacts only |
| D-5 | Meetings, wins, "brak danych" for counts | Counts are numbers; wins = latest `WON` event in the period and current status `WON`; sums and rates without input are `null` | Whole period "brak danych" when empty; wins from events only |
| D-7 | Date of a work entry | Server time, no backdating | Optional `on` date |
| D-8 | Per-source attribution | Primary signal's source only; all manual imports in one bucket | Count under every source; per `source_type` |
| D-9 | Per-category attribution | Stored category; `null` is its own group "bez kategorii" | Drop uncategorised rows |
| D-11 | ISO-week validation | Real week count per year, 2000…2100, future periods allowed, `previous`/`next` null at the bounds, `current` flag | Refuse future periods with 400 |
| D-12 | UI | `/wyniki`, tabs Tydzień/Miesiąc, tables that scroll inside their box, form on the card | Charts; per-group cards |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (1065 passed), e2e ok (5 passed); image and image smoke not run (no Docker daemon in the review environment; the diff touches no Docker files). Source: [review.md](context/changes/insights/review.md).
- Review: APPROVE, round 2: fixed 2 (R1 major: the primary-source test now links the second source through `opportunity_evidence`; R2 minor: unused string removed), deferred 0, rejected 0.
- Plan review: READY WITH NOTES ([plan-review.md](context/changes/insights/plan-review.md)); notes recorded in Deviations.
- Mutation: skipped: no mutation step ran in this run and there is no `mutation.md`; `bug` mutants: none (not run).
- Proposed lessons: one from R1 ("A test that names a cross-record situation must create the real link the production path creates, not a look-alike row"). Drop the commit `docs(insights): propose lessons` to reject it.

## Follow-ups
None recorded as `[FOLLOW-UP]`. Noted in the plan's Out of scope and Risks:
- LLM cost in Insights (already reported by S-05/S-13), editing/deleting work entries, per-source time and costs, contract values of wins: not built.
- If a Pi measurement shows slow week queries, add an index on `activity_events`/`payments` time (additive migration).
- The S-07 follow-up ("sent" should count `SENT_MANUALLY` drafts) is resolved by D-3.

## Commits
```
b690d49 docs(insights): review
5886114 docs(insights): triage review round 1
940ca50 docs(insights): propose lessons
26ba30a fix(insights): remove unused paymentsCount string (R2)
d28ae40 fix(insights): link the second source through opportunity_evidence in the D-8 test (R1)
0c2eac3 docs(insights): review
d9cde8d feat(insights): time and cost form on the card, README
70f33fd feat(insights): Wyniki view for week and month
2fc4cec feat(insights): time and cost entries on an opportunity
787d222 feat(insights): insights API for weeks and months
432e45e docs(insights): plan-review
4a25c21 docs(insights): plan
```

<details><summary>Run</summary>

ship insights (S-14), base main, branch `change/insights`, started 2026-10-26T13:09:47+00:00. No failed step, no draft reason.

| Step | Attempt | Model | Cost | Result |
|------|---------|-------|------|--------|
| plan | 1 | opus | $1.89 | success |
| plan-review | 1 | opus | $1.20 | READY WITH NOTES |
| implement (4 phases) | 1 each | sonnet | $0.88 + $0.39 + $0.39 + $0.32 | success; phases ticked 4/4 |
| review (round 1) | 1 | opus | $1.26 | APPROVE WITH FOLLOW-UPS, 2 open |
| fix-review | 1 | sonnet | $0.15 | success |
| review (round 2) | 1 | opus | $0.30 | APPROVE, 0 open |

Total of the listed steps: $6.78 (the pr-body step is not included).
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
