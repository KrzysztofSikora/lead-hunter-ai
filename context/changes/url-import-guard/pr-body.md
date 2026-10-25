# feat(url-import-guard): import a pasted URL through a guarded fetch with robots.txt

Roadmap S-09 (FR-03): an operator who pastes only a URL into Import gets a signal whose title and text come from that page, fetched once through a shared, guarded HTTP client (AC1). The client never connects to loopback, private, link-local, CGNAT, ULA, metadata or other non-public addresses, whether the address is in the URL, comes from DNS, from a redirect hop or from a second DNS answer (AC2). Pages that robots.txt disallows for `LeadHunterAI` are not fetched (AC3). Slow or oversize responses abort with an explicit error (AC4). Every refusal or failure stores nothing, shows a Polish reason and asks for the pasted text. Later adapters (S-10 RSS) reuse the same client.
Closes #10

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] AC4 reading (D-2, costly, public API):** FR-03 AC4 says "the URL is kept as the signal's source". I read it as "kept in the form and stored when you resubmit with pasted text". A failed fetch (`timeout`, `too_large`, `http_status`, `network`, robots, blocked address) stores nothing and returns `422 { result: "fetch_failed", reason, httpStatus? }`. Alternative B: store a URL-only signal for the AC4-class failures. That is the literal reading, but it creates an empty opportunity that analysis cannot use, and the text pasted later would only become `REPEAT_IMPORT` evidence, not the snippet. Switching costs: `service.ts`, `routes.ts`, the contract variant and the Import page.
- **D-4 (costly, security):** address policy is an allow-list: only `ipaddr.process(ip).range() === 'unicast'` passes, with IPv4-mapped IPv6 unwrapped first. A hostname is refused if any resolved address is blocked. Round-1 review R3 added "IPv6 must also be in `2000::/3`". Consequence: NAT64, 6to4, Teredo, multicast and documentation ranges are refused, including public NAT64 targets on IPv6-only networks. Alternatives: B: a block-list of only the ranges AC2 names; C: block-list plus unwrapping NAT64/6to4. Switching costs: `address-guard.ts` and its table test.
- **D-3 (costly, public API):** `FetchFailureReason` enum in contracts (`blocked_address`, `blocked_url`, `robots_disallowed`, `robots_unavailable`, `timeout`, `too_large`, `http_status`, `unsupported_content`, `no_text`, `too_many_redirects`, `network`), one Polish text each in the web app. S-10 will reuse it. Alternatives: B: a generic `fetch_failed` with free-text message; C: separate HTTP codes per class. Switching costs: `opportunities.ts`, `routes.ts`, `strings.pl.ts`, `ImportPage.tsx`.
- **D-5 (costly, security):** the guard runs twice in one client: a URL target check before each hop (scheme, no user info, IP literals), and at connect via the undici `Agent`'s `connect.lookup`, which checks every resolved address and hands the checked addresses to the socket (rebinding safe). The agent connects directly and ignores `HTTP(S)_PROXY`, because a proxy would resolve names itself. Alternatives: B: resolve first, connect to the IP with a `Host` header; C: check only `URL.hostname`. Switching costs: `client.ts`, `address-guard.ts`.
- **D-11 (costly, public API and stored values):** new `SourceType` value `manual_fetch` (label "Pobrana strona (jednorazowo)") for a signal whose text was fetched; `manual_url` stays for URL + pasted text. `availability` stays `NOT_CHECKED`. No migration (no CHECK constraint on `raw_signals.source_type`). Alternatives: B: keep `manual_url`; C: `availability AVAILABLE` with `lastVerifiedAt = fetchedAt`. Switching costs: contract enum, `service.ts`, web label, stored rows.
- **Review leftovers:** none open. Round 2 (verdict "CHANGES REQUESTED") raised only R5 (blocker); it was fixed in `72a000d` and **no third review round was run**, so the R5 fix is not independently re-reviewed. See [review.md](context/changes/url-import-guard/review.md).

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) Import a real public job page (one you may open) with only the URL filled. Run `pnpm dev`, log in, Import, paste the URL, or `curl -s -X POST localhost:8080/api/signals/import -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{"url":"https://<offer>"}'`. Expected: 201, the card shows the page title, readable main text without menus, label "Pobrana strona (jednorazowo)". Evidence: none (the run had no internet); save the response JSON and a card screenshot under `context/changes/url-import-guard/evidence/`.
- [ ] (Phase 2) Import a page of a site whose robots.txt disallows all bots (`curl -s https://<site>/robots.txt` shows `User-agent: *` + `Disallow: /`) with only the URL. Run: same as above. Expected: 422 `{"result":"fetch_failed","reason":"robots_disallowed"}` and the server log shows only the robots.txt request for that host. Evidence: none.
- [ ] (Phase 2) `pnpm docker:build` succeeds with the new runtime dependencies (`@mozilla/readability`, `linkedom`, `robots-parser`, `ipaddr.js`, `undici`). Run it on a machine where Corepack can download pnpm. Evidence: none; in the run's sandbox the build stops at Corepack (cannot download pnpm 12.15.0), both review rounds the same.
- [ ] (Phase 3) Failed fetch on the Import page. Run `pnpm dev`, log in, Import, URL `http://10.0.0.5.nip.io/` with no text, submit. Expected: alert "adres prywatny lub lokalny" plus the paste prompt, URL still in its field, cursor in the text area; then paste any text and submit: "Zaimportowano", and the card shows the URL as the source. Evidence: none; save two 360 px screenshots under `context/changes/url-import-guard/evidence/`.
- [ ] (Phase 3) Read every `import.fetchFailed` text in `apps/web/src/strings.pl.ts` for wording. Evidence: none.

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | When does an import fetch? | Only with a URL and missing/blank text; a known canonical URL answers `duplicate` with no request; URL + text never fetches | B: always fetch with a URL; C: an explicit checkbox |
| D-6 | Redirects | Manual, max 5 hops, each hop re-checked (URL target, connect guard, robots); source URL stays the pasted one | B: undici redirect interceptor; C: also claim the final URL as identity |
| D-7 | robots.txt | Fetched per origin through the same client; 4xx = allowed; 5xx/network = `robots_unavailable` (RFC 9309); 24 h in-memory cache; guard errors and `timeout` pass through unchanged | B: SQLite cache; C: unreachable = allowed |
| D-8 | Limits | `FETCH_TIMEOUT_MS` (default 20 000) is one deadline per import; `FETCH_MAX_BYTES` (default 1 048 576) per response; `accept-encoding: identity` | B: per-request timeout; C: fixed constants |
| D-9 | Accepted content | 2xx `text/html`, `application/xhtml+xml`, `text/plain`; charset from header, `<meta>`, else UTF-8 | B: HTML only; C: content sniffing |
| D-10 | Title and snippet | Readability on linkedom, `<body>` text fallback, normalised, cut to `IMPORT_MAX_TEXT_CHARS`; empty gives `no_text` | B: `too_large` for long text; C: store the raw HTML |
| D-12 | Shared client | One per process, at most 2 requests in flight, UA `LeadHunterAI/<VERSION> (+repo URL)` | B: no limit until S-12 |
| D-13 | Test approach | Unit table for the guard; real loopback server with a fake resolver for the client; global `MockAgent` for routes | B: `MockAgent` only; C: real DNS fixture |
| D-14 | Import page after a failure | URL kept, text field focused, reason plus paste prompt | B: a separate dialog |

## Quality
- Gates (round 2): typecheck ok, lint ok, unit tests ok (601), e2e ok (5), mutation ok. **image: fail**, environment only (Corepack cannot download pnpm 12.15.0 inside the build, same as round 1), so it is a human check above. The last fix (R5) was committed after this gate run.
- Review: CHANGES REQUESTED, round 2. Round 1: R1 (blocker) partly fixed, R2 (major) fixed, R3 and R4 (minor) fixed. Round 2: R1 completed by R5 (blocker, linkedom parse superlinear on ~1 MB of unclosed `<b>`: 41 s of frozen process, now skipped above 20 000 tags with a linear text fallback), fixed in `72a000d`. Fixed 5, deferred 0, rejected 0.
- Mutation: `address-guard.ts` 85.33 % → 90.67 % (round 2 re-run 91.46 %); survivors are `accept`/`equivalent` (error message and name strings, unreachable `catch`, bracket-strip anchors). No `bug` mutants. `robots.ts`, `page-fetcher.ts`, `extract.ts` are not mutation targets.
- Proposed lessons: "Bound every CPU-bound step on untrusted input, or run it where the deadline can stop it" (R1, R5; add 613bcfc to the commits to drop to reject it, plus cf29b29 which first proposed it), and mutation's "fixtures that hold raw non-UTF-8 bytes must survive the mutation sandbox: store them escaped and decode in a helper".

## Follow-ups
- Mutation gap for `context/test-plan.md` *Test data and isolation*: non-UTF-8 fixtures must be stored as ASCII escapes (`pageFixture()` in `apps/api/test/helpers/page-fixture.ts`).
- Considered but out of scope: claiming the final URL after redirects as an identity (D-6 C); persistent robots cache (D-7 B); re-checking availability of a stored page.
- Plan-review items not applied (logged as `[minor]`): the nested-`get` client test (plan-review 4) and the e2e wording (plan-review 12).

## Commits
```
dcec4f4 docs(url-import-guard): triage review round 2
613bcfc docs(url-import-guard): propose lessons
72a000d fix(url-import-guard): skip the DOM above 20 000 tags, plain linear text fallback (R5)
a9d9117 docs(url-import-guard): review
01a5887 docs(url-import-guard): triage review round 1
cf29b29 docs(url-import-guard): propose lessons
c5128c8 fix(url-import-guard): bound Readability input, empty HTML is no_text, log unexpected fetch errors (R1, R2)
bcd7734 test(url-import-guard): redirect target origin is checked against its robots.txt (R4)
9c113aa fix(url-import-guard): allow only 2000::/3 among IPv6 addresses (R3)
3f9b9dc docs(url-import-guard): review
85fdd5a docs(url-import-guard): mutation
ecb5643 test(url-import-guard): strengthen assertions from mutation check
9cdedb3 feat(url-import-guard): Import page shows a failed fetch and asks for the text
daada03 feat(url-import-guard): fetch a pasted URL with robots.txt and the fetch_failed contract
48335b1 feat(url-import-guard): address guard and shared HTTP client
67a7f5e docs(url-import-guard): plan-review
d7a3ee4 docs(url-import-guard): plan
```

<details><summary>Run</summary>

Base `main`, branch `change/url-import-guard`, started 2026-10-25 14:21 UTC. No failed step, no stop requested. Plan review: READY WITH NOTES (one round). Phases ticked 3/3.

| Step | Attempts | Cost |
|------|----------|------|
| plan (opus) | 1 | $1.77 |
| plan-review (opus) | 1 | $1.02 |
| implement (sonnet), 3 phases | 1 each | $0.56 + $1.33 + $0.27 |
| mutation (sonnet) | 1 | $0.36 |
| review round 1 (opus) | 1 | $1.43 |
| fix-review round 1 (sonnet) | 1 | $0.30 |
| review round 2 (opus) | 1 | $0.83 |
| fix-review round 2 (sonnet) | 1 | $0.17 |

Total before pr-body: about $8.04.
</details>

https://claude.ai/code/session_01L7xnPWXcnFkaxbXFZSCLFq
