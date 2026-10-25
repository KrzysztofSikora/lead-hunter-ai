# Plan: url-import-guard (S-09)

## Goal and end state
An operator who pastes only a URL into Import gets a signal whose title and text come from that
page, fetched once through a shared, guarded HTTP client (FR-03 AC1). The client never opens a
connection to loopback, private, link-local, CGNAT, ULA, metadata or other non-public addresses,
whether the address is in the URL, comes from DNS, from a redirect hop or from a second DNS answer
(rebinding) (AC2). Pages that robots.txt disallows for `LeadHunterAI` are not fetched (AC3).
Slow or huge responses are aborted with an explicit error (AC4). Every refusal or failure stores
nothing, shows the reason in Polish and asks the operator to paste the text. The form keeps the
URL, so the next submit stores it as the signal's source. A URL that is already known is
reported as a duplicate without a request. Later adapters (S-10 RSS) reuse the same client.

## Scope
- In: `address-guard.ts` (address policy, URL target check, guarded DNS lookup); shared HTTP
  client (undici `Agent` with guarded `connect.lookup`, manual redirects, deadline, byte limit,
  user agent, at most 2 requests in flight); robots.txt check with a 24 h in-memory cache; main
  text extraction (Readability + linkedom); `FETCH_TIMEOUT_MS` and `FETCH_MAX_BYTES` config;
  import contract and service changes; Import page handling of a failed fetch; source type
  label for fetched pages.
- Out: RSS/IMAP adapters and retry/backoff (S-10, S-11); a `sources` table; storing the final
  URL after redirects as an identity (`[FOLLOW-UP]` candidate); re-checking availability of a
  stored page; persistent robots cache; e2e changes (the e2e run has no network, and the import
  flows it covers paste text, so they never fetch).

## Findings
- Import today: `POST /api/signals/import` (`apps/api/src/modules/signals/routes.ts:14`) calls
  the synchronous `importSignal` (`service.ts:24`). A URL-only import stores `snippet ''`, the
  title = the URL, `sourceType 'manual_url'` (`service.ts:66-76`). Identity lookup reads
  `signal_identities` inside one synchronous better-sqlite3 transaction (D-14 of
  manual-text-import). The transaction callback must stay synchronous, so the fetch has to happen
  before it.
- Contracts: `importRequestSchema` (`packages/contracts/src/opportunities.ts:44`) already
  limits `url` to `z.httpUrl()`, ≤ 2048 chars, no user info. `ImportResult`
  (`opportunities.ts:68`) is a discriminated union `created | duplicate`. `SourceType` is
  `manual_text | manual_url` (`opportunities.ts:12`), with no CHECK constraint on
  `raw_signals.source_type` (`migrations/0003_cooing_nitro.sql:38`). The web labels source types
  in `strings.pl.ts:125-128`, and the list filter offers `SourceType.options`
  (`OpportunitiesPage.tsx:186`).
- Web client `importSignal` (`apps/web/src/api/signals.ts:8`) accepts 200/201/400 and throws on
  anything else. `ImportPage.tsx` clears both fields on success. The URL hint
  (`strings.pl.ts:144`) still says fetching "will come later".
- Tests: `test/setup.ts` sets a global `MockAgent` with `disableNetConnect()`. Existing
  URL-only imports in `signals-import.int.test.ts`: line 76 and line 122 hit a known URL
  (duplicate, so no fetch with this design). Line 215 is a **new** URL-only import used to test
  restart dedup, so it would now fetch (see Deviations note in Phase 2).
- Config: `packages/config/src/env.ts` lists every variable in `ENV_VARIABLES`, `EnvSchema`,
  `EXPECTED` and `Config`. `.env.example` documents each one (lesson: never describe config that
  does not exist).
- Dependencies: `undici@8.12.3` is only a devDependency of `apps/api`. `ipaddr.js@2.5.0` is in
  the store transitively. `@mozilla/readability@0.6.0` (Apache-2.0), `linkedom@0.18.14` (ISC)
  and `robots-parser@3.0.1` (MIT) exist on the registry at the tech-stack versions. All four are
  already chosen in `context/tech-stack.md:21-23`, so adding them is not a new choice.
- undici 8.12.3 `lib/core/connect.js:73-134`: the connector spreads its options into
  `net.connect`/`tls.connect`, so `new Agent({ connect: { lookup } })` reaches Node's socket
  connect. Node calls `lookup` with `{ all: true }` when `autoSelectFamily` is on (default), and
  **does not call `lookup` at all for an IP-literal host**. So the client must check literal
  hosts itself, before dispatch. The address that `lookup` returns is the one connected to,
  which closes the rebinding window (no separate pre-resolution). A pooled keep-alive socket
  is reused without a new lookup, which is safe because it is bound to an already-checked
  address.
- ipaddr.js 2.5.0 `range()`: v4 `unspecified, broadcast, multicast, linkLocal (169.254/16,
  incl. 169.254.169.254 metadata), loopback, carrierGradeNat, private, reserved (192.0.0/24,
  192.0.2/24, 192.88.99/24, 198.18/15, 198.51.100/24, 203.0.113/24, 240/4), as112, amt`, else
  `unicast`. v6 `unspecified, linkLocal, multicast, loopback, uniqueLocal (fc00::/7, incl.
  fd00:ec2::254 metadata), ipv4Mapped, deprecatedSiteLocal, discard, rfc6145, rfc6052 (NAT64),
  6to4, teredo, benchmarking, amt, as112v6, deprecatedOrchid, orchid2, reserved,
  droneRemoteIdProtocolEntityTags`, else `unicast`. Any range other than `unicast` is blocked.
- WHATWG `URL` already normalises odd IPv4 spellings (`http://2130706433/`,
  `http://0x7f.1/` → `127.0.0.1`) and brackets IPv6 (`[::1]`). The literal check must strip the
  brackets from `hostname`.
- undici `request()` does not decompress, so sending `accept-encoding: identity` makes the byte
  limit apply to the real body. `fetch()` would decompress and hide the transferred size.
- RFC 9309 §2.3.1: robots.txt 2xx → parse; 4xx → no restrictions; 5xx or unreachable →
  complete disallow; follow at least 5 redirects; caching up to 24 h is allowed.
- `UNVERIFIED` (checked in Phase 2 tests, not from docs): robots-parser's user-agent matching
  when given the product token `LeadHunterAI`, and Readability's output on a linkedom
  document without `<html>` wrapping.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | When does an import fetch the page? | Only when a URL is given and the text is missing or blank. Before any request, the canonical URL is looked up in `signal_identities`; a known URL returns `duplicate` without a request. URL + text never fetches: the pasted text is the snippet, as in S-03 | B: always fetch when a URL is given (fresh title for pasted posts, but one outbound request per import and two texts competing for the snippet); C: an explicit "pobierz stronę" checkbox (operator control, one more input) | AC1 "fetched once"; the pasted text is the fallback AC2/AC3 offer, so it must not trigger a fetch | cheap | agent |
| D-2 | What a failed or refused fetch stores and answers | Nothing is stored. `422` with a third `ImportResult` variant `{ result: "fetch_failed", reason, httpStatus? }`. The form keeps the URL, shows the reason and asks for the text; resubmitting with text stores the URL as the signal's source (D-1, no fetch). This is how AC4's "the URL is kept as the signal's source" is met | B: store a URL-only signal as S-03 did and attach the error (the URL is kept without a second submit, but it creates an empty opportunity that analysis cannot use, and the text pasted later only becomes `REPEAT_IMPORT` evidence, not the snippet); C: `200` with the failed variant (one less status code, but a failure would look like a success to generic clients) | Nothing half-imported, no empty opportunities; one code for every fetch outcome | costly (public API) | agent |
| D-3 | Failure reasons in the contract | `FetchFailureReason` enum in contracts: `blocked_address` (non-public address: literal, DNS, redirect hop, rebinding), `blocked_url` (redirect to a non-http(s) scheme or with user info), `robots_disallowed`, `robots_unavailable` (robots.txt 5xx/unreachable, RFC 9309), `timeout`, `too_large`, `http_status` (+ `httpStatus`), `unsupported_content`, `no_text`, `too_many_redirects`, `network`. Each gets one Polish text in the UI | B: one generic `fetch_failed` with a free-text message (smaller contract, but the API would emit user-facing text and the UI could not phrase it); C: separate HTTP codes per class (403 blocked, 504 timeout…) (REST-ish, but the web client would need a branch per code) | AC2 "the reason is shown"; codes keep wording in the web app | costly (public API) | agent |
| D-4 | Address policy | Allow-list: an address is allowed only if `ipaddr.process(ip).range() === 'unicast'`. An IPv4-mapped IPv6 address is unwrapped first and judged as IPv4. Every other range is blocked, including NAT64, 6to4, Teredo, multicast and documentation ranges. A hostname is refused if **any** of its resolved addresses is blocked | B: a block-list of only the ranges AC2 names (narrower, but 6to4/NAT64/Teredo can carry a private IPv4 and reserved ranges stay open); C: block-list plus unwrapping NAT64/6to4 (would allow public NAT64 targets on IPv6-only networks, more code and more ways to get it wrong) | Closed by default; ipaddr.js keeps the table; the Pi sits on an IPv4/dual-stack LAN where NAT64 is not needed | costly (security) | agent |
| D-5 | Where the guard runs | Two places in one client: (a) before each hop, the URL target check: scheme http/https, no user info, and an IP-literal host must pass D-4; (b) at connect, through `connect.lookup` on the client's own undici `Agent`, which resolves with `dns.lookup(host, { all: true })`, checks every address and hands the checked addresses to the socket (rebinding safe). The agent connects directly and ignores `HTTP(S)_PROXY`, because a proxy would resolve the name itself and bypass (b). Any port is allowed | B: resolve first, then connect to the IP with a `Host` header (two code paths for TLS SNI, and easy to get wrong); C: only check `new URL().hostname` before the request (simple, but misses DNS answers and rebinding) | Matches tech-stack "Outbound HTTP and SSRF guard"; the checked address is the address used | costly (security) | research |
| D-6 | Redirects | Manual, at most 5 hops (the 6th is `too_many_redirects`), for 301/302/303/307/308 with a `Location` that is resolved against the current URL. Every hop goes through D-5 (a) and (b) again, and its origin goes through the robots check (D-7). Always `GET`. The stored source URL stays the URL the operator pasted (D-8 of manual-text-import), and only the pasted URL's canonical form is claimed as identity | B: undici's redirect interceptor (less code, but hops would not be re-checked against robots and the URL check); C: also claim the final URL's canonical form (catches imports of the final URL, but changes S-03's identity rule; a `[FOLLOW-UP]` if needed) | Every hop is checked; identity rules unchanged | cheap | agent |
| D-7 | robots.txt behaviour | Before each page request, `<origin>/robots.txt` is fetched through the same client (same deadline, byte limit and redirects). 2xx is parsed with robots-parser and checked for the product token `LeadHunterAI`; 4xx means allowed; 5xx, network error or timeout gives `robots_unavailable` (RFC 9309 complete disallow). Parsed results and 4xx results are cached in memory per origin for 24 h; failures are not cached. A disallowed page gives `robots_disallowed` | B: persist the cache in SQLite (survives restarts, but needs a migration for a one-off manual import); C: treat an unreachable robots.txt as allowed (fewer refusals, against RFC 9309 §2.3.1.4) | Roadmap *Decided up front* (24 h) plus RFC 9309; in-memory is enough for one process | cheap | user (roadmap S-09) + research |
| D-8 | Limits and their configuration | New env `FETCH_TIMEOUT_MS` (integer 1 000–60 000, default 20 000) and `FETCH_MAX_BYTES` (integer 65 536–5 242 880, default 1 048 576). The timeout is **one deadline per import fetch**, covering robots.txt, every hop, headers and body (`AbortSignal.timeout`). The size limit applies per response: a `Content-Length` above it aborts before the body is read, and a streamed body is aborted as soon as it passes the limit. Requests send `accept-encoding: identity` | B: a timeout per request (simpler, but robots + 6 hops could keep the operator's HTTP request open for 140 s); C: fixed constants (no config, but AC4 says "configured") | NFR-03 defaults and the roadmap; one deadline bounds the import request the browser waits on | cheap | user (roadmap S-09) + agent |
| D-9 | Accepted content and decoding | 2xx only (else `http_status`). `text/html` and `application/xhtml+xml` go through extraction; `text/plain` is taken as the text, with the title derived as in S-03; anything else gives `unsupported_content`. Charset: the `Content-Type` parameter, else a `<meta charset>` / `http-equiv` in the first 1 024 bytes, else UTF-8, decoded with `TextDecoder` (Node's full ICU covers iso-8859-2 and windows-1250); an unknown label falls back to UTF-8 | B: HTML only (simpler, refuses plain-text job boards); C: sniff content without trusting the header (more code, more surprises) | Covers the pages an operator pastes, with Polish legacy charsets | cheap | agent |
| D-10 | What becomes title and snippet | Readability on a linkedom document: title = Readability `title`, else `<title>`, else the S-03 rule (first line / URL), cut to 200 chars. Text = Readability `textContent`, or, when Readability returns null, the `<body>` text without `script`/`style`/`noscript`. Normalisation: each line trimmed, runs of spaces/tabs become one space, 3+ newlines become 2, then trim. Text over `IMPORT_MAX_TEXT_CHARS` is cut to that length (at a code-point boundary). An empty result gives `no_text`. The text is the snippet and the `IMPORT` evidence `sourceFact`, and its content hash is claimed as in S-03 | B: reject over-long text with `too_large` (no cut text, but long pages could not be imported at all); C: store the raw HTML too (re-extraction possible later, but it stores untrusted markup and much more data) | A verbatim prefix is still a source fact; the same length limit as pasted text | cheap | agent |
| D-11 | How a fetched signal is told apart | New `SourceType` value `manual_fetch` for a signal whose text came from a fetch (`manual_url` stays for URL + pasted text, `manual_text` for text only). Web label "Pobrana strona (jednorazowo)". `fetchedAt` = when the page body was read. `availability` stays `NOT_CHECKED` and `lastVerifiedAt` null: a reachable page does not show the job is still open | B: keep `manual_url` (no contract change, but stored rows can never be split later by whether the text was pasted or fetched); C: `availability AVAILABLE` with `lastVerifiedAt = fetchedAt` (looks verified, but claims more than a 200 proves) | Additive enum value keeps provenance (FR-06 AC3) and keeps the door open; no migration (no CHECK constraint) | costly (public API, stored values) | agent |
| D-12 | Concurrency and user agent of the shared client | One client instance per process, created in `server.ts`. A small semaphore keeps at most 2 requests in flight (NFR-01); a queued request still counts against its deadline. `user-agent: LeadHunterAI/<VERSION> (+https://github.com/KrzysztofSikora/lead-hunter-ai)` on every request (VERSION from `apps/api/src/version.ts`, URL = the repo's `origin`) | B: no limit until S-12 schedules runs (less code now, but S-10 would have to retrofit it into the shared client) | NFR-01 binds every outbound request; roadmap fixes the UA format | cheap | user (roadmap S-09) + prd |
| D-13 | How the guard and client are tested | Unit table in `address-guard.test.ts` for the address policy, the URL target check and the guarded lookup with a fake resolver (including a resolver that answers public and then private: rebinding). Client tests (`http-client.int.test.ts`) against a `node:http` server on `127.0.0.1`, using the real undici `Agent` path with a fake resolver and, for positive-path cases only, a test policy that also allows `127.0.0.1`. These cover the IP-literal refusal with zero connections reaching the server, a redirect to a hostname that resolves private, oversize by `Content-Length` and by stream, the deadline, and the hop limit. The route test uses the global `MockAgent` (robots + page → signal, robots disallow, a 404 page) | B: `MockAgent` only (one mocking style, but MockAgent never calls `connect`, so the lookup guard and rebinding would go untested); C: a real DNS server fixture (closest to reality, much more setup) | TR-03 needs the connect path covered; loopback is not outbound network, so test-plan isolation holds | cheap | agent |
| D-14 | Import page after a failed fetch | The URL stays in its field, the text field is focused, and an alert shows the reason text plus "Wklej treść ogłoszenia w polu powyżej i zaimportuj ponownie — adres zostanie zapisany jako źródło." The URL hint becomes "Jeśli nie wkleisz treści, strona zostanie pobrana jednorazowo (z poszanowaniem robots.txt)." | B: a separate "paste text" dialog (more UI for the same step) | Smallest change that offers the paste (AC2/AC3) | cheap | agent |

## Design

### Modules and files
```
apps/api/src/infrastructure/sources/http/
  address-guard.ts   isAllowedAddress(ip), checkTarget(url, isAllowed), createGuardedLookup({ resolve, isAllowed })
  client.ts          createHttpClient({ userAgent, maxBytes, maxInFlight, resolve?, isAllowed?, dispatcher? })
apps/api/src/infrastructure/sources/manual/
  page-fetcher.ts    createPageFetcher({ http, timeoutMs, maxTextChars, clock }) implements PageFetcher
  robots.ts          createRobotsCheck({ http, userAgentToken, clock }) (24 h cache)
  extract.ts         extractPage(body: Uint8Array, contentType: string, url: string, maxTextChars) → { title, text } | null
apps/api/src/modules/signals/ports.ts   PageFetcher port
```

### Guard (`address-guard.ts`, mutation target)
- `isAllowedAddress(ip: string): boolean`: `ipaddr.isValid` must hold, otherwise `false`. An
  IPv4-mapped address is unwrapped with `toIPv4Address()`. The result is
  `range() === 'unicast'` (D-4).
- `checkTarget(url: URL, isAllowed): GuardFailure | null`: protocol not `http:`/`https:` →
  `blocked_url`; username/password present → `blocked_url`; `hostname` stripped of `[ ]`, and if
  `net.isIP` is true and `!isAllowed` → `blocked_address`.
- `createGuardedLookup({ resolve = dns.lookup, isAllowed })` returns a function with Node's
  `lookup(hostname, options, callback)` signature. It always resolves with `{ all: true }`, and
  an empty answer or any disallowed address fails with `BlockedAddressError` (`code:
  'ERR_BLOCKED_ADDRESS'`). It answers in the shape the caller asked for: the array for
  `options.all`, otherwise the first `(address, family)`.

### Client (`client.ts`)
- `HttpClient.get(url: string, opts: { signal: AbortSignal; accept: string }): Promise<HttpResponse>`
  - `HttpResponse = { status, headers, body: Uint8Array, url: string /* final */ }`. It throws
    `HttpFetchError { reason: FetchFailureReason, httpStatus? }`.
  - Per hop: `checkTarget` → semaphore → `undici.request(url, { dispatcher: agent, method:
    'GET', headers: { 'user-agent', accept, 'accept-encoding': 'identity' }, signal })`.
    A 3xx with `Location` (D-6) is drained and followed. Otherwise the body is read with the
    byte limit.
  - Error mapping: `ERR_BLOCKED_ADDRESS` (also when wrapped in `cause` or an `AggregateError`)
    → `blocked_address`; abort by the deadline → `timeout`; other socket/DNS errors →
    `network`.
  - The agent is `new Agent({ connect: { lookup: guardedLookup } })`. `dispatcher` is injectable
    only so that the route tests can pass the global `MockAgent`.
  - The client knows nothing about robots or HTML; S-10 uses `get` directly.

### Page fetcher and service
- Port (`modules/signals/ports.ts`):
  `PageFetcher.fetch(url: string): Promise<{ ok: true; title: string; text: string; fetchedAt: number } | { ok: false; reason: FetchFailureReason; httpStatus?: number }>`
- `createPageFetcher`: `deadline = AbortSignal.timeout(timeoutMs)` → `robots.isAllowed(url,
  deadline)` → `http.get(url)`; each redirect hop's origin is checked against robots before it
  is requested (the client takes an optional `beforeHop(url)` hook that can throw
  `HttpFetchError`) → `extractPage` → `{ ok: true }`. Fetcher outcomes are logged at `info`
  with the host and reason only, never the body.
- `SignalService.importSignal` becomes `async`:
  1. If there is a URL, no non-blank text, and `repository.findOwner('canonical_url', canonical)`
     returns an owner, it returns `duplicate` (`matchedBy: canonical_url`) with the same evidence
     rule as today. That rule adds nothing for a URL-only repeat (D-1 of S-03), so it is a plain
     read with no write.
  2. If there is a URL and no non-blank text, `pageFetcher.fetch(url)` runs. On `ok: false` it
     returns `{ result: 'fetch_failed', reason, httpStatus? }`.
  3. The existing synchronous transaction runs with `snippet = fetched text`, `title = fetched
     title`, `sourceType = 'manual_fetch'` and `fetchedAt = fetched.fetchedAt`. It re-checks
     identity, so an import that races in during the fetch still dedups.
- `SignalRepository` gets a read-only `findOwner(kind, value)` outside a transaction. The route
  maps `fetch_failed` → 422, `created` → 201, `duplicate` → 200, and the OpenAPI response map
  gains 422.

### Contracts (`packages/contracts/src/opportunities.ts`)
- `SourceType` += `'manual_fetch'` (D-11).
- `FetchFailureReason` enum (D-3).
- `ImportResult` += `{ result: 'fetch_failed', reason: FetchFailureReason, httpStatus?: int 100–599 }` strict.

### Config (`packages/config/src/env.ts`)
- `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES` → `Config.fetchTimeoutMs`, `Config.fetchMaxBytes`, with
  `EXPECTED` texts. Both are documented in `.env.example`.

### Error model summary
| Situation | Reason | Requests made |
|-----------|--------|---------------|
| URL host is a blocked literal (`127.0.0.1`, `[::1]`, `[::ffff:10.0.0.1]`, `169.254.169.254`) | `blocked_address` | none |
| DNS answer contains a blocked address | `blocked_address` | none to that address |
| Redirect hop to a blocked literal/host | `blocked_address` | earlier hops only |
| Redirect to `ftp:`, `file:`, `javascript:` or `user:pass@` | `blocked_url` | earlier hops only |
| robots.txt disallows | `robots_disallowed` | robots.txt only |
| robots.txt 5xx / unreachable | `robots_unavailable` | robots.txt only |
| Deadline passed | `timeout` | aborted |
| Body or `Content-Length` > `FETCH_MAX_BYTES` | `too_large` | aborted |

## Phases

### Phase 1: Address guard and shared HTTP client
- Files:
  - `apps/api/package.json`: move `undici` to `dependencies` and add `ipaddr.js@2.5.0` (exact
    pins, as the rest). Contract: runtime deps from tech-stack only.
  - `apps/api/src/infrastructure/sources/http/address-guard.ts`: new. Contract:
    `isAllowedAddress(ip: string): boolean`, `checkTarget(url: URL, isAllowed?): 'blocked_url' | 'blocked_address' | null`,
    `createGuardedLookup(opts?: { resolve?, isAllowed? })`, `BlockedAddressError`. Invariant: only
    `unicast` passes (D-4); a hostname with any blocked address fails.
  - `apps/api/src/infrastructure/sources/http/address-guard.test.ts`: new unit table. v4: one
    case at each edge of 0/8, 10/8, 100.64/10 (100.63.255.255 allowed, 100.64.0.0 and
    100.127.255.255 blocked, 100.128.0.0 allowed), 127/8, 169.254/16 incl. 169.254.169.254,
    172.16/12 (172.15.255.255 and 172.32.0.0 allowed), 192.168/16, 192.0.0/24, 192.0.2/24,
    198.18/15, 224/4, 240/4, 255.255.255.255, plus public 1.1.1.1 / 93.184.216.34. v6: `::`,
    `::1`, `fe80::1`, `fc00::1`, `fd00:ec2::254`, `ff02::1`, `::ffff:127.0.0.1`,
    `::ffff:10.0.0.1`, `::ffff:8.8.8.8` (allowed), `64:ff9b::a00:1`, `2002:a00:1::`,
    `2001:db8::1`, public `2606:4700:4700::1111`; invalid strings blocked. `checkTarget`:
    schemes, user info, `[::1]`, `http://2130706433/`, `http://0x7f.1/`, public hostname →
    null. Lookup: all-public answer passed in both `all` shapes; mixed answer refused; empty
    answer refused; resolver error passed through; public-then-private resolver refused on the
    second call.
  - `apps/api/src/infrastructure/sources/http/client.ts`: new. Contract: `createHttpClient(opts)`
    → `HttpClient.get(url, { signal, accept, beforeHop? })`; `HttpFetchError { reason, httpStatus? }`;
    `FetchFailureReason` type (temporarily local, moved to contracts in Phase 2). Invariants:
    ≤ 5 redirects, ≤ `maxBytes` per body, ≤ `maxInFlight` (2) concurrent, UA header on every
    request, `accept-encoding: identity`.
  - `apps/api/test/http-client.int.test.ts`: new, loopback `node:http` server (D-13). Cases:
    literal `127.0.0.1` refused with 0 server connections; host `internal.test` resolving to
    `10.0.0.5` refused (resolver called, 0 connections); positive path with test policy (UA
    header seen by the server, body returned); 302 to `http://internal.test:<port>/` refused at
    hop 2; 302 to `ftp://…` → `blocked_url`; 6 redirects → `too_many_redirects`;
    `Content-Length` 2 MB → `too_large` before the body is sent; chunked body over the limit →
    `too_large`; server that never answers + 200 ms deadline → `timeout`; 3 parallel requests →
    the server never sees more than 2 at once.
  - `packages/config/src/env.ts`, `env.test.ts`, `.env.example`: `FETCH_TIMEOUT_MS`,
    `FETCH_MAX_BYTES` (D-8) with range errors in `EXPECTED`. Contract: `Config.fetchTimeoutMs`,
    `Config.fetchMaxBytes`.
  - `context/test-plan.md`: TR-03 test column names the two test files (mutation-target path
    unchanged).
- Proves: FR-03 AC2 (unit + integration at client level), AC4 (integration at client level).
- Agent checks: `pnpm typecheck`, `pnpm lint`,
  `pnpm test -- apps/api/src/infrastructure/sources/http apps/api/test/http-client.int.test.ts packages/config`,
  then `pnpm test`.
- Human checks: none.

### Phase 2: Page fetch with robots.txt and the import contract
- Files:
  - `apps/api/package.json`: add `@mozilla/readability@0.6.0`, `linkedom@0.18.14`,
    `robots-parser@3.0.1`.
  - `packages/contracts/src/opportunities.ts`, `index.ts`: `SourceType` += `manual_fetch`;
    `FetchFailureReason`; `ImportResult` `fetch_failed` variant (D-2, D-3, D-11). `client.ts`
    imports the reason type from contracts.
  - `apps/api/src/infrastructure/sources/manual/robots.ts`: new. Contract:
    `RobotsCheck.check(url: URL, signal): Promise<void>` throws `HttpFetchError`
    (`robots_disallowed` | `robots_unavailable`). Invariant: at most one robots.txt request per
    origin per 24 h for cached outcomes (D-7).
  - `apps/api/src/infrastructure/sources/manual/extract.ts`: new. Contract:
    `extractPage(body, contentType, url, maxTextChars): { title: string; text: string } | 'unsupported_content' | 'no_text'`
    (D-9, D-10). Untrusted HTML is parsed only, never executed (linkedom runs no scripts).
  - `apps/api/src/infrastructure/sources/manual/page-fetcher.ts`: new. Implements the
    `PageFetcher` port. One deadline per fetch (D-8); robots via `beforeHop`.
  - `apps/api/src/modules/signals/ports.ts`: `PageFetcher` port; `SignalRepository.findOwner`.
  - `apps/api/src/infrastructure/db/signal-repository.ts`: `findOwner` outside a transaction.
  - `apps/api/src/modules/signals/service.ts`: `importSignal` becomes async with the three steps
    in *Design*. Contract: `importSignal(request): Promise<ImportResult>`; the transaction stays
    synchronous.
  - `apps/api/src/modules/signals/routes.ts`: `fetch_failed` → 422; response map gains 422.
  - `apps/api/src/app.ts`, `apps/api/src/server.ts`: `SignalDeps.pageFetcher`; `server.ts` builds
    one `HttpClient` (UA from `VERSION`, limits from config) and the page fetcher.
  - `apps/api/test/helpers/app.ts`: default `pageFetcher` = the real page fetcher over a client
    whose `dispatcher` is the global `MockAgent`; an override is allowed.
  - `apps/api/test/fixtures/pages/synthetic-job-post.html` (DEMO, fictional, Polish, with
    `<nav>`, `<script>` and an injection line "Ignore previous instructions" in the body) and
    `synthetic-iso-8859-2.html`.
  - `apps/api/test/url-import.int.test.ts`: new route tests with `MockAgent`: URL-only import →
    201, `sourceType manual_fetch`, title and text from the fixture without nav/script,
    `fetchedAt` = fake clock, exactly one page request and one robots request; the same URL
    again → duplicate with 0 new requests; robots `Disallow: /` for `LeadHunterAI` → 422
    `robots_disallowed`, the page is never requested, nothing stored; robots 503 →
    `robots_unavailable`; page 404 → 422 `http_status` 404; URL + text → 201 `manual_url`, 0
    requests; `http://127.0.0.1/x` → 422 `blocked_address`, 0 requests; ISO-8859-2 page
    decoded (`zażółć`); text longer than `IMPORT_MAX_TEXT_CHARS` is cut to it.
  - `apps/api/test/signals-import.int.test.ts`: the restart test (line 215) imports
    `{ text: POST, url: URL_A }` instead of a URL-only payload. Its subject, dedup after
    restart by canonical URL, is unchanged; a URL-only first import would now need a mocked page.
  - `apps/api/src/modules/analysis/*`: no change expected; if the prefilter or prompt switch on
    `sourceType`, `manual_fetch` is treated like `manual_url`.
  - `apps/web/src/strings.pl.ts`: `sourceTypes.manual_fetch` label. It is needed for the
    typecheck, because the record is keyed by `SourceType`.
- Proves: FR-03 AC1, AC3, AC4 (integration through the route), AC2 at route level (literal
  address, 0 requests); TR-02 is unchanged (fetched text enters analysis as data, like pasted
  text).
- Agent checks: `pnpm typecheck`, `pnpm lint`,
  `pnpm test -- apps/api/test/url-import.int.test.ts apps/api/test/signals-import.int.test.ts apps/api/test/openapi.int.test.ts`,
  then `pnpm test`, `pnpm docker:build` (new runtime deps in the image).
- Human checks:
  - Import a real public job page (e.g. a Useme or justjoin.it offer page you are allowed to
    open) from a machine with internet, with only the URL filled. Expected: 201, the card shows
    the page title, a readable main text without menus, and "Pobrana strona (jednorazowo)".
    Evidence: the response JSON and a card screenshot in `evidence/`.
  - Pick a site whose robots.txt disallows all bots (confirm with
    `curl -s https://<site>/robots.txt` showing `User-agent: *` + `Disallow: /`) and import one
    of its pages with only the URL. Expected: 422 `robots_disallowed`, and the server log shows
    only the robots.txt request for that host. Evidence: the response JSON and the log line.

### Phase 3: Import page handles a refused or failed fetch
- Files:
  - `apps/web/src/api/signals.ts`: 422 → `{ ok: true, result }` with the `fetch_failed`
    variant, parsed by `ImportResult`. Contract: `ImportOutcome` unchanged in shape.
  - `apps/web/src/ImportPage.tsx`: `fetch_failed` keeps both fields, focuses the text area and
    shows `role="alert"` with the reason text and the paste prompt (D-14). `created` and
    `duplicate` behave as before.
  - `apps/web/src/strings.pl.ts`: `import.fetchFailed.<reason>` texts for every
    `FetchFailureReason` (typed as `Record<FetchFailureReason, string>` so a missing one fails
    typecheck), the paste prompt, and the new `urlHint`.
- Proves: AC2/AC3 "offers pasting the text and shows the reason" (human check; no component
  tests by budget).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (existing specs still
  pass; they paste text and never fetch).
- Human checks:
  - `pnpm dev`, log in, Import, a URL whose name resolves to a private address (the contract
    rejects IP literals with 400, see Deviations) such as `http://10.0.0.5.nip.io/` with no text,
    submit. Expected: an
    alert with the "adres prywatny/lokalny" reason and the paste prompt, the URL still in its
    field, the cursor in the text area. Paste any text and submit: "Zaimportowano", and the card
    shows the URL as the source. Evidence: two 360 px screenshots.
  - Read every `fetchFailed` text in `strings.pl.ts` for wording.

## Risks and unknowns
- robots-parser user-agent matching with the token `LeadHunterAI` is `UNVERIFIED`. Phase 2's
  robots test fixes the behaviour; if the library matches differently, `robots.ts` passes the
  form it expects, and this is logged as `[minor]`.
- Readability on linkedom can return null or mis-extract unusual pages. The `<body>` fallback
  (D-10) and the human check on a real page cover it, and the extraction may be weaker than in a
  browser.
- Undici error shapes for a lookup failure (wrapped in `cause` or `AggregateError` with
  `autoSelectFamily`) are mapped defensively. The Phase 1 client tests pin them.
- The mutation score target is 90 % on `address-guard.ts`. Keeping that file pure (no I/O apart
  from the injected resolver) makes it reachable; the mutation step reports survivors.
- A page behind a CDN bot challenge answers 403/503, which is reported as `http_status`, never
  bypassed (PRD §5).

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Address guard and shared HTTP client
- [x] Phase 2: Page fetch with robots.txt and the import contract
- [ ] Phase 3: Import page handles a refused or failed fetch

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 2) Import a real public job page (a Useme or justjoin.it offer you may open) with only the URL filled — run: `pnpm dev`, log in, Import, paste the URL, or `curl -s -X POST localhost:8080/api/signals/import -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{"url":"https://<offer>"}'` — expected: 201, card shows the page title, readable main text without menus, label "Pobrana strona (jednorazowo)" — evidence: none (the run has no internet; save the response JSON and a card screenshot under `evidence/`)
- [ ] (Phase 2) Import a page of a site whose robots.txt disallows all bots (`curl -s https://<site>/robots.txt` shows `User-agent: *` + `Disallow: /`) with only the URL — run: same as above — expected: 422 `{"result":"fetch_failed","reason":"robots_disallowed"}` and the server log shows only the robots.txt request for that host — evidence: none (no internet here)
- [ ] (Phase 2) `pnpm docker:build` succeeds with the new runtime dependencies (`@mozilla/readability`, `linkedom`, `robots-parser`, `ipaddr.js`, `undici`) — run: `pnpm docker:build` on a machine where Corepack can download pnpm — evidence: none (in this sandbox the build stops at `corepack` with `SELF_SIGNED_CERT_IN_CHAIN` before reaching the project; `pnpm build` and a node import of the built `robots.js` pass)

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) `HttpClient.get` returns non-2xx responses to the caller instead of throwing `http_status`, because robots.txt needs the 4xx/5xx status (D-7); the page fetcher maps a bad page status to `http_status` in Phase 2. Plan-review findings 4, 5, 8, 10, 11 applied: `beforeHop` runs before a slot is taken, a 3xx body is destroyed, no `--` in test paths, caller lookup options are kept with `all: true`, `ipaddr.js` added to `DRIVERS` (the Phase 2 libs follow in Phase 2).

- [minor] (Phase 2) `importRequestSchema` (`z.httpUrl()`) already rejects IP-literal and single-label hosts with 400, so the plan's route test `http://127.0.0.1/x → 422 blocked_address` cannot happen. The route test asserts 400 with 0 requests; `blocked_address` for literals, DNS answers and redirect hops is covered by `page-fetcher.test.ts`/`http-client.int.test.ts` (real guarded client, fake resolver) and the route test for a redirect to `10.0.0.5`. Consequence for Phase 3: its human check must use a name that resolves privately (or a `10.x.nip.io` host), not `http://127.0.0.1:8080/`.
- [minor] (Phase 2) Plan-review 1, 7, 9 applied: `robots.ts` rethrows `blocked_address`, `blocked_url` and `timeout` from the robots request unchanged and folds only network, 5xx, `too_large` and `too_many_redirects` into `robots_unavailable`; `createPageFetcher` takes `robots` and `logger`; the interface is `check(url, signal)`. Plan-review 2 applied: the `signals-import` test "never merges URL imports with blank text" now mocks both pages and asserts `manual_fetch` (S-03's empty-snippet URL-only signal is retired), and the restart test imports `{ text, url }`. Plan-review 6 applied: route tests for `timeout`, `too_large`, `unsupported_content`, `no_text`, plus `extract.test.ts`. Plan-review 4's nested-`get` client test and 12's e2e wording were not added (`beforeHop` already runs before a slot is taken; the e2e duplicate flow works because a known URL is answered before any fetch).
- [REVIEW] (Phase 2) Plan-review 3: D-2 reads FR-03 AC4's "the URL is kept as the signal's source" as "kept in the form and stored on resubmit with pasted text". Alternative: store a URL-only signal for `timeout`/`too_large`/`http_status`/`network` failures. Nothing is stored on a failed fetch as implemented.
- [minor] (Phase 2) Web: until Phase 3, `ImportOutcome` and `ImportPage` state exclude `fetch_failed` (a 422 throws the generic failure) so typecheck stays green; Phase 3 widens it.
- [minor] (Phase 2) `.prettierignore` gains `apps/api/test/fixtures/pages` (an ISO-8859-2 fixture must stay byte-exact); `eslint.config.js` `DRIVERS` gains `linkedom`, `@mozilla/readability`, `robots-parser`; `robots-parser` is CommonJS, so `robots.ts` casts the default import to the callable.
- [minor] (Phase 2) linkedom keeps the text of an HTML fragment without `<html>` in `documentElement` and leaves `<body>` empty; `extract.ts` falls back to it (the plan's `UNVERIFIED` item). robots-parser matches the token `LeadHunterAI` as expected (`Disallow` in a `LeadHunterAI` group applies, `*` group otherwise).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
