# Test plan

Sources: `context/prd.md`, `context/tech-stack.md`, `context/roadmap.md`. No application code
exists yet; F-01 creates the tooling described here. Revisit this file when a slice adds an
integration or a bug escapes.

Test levels in this repo:

| Level | Tool | Where | Touches |
|-------|------|-------|---------|
| **unit** | Vitest | `apps/api/src/**/*.test.ts`, `packages/*/src/**/*.test.ts`, `apps/web/src/**/*.test.ts(x)` | pure rules named by a `test` risk (scoring, guards, transitions); no React component tests |
| **integration** | Vitest | `apps/api/test/**/*.int.test.ts` | Fastify app via `inject` → services → real SQLite (temp file, all migrations); outbound HTTP through undici `MockAgent`; fake clock; fake IMAP server port |
| **e2e** | Playwright (Chromium headless) | `e2e/*.spec.ts` | built app (`pnpm build && pnpm start`) on a temp data dir, `LLM_PROVIDER=mock`, no outbound network |
| **image** | `docker build` | `Dockerfile` | the image builds; container healthcheck in the e2e-in-container check of S-16 |
| **human** | PR checklist with evidence | `context/changes/<id>/evidence/` | real feeds, real LLM providers, real IMAP mailbox, the Raspberry Pi; never a gate |

## Test budget (user decision, 2026-10-25)
As few tests as possible; test only where a bug would be costly.
- **Write tests only for risks marked `test` in the register below** (high impact: honesty,
  security, money, data loss, duplicates, scoring). Everything else is a human check in the PR
  or not tested.
- **Per slice:** one or two integration tests for the main path of its API, plus table-driven
  unit tests only for the rules a `test` risk names. No tests for glue code, config wiring,
  simple CRUD, getters, or "it renders".
- **No component tests** in `apps/web`; the UI is covered by the e2e main path and human checks.
- **e2e:** at most 2 specs — the F-01 smoke and the main path (S-08). No more.
- **Mutation testing is off by default** (`WORKFLOW_MUTATION=0`). It runs only for the two
  items whose modules are in *Mutation targets* (S-04, S-09), via `ship <id> --mutation`.
- Do not add a test to raise coverage; coverage is not tracked.

## Risk register
Impact × likelihood: H/M/L. **Budget**: `test` = automated test required; `human` = human check in the PR; `none` = not tested. Only `test` rows need tests. Status: `planned` until the item that owns it lands, then `covered`.

| ID | Risk | Impact | Likelihood | Level | Test(s) | Status |
|----|------|--------|------------|-------|---------|--------|
| TR-01 (test) | Invented data shown as fact: URL, budget, contact, company or person not present in the source (brief's main honesty risk) | H | M | unit + integration | output guard: values absent from the source text are removed/flagged (FR-08 AC4); `sourceBudget` only with a quote; fixtures where the model "hallucinates" a URL, e-mail and company; card shows "wniosek modelu" for every inferred field | planned (S-04, S-05, S-06) |
| TR-02 (test) | Prompt injection in source content executes, leaks secrets or changes settings | H | M | integration | injection fixtures (feed item, page, e-mail) through analysis with a fake provider that echoes its input: request has source data only inside the delimited data block, no secret value in the request, no setting changed after the run; system prompt states data ≠ instructions | planned (S-04, S-05) |
| TR-03 (test) | SSRF through manual URL import (loopback, private, link-local, metadata, IPv6, redirects, DNS rebinding) | H | M | unit + integration | guard table over address ranges (v4/v6, mapped v6); lookup returning a private address after a public one; redirect hop to a private host; non-http schemes; oversize/timeout | planned (S-09) |
| TR-04 (test) | Something is sent to a client or any third party automatically | H | L | integration | `MockAgent` with `disableNetConnect()` across draft and pipeline flows: the only allowed host is the configured LLM; no IMAP write commands; e2e runs with no network access | planned (S-07, S-08, S-11) |
| TR-05 (test) | Score not deterministic, components do not sum, caps ignored (SPECULATIVE > 6/30), OSS bug report scored as a paid job | H | M | unit | table-driven rubric tests per component and evidence level; property: sum = total, 0 ≤ total ≤ 100, same input → same output; fixture "OSS bug issue" never `DIRECT_REQUEST` | planned (S-04) |
| TR-06 (test) | Duplicate opportunities from re-import, re-run or URL variants; or different clients merged | H | M | unit + integration | canonicalisation table (tracking params, fragment, slash, case); import twice → one row; run a feed twice → no new signals; two similar titles with different URLs/authors stay separate | planned (S-03, S-10) |
| TR-07 (test) | Invalid LLM output stored as analysis (bad JSON, schema mismatch, out-of-range numbers, overlong strings) | H | M | unit + integration | Zod schema boundary tests; provider adapters fed recorded bad responses → `ANALYSIS_FAILED` with reason, retry works, signal kept | planned (S-04, S-05) |
| TR-08 (test) | LLM spend above the operator's cap, or analyses without a cap on a paid provider | H | M | integration | fake usage reports: cap reached → next analysis refused, imports continue; paid provider without cap → refused; month boundary resets with fake clock; cache by content hash prevents re-analysis | planned (S-05) |
| TR-09 (human) | A failing source empties or corrupts previous results, or stops other sources | H | M | integration | `MockAgent`: one feed 500/timeout/invalid XML, another OK → partial run, previous signals untouched, `lastError` set | planned (S-10) |
| TR-10 (none) | Aggressive retries on 429/503 (ignores `Retry-After`, violates per-source interval) | M | M | unit + integration | backoff schedule with fake clock; `Retry-After` seconds and HTTP-date; number of requests counted on `MockAgent` | planned (S-10) |
| TR-11 (test) | Scheduler runs twice, skips or doubles across DST, or duplicates after restart; stale lock blocks forever | H | M | unit + integration | fake clock across 2027-03-28 and 2026-10-25 / 2027-10-31 in Europe/Warsaw: exactly one run at 08:00 and 18:00; concurrent start refused; lock with dead owner released on start; manual + scheduled overlap refused | planned (S-12) |
| TR-12 (test) | Secrets in logs, API responses, export or the repository (API keys, IMAP password, session cookie, password hash) | H | M | integration + CI | canary values in config (`sk-LEAK-CANARY`, `imap-LEAK-CANARY`) → scan captured log output, `/api/health`, `/api/sources`, export JSON: none contain them; CI step fails if `.env`, `*.db`, backups or logs are tracked | planned (F-01, S-05, S-11, S-15) |
| TR-13 (test) | API reachable without a session; LAN exposure without a password; login brute force | H | M | integration | every registered route except health/login returns 401 without a session (test iterates the route table); start with LAN flag and no hash → refuses; 401 after logout; throttle after N failures | covered (S-01) |
| TR-14 (test) | Status rules broken: WON counted as paid, illegal transitions, rejection without reason, follow-up sent automatically | H | M | unit + integration | transition table (allowed forward skips, back moves need a note, terminal states); payment is a separate event; report separates sent/won/paid | planned (S-08) |
| TR-15 (none) | Reports show zeros or assumed outcomes instead of "brak danych"; currencies summed together | M | M | unit | insights calculator with partial data; per-currency sums; reply rate with zero offers → "brak danych" | planned (S-14) |
| TR-16 (none) | Empty state filled with demo or generated opportunities | M | L | integration + e2e | fresh database → Today and list show the empty text, source count and errors; mock provider output labelled `DEMO / MOCK` | planned (S-03, S-04, S-13) |
| TR-17 (human) | Feed format variants break parsing (RSS 2.0 vs Atom, missing dates, HTML in description, CDATA, relative links) | M | M | unit | parser tests on recorded hnrss and WWR fixtures plus synthetic edge cases | planned (S-10) |
| TR-18 (human) | Useme e-mail format change or unknown mail silently dropped; e-mail body stored or logged | M | M | unit + integration | parser on anonymised real `.eml` samples; unknown format → explicit parse error kept for retry; non-allow-listed sender skipped; stored fields only; log scan | planned (S-11) |
| TR-19 (none) | IMAP access modifies the mailbox | M | L | integration | fake IMAP server records commands: only `EXAMINE`/`FETCH`/`UID SEARCH`, never `STORE`, `MOVE`, `EXPUNGE`, `COPY` | planned (S-11) |
| TR-20 (test) | Data lost on restart, crash or migration; restore does not work | H | L | integration | file-backed DB round trip; migration test from each previous schema version with seeded rows; backup → restore → migrate → start script in CI | planned (F-01, S-15) |
| TR-21 (none) | Delete leaves rows behind (evidence, analyses, drafts, events, payments) | M | L | integration | delete an opportunity with all child rows → all queries empty | planned (S-15) |
| TR-22 (none) | OpenAPI document drifts from the routes | M | M | integration | test compares registered routes and methods with the generated document | planned (F-01) |
| TR-23 (none) | Layer boundary violated (domain imports infrastructure/SDKs; web imports api internals) | M | M | lint | ESLint `no-restricted-imports` + a fixture asserting lint fails | planned (F-01) |
| TR-24 (human) | Facts and estimates indistinguishable in the UI; status by colour only; unusable at 360 px | M | M | unit + e2e | component tests assert the "ze źródła" / "wniosek modelu" / "szacunek (hipoteza)" labels; e2e at 360 px viewport asserts no horizontal scroll on the main views | planned (S-06, S-13) |
| TR-25 (none) | Pre-filter lets "SEEKING WORK" posts or excluded categories reach the LLM; daily limits ignored | M | M | unit | pre-filter rule table; limit counters with fake clock | planned (S-04, S-05) |
| TR-26 (human) | Image does not build or the container cannot start (native better-sqlite3, non-root permissions, volume) | M | M | image + human | CI `docker build` on every PR; S-16 human check on the Pi with evidence | planned (F-01, S-16) |
| TR-27 (human) | Footprint too large for the Pi 4 (NFR-01, NFR-02) | M | L | human | S-16 measurements with seeded 10 000 signals | planned (S-16) |

## Not tested (and why)
- **Real third-party services in automated tests** (hnrss.org, WWR, Useme mail, Anthropic,
  OpenAI-compatible providers, IMAP servers): never called from tests; recorded fixtures and
  `MockAgent` instead. Real behaviour is a human check in S-05, S-10 and S-11 with evidence.
- **Quality of LLM analyses.** Not testable deterministically; we test the contract (schema,
  guards, labels) and judge quality in human checks on real samples.
- **Internals of Fastify, Drizzle, croner, imapflow, Readability.** We test our use of them.
- **Visual styling and pixel layout.** No screenshot tests; behaviour and labels are asserted.
- **Raspberry Pi hardware, Tailscale, Docker on ARM64.** Human checks in S-16.
- **30-day business targets (brief §20).** Measured in use, not by tests.

## Quality gates
| Gate | Runs | Must pass |
|------|------|-----------|
| typecheck `pnpm typecheck` | `/implement` each phase; `/review`; CI on every PR and push | yes |
| lint `pnpm lint` | `/implement` each phase; `/review`; CI | yes |
| unit + integration `pnpm test` | `/implement` each phase; `/review`; CI | yes |
| e2e `pnpm e2e` | `/review`; CI on every PR and push | yes (F-01: one smoke spec; S-08 on: main path) |
| image `pnpm docker:build` | `/review`; CI on every PR and push | yes |
| mutation `pnpm mutation --mutate <file>` | only S-04 and S-09 (`ship <id> --mutation`); CI job `mutation-report` report-only | no (report only, target 80 %) |

- No pre-commit hook: autonomous runs are gated by the skills; human commits rely on CI.
- CI (`.github/workflows/ci.yml`, created in F-01): Node 24 + pnpm, `pnpm install
  --frozen-lockfile`, then typecheck, lint, test; job `e2e` (`pnpm exec playwright install
  --with-deps chromium`, `pnpm e2e`, report uploaded as an artifact on failure); job `image`
  (`pnpm docker:build`); job `repo-hygiene` (fails if `.env`, `*.db`, backups or logs are
  tracked); job `mutation-report` (Stryker on changed target files, score in the job summary,
  never fails).
- `pnpm e2e` builds the app, starts it on a free port with a temp `DATA_DIR`,
  `LLM_PROVIDER=mock`, a test password hash and outbound network disabled, runs Playwright, and
  stops the server.
- `pnpm docker:build` = `docker build -t lead-hunter-ai:local .`.

## Mutation targets
Only two modules, where a weak test would let a costly bug through (user decision: mutation
testing only where needed).

| Module | Why | Target score | CI (report / break at N%) |
|--------|-----|--------------|---------------------------|
| `apps/api/src/modules/scoring/rubric.ts`, `score.ts` | the number the operator acts on; caps and sums (TR-05) | 80 % | report |
| `apps/api/src/infrastructure/sources/http/address-guard.ts` | SSRF blocklist and redirect checks (TR-03) | 90 % | report |

File names are the intended layout; the plan of each slice may rename them and must then update
this table.

Tool setup (done in F-01, configuration fixed here): `@stryker-mutator/core` and
`@stryker-mutator/vitest-runner` 10.1.x at the root; `stryker.config.mjs` with
`testRunner: "vitest"`, `coverageAnalysis: "perTest"`, `reporters: ["clear-text", "html",
"json"]`, `thresholds: { high: 80, low: 70, break: null }`, `incremental: true`
(`incrementalFile: reports/stryker-incremental.json`, gitignored). Root script
`"mutation": "stryker run"` so that `pnpm mutation --mutate <file>` scopes to one file.

## Test data and isolation
- **Database:** every integration test gets a fresh SQLite file in a temp directory with all
  migrations applied (`openTestDb()`); no shared state; files removed after the test.
- **Network:** a global Vitest setup installs undici `MockAgent` with `disableNetConnect()`; a
  test that makes an unmocked request fails. Real network is never used in tests.
- **Clock:** services take a `Clock` port; tests use `fakeClock(iso)`; scheduler tests use the
  fake clock with the `Europe/Warsaw` zone.
- **Fixtures:** `apps/api/test/fixtures/` — `feeds/` (recorded hnrss and WWR responses, from the
  S-10 human check; synthetic edge cases marked `synthetic-` in the file name), `pages/`,
  `email/` (anonymised `.eml` from the operator, S-11), `llm/` (recorded and synthetic provider
  responses, incl. invalid JSON and injection cases). Every fixture is fictional or anonymised
  and marked `DEMO` where it is shown in the UI; no real person, rate or client.
- **LLM:** the `mock` provider for all automated tests above the adapter level; adapter tests use
  `MockAgent` with recorded responses.
- **IMAP:** a small in-process fake IMAP server (test helper) that serves fixture messages and
  records the commands it receives.
- **Canaries:** secret values in tests are `*-LEAK-CANARY`; leak tests search for them.
- **e2e:** each spec starts from an empty temp data dir; data is created through the UI or
  `POST /api/signals/import`; the mock provider gives deterministic analyses.

## Cookbook

### Add a unit test
1. Put the test next to the code: `apps/api/src/modules/scoring/rubric.test.ts` for `rubric.ts`.
2. Import only the module under test and contract types; pure functions need no fakes.
3. Prefer table-driven `it.each` over copies with one changed input.
4. Assert on returned values or thrown errors, never on internal calls.
5. Run `pnpm vitest run apps/api/src/modules/scoring/rubric.test.ts`, then `pnpm test`.

### Add a component test
Don't (see *Test budget*). UI behaviour is covered by the e2e main path and human checks.

### Add an integration test
1. `apps/api/test/<area>/<name>.int.test.ts`.
2. `const app = await buildTestApp({ clock, llm: 'mock', env })` (helper: temp DB with
   migrations, `MockAgent` installed, a logged-in session cookie via `app.loginAsOperator()`).
3. Mock outbound calls: `mockAgent.get('https://hnrss.org').intercept({ path: '/whoishiring/freelance' }).reply(200, fixture('feeds/hnrss-freelance.xml'))`.
4. Drive the HTTP API with `app.inject(...)`; assert on the response and on rows read back
   through the API or a repository.
5. For failures, reply with 429/500, `.replyWithError()`, or `.delay()` past the timeout.

### Add an e2e test
1. `e2e/<flow>.spec.ts`; start from the empty app; log in with the test password from
   `e2e/env.ts`.
2. Create data through the UI or `request.post('/api/signals/import')`.
3. Assert user-visible text and roles; set the viewport to 360×740 for phone checks.
4. Run one spec: `pnpm e2e e2e/<flow>.spec.ts`; all: `pnpm e2e`.
5. The suite has at most 2 specs (smoke, main path). Put anything else into an integration
   test only if a `test` risk requires it.

### Run a mutation check
1. Pick the target from *Mutation targets* (or the file your change touched in that list).
2. `pnpm mutation --mutate apps/api/src/modules/scoring/rubric.ts`
3. Open `reports/mutation/mutation.html` or read the clear-text summary.
4. Triage each survivor per `.claude/skills/mutation/SKILL.md`.
5. Never widen `--mutate` to the whole repo; never lower the targets in this file without a
   recorded reason.

### Record a real fixture (human check)
1. Run the app from a machine with internet with the source enabled; run discovery once.
2. Save the raw response with `pnpm fixtures:record <source-id>` (created in S-10) into
   `apps/api/test/fixtures/feeds/`; check it contains no private data.
3. Commit it with the PR that uses it; mention it under evidence.
