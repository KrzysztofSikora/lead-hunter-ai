# PRD: Lead Hunter AI

Sources: brief `lead-hunter-ai-PRD.md` (v1.0, 2026-10-24), `context/shape-notes.md`.
Brief references `B-nn` are defined in the traceability table at the end; `§n` points to the
brief's sections. Shape decisions are `D-nn`, assumptions `A-nn`, non-goals `NG-nn`.

## Problem and goal
A solo software/AI/IoT studio owner has broad skills but no time to watch a dozen job boards and
communities every day, and the links found there rarely turn into an action. Lead Hunter AI runs
24/7 on the operator's Raspberry Pi, collects real demand signals from permitted sources, tells
facts from model inferences, scores each opportunity with explicit rules and proposes one next
step. For the opportunities the operator chooses, it drafts an offer that the operator reviews
and sends by hand, then records contact, outcome and real payments.

Core promise (brief §1): "Find real problems someone may pay to solve, check whether I can solve
them, estimate how to monetise, prepare the next step and measure whether it brought money."
Success is paid work, not the number of analyses (B-02). Priorities on conflict: truth of data,
lawful access to sources, security, a working sales process, low running cost (B-01).

## Users
- **Primary (MVP):** one operator — a solo technical service provider (persona A, §3) using a
  phone and a laptop on the home network.
- Later: other freelancers or small studios self-hosting their own instance.
- Not targeted: teams sharing one instance, recruiters, mass outreach.

## Constraints
- **C-01** Backend: Node.js LTS + TypeScript + Fastify + Zod (B-40).
- **C-02** UI: React + TypeScript + Vite, single-page app served by the same process; no Next.js
  (B-40).
- **C-03** Storage: SQLite with reproducible migrations; Drizzle ORM preferred (B-40).
- **C-04** Jobs: in-process scheduler with durable state in SQLite; no Redis/RabbitMQ (B-40).
- **C-05** Tests: Vitest, API tests via Fastify inject, component tests, one end-to-end test of
  the main path (B-41).
- **C-06** Runtime: one service on Raspberry Pi 4B 8 GB, Linux ARM64, as a Docker Compose
  service; no `systemd` unit for the app (D-14, deviates from B-39/B-44 which name `systemd`).
- **C-07** Monorepo per §13.3 (`apps/api`, `apps/web`, `packages/contracts`, `packages/config`,
  `deploy/`, `docs/`, `scripts/`); domain logic separate from adapters, API and UI (B-42).
- **C-08** Commands: `pnpm install|dev|test|typecheck|build|db:migrate|discover` (B-43).
- **C-09** LLM only through APIs (Anthropic, OpenAI-compatible) or a mock; the app ships no local
  model (D-07, D-08, B-38).
- **C-10** Polish UI; offer drafts in the source's language (D-11).
- **C-11** Repository private for now; nothing private ever committed (D-13, B-36).
- **C-12** The phased implementation plan lives in `context/changes/<id>/plan.md` (workflow);
  `docs/implementation-plan.md` (§0.2) is replaced by `context/roadmap.md` plus the README section
  "Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji" (FR-26).

## User stories
- **US-01** As the operator, I configure my skills, preferences and commercial goals so results match me. (B-05)
- **US-02** As the operator, I add a URL or pasted text of a potential job and get a structured opportunity with its source. (B-06)
- **US-03** As the operator, I want permitted sources checked on a schedule even when my laptop is off. (B-07)
- **US-04** As the operator, I see 3–5 best opportunities a day instead of hundreds of links. (B-08)
- **US-05** As the operator, I see why something scored 82/100 and whether the need is confirmed. (B-09)
- **US-06** As the operator, I get an offer draft and MVP scope for one opportunity, without invented facts. (B-10)
- **US-07** As the operator, I approve, edit, copy and send the offer myself; nothing reaches a client without me. (B-11)
- **US-08** As the operator, I record a reply, meeting, win, loss or payment to measure results. (B-12)
- **US-09** As the operator, I understand why a source or an analysis failed and can retry without duplicates. (B-13)
- **US-10** As the operator, after a week I see which channels and project types bring replies and revenue. (B-14)
- **US-11** As the operator, I receive my Useme/Oferia job alert e-mails as signals without retyping them. (D-03)
- **US-12** As the operator, I choose a paid, free or LAN LLM provider and cap what it may cost. (D-07, D-09)

## Functional requirements

### FR-01 Operator profile  (Must, covers US-01, B-05, B-04)
Fields per §2.3: skills, experience, service types, preferred and excluded technologies,
industries, excluded categories, minimum job value, preferred billing model, languages,
remote/on-site, countries, weekly available hours, preferred rate ranges, revenue goals,
direct-revenue vs product-hypothesis split (default 80/20).
- AC1: Given a fresh install, When the operator opens Profile, Then an anonymous example profile marked `PRZYKŁAD` is shown and can be edited and saved without touching code or files.
- AC2: Given a saved profile, When the process restarts, Then the same values are returned by `GET /api/profile`.
- AC3: Given a profile payload with an unknown field, a negative amount or a split not summing to 100, When it is saved, Then it is rejected with a field-level validation error and nothing is stored.
- AC4: Given the repository, When it is searched, Then no real operator profile or prices exist in it; the example profile contains no real names, rates or clients.

### FR-02 Manual import  (Must, covers US-02, B-06, B-15, AC-01, AC-02)
- AC1: Given pasted text without a URL, When it is imported, Then a raw signal with origin `manual_text`, `canonicalUrl = null`, `fetchedAt = now` and the text as snippet is stored, and no URL is invented.
- AC2: Given a URL (with or without pasted text), When it is imported twice (including variants differing only in tracking parameters, fragment, trailing slash or host case), Then only one signal and one opportunity exist and the second import reports "już zaimportowane" with a link to the existing one.
- AC3: Given an import, When it is stored, Then it is queued for pre-filter and analysis (FR-07, FR-08) without further operator action.
- AC4: Given an empty text and no URL, or text above the configured maximum length, When it is imported, Then it is rejected with a validation error.

### FR-03 One-off URL fetch  (Must, covers B-06, B-34, AC-18, D-06)
- AC1: Given a URL to a public http/https page, When the operator imports it, Then the page is fetched once, its title and main text are extracted into the signal, and the fetch time is recorded.
- AC2: Given a URL whose host resolves (directly, after any redirect, or via DNS rebinding) to loopback, private (RFC 1918, ULA), link-local, CGNAT or cloud-metadata addresses, or a scheme other than http/https, When it is imported, Then no request is made to that address, the import offers pasting the text instead, and the reason is shown.
- AC3: Given a page disallowed for our user agent by its robots.txt, When it is imported, Then it is not fetched and the operator is asked to paste the text.
- AC4: Given a slow or huge response, When it exceeds the configured timeout or size limit, Then the fetch is aborted and reported as an error; the URL is kept as the signal's source.

### FR-04 Source adapters and RSS/Atom  (Must, covers US-03, US-09, B-07, B-16, B-17, B-19, AC-03, AC-04, AC-15, D-01, D-02)
Every adapter implements the contract in §5.2 (`discover`, `validateConfig`, `healthCheck`) and
returns raw signals with the §5.2 fields; adapters never score.
- AC1: Given an enabled RSS/Atom source with a new entry, When discovery runs, Then the entry is stored as a raw signal with source, URL, title, snippet, `publishedAt` (or null), `fetchedAt` and content hash, and appears in the panel with source name and date.
- AC2: Given presets, When the operator adds a source, Then demand-only feeds can be added in one step — "Hacker News — Seeking freelancer" (`hnrss.org/whoishiring/freelance`), Freelancer.com project feeds per skill, the Arduino Forum "Jobs and Paid Consultancy" category and any further preset that carries requests for work (D-15); job-board feeds are not offered as presets; any other RSS/Atom URL can be added manually. (revised 2026-10-25, D-15; WWR presets withdrawn)
- AC3: Given a source that is unreachable, returns non-2xx or unparsable XML, When discovery runs, Then the job run records an error for that source, `lastError` is set, previously stored signals are untouched, and other sources still run.
- AC4: Given a `429` or `503` with or without `Retry-After`, When discovery runs, Then the adapter backs off exponentially within the run, stops after the configured attempts, records the failure, and the next attempt waits at least the larger of `Retry-After` and the per-source minimum interval (A-03).
- AC5: Given a successful run, When the same feed is read again, Then the cursor (last seen id/date) prevents reprocessing and no duplicate signal is created.
- AC6: Given an item from any feed, When it is shown, Then the card names the source and links to the original URL (D-02).
- AC7: Given a source whose terms or access method is documented, When the Sources view shows it, Then it states the access method and limits (B-35).

### FR-05 E-mail alert import (IMAP)  (Must, covers US-11, D-03, D-04, A-08)
- AC1: Given IMAP host, user, app password and folder in `.env`, When discovery runs, Then the folder is opened read-only and only unseen-by-us messages (tracked by UID/Message-ID cursor) from allow-listed senders are parsed; messages are not deleted, moved or flagged.
- AC2: Given a Useme job alert, When it is parsed, Then each job in it becomes a raw signal with the job title, snippet, Useme job URL, alert date and source "Useme (e-mail)"; the full e-mail body is not stored.
- AC3: Given a message from a non-allow-listed sender, When discovery runs, Then it is skipped and only counted.
- AC4: Given an allow-listed message the parser cannot read, When discovery runs, Then an explicit parse error is recorded with the Message-ID for retry; it is never silently dropped.
- AC5: Given wrong credentials or an unreachable server, When discovery runs, Then the source shows an authentication/connection error and other sources still run.
- AC6: Given logs, When any IMAP step runs, Then no password, e-mail body or full address list appears in them.

### FR-06 Normalisation, deduplication and provenance  (Must, covers B-15, B-18, B-24, AC-02)
- AC1: Given signals from any source, When they are normalised, Then identity is checked by canonical URL, then `externalId` per source, then content hash; a match links to the existing signal instead of creating an opportunity.
- AC2: Given two signals with similar titles but different canonical URLs and different authors/organisations, When they are normalised, Then they stay separate opportunities.
- AC3: Given an opportunity, When it is stored, Then it keeps: exact source URL and type (or `manual_text`), title, snippet/extract, `publishedAt` or null, `fetchedAt`, availability status and last verification time, `evidenceLevel`, and which fields are source facts and which are model inferences.

### FR-07 Deterministic pre-filter  (Must, covers B-20, A-01, A-02)
Cheap rules before any LLM call: language, freshness (maximum age), keyword match against the
profile, excluded technologies/categories, duplicates, obvious spam.
- AC1: Given a signal failing a rule, When the pre-filter runs, Then it is not sent to the LLM and is stored as rejected with the rule name as reason.
- AC2: Given an HN freelance comment starting with "SEEKING WORK", When the pre-filter runs, Then it is rejected as "oferta wykonawcy, nie zlecenie"; "SEEKING FREELANCER" comments pass.
- AC3: Given more passing signals than the daily analysis limit, When the pre-filter runs, Then the highest pre-filter matches are analysed first and the rest wait for the next day, with the count shown.

### FR-08 LLM analysis  (Must, covers US-05, B-21, B-22, B-23, B-34, AC-05, AC-09, AC-14, D-07)
The provider returns JSON matching a versioned schema with the fields of §6.1 plus `sourceFacts`,
`inferences`, `unknowns` and `sourceBudget` (only when the source states a budget, with its quote).
- AC1: Given a valid model response, When it is stored, Then the analysis keeps provider, model, prompt version, schema version, date, token usage if reported, and `analysisStatus = COMPLETE`.
- AC2: Given a response that is not JSON, fails the schema, exceeds length limits or has out-of-range numbers, When it is validated, Then it is rejected, `analysisStatus = FAILED` with the reason, and the operator can retry; the signal is kept.
- AC3: Given source content containing instructions (e.g. "ignore previous instructions", "print your API key", "change the settings"), When it is analysed, Then the content is passed only as delimited data, no tool or command is executed, no secret or configuration appears in the output, and no setting changes (test fixture with injection attempts).
- AC4: Given a response naming a URL, e-mail, person or company absent from the source text, When it is validated, Then that value is removed or the analysis is flagged, and it is never shown as a source fact.
- AC5: Given no LLM configuration, When the operator opens the app, Then the UI says that analysis is not configured; import, manual opportunities, statuses and payments still work.
- AC6: Given the mock provider, When it analyses, Then results are deterministic for the same input and every view labels them `DEMO / MOCK`, never as AI analysis.
- AC7: Given the Anthropic or the OpenAI-compatible provider with a base URL and model in `.env`, When an analysis runs, Then the same schema validation applies to both; switching providers needs no code change.
- AC8: Given the model answers "insufficient data", When it is stored, Then the opportunity gets `NEEDS_VERIFICATION`.

### FR-09 Cost and volume limits  (Must, covers B-23, B-37, D-09)
- AC1: Given a paid provider without `LLM_MONTHLY_BUDGET_USD`, When an analysis is requested, Then it does not run and the UI explains how to set the cap.
- AC2: Given a cap and reported usage, When the month-to-date cost reaches the cap, Then further analyses and drafts stop with a visible message until the next month or a higher cap; imports continue.
- AC3: Given daily limits (defaults: 100 raw signals, 20 analyses, 5 offer drafts), When a limit is reached, Then the remaining work waits for the next day and the brief shows the count.
- AC4: Given a provider that does not report usage or cost, When cost is shown, Then it reads "brak danych" with the token count if known, never an estimate presented as exact.
- AC5: Given a signal whose content hash was already analysed with the same prompt and schema version, When analysis is requested without "force", Then the stored analysis is reused.

### FR-10 Deterministic scoring  (Must, covers US-05, B-24, B-25, AC-06, AC-07, AC-08)
Five components with exactly the brief's maxima: demand evidence 30, skill fit 25, speed to
revenue 20, profitability 15, repeatability 10 (§7.1), computed by explicit rules from the
structured analysis.
- AC1: Given any scored opportunity, When the breakdown is read, Then the five components sum to the total, each is within its maximum, total is 0–100, and each component has a written justification.
- AC2: Given `evidenceLevel = SPECULATIVE`, When it is scored, Then demand evidence is at most 6/30; `INDIRECT_SIGNAL` and `EXPLICIT_PROBLEM` have their own caps documented in the rules, below `DIRECT_REQUEST`.
- AC3: Given a GitHub issue or comment that only reports an OSS bug, When it is analysed and scored, Then it is never `DIRECT_REQUEST` and never shown as a paid job.
- AC4: Given a source without a budget, When it is scored, Then `sourceBudget = null`, the opportunity is not blocked, and every price shown is labelled "szacunek (hipoteza)".
- AC5: Given the same analysis and profile, When scoring runs twice, Then the result is identical; `confidence` (LOW/MEDIUM/HIGH) is stored separately and no closing probability exists anywhere.
- AC6: Given filters (minimum score, default 65; excluded industries; maximum source age; minimum amount; job type; language; geography), When they are set, Then lists and the brief respect them.

### FR-11 Opportunity list and card  (Must, covers US-04, US-05, B-26)
- AC1: Given opportunities, When the list is opened, Then it can be filtered by score, category, date, source and status, sorted by score or date, and is paginated.
- AC2: Given an opportunity, When its card is opened, Then it shows all twelve elements of §8 (title/category/status; original link or import method, publication and detection date; snippet and evidence level; score with five components and confidence; who has the problem and what it is; what can be sold incl. MVP scope and exclusions; matched skills and justification; billing and price/time estimate with assumptions; risks, missing information, client questions; one next step; actions Zapisz/Odrzuć/Przygotuj ofertę/Oznacz jako kontakt/Dodaj notatkę; status history and link to the source).
- AC3: Given any inferred value, When it is displayed, Then it is visually and textually distinguished from source facts ("ze źródła" vs "wniosek modelu"), not by colour alone (B-34).
- AC4: Given a phone-width screen (360 px), When any view is opened, Then it is usable without horizontal scrolling.

### FR-12 Empty state  (Must, covers B-27, AC-12)
- AC1: Given no verified opportunities for the period, When Today or the list is opened, Then it shows "Brak zweryfikowanych okazji dla tego okresu", the number of sources checked and adapter errors, and no generated or demo opportunity.

### FR-13 Offer drafts  (Must, covers US-06, US-07, B-10, B-11, B-28, AC-10)
- AC1: Given an opportunity, When the operator clicks "Przygotuj ofertę", Then a draft is created with: client problem and plan, value proposition, MVP scope and exclusions, time range with assumptions, price or billing model as a range marked as an estimate, 3–6 clarifying questions, a short message in the source's language, and an alternative variant (short reply / full B2B proposal).
- AC2: Given a draft, When it is generated, Then it contains no references, past projects, client names or experience absent from the operator profile and the source.
- AC3: Given a draft, When the operator edits it, Then the edit is saved and the status moves `DRAFT` → `REVIEWED` → `COPIED_OR_EXPORTED` → `SENT_MANUALLY` only by operator actions ("Kopiuj treść", "Eksportuj Markdown", "Oznacz jako wysłane").
- AC4: Given any draft action, When it completes, Then no message, e-mail or request is sent to any third party (verified by a test that fails on any outbound call other than the configured LLM).
- AC5: Given no draft was requested, When an opportunity is analysed, Then no draft is created automatically.

### FR-14 Business status and activity  (Must, covers US-08, B-29, B-30, AC-11)
- AC1: Given an opportunity, When its status changes, Then only the transitions of §10.1 are allowed (main path `NEW → QUALIFIED → SAVED → OFFER_DRAFTED → CONTACTED → REPLIED → MEETING → WON/LOST`, plus `REJECTED`, `EXPIRED`, `NEEDS_VERIFICATION`), each change is an activity event with time and optional note, and `analysisStatus` is independent.
- AC2: Given a rejection, When it is saved, Then a reason from the §10.2 list (or "inne" with text) is required.
- AC3: Given `WON`, When it is saved, Then contract value, currency and expected dates can be recorded; winning does not create a payment.
- AC4: Given a contacted opportunity, When the operator sets a follow-up date, Then it appears in Today on that date; follow-up suggestions exist only for drafts marked `SENT_MANUALLY`, and nothing is sent automatically.

### FR-15 Payments  (Must, covers US-08, B-30, AC-11)
- AC1: Given an opportunity, When a payment is recorded, Then it is a separate event with amount (integer minor units), currency (PLN/EUR/USD), date and note, independent of `WON`.
- AC2: Given an opportunity `CONTACTED` and later paid, When reports are read, Then sent, won and paid are counted separately.

### FR-16 Today and daily brief  (Must, covers US-04, B-08, B-26, B-31, B-33)
- AC1: Given scored opportunities, When Today is opened or `GET /api/digest/today` is called, Then it shows source status (OK/error counts), new signals, new opportunities above the threshold, top 3–5 with score, category and next step, the best next step, today's LLM cost (or "brak danych"), and recent source errors, in the §11.1 format.
- AC2: Given near-identical opportunities, When the top list is built, Then at most 2 near-duplicates appear and direct, feasible requests are preferred.
- AC3: Given product hypotheses or weak signals, When the brief is built, Then they appear only in a separate section "Pomysły produktowe / słabe sygnały".

### FR-17 Scheduler and manual runs  (Must, covers US-03, B-07, B-32, AC-13, AC-19)
- AC1: Given the default schedule, When the clock reaches 08:00 or 18:00 Europe/Warsaw, Then one discovery cycle runs; this holds across the DST changes in March and October (no skipped or double run).
- AC2: Given a running cycle, When another (scheduled or manual) is started, Then it is refused with "przebieg w toku" and no second identical run happens.
- AC3: Given the process restarts during or between runs, When it starts, Then data and configuration are intact, a stale lock from a dead process is released, the scheduler resumes, and no job is duplicated.
- AC4: Given the operator, When they press "Uruchom teraz" in the UI, call `POST /api/jobs/discover` or run `pnpm discover`, Then one cycle runs with the same rules.
- AC5: Given one adapter fails, When a cycle runs, Then the other adapters complete and the run is recorded as partial.

### FR-18 Jobs and source health  (Must, covers US-09, B-13, B-19)
- AC1: Given runs, When Sources or `GET /api/jobs` is opened, Then each run shows type, source, status, start/end, counters (fetched, new, duplicates, rejected, analysed, failed), error and cost.
- AC2: Given a failed signal or analysis, When the operator retries it, Then it is processed again without creating duplicates.
- AC3: Given a source, When its health check runs, Then the result (OK / error with reason) and last success time are shown.

### FR-19 Insights  (Must, covers US-10, B-14, B-33, AC-20)
- AC1: Given a week of data, When Insights is opened, Then it shows per week: stage transitions, offers sent, reply rate, meetings, wins, payments received (count and sum per currency), and the same per source and per category.
- AC2: Given missing outcome data, When a metric cannot be computed, Then it shows "brak danych", never zero or an assumed result.
- AC3: Given a month, When the monthly view is opened, Then revenue is summed per currency without conversion; time spent and costs are shown only if entered.

### FR-20 Operator authentication and exposure  (Must, covers B-34, AC-17, D-10)
- AC1: Given the default config, When the server starts, Then it listens on 127.0.0.1 only.
- AC2: Given LAN exposure enabled without a password hash, When the server starts, Then it refuses to start with a clear message.
- AC3: Given any `/api/*` route except `GET /api/health` and login, When it is called without a valid session, Then it returns 401 and the UI shows the login form.
- AC4: Given repeated wrong passwords, When the limit is reached, Then further logins are delayed; the session cookie is HttpOnly and SameSite, and logout invalidates it.
- AC5: Given `GET /api/health`, When it is called, Then it returns process and database status without secrets or configuration values.

### FR-21 Data ownership  (Must, covers B-36, A-05)
- AC1: Given an opportunity, When the operator deletes it, Then its signals, evidence, analyses, drafts, events and payments are removed.
- AC2: Given the operator, When they export data, Then a JSON file with profile, sources (without secrets), signals, opportunities, analyses, drafts, events and payments is produced.
- AC3: Given rejected or expired signals older than the retention period (default 90 days), When retention runs, Then they are deleted and the count is logged.

### FR-22 Backup and restore  (Must, covers B-38, B-39)
- AC1: Given a running instance, When the backup command or the daily backup runs, Then a consistent copy of the database is written to the configured backup directory and old copies beyond the configured count are removed.
- AC2: Given a backup, When the documented restore procedure is followed, Then the instance starts with the restored data and migrations still apply.

### FR-23 Deployment on Raspberry Pi  (Must, covers B-38, B-39, B-44)
- AC1: Given a Raspberry Pi 4B with 64-bit Linux, When the README install steps are followed, Then the app runs as a Docker Compose service built for linux/arm64, starts after reboot (`restart: unless-stopped`), restarts on crash, publishes its port on 127.0.0.1 only, and keeps the database and backups in a volume that survives image updates.
- AC4: Given the container, When it starts, Then it runs as a non-root user, applies pending migrations, and its healthcheck uses `GET /api/health`; because it listens on `0.0.0.0` inside the container, it refuses to start without a password hash (FR-20 AC2).
- AC5: Given a new version, When the README update steps are followed (`git pull`, `docker compose up -d --build`), Then data is kept and migrations apply.
- AC2: Given `.env.example`, When it is read, Then every variable the app reads is listed with its meaning and default, and none holds a real value.
- AC3: Given no internet or no LLM provider, When the service runs, Then the panel, manual import (text), statuses and payments work, and failing sources/analyses are shown as errors.

### FR-24 Secrets and public-repo hygiene  (Must, covers B-36, AC-16)
- AC1: Given the repository, When checked in CI, Then no `.env`, database, backup, log, token or private profile is tracked and `.gitignore` covers them.
- AC2: Given any log line, When the app logs, Then API keys, passwords, cookies, e-mail bodies and full prompts with source data are absent unless an explicit debug opt-in is set.
- AC3: Given the LLM request, When it is built, Then it contains only the source extract and the profile fragment needed for the analysis; the docs list what is sent.

### FR-25 HTTP API  (Must, covers B-45)
- AC1: Given the endpoints of §15, When they are called with invalid payloads, Then they return 400 with field errors from the shared schemas.
- AC2: Given list endpoints, When they are called, Then they support pagination and the filters of FR-11.
- AC3: Given the API, When the OpenAPI document is generated, Then it matches the implemented routes (test compares them).

### FR-26 Operator documentation  (Must, covers B-44, B-46, C-12)
- AC1: Given the README, When it is read, Then it contains install (ARM64, Docker Compose, Tailscale serve, backup), configuration (incl. what data goes to the LLM and the access method/limits of each source), and the section "Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji", updated by each roadmap item.
- AC2: Given `docs/source-policy.md`, When it is read, Then each adapter's access method, terms link and limits are listed.

### FR-27 GitHub Issues adapter  (Could — P1, covers B-16, B-47)
- AC1: Given configured queries and an optional token, When discovery runs, Then issues come from the official search API within its rate limits, and none is classified `DIRECT_REQUEST` unless it explicitly asks for paid help.

### FR-28 Web search adapter  (Could — P1, covers B-16, B-47)
- AC1: Given a configured permitted search API and a budget, When discovery runs, Then results become signals and searching stops at the budget.

### FR-29 Telegram notifications  (Could — P1, covers B-32, B-47, D-12)
- AC1: Given a bot token and the operator's chat id, When a cycle finds opportunities above the threshold, Then one digest message goes to the operator only, logged in the notification log; no message goes to anyone else.

### FR-30 CSV export, semantic grouping, multiple evidence  (Could — P1, covers B-47)
- AC1: Given P1, When implemented, Then CSV export exists, similar needs can be grouped without a vector database, and independent evidence of the same demand is linked to one opportunity.

### FR-31 Per-source keyword filter  (Must, covers B-20, D-15)
Each source may carry include and exclude phrases checked against title and snippet before the
pre-filter (FR-07) and before any LLM call; the operator switches the filter on and off per source
in the Sources view without losing the phrases.
- AC1: Given a source with the filter on and an exclude phrase present in an item, When discovery runs, Then the item is stored as rejected with reason "filtr źródła: <phrase>" and is not analysed.
- AC2: Given include phrases and the filter on, When an item contains none of them, Then it is rejected with reason "filtr źródła: brak frazy"; with the filter off the same item passes to FR-07.
- AC3: Given a run, When it finishes, Then the job run and the Sources view show how many items the source filter rejected, so filtered items are never silently "no results".

### FR-32 Public procurement sources  (Should, covers B-16, D-15)
- AC1: Given the e-Zamówienia BZP source with configured CPV prefixes (default 72, 48, 73), When discovery runs, Then new contract notices from the public API `ezamowienia.gov.pl/mo-board/api/v1/notice` become signals with buyer, deadline, estimated value as `sourceBudget` only when the notice states it, and the notice URL; requests stay within 30 per minute.
- AC2: Given the TED source with the same CPV prefixes and country filter (default PL), When discovery runs, Then new notices from the official TED search API become signals the same way.
- AC3: Given a tender signal, When it is analysed, Then it is classified as a public tender (not `DIRECT_REQUEST` from a private client) and the card shows the submission deadline.

### FR-33 Paid code bounties  (Should, covers B-16, FR-27, D-15)
- AC1: Given configured GitHub search queries (default: open issues labelled bounty/paid, languages from the profile) and an optional token, When discovery runs, Then issues come from the official search API within its rate limits and the stated reward is stored as `sourceBudget` only when the issue states it.
- AC2: Given the Opire source, When discovery runs, Then active rewards from Opire's public API become signals linking to the GitHub issue; closed issues are skipped.

## Data model (conceptual)
- **Operator profile** — the FR-01 fields; one record.
- **Source** — type (manual, rss, imap, later github/search), name, enabled, configuration
  (without secrets; secrets come from `.env`), access-method note, cursor, last run, last
  success, last error.
- **Raw signal** — source, external id?, canonical URL?, title, snippet, published at?, fetched
  at, author/organisation?, content hash, metadata, processing status, pre-filter reason?.
  Unique by canonical URL; by (source, external id); by content hash.
- **Opportunity** — primary signal, category (§6.1), evidence level (§5.4), business status,
  analysis status, problem, buyer or audience?, buyer confirmed, score, confidence, next action,
  created/updated, last verified?.
- **Evidence** — opportunity, signal, type, source fact text, extracted at.
- **Analysis** — opportunity, version, provider, model, prompt version, schema version,
  structured result, score breakdown (5 components with justifications), tokens?, cost?, date.
- **Offer draft** — opportunity, status (§9.2), language, subject, body (Markdown), scope,
  pricing, created/updated.
- **Activity event** — opportunity, type (status change, note, contact, reply, meeting,
  follow-up, win, loss), note?, occurred at, metadata (e.g. contract value for a win).
- **Payment** — opportunity, amount in minor units (integer > 0), currency (PLN/EUR/USD), paid
  at, note?.
- **Job run** — job type, source?, status (running, ok, partial, failed), started, finished?,
  counters, error?, cost?.
- **Notification log** (P1) — channel, digest key, status, sent at?, error?.
- Times stored in UTC, shown in Europe/Warsaw. Contract value and payments are distinct.

## External integrations
- **RSS/Atom feeds** — HTTP GET of the feed URL with our user agent; fields used: item id/guid,
  link, title, description/content, published/updated date, author. Errors: network, non-2xx,
  `429`/`503` with `Retry-After`, invalid XML. Limits: twice daily + manual, per-source minimum
  interval (A-03). Presets: hnrss.org `whoishiring/freelance` (and optional
  `whoishiring/jobs?q=…`), WWR category feeds. `UNVERIFIED`: current availability of both feeds
  from the Pi and the exact item format (to be recorded from a first real run).
- **IMAP mailbox** — TLS connection, read-only `EXAMINE` of one folder, fetch by UID; fields
  used: Message-ID, From, Date, Subject, text/HTML body. Errors: auth failure, connection
  failure, unknown format. `UNVERIFIED`: Useme alert format and whether alerts contain the job
  URL and a snippet; Oferia format (Q-02).
- **Anthropic Messages API** — request with system prompt, delimited source data and the output
  schema; response text parsed as JSON; usage tokens read when present. Errors: 401, 429, 5xx,
  timeout, invalid JSON. Limits: FR-09.
- **OpenAI-compatible Chat Completions API** — base URL + model + optional key (Ollama, Groq,
  OpenRouter, Gemini compatibility endpoint); JSON output requested where supported; same
  validation. `UNVERIFIED`: JSON-mode support and usage reporting per provider.
- **Arbitrary web page (manual import)** — one GET under FR-03 guards; robots.txt check.
- **P1:** GitHub REST search API, a web search API, Telegram Bot API (§24 references).

## Non-functional requirements
- **NFR-01 Footprint:** on a Raspberry Pi 4B 8 GB the service uses at most 500 MB RSS during a
  discovery cycle and processes signals in batches with at most 2 concurrent outbound requests.
- **NFR-02 Responsiveness:** with 10 000 stored signals, list and Today API responses take at
  most 500 ms on the Pi (excluding LLM calls).
- **NFR-03 Bounded external calls:** every outbound request has a timeout (default 20 s for
  feeds/pages, 120 s for LLM) and bounded retries.
- **NFR-04 Durability:** an unclean shutdown (power loss) loses at most the in-flight run; the
  database stays consistent and the next start recovers (FR-17 AC3).
- **NFR-05 Observability:** structured JSON logs with run id and source id; no secrets (FR-24).
- **NFR-06 Security:** FR-03, FR-20, FR-24; source content treated as untrusted (B-34).
- **NFR-07 Accessibility:** status and evidence level are never conveyed by colour alone.
- **NFR-08 Licensing:** dependencies are compatible with the licence chosen before going public
  (Q-01); no copied code without a compatible licence (B-48).

## Non-goals
- NG-01 Automatic sending of offers, cold outreach, auto-applying, account creation or
  negotiating on external portals.
- NG-02 Scraping LinkedIn, Upwork, Useme listings, closed groups or any site that forbids it;
  bypassing CAPTCHAs or rate limits.
- NG-03 Shipping or managing a local LLM; RAG, vector database, Elasticsearch, agent frameworks,
  LangChain, queues, microservices, Kubernetes.
- NG-04 Full CRM, invoicing, online payments, calendar sync.
- NG-05 A probability of closing a deal.
- NG-06 Multi-user accounts and an English UI in the MVP.
- NG-07 Training a model; automatic financial commitments.

## Success criteria
The MVP scope is complete when every Must FR's acceptance criteria pass (automated, or as a
documented human check on the Raspberry Pi with evidence), and the brief's MVP Definition of
Done (§22, B-49) holds: installed on the Pi from the README, protected panel reachable from a
phone, editable profile, manual import plus at least one real working automatic source (RSS
presets or IMAP), provenance and scoring on every opportunity, drafts never sent automatically,
statuses/payments/weekly report, schedule survives reboot without duplicates, no invented
clients/budgets/results, tests/types/migrations/deploy documented, no private data or secrets in
the repo. The 30-day targets (§20) are an experiment, not acceptance criteria.

## Traceability
| Brief | Story | FR | Notes |
|-------|-------|----|-------|
| B-01 §0.10 priorities on conflict | – | all | ordering rule for decisions |
| B-02 §1, §1.2 success = paid work, not link aggregation | US-10 | FR-16, FR-19 | |
| B-03 §0.6, §0.7 no faked integrations, no invented data, no auto-sending | US-07 | FR-08, FR-12, FR-13 | |
| B-04 §2, §2.1 profile is configuration, private data local | US-01 | FR-01, FR-24 | |
| B-05 §2.3, US-01 profile and preferences | US-01 | FR-01 | |
| B-06 US-02 manual URL/text import | US-02 | FR-02, FR-03 | |
| B-07 US-03 scheduled checks while laptop is off | US-03 | FR-17, FR-23 | |
| B-08 US-04 3–5 best per day | US-04 | FR-16 | |
| B-09 US-05 explainable score, confirmed need | US-05 | FR-10, FR-11 | |
| B-10 US-06 offer draft without invented facts | US-06 | FR-13 | |
| B-11 US-07 human sends | US-07 | FR-13 | NG-01 |
| B-12 US-08 outcomes and payment | US-08 | FR-14, FR-15 | |
| B-13 US-09 failure visibility, retry without duplicates | US-09 | FR-04, FR-18 | |
| B-14 US-10 weekly channel effectiveness | US-10 | FR-19 | |
| B-15 §4.1, §5.4 provenance, no guessing missing content | US-02 | FR-02, FR-06 | |
| B-16 §5.1 source tiers | US-03 | FR-04, FR-05, FR-27, FR-28, FR-31, FR-32, FR-33 | D-01, D-03, D-05, D-15 |
| B-17 §5.2 adapter contract and RawSignal fields | – | FR-04 | |
| B-18 §5.3 queries per category, limit duplication | – | FR-04, FR-06 | |
| B-19 §5.5 rate limits, backoff, explicit source errors | US-09 | FR-04, FR-18 | |
| B-20 §6.2 deterministic pre-filter before LLM | – | FR-07 | |
| B-21 §6.1 versioned analysis schema, sourceBudget, no invented entities | US-05 | FR-08 | |
| B-22 §6.3 provider abstraction, ANALYSIS_FAILED + retry | US-12 | FR-08 | D-07 |
| B-23 §6.2, §12.1 daily limits, API budget, cache by hash | US-12 | FR-09 | D-09 |
| B-24 §7.1–7.2 deterministic 30/25/20/15/10 scoring, caps, dedup | US-05 | FR-06, FR-10 | |
| B-25 §7.2 configurable filters | US-04 | FR-10 | |
| B-26 §7.3, §8, §11 card, diversification, navigation | US-04 | FR-11, FR-16 | |
| B-27 §8.2 empty state | – | FR-12 | |
| B-28 §9.1–9.2 draft contents and acceptance workflow | US-06, US-07 | FR-13 | |
| B-29 §9.3, §10.2 follow-up, operator actions | US-08 | FR-14 | |
| B-30 §10.1–10.2 statuses, WON vs PAID | US-08 | FR-14, FR-15 | |
| B-31 §11.1 daily brief format | US-04 | FR-16 | |
| B-32 §12 schedule 08:00/18:00 Warsaw, lock, notifications P1 | US-03 | FR-17, FR-29 | D-12 |
| B-33 §10.3 KPI daily/weekly/monthly, "brak danych" | US-10 | FR-16, FR-19 | |
| B-34 §16.1–16.6, §16.11 bind, auth, SSRF, prompt injection, facts vs estimates | – | FR-03, FR-08, FR-11, FR-20 | D-06, D-10 |
| B-35 §16.12 access method and terms per adapter | – | FR-04, FR-26 | |
| B-36 §16.3, §16.9–10, §16.1 secrets, retention, logs, public vs private | – | FR-21, FR-24 | |
| B-37 §12.1 limits, cost metrics without faked precision | US-12 | FR-09 | |
| B-38 §12.1 Pi 4 ARM64, no local large LLM, light process | – | FR-22, FR-23, NFR-01 | D-08 |
| B-39 §12 auto-start after reboot, persistent DB | US-03 | FR-22, FR-23 | |
| B-40 §13.1 stack | – | C-01…C-04 | |
| B-41 §13.1 tests | – | C-05 | `/test-plan` |
| B-42 §13.3 repo structure, domain vs adapters | – | C-07 | |
| B-43 §23 commands | – | C-08, FR-17 | |
| B-44 §0.8, §22 migrations, .env.example, ARM64, systemd docs | – | FR-23, FR-26 | Docker instead of systemd (D-14) |
| B-45 §15 API contracts, pagination, OpenAPI | – | FR-25 | |
| B-46 §23 per-phase "what works" report | – | FR-26 | C-12 |
| B-47 §17 P1 scope | – | FR-27…FR-30 | |
| B-48 §16.2 licence | – | NFR-08 | Q-01 |
| B-49 §22 MVP Definition of Done | – | Success criteria | |
| B-50 §20 30-day experiment and north-star metric | US-10 | FR-19 | not acceptance |
| B-51 §21 risks | – | – | shape notes R-01…R-06 |
| B-52 §0.3–0.4, §18 vertical slice first, then sources, then scheduler | – | – | ordering for `/roadmap` |

## Open questions
- Q-01 Licence before going public (does not block the MVP).
- Q-02 Oferia alert format; Useme alert format is `UNVERIFIED` until a real sample is captured
  (first step of the e-mail item).
- Q-03 Further RSS feeds (configuration only).
- Q-04 Telegram vs e-mail for P1 notifications.
- Q-05 Concrete model ids per provider (`/tech-stack`).
