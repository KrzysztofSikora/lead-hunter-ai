# Review: manual-text-import

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (24 files, 217 tests), e2e ok (4 tests), image not run (sandbox: corepack inside `docker build` cannot fetch pnpm 12.15.0 through the TLS proxy, `self-signed certificate in certificate chain`; environment, not this change, which touches no `package.json` or lockfile; the CI `image` job is the authority), mutation n/a (S-03 is not a mutation target in the test plan) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/opportunities.ts` | done | D-5/D-6/D-8/D-9/D-10/D-11 shapes; total user-info refine as planned |
| `packages/contracts/src/index.ts` | done | exports |
| `packages/config/src/env.ts`, `env.test.ts` | done | `IMPORT_MAX_TEXT_CHARS` 1000–200000, default 20000, in `ENV_VARIABLES` |
| `.env.example` | done | line states the real default and range (lesson respected) |
| `apps/api/src/infrastructure/db/schema.ts` | done | four tables per *Data*; CHECK and FKs emitted |
| `apps/api/migrations/0003_cooing_nitro.sql`, `meta/*` | done | additive, generated |
| `apps/api/src/modules/signals/identity.ts`, `identity.test.ts` | done | D-1/D-2/D-7 rules, table-driven (TR-06) |
| `apps/api/src/modules/signals/{ports,service,routes}.ts` | done | synchronous transaction, URL-then-hash lookup, claims (D-14) |
| `apps/api/src/infrastructure/db/signal-repository.ts` | done | `db.transaction`, insert-or-ignore claims |
| `apps/api/src/modules/opportunities/{ports,service,routes}.ts` | done | list + detail, 404 `not_found` |
| `apps/api/src/infrastructure/db/opportunity-repository.ts` | done | filters, sort, offset paging, count |
| `apps/api/src/infrastructure/sources/source-status.ts` | done | D-10 stub |
| `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts` | done | wiring; `AppDeps.config` widened |
| `apps/api/test/signals-import.int.test.ts` | done | every Phase 1 case incl. D-14 sequences and restart |
| `apps/api/test/opportunities.int.test.ts` | done | empty state, one main-path filter test, detail, 404 |
| `apps/web/src/api/opportunities.ts`, `api/signals.ts` | done | through `apiFetch`, parsed with contracts |
| `apps/web/src/OpportunitiesPage.tsx`, `.module.css` | done | filters/sort/page in the URL query (D-12), empty state |
| `apps/web/src/OpportunityPage.tsx` | done | D-11 view, text rendered as text |
| `apps/web/src/OpportunityPage.module.css`, `ImportPage.module.css` | unplanned | styling for planned views; harmless |
| `apps/web/src/warsawTime.ts`, `warsawTime.test.ts` | done | DST days covered |
| `apps/web/src/App.tsx` | done | nav *Okazje*/*Import*, routes |
| `apps/web/src/App.module.css` | absent | not needed: the nav already wraps and e2e shows no overflow |
| `apps/web/src/strings.pl.ts` | done | three unused keys, see R5 |
| `apps/web/src/ImportPage.tsx` | done | form, result line, field errors |
| `apps/web/src/ImportPage.test.tsx` | unplanned | React component test against the test-plan budget, not logged, see R1 |
| `e2e/smoke.spec.ts` | done | D-13 test, no-overflow on `/okazje`, `/import`, `/okazje/:id`, screenshots |
| `README.md` | done | *Co działa* updated |
| `context/changes/manual-text-import/evidence/*.png` | done | three screenshots from the e2e |
| `context/roadmap.md` | done | status bookkeeping |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | ACs FR-02 AC1–AC4, FR-06 AC1–AC3, FR-11 AC1, FR-12 AC1 met; small edge cases in R2–R4 |
| Design | ok | module/port/repository layering as in S-01/S-02; costly decisions each live in one file |
| Safety | ok | every 400 comes from the schema; http(s)-only URLs (no `javascript:` hrefs); source text rendered as text; pasted text not logged |
| Tests | concern | API and identity tests assert behaviour and failure paths; one unplanned component test breaks the budget (R1) |
| Simplicity | ok | small functions; a few dead strings (R5) |
| Plan fidelity | concern | matches the plan except the unlogged component test (R1) |
| Agent decisions | ok | D-1/D-2/D-14 in `identity.ts` + `service.ts`; D-8–D-11 only in `contracts/opportunities.ts`; D-10 stub in one file |

## Findings
### R1: Unplanned React component test breaks the test budget, no deviation logged
- Severity: major
- Where: `apps/web/src/ImportPage.test.tsx:1`
- Problem: `context/test-plan.md:11` and `:25` (user decision, 2026-10-25) say "No component tests in `apps/web`; the UI is covered by the e2e main path and human checks". The plan lists no such file (Phase 4 files: `api/signals.ts`, `ImportPage.tsx`, `.module.css`, `App.tsx`, `strings.pl.ts`, e2e, README) and *Deviations* is empty. The file renders `ImportPage` with a stubbed `fetch` and checks rendering and links; the same flow is already in the D-13 e2e test. The code now disagrees with an artifact without saying so.
- Fix: delete `ImportPage.test.tsx` (the e2e covers created/duplicate/link; the field-error rendering is a human check). Alternative: keep it, log a `[REVIEW]` deviation and let the person amend the test budget at the PR.
- Effort: small
- Lesson candidate: Add a test file only if the plan lists it or a `[REVIEW]` deviation records why; the test-plan budget binds implementers too.
- Decision: fixed (71f019b)

### R2: `minScore=` (empty) silently becomes `minScore=0` and hides every unscored opportunity
- Severity: minor
- Where: `packages/contracts/src/opportunities.ts:177`
- Problem: `z.coerce.number()` turns `''` into `0`. Probe on the built contract: `OpportunityListQuery.safeParse({ minScore: '' })` → `success: true, minScore: 0`. `minScore` excludes unscored rows (D-9), so `GET /api/opportunities?minScore=` returns only scored rows, which until S-04 means an empty list showing "Brak zweryfikowanych okazji" for data that exists. The web client never sends an empty value today, but the API is the contract (other filters such as `category=` answer 400).
- Fix: treat an empty string as absent or reject it, e.g. `z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(100).optional())`, and the same for `page`/`pageSize` for consistency.
- Effort: small
- Lesson candidate: no
- Decision: fixed (68bce4d)

### R3: A page beyond the last one shows "Razem: N" with an empty list and "Strona 5 z 1"
- Severity: minor
- Where: `apps/web/src/OpportunitiesPage.tsx:163`, `:186`
- Problem: the empty state is chosen by `data.total === 0`; with `?page=5` and 3 opportunities the API returns `items: []`, `total: 3`, so the view prints "Razem: 3", no items and "Strona 5 z 1" with *Poprzednia* going to page 4 (also empty). Reachable by a stale bookmark or after rows disappear (S-15 delete). Not wrong data, but a confusing state.
- Fix: when `items.length === 0 && total > 0`, render a link/button to the last page (`Math.ceil(total / PAGE_SIZE)`), or clamp `page` in `goTo`/`readQuery` after load.
- Effort: small
- Lesson candidate: no
- Decision: fixed (69f699e)

### R4: Title cut at 200 UTF-16 units can split an emoji into a lone surrogate
- Severity: minor
- Where: `apps/api/src/modules/signals/identity.ts:64`
- Problem: `line.trim().slice(0, TITLE_MAX_CHARS)` counts UTF-16 code units. `('a' + '😀'.repeat(150)).slice(0, 200)` ends in `\ud83d` and `isWellFormed()` is `false` (checked with node). The stored title is then not a verbatim extract (D-7) and renders as a replacement character. The excerpt in `opportunities/service.ts` already cuts by code points with `Array.from`, so the two cuts are inconsistent.
- Fix: `Array.from(line.trim()).slice(0, TITLE_MAX_CHARS).join('')`, plus one row in the `deriveTitle` unit test.
- Effort: small
- Lesson candidate: no
- Decision: fixed (459ade3)

### R5: Three UI strings are never used
- Severity: minor
- Where: `apps/web/src/strings.pl.ts:60`, `:118`, `:119`
- Problem: `opportunities.open` ('Zobacz'), `opportunity.noUrl` ('brak adresu') and `opportunity.title` ('Tytuł') are referenced nowhere in `apps/web/src` (grep). Dead text invites drift when S-06 builds the card.
- Fix: remove them (S-06 can add what it needs).
- Effort: small
- Lesson candidate: no
- Decision: fixed (ea927ed)
