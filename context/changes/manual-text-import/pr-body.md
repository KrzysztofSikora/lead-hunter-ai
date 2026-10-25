# docs(manual-text-import): plan for manual text import, duplicate recognition and the Okazje list

Roadmap item S-03 (manual text import): the operator pastes a job post (optionally with its URL, stored but not fetched), gets a raw signal plus a `NEW` opportunity with `analysisStatus = PENDING`, duplicates are recognised, and a filterable, sortable, paginated *Okazje* list shows them with an honest empty state. The plan targets FR-02 AC1–AC4, FR-06 AC1–AC3, FR-11 AC1 and FR-12 AC1 (list part). **Nothing is implemented in this PR; it holds the plan and its reviews only.**
Closes #4

> **Status:** Draft: plan review still says NEEDS CHANGES after 2 rounds. Nothing was implemented (phases ticked 0/4). Review the plan in this PR, answer the points below, then run `.claude/workflow/address-pr <PR number>`.

## ⚠ Needs your decision
- **Plan review round 2, #1 (blocker): the exact source URL is not kept.** The plan stores only the canonical URL (D-2, D-8: `source.url` = canonical URL), but FR-06 AC3 (`prd.md:107`) requires the exact source URL. Canonicalisation drops the fragment, so a hash-routed board link `https://site/#/job/123` becomes `https://site/` and no longer opens the post; it also drops `ref`, which some sites need. Rebuilding the query through `URLSearchParams` re-encodes values (`?q=a%20b&redirect=/a/b` → `?q=a+b&redirect=%2Fa%2Fb`). Suggested fix: store the pasted (trimmed) URL in `raw_signals.source_url` and `opportunity_evidence.url`, use `canonical_url` only for identity, make `source.url` the source URL, filter query parameters on the raw `&`-split string, assert it in Phase 2, and list fragment-routed URLs merging into one identity under *Risks*. Costly: a data-shape change that cannot be repaired for rows imported before it.
- **Plan review round 2, #2 (major): a malformed URL would give a 500.** The user-info `.refine` on `url` calls `new URL(value)`, which throws on `'not a url'` (Zod 4.6.7 keeps running later checks after `z.httpUrl()` fails). The throw is not a Zod error, so `http-errors.ts:16` rethrows it. Fix: make the refine total (`URL.canParse`) or use `z.httpUrl({ abort: true })`, and add `url: "nie-adres"` → 400 to the AC4 table.
- **D-14 (costly):** where identity is looked up so a URL or text first seen in a duplicate import is still recognised → chose **`signal_identities` table, `PRIMARY KEY (kind, value)`, first owner wins, URL wins over hash on conflict**. Alternatives: B: look up `opportunity_evidence` columns (no new table, but a value can sit under two opportunities and needs a tie rule); C: one signal per import with unique columns (against FR-02 AC2 "one signal"). Switching costs: schema, migration `0003`, service and Phase 1 tests.
- **D-1 (costly):** one opportunity per distinct signal identity; a duplicate adds a `REPEAT_IMPORT` evidence row only when it brings a new URL or text hash → chose **this rule**. Alternatives: B: duplicates add nothing; C: always add a row. Switching costs: `opportunity_evidence` shape and service. See also review #3 below (what a `REPEAT_IMPORT` row stores is undefined).
- **D-2 (costly):** identity order canonical URL, then content hash; canonical form per the roadmap list; content hash = SHA-256 of NFKC, lower-cased, whitespace-collapsed text → chose **the roadmap's list exactly, no `www.` stripping or parameter sorting**. Alternatives: B: also sort parameters and strip `www.`; C: hash the raw text. Switching costs: stored identity values.
- **D-3 (costly):** source recorded as `raw_signals.source_type` (`manual_text` / `manual_url`), no `sources` table or `external_id` yet → chose **this**. Alternatives: B: create `sources` now and seed a "manual" row; C: `source_id` to a seeded row only. Switching costs: S-10's schema decided early.
- **D-4 (costly):** `opportunities` gets four nullable analysis columns now (`category`, `evidence_level`, `score` 0–100, `confidence`) because FR-11 AC1 filters on them → chose **this**. Alternatives: B: status columns only; C: all §14 columns. Switching costs: migration.
- **D-5 (costly, public API):** `POST /api/signals/import`, 201 `created` / 200 `duplicate` / 400 → chose **a discriminated result with 200 for a duplicate**. Alternatives: B: 409 for a duplicate; C: `POST /api/opportunities`. Switching costs: contracts, route, UI.
- **D-8 (costly, public API):** DTO separates `source {…}` facts from `analysis {…} | null` inferences → chose **grouped fields**. Alternatives: B: flat fields plus a `fieldOrigins` map; C: flat fields. Switching costs: contracts and every consumer.
- **D-9 (costly, public API):** list API `GET /api/opportunities` with offset pagination and ISO-instant `from`/`to` → chose **offset pagination**. Alternatives: B: cursor pagination; C: Warsaw calendar-day dates. Switching costs: contracts, repository, UI.
- **D-10 (costly, public API):** `sources: { checked, errors[] }` in the list response, stubbed to `{ 0, [] }` through a `SourceStatusReader` port → chose **this**. Alternatives: B: fixed UI sentence; C: separate `/api/sources/summary`. Switching costs: contracts, UI. Risk: S-12's plan must replace `source-status.ts` or the empty state under-reports.
- **D-11 (costly, public API):** minimal read-only `/okazje/:id` backed by `GET /api/opportunities/:id` as the link target → chose **this**. Alternatives: B: link to the list with the row highlighted; C: no link (breaks FR-02 AC2). Switching costs: contracts, route, view.
- **Plan review round 2, #3 (minor):** what a `REPEAT_IMPORT` evidence row holds is not defined (full text vs excerpt vs URL; which signal `raw_signal_id` points to; nullable or not). It is the only copy of a second pasted text. Suggested: `source_fact` = full normalised snippet (or the source URL when no text came), `raw_signal_id` = the primary signal, NOT NULL.
- **Plan review round 2, #4–#7 (minor, not applied):** #4 type `transaction` as synchronous (`transaction<T>(fn: (tx) => T): T`, no `await`; better-sqlite3 throws on a promise); #5 Phase 2 test table goes beyond the test budget (TR-06 only): cut to one main-path list test or record a decision (FR-25 AC2 could justify it); #6 add the `scrollWidth - clientWidth` overflow assertion on `/okazje` and `/import` to the e2e test; #7 `z.httpUrl()` rejects punycode TLDs (`xn--p1ai`), mention under *Risks* or skip.

Reply in a review comment, e.g. `D-3: take B`, `R1: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
Not yet recorded in the plan's *Human checks* section (`/implement` fills it, and it did not run). The plan's Phase 4 lists these, to run after implementation (evidence goes to `context/changes/manual-text-import/evidence/`, which does not exist yet):
- [ ] At 360 px open *Okazje* on a fresh install: the empty text, "Sprawdzone źródła: 0" and "Błędy źródeł: brak" are shown, no example opportunity; evidence `evidence/empty-360.png`.
- [ ] Import a pasted post with a URL containing `?utm_source=x#frag`, then the same URL without them: second time "Już zaimportowane" with a working link; the opportunity view shows the canonical URL, "wklejony tekst"/link label, "brak analizy — w kolejce"; evidence `evidence/duplicate-360.png`.
- [ ] With 3+ imports, try each filter, both sorts and *Następna*: results match, the filter survives a reload, Polish labels read well, no horizontal scroll; evidence `evidence/list-360.png`.
- [ ] Paste a text containing `<script>alert(1)</script>` and an "ignore previous instructions" line: it is shown verbatim as text, nothing executes.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-6 | Maximum text length | Env `IMPORT_MAX_TEXT_CHARS`, 1 000–200 000, default 20 000; route schema built from config | B: fixed constant in contracts; C: check in the service |
| D-7 | Title and snippet of a manual signal | snippet = whole trimmed text; title = first non-blank line cut to 200 chars, URL-only → the URL; `publishedAt` null, `availability` `NOT_CHECKED` | B: optional title field; C: title null |
| D-12 | Data fetching in the web app | Plain `apiFetch` + `useEffect`; filters, sort, page in the URL query | B: add `@tanstack/react-query`; C: component state only |
| D-13 | e2e coverage | One more test in `e2e/smoke.spec.ts` (4th of 5 login attempts), screenshots as evidence | B: no e2e; C: a new spec file |

## Quality
- Gates: not run yet; no code was written (phases ticked 0/4).
- Review: not run (`review.md` does not exist). Plan review: NEEDS CHANGES after round 2 (round 1 also NEEDS CHANGES; its blocker, identity across URL and hash, was fixed by D-14, and findings #2–#7 were applied, see `plan.md#review-response`).
- Mutation: not run (`mutation.md` does not exist).
- Proposed lessons: none.

## Follow-ups
None recorded in the plan's *Deviations*. Items the plan defers to other changes: fetching, robots.txt and SSRF guard (S-09); analysis and scoring (S-04); full opportunity card (S-06); status changes (S-08); `sources` table and job runs (S-10/S-12); grouping similar signals (FR-30, P1); delete/export (S-15).

## Commits
```
bd1c128 docs(manual-text-import): plan-review
5e39139 docs(manual-text-import): plan
9dba6a6 docs(manual-text-import): plan-review
2ae007e docs(manual-text-import): plan
```

<details><summary>Run</summary>

Branch `change/manual-text-import`, base `main`, started 2026-10-25T10:35:23+00:00.

| Step | Attempt | Result | Cost |
|------|---------|--------|------|
| plan (opus) | 1 | success, 19 turns | $1.79 |
| plan-review (opus) | 1 | success; round 1 NEEDS CHANGES | $0.72 |
| plan revise (opus) | 1 | success, 10 turns | $0.66 |
| plan-review (opus) | 1 | success; round 2 NEEDS CHANGES | $1.03 |
| pr-body (sonnet) | 1 | this document | - |

Failed step: none. Draft reason: plan review still says NEEDS CHANGES after 2 rounds. Phases ticked: 0/4.
</details>
