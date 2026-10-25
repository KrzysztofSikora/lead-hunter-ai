# Review: url-import-guard

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok (601), image fail (environment: Corepack cannot download pnpm 12.15.0 inside the build, same as round 1), e2e ok (5), mutation ok (address-guard.ts 91.46 %, re-run this round; the survivors are the round-1 `accept`/`equivalent` ones, line numbers shifted by the R3 fix) · Round: 2

## Re-review of round 1
| Finding | Status | Evidence |
|---------|--------|----------|
| R1 | partly fixed | Readability is now skipped above depth 64 / 5 000 elements and the 2 000-deep case takes milliseconds, but linkedom's own parse is superlinear on deep nesting and runs twice before the check; see R5 |
| R2 | fixed | `source.trim() === ''` returns `no_text`, the Readability call is guarded, a null `documentElement` skips the fallback; `''`, whitespace and `<` are tested; unexpected errors are logged at `warn` (wired in `server.ts`) |
| R3 | fixed | IPv6 must match `2000::/3` after the mapped-v4 unwrap; `::7f00:1`, `::a00:1` in the blocked table; the new line has no surviving mutant |
| R4 | fixed | route test redirects A to B with B `Disallow: /` and asserts 422 `robots_disallowed` and `b.requests == ['/robots.txt']` |

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
| `apps/api/src/infrastructure/sources/manual/extract.test.ts`, `apps/api/test/url-import.int.test.ts`, `address-guard.test.ts` | done | round-2 fixes: tests for R1, R2, R3, R4 |
| `apps/api/src/server.ts` | done | round 2: `warn` logger wired for R2 |
| `context/lessons.md` | unplanned | lesson proposed from R1 (expected from `/fix-review`) |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | R2 and R3 fixed; empty HTML is `no_text`, reserved IPv6 is blocked |
| Design | ok | the limits live in `extract.ts` only; the client still knows nothing about HTML |
| Safety | fail | a 1 MB page of nested tags still blocks the process for ~45 s, beyond the 20 s deadline (R5) |
| Tests | ok | new tests assert behaviour (no_text, robots per hop, blocked IPv6); the deep-nesting test covers only 22 KB (R5) |
| Simplicity | ok | one iterative walk, no dead code |
| Plan fidelity | ok | every divergence is logged under *Deviations* |
| Agent decisions | ok | D-2/D-3/D-11 (`costly`) unchanged, each in one place |

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
- Re-review (round 2): partly fixed; the remaining part is R5.

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

### R5: Deeply nested markup still blocks the process past the deadline, now inside linkedom's parse
- Severity: blocker
- Where: `apps/api/src/infrastructure/sources/manual/extract.ts:92`, `apps/api/src/infrastructure/sources/manual/extract.ts:101`
- Problem: the R1 fix measures depth after `parseHTML(source)`, but linkedom's parse is itself
  superlinear in nesting depth, and `extractPage` parses the source twice. Measured on this
  machine (4 cores) through `extractPage` with `text/html`: `'<b>'.repeat(340_000) + 'x'`
  (996 KB, under the default `FETCH_MAX_BYTES` 1 048 576) takes 41.7 s and 45.7 s in two runs,
  of which one `parseHTML` alone is 26.6 s; 500 KB of `<b>` parses in 6.0 s; 1 MB of closed
  `<div>` nesting takes 4.8 s; 256 KB of `<b>` 1.5 s. The body has been read when this runs, so
  `AbortSignal.timeout(FETCH_TIMEOUT_MS)` (20 s) cannot stop it, and the single Node process
  (UI, other imports, analysis runner) is frozen for more than twice the deadline; the Pi is
  slower, and `FETCH_MAX_BYTES` can be raised to 5 MB. This is the same defect class as R1 and
  breaks the lesson this change proposes ("bound every CPU-bound step on untrusted input").
  The new test uses depth 2 000 (22 KB), where linkedom is still fast, so it does not catch it.
- Fix: bound the input before any parse. A linear pre-scan of the decoded source (for example
  count `<` followed by a letter) above a fixed limit (such as 20 000 tags) skips the DOM
  entirely and goes to a plain fallback (strip `<script>/<style>` blocks and tags with linear
  regexes, then `normaliseText`), or caps the HTML handed to `parseHTML`; parse a second time
  only when the fallback needs it. Add an `extract.test.ts` case with ~1 MB of unclosed `<b>`
  that must finish quickly. Alternative: run the whole extraction in a `worker_thread` and
  terminate it at the remaining deadline (`timeout`), which bounds every future parser case too
  but costs a worker per import and more code.
- Effort: small
- Lesson candidate: no (covered by the lesson proposed from R1; its test should use the maximum body size)
- Decision: open
