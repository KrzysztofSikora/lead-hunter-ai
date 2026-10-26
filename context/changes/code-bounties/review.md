# Review: code-bounties

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (82 files, 1292 tests), e2e ok (5), mutation reward.ts ok (88.95 %, 20 survivors, matches `mutation.md`), image not run (no Docker daemon in the session), image smoke not run (same) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/contracts/src/opportunities.ts` | done | `SourceType` += github/opire, `BountyFacts` with the D-2 bounds and name rules |
| `packages/contracts/src/sources.ts` (+ test) | done | `GITHUB_LANGUAGES`, `GithubSearchConfig` with the 256-char refine, `OpireConfig`, `Source.github`, `UpdateSourceRequest.github`; `longestGithubQuery` logged as [minor] |
| `packages/contracts/src/index.ts` | done | exports |
| `packages/config/src/env.ts` (+ test), `.env.example` | done | `GITHUB_TOKEN` → `config.github.token` |
| `apps/api/src/infrastructure/db/schema.ts`, `migrations/0013_*` (+ meta) | done | nullable `bounty_json` |
| `apps/api/src/modules/sources/ports.ts` | done | `FeedItem.bounty`, `DiscoverContext.seen` (required, logged), `checkedKeys` |
| `apps/api/src/modules/sources/service.ts` | done | `checkBounty`, `SOURCE_ENDPOINTS`, `toSource.github`, `update` github / narrowed tender check, `create` per preset, `checkedKeys` merged into the cursor |
| `apps/api/src/modules/sources/routes.ts` | done | `not_github_source` → 400 |
| `apps/api/src/modules/signals/ingest.ts`, `ports.ts` | done | `bountyJson` on insert |
| `apps/api/src/infrastructure/sources/http/client.ts`, `test/http-client.int.test.ts` | done | headers on first / same-origin hops, dropped for good after an origin change |
| `apps/api/src/infrastructure/sources/compose.ts`, `server.ts`, `test/helpers/app.ts` | done | one shared `createGithubApi`, both adapters, profile reader; `sourceLogger`/`sourceSleep` logged |
| `apps/web/src/strings.pl.ts` | done | type labels and editor texts |
| `apps/api/src/infrastructure/sources/github/reward.ts` (+ test) | done | D-7 parser; the 60-char quote check dropped (logged [minor]); see R1 |
| `apps/api/src/modules/analysis/output-guard.ts` (+ test) | done | D-10 and D-23 (adapter lines stripped before the cue check) |
| `apps/api/src/modules/analysis/ports.ts`, `service.ts`, `infrastructure/db/analysis-repository.ts` | done | `bountyJson` on the waiting row, `safeParse` on read |
| `context/test-plan.md` | done | third mutation target (logged [REVIEW]), TR-30, TR-12 canary, `bounties/` |
| `apps/api/src/infrastructure/sources/github/{names,query,map-issue,api,adapter}.ts` (+ tests) | done | D-3…D-6, D-16, D-17, D-19; labels cut to 20 (plan-review 7) |
| `apps/api/src/modules/sources/presets.ts` | done | `github-bounties`, `opire-rewards`, `SourcePreset.github` |
| `apps/api/src/modules/sources/github-languages.ts` (+ test) | done | D-4 defaults |
| `apps/api/src/modules/sources/source-filter.test.ts` | done | preset ids |
| `apps/api/test/fixtures/bounties/*` | done | synthetic, `DEMO`/`UNVERIFIED` (D-14) |
| `apps/api/test/bounty-sources.int.test.ts` | done | Phases 1–4 integration cases, including exact request counts, the 25-closed cap case, both D-12 orders and the token canary |
| `apps/api/src/infrastructure/sources/opire/{map-reward,adapter}.ts` (+ test) | done | D-8, D-15; see R2 |
| `apps/api/src/infrastructure/sources/opire/api.ts` | unplanned | logged [minor] (Phase 4): Opire list fetched without the GitHub helper |
| `apps/api/src/infrastructure/logging/logger.ts`, `test/logging.int.test.ts` | unplanned | logged [minor] (Phase 1): `*.*.token` redaction path |
| `apps/api/src/infrastructure/sources/{bzp,ted}/adapter.test.ts` | unplanned | logged [minor] (Phase 4): `seen: new Set()` |
| `apps/web/src/SourcesPage.tsx`, `api/sources.ts`, `SourcesPage.test.tsx` | done | `GithubEditor`, `updateGithub`, endpoint row for API sources |
| `docs/source-policy.md` | done | GitHub and Opire entries with `DO WERYFIKACJI` items |
| `context/roadmap.md` | done | status |
| `context/changes/code-bounties/evidence/` | absent | empty; every human check is open and says why (APIs unreachable) |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | The reward parser turns non-reward amounts in a title or a `paid`/`pay` line into a "ze źródła" budget and a kept `DIRECT_REQUEST` (R1). |
| Design | ok | Two source types on S-18's registry; one guarded HTTP path; the Opire field reads stay in one file. |
| Safety | ok | Token only to `api.github.com`, dropped on a cross-origin hop, redacted two levels deep, canary-tested; names validated before they reach a path. |
| Tests | concern | Thorough integration coverage with exact counts, but no look-alike title or `paid` cases (R1) and one mutation decision that is not equivalent (R5). |
| Simplicity | ok | Small focused modules; no dead code found. |
| Plan fidelity | concern | Plan-review majors 2 and 3 have no Decisions row or Deviations line (R2); two commits carry attribution trailers the plan itself forbids (R3). |
| Agent decisions | ok | Each `costly` decision sits in one place (`SOURCE_ENDPOINTS`, `api.ts`, `bounty_json`, `GetOptions.headers`); D-4 still marked `cheap` (R2). |

## Findings
### R1: The reward parser reads non-reward amounts in titles and `paid`/`pay` lines as the issue's reward
- Severity: major
- Where: `apps/api/src/infrastructure/sources/github/reward.ts:90` (title taken with no keyword), `:18` (`pay`, `paid`, `budget` in `KEYWORD`)
- Problem: `parseReward` takes any marked amount in the title, and any on a body line containing `pay`/`paid`/`budget`. Probed with `labels: ['bounty']`:
  - title `Support invoices over $1,000` → `{ amountMinor: 100000, currency: 'USD', quote: '$1,000' }`;
  - title `[Bounty] Fix rounding for $5 items` → 5 USD;
  - body `The paid plan costs $10` → 10 USD.

  The guard then sets `sourceBudget` to that amount with its quote and treats it as an offer to pay (`output-guard.ts:153-173`), so the card shows an invented budget as a source fact and keeps `DIRECT_REQUEST`. That goes against PRD §0 / D-7 ("unknown, never guessed") and the lesson "a pattern that extracts a source fact needs negative tests with the domain's look-alike phrasing". The tests cover sponsor, credit, rate and range look-alikes, but not a title that only mentions a price, and not a `paid` that names a product tier.
- Fix: accept a title amount only in the reward forms (`[$200]`, `($200)`, a leading `$200`, or with a reward keyword such as `bounty`/`reward`/`nagroda` in the title). For body lines, require the amount to sit right after the keyword (for example `(bounty|reward|nagroda|pay|paid|budget)\W{0,15}<amount>`), rather than anywhere on the line. Add the three probes above as negative tests.
- Effort: small
- Lesson candidate: no (the existing look-alike lesson covers it)
- Decision: open

### R2: Plan-review majors 2 and 3 were never answered; a header-less 403 keeps the Opire check loop running
- Severity: major
- Where: `apps/api/src/infrastructure/sources/opire/adapter.ts:71-79`, `apps/api/src/infrastructure/sources/github/api.ts:111-112`, `context/changes/code-bounties/plan.md` (D-4, D-8, empty *Review response*)
- Problem: Lesson: "Answer every plan-review finding of major or above with a Decisions row or a Deviations line before implementing." Two majors were left unanswered:
  - Plan-review 2. D-8 still says "any other failed check counts as `skipped` and is not remembered", and the code does that. A 403 with neither `x-ratelimit-remaining: 0` nor `retry-after` becomes `http_status` (`api.ts:112`). The Opire loop then counts it as `skipped` and goes on (`adapter.ts:77`), so a secondary limit without headers sends up to 19 more checks while limited. None of them reaches `checkedKeys`, so the next run spends its cap on the same keys.
  - Plan-review 3. D-4 is still `cheap`, though it fixes how many requests go to a third party.
- Fix: in the Opire loop, stop at the first failed check that is not a 404/410, and return the items and `checkedKeys` gathered so far as `truncated`. That is the D-17 rule the search already follows. Optionally map a 403 from `api.github.com` that carries `x-ratelimit-*` headers to `rate_limited` with a wait of at least 60 s. Add the test the plan-review asked for: check 3 answers a header-less 403, then exactly 3 requests and a `partial` run. Mark D-4 `costly`, and fill *Review response* for plan-review 1–3.
- Effort: small
- Lesson candidate: no (existing lesson)
- Decision: open

### R3: Two phase commits carry a `Claude-Session` trailer
- Severity: major
- Where: commits `5982ab1` (Phase 2) and `bfbd685` (Phase 4)
- Problem: `CLAUDE.md` says "No AI attribution anywhere in the repo: no `Co-Authored-By`, `Claude-Session` …". The plan's own risk note (v1 R1) says phase commits carry no such trailer. `git log --format=%B ef843db..HEAD` shows `Claude-Session: https://claude.ai/…` in both commits. This is the same defect v1 was reviewed for.
- Fix: remove the trailer before merge. Either squash-merge the PR with a clean message, or reword the two commits; a history rewrite is outside the autonomous loop, so the user decides at the PR.
- Effort: small
- Lesson candidate: Commit messages follow `CLAUDE.md`'s no-attribution rule even when a tool reminder supplies a trailer; check `git log --format=%B` before each phase commit.
- Decision: open

### R4: The GitHub request spacing is not serialised across concurrent callers
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/github/api.ts:61-67`
- Problem: `space()` computes its wait from `lastRequestAt` and sets it only after sleeping. A `POST /api/sources/:id/check` on the GitHub source runs outside the job lock (only the per-source check cooldown applies). If it arrives while a run is waiting, both callers compute the same wait from the same `lastRequestAt`, wake together and send two searches back to back. That breaks the 6 100 ms gap D-5 relies on. Plan-review 6 (minor) raised this, and it is not answered.
- Fix: serialise through a promise chain (`queue = queue.then(() => wait…)`), or reserve the slot before sleeping (`lastRequestAt = max(now, lastRequestAt + gap)`, then sleep until it). Add a test with two concurrent `get`s on the injected clock.
- Effort: small
- Lesson candidate: no
- Decision: open

### R5: A mutation decision on `reward.ts` is not equivalent, and the Polish keywords are untested
- Severity: minor
- Where: `context/changes/code-bounties/mutation.md` (`MARKER_BEFORE` row and `KEYWORD` row), `apps/api/src/infrastructure/sources/github/reward.ts:26`, `:18`
- Problem: `mutation.md` says dropping the `$` anchor of `MARKER_BEFORE` "finds the same marker" because the window is 4 characters. That is false. For `Bounty $: 50` the window is `" $: "`: the anchored pattern does not match (the parse gives `null`), while the unanchored one does (50 USD). The `KEYWORD` survivors include removing the `płac…`/`płatn…` branches. So no test has a Polish body line such as `Płacę 200 zł za poprawkę`, even though the operator is Polish and D-7 names those stems.
- Fix: add `Bounty $: 50` (→ `null`) and a `Płatne: 300 zł` / `Płacę 200 zł` body line (→ PLN reward) to `reward.test.ts`, then re-run the mutation and update the decisions.
- Effort: small
- Lesson candidate: no
- Decision: open
