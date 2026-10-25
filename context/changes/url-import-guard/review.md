# Review: url-import-guard

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok (596), image fail (environment: Corepack cannot download pnpm, `SELF_SIGNED_CERT_IN_CHAIN`; `pnpm install --frozen-lockfile --offline` passes), e2e ok (5), mutation ok (address-guard.ts 90.67 %, from `mutation.md`) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/api/package.json` | done | undici moved to dependencies; ipaddr.js, readability, linkedom, robots-parser pinned |
| `apps/api/src/infrastructure/sources/http/address-guard.ts` | done | allow-list on `unicast`, literal check, guarded lookup |
| `apps/api/src/infrastructure/sources/http/address-guard.test.ts` | done | range table, `checkTarget`, lookup shapes, rebinding |
| `apps/api/src/infrastructure/sources/http/client.ts` | done | non-2xx returned to the caller (logged `[minor]`) |
| `apps/api/test/http-client.int.test.ts` | done | loopback server, fake resolver; all planned cases plus the nested `beforeHop` case |
| `packages/config/src/env.ts`, `env.test.ts`, `.env.example` | done | `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES` |
| `context/test-plan.md` | done | TR-03 names the two test files |
| `packages/contracts/src/opportunities.ts`, `index.ts` | done | `manual_fetch`, `FetchFailureReason`, `fetch_failed` variant |
| `apps/api/src/infrastructure/sources/manual/robots.ts` | done | pass-through of guard/timeout errors as plan-review 1/7 asked |
| `apps/api/src/infrastructure/sources/manual/extract.ts` | done | see R1, R2 |
| `apps/api/src/infrastructure/sources/manual/page-fetcher.ts` | done | see R2 |
| `apps/api/src/modules/signals/ports.ts` | done | `PageFetcher`, `findOwner` |
| `apps/api/src/infrastructure/db/signal-repository.ts` | done | `findOwner` |
| `apps/api/src/modules/signals/service.ts` | done | pre-fetch duplicate, fetch, sync transaction |
| `apps/api/src/modules/signals/routes.ts` | done | 422 mapped and in the response map |
| `apps/api/src/app.ts` | absent | not needed: `SignalDeps` flows through `deps.signals` unchanged |
| `apps/api/src/server.ts` | done | one client, UA from `VERSION` |
| `apps/api/test/helpers/app.ts` | done | real fetcher over the global MockAgent |
| `apps/api/test/fixtures/pages/*.html` | done | DEMO, synthetic |
| `apps/api/test/url-import.int.test.ts` | done | route tests incl. timeout/too_large (plan-review 6) |
| `apps/api/test/signals-import.int.test.ts` | done | both tests from plan-review 2 adjusted |
| `apps/api/src/modules/analysis/*` | absent | as planned: prefilter uses `startsWith('manual_')`, so `manual_fetch` is covered |
| `apps/web/src/strings.pl.ts`, `api/signals.ts`, `ImportPage.tsx` | done | reason texts typed with `satisfies Record<FetchFailureReason, string>` |
| `apps/api/src/infrastructure/sources/manual/{robots,page-fetcher,extract}.test.ts` | unplanned | added for plan-review 6/1; logged |
| `apps/api/test/helpers/page-fixture.ts` | unplanned | mutation sandbox fix; logged in *Review response* |
| `.prettierignore`, `eslint.config.js` | unplanned | logged deviations (plan-review 11, byte-exact fixture) |
| `pnpm-lock.yaml`, `context/roadmap.md`, `context/changes/url-import-guard/*` | unplanned | expected bookkeeping |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | fail | a small nested page blocks the whole process past the deadline (R1); empty HTML is reported as a network error (R2) |
| Design | ok | guard, client, robots and extraction are separate and the client knows nothing about robots/HTML |
| Safety | concern | connect-path guard and rebinding handling are sound; CPU DoS through Readability (R1); `::/96` passes the allow-list (R3) |
| Tests | concern | strong client/guard coverage; no test that a cross-origin redirect hop is checked against its own robots.txt (R4) |
| Simplicity | ok | small modules, no dead code |
| Plan fidelity | ok | every divergence is logged under *Deviations* |
| Agent decisions | ok | D-2/D-3/D-11 (`costly`) each live in one place; D-2's AC4 reading is a logged `[REVIEW]` with a *Decisions* row |

## Findings
### R1: Readability is superlinear in nesting depth, so a 22 KB page freezes the server for minutes
- Severity: blocker
- Where: `apps/api/src/infrastructure/sources/manual/extract.ts:201`
- Problem: `new Readability(...).parse()` runs synchronously on the single Node process, after the
  body is read, so the D-8 deadline (`AbortSignal.timeout`) cannot interrupt it. Measured on this
  machine with `extractPage` and `<div>` nested *n* deep around one line of text:
  n=300 (3.3 KB) 0.7 s, n=1000 (11 KB) 16.6 s, n=2000 (22 KB) 118.8 s. Linkedom's parse and
  `body.textContent` of the same documents take under 5 ms, so Readability is the cost. With
  `FETCH_MAX_BYTES` = 1 MB, a hostile or just badly built page can hold the API (UI, other imports,
  the analysis runner) far beyond `FETCH_TIMEOUT_MS`, and the Pi is slower still. This breaks the
  plan's promise that one deadline bounds the import request (D-8, AC4) and treats untrusted
  source content as safe to process without limits.
- Fix: after `parseHTML`, measure the element count and maximum depth (one iterative walk, cheap)
  and skip Readability above fixed limits (for example depth > 64 or more than ~5 000 elements),
  going straight to the existing `<body>` text fallback. Also pass `maxElemsToParse` to
  Readability. Add an `extract.test.ts` case with deep nesting that must finish quickly.
  Alternative: run extraction in a `worker_thread` and terminate it at the remaining deadline
  (always bounded, but more code and a worker per import).
- Effort: small
- Lesson candidate: Every CPU-bound step on untrusted input must have an input bound or run where the deadline can stop it.
- Decision: fixed (c5128c8) + lesson proposed

### R2: Any unexpected exception in the page fetcher becomes `network`, and an empty HTML page hits it
- Severity: major
- Where: `apps/api/src/infrastructure/sources/manual/page-fetcher.ts:56`, `apps/api/src/infrastructure/sources/manual/extract.ts:201`
- Problem: the `catch` maps every non-`HttpFetchError` to `network` and logs only the reason, so a
  programming error or a library throw is shown to the operator as "błąd połączenia z serwisem"
  and leaves no trace in the log. It happens for real input: `extractPage(enc(''), 'text/html', …)`
  and `extractPage(enc('<'), 'text/html', …)` throw "First argument to Readability constructor
  should be a document object" (linkedom yields no usable document), so a 200 `text/html` reply with
  an empty or whitespace-only body is reported as `network` instead of `no_text` (D-10). The
  existing "empty page" tests only cover `<html><body><script>` and blank `text/plain`.
- Fix: in `extractPage`, return `no_text` when the decoded source is blank and guard the
  Readability call (a throw falls back to the body text). In the fetcher, log unexpected errors at
  `warn`/`error` with the error message (host only, no body) before mapping them, so they are not
  swallowed. Add tests for an empty HTML body.
- Effort: small
- Lesson candidate: no
- Decision: fixed (c5128c8)

### R3: The allow-list lets IPv4-compatible and other reserved IPv6 addresses through
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/http/address-guard.ts:21`
- Problem: D-4 says only globally routable unicast passes, but ipaddr.js 2.5.0 labels everything
  it has no range for as `unicast`. Checked: `::7f00:1` (`[::127.0.0.1]`) and `::a00:1`
  (`[::10.0.0.1]`) give `range() === 'unicast'`, so `isAllowedAddress` returns true for the
  deprecated IPv4-compatible block `::/96` (RFC 4291) and the rest of the IETF-reserved `::/8`,
  both for URL literals and AAAA answers. Most hosts do not route these, but on a host with a
  `sit` tunnel `::/96` is routed to the embedded IPv4 address, and the guard's claim is
  "closed by default". No test covers it.
- Fix: for IPv6 (after the mapped-v4 unwrap) also require the address to be in `2000::/3`
  (`ipaddr.parseCIDR('2000::/3')` + `match`), and add `::7f00:1` and `::a00:1` to the blocked
  table.
- Effort: small
- Lesson candidate: no
- Decision: fixed (9c113aa)

### R4: No test shows that a redirect to another origin is checked against that origin's robots.txt
- Severity: minor
- Where: `apps/api/src/infrastructure/sources/manual/page-fetcher.ts:40`, `apps/api/test/url-import.int.test.ts`
- Problem: D-6 says every hop's origin goes through the robots check. The code does it through
  `beforeHop`, but no test proves it: the client test "lets beforeHop refuse a hop" uses a stub,
  and every route test redirects to a blocked address or stays on one origin. A fetcher that checked
  robots.txt only for the pasted URL's origin (one `robots.check` before `http.get`, no
  `beforeHop`) would pass every test, while fetching a page on site B despite B's `Disallow: /`.
- Fix: one route test: site A `/robots.txt` allows, page 302 to site B; site B `/robots.txt`
  `Disallow: /` for `LeadHunterAI` → 422 `robots_disallowed`, B's page never requested.
- Effort: small
- Lesson candidate: no
- Decision: fixed (bcd7734)
