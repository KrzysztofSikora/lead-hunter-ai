# Shape notes: Lead Hunter AI

## Brief summary
Lead Hunter AI is a self-hosted service on a Raspberry Pi 4B that collects real demand signals
for one operator (a solo software/AI/IoT studio) from permitted sources, analyses them with an
LLM or a deterministic mock, scores them with explicit rules and shows 3–5 best opportunities a
day. For an opportunity the operator picks, it drafts an offer that the operator reviews and
sends by hand, then records contact, outcome and real payments to learn which channels pay.
Truth of data, lawful source access and human-in-the-loop outranks features (brief §0.10).
Brief: `lead-hunter-ai-PRD.md` v1.0 (2026-10-24).

## Decisions
| ID | Topic | Decision | Reason | Source (brief / user / default) |
|----|-------|----------|--------|---------------------------------|
| D-01 | First automatic sources (MVP) | One generic RSS/Atom adapter with two presets: Hacker News via hnrss.org (`/whoishiring/freelance` — "Freelancer? Seeking freelancer?" threads; optionally `/whoishiring/jobs?q=contract`) and We Work Remotely category feeds (programming, full-stack, back-end, devops). | Both are public feeds whose owners allow reuse: WWR's feed page invites use with attribution; hnrss is a public feed service that asks for conservative refresh. HN freelance threads contain direct requests for freelancers (DIRECT_REQUEST). Twice-daily schedule is conservative. | user (after research) |
| D-02 | Attribution | Every card shows the source name and links back to the original URL; WWR items keep the WWR link. | WWR asks for attribution; brief §5.4 needs provenance anyway. | brief + research |
| D-03 | E-mail notifications in MVP | E-mail import of job alerts from Useme (and Oferia if the format is similar) moves from P2 into the MVP as a second automatic source. | Polish direct gigs are the highest-value signal for this operator and Useme has no RSS/API; its users can enable e-mail alerts for new jobs in their categories (Useme help center). | user |
| D-04 | E-mail access | IMAP, read-only, one dedicated folder/label (the operator's mail filter moves alerts there); credentials (app password) in `.env`; only messages from an allow-list of senders are parsed; a dedicated mailbox is recommended in the docs. Only extracted job fields and the source link are stored, not the whole e-mail. | Works with Gmail and other providers; no OAuth project on the Pi; limits personal data (brief §16.9–10). | user |
| D-05 | Useme / marketplace pages | No crawling of Useme listings or sitemap. Useme enters only through e-mail alerts and manual import. | Brief §5.1 allows marketplace automation only via an official API/feed; none exists. | brief |
| D-06 | Manual URL import | On the operator's explicit action the app fetches the page once (SSRF guard: http/https only, no localhost/private/link-local/metadata addresses, redirect re-check, size and time limits; honours robots.txt). If the fetch fails or is blocked, the operator pastes the text; the URL is kept as the source. | One human-triggered fetch equals opening the page; covers AC-18. | user |
| D-07 | LLM providers | Two adapters behind `LlmProvider`: Anthropic (default for real analysis) and a generic OpenAI-compatible adapter (Ollama on the LAN or on the Pi, Groq, OpenRouter, Gemini's OpenAI-compatible endpoint). Provider, model and base URL come from `.env`; plus the deterministic mock. | Operator wants a free option; one OpenAI-compatible adapter covers all of them without binding the domain to one SDK (brief §6.3). | user |
| D-08 | Local inference | The app does not ship or manage a local model. Running Ollama on the Pi is the operator's choice through D-07 and is documented as slow/low-quality on a Pi 4; the default deployment assumes an API or a LAN machine. | Brief §12.1 and §17 exclude local large-LLM inference on the Pi 4. | brief + user |
| D-09 | LLM cost limit | A paid provider runs only with an operator-set monthly cap (`LLM_MONTHLY_BUDGET_USD`); without it real analysis is disabled with a clear message. Daily counters from brief §12.1 (100 signals, 20 analyses, 5 drafts) are defaults. Cost is recorded only when the provider reports usage; free/local providers record tokens, cost "unknown". | No invented spend default; the cap is a stop, not an estimate (brief §12.1). | user + default |
| D-10 | Operator authentication | Single operator, password + session: password hash in `.env`, login form, HttpOnly SameSite cookie, rate-limited login. Bind `127.0.0.1` by default; LAN exposure is an explicit config flag that refuses to start without a password hash. | Usable from a phone on the home LAN; satisfies brief §16.1–2 and AC-17. | user |
| D-11 | UI language | Polish UI. Offer drafts follow the source's language. No i18n framework in the MVP; strings kept in one module so i18n can be added later. | Brief labels are Polish; open-source English UI deferred. | user |
| D-12 | Notifications | Dashboard + daily brief only in the MVP; Telegram stays P1. | Brief §12. | brief |
| D-13 | Repository visibility | Private for now; public release later. | User. | user |
| D-14 | Deployment | The app runs on the Pi only as a Docker Compose service (ARM64 image, `restart: unless-stopped`, data volume, port published on `127.0.0.1` only, Tailscale serve in front). No `systemd` unit for the app. | Operator runs everything in Docker; deviates from brief §0.8/§13.1 (`systemd` as the base). | user |

## Assumptions
- A-01 HN freelance threads mix "SEEKING WORK" and "SEEKING FREELANCER" comments; the
  deterministic pre-filter keeps only "SEEKING FREELANCER"/hiring comments. Cheap to change.
- A-02 WWR feeds are mostly employment offers; they enter as signals and the pre-filter/analysis
  classify them (`B2B_SUBCONTRACT` or rejected). Contract/freelance keywords raise priority.
- A-03 Refresh = the schedule (08:00 and 18:00 Europe/Warsaw) plus manual runs, with a minimum
  interval per source (default 1 h) so manual runs cannot hammer a feed.
- A-04 One operator, one profile, one database; no multi-user.
- A-05 Data retention default: rejected/expired signals older than 90 days are pruned; the
  operator can delete any opportunity and export all data (JSON) (brief §14).
- A-06 Currencies PLN/EUR/USD; amounts in integer minor units; no FX conversion (brief §10.3).
- A-07 Demo/fixture data is fictional and labelled `DEMO`; never real leads (brief §8.1, §16.1).
- A-08 The e-mail parser is per sender (Useme first); an unknown format becomes an explicit
  parse error with the message kept for retry, never a silent drop.

## Non-goals
- NG-01 Automatic sending of offers, cold outreach, auto-applying or negotiating (brief §9.2, §17).
- NG-02 Scraping LinkedIn, Upwork, Useme listings, closed groups, or any site that forbids it;
  bypassing CAPTCHAs or limits (brief §5, §17).
- NG-03 Shipping or managing a local LLM; RAG, vector DB, agent frameworks, queues,
  microservices, Kubernetes (brief §13, §17).
- NG-04 Full CRM, invoicing, online payments, calendar sync (brief §17).
- NG-05 A "probability of closing" percentage (brief §7.2).
- NG-06 Multi-user accounts and English UI in the MVP.

## Deferred questions
- Q-01 Licence (MIT suggested by brief §16.2): decide before the repo goes public; does not affect
  the MVP code.
- Q-02 Oferia e-mail format: confirm with a real alert during the e-mail item; Useme first.
- Q-03 Which further RSS feeds to add (e.g. Polish job boards with official feeds): config only,
  no code change.
- Q-04 Telegram vs e-mail notifications for P1: decided when P1 starts.
- Q-05 Concrete Anthropic and OpenAI-compatible model ids: `/tech-stack`.

## Risks spotted
- R-01 Few real direct requests in the chosen feeds (likelihood medium / impact high): HN
  freelance threads are monthly and US-heavy. Find out in the first week of real runs; the
  Insights view shows signals and qualified opportunities per source.
- R-02 Useme e-mail format changes or alerts carry only a snippet (medium / medium): parser
  tests on real (anonymised) samples; manual URL import of the linked job as fallback.
- R-03 Free/local models return invalid JSON (high / medium): Zod validation, `ANALYSIS_FAILED`
  and retry; real runs compared against the mock contract tests.
- R-04 IMAP credentials give access to the whole mailbox (medium / high): dedicated mailbox
  recommended, read-only access, sender allow-list, no e-mail bodies in logs.
- R-05 hnrss.org or WWR feed availability or terms change (low / medium): adapter health check
  reports an explicit error; the brief's manual import keeps working.
- R-06 SSRF via manual URL import (medium / high): guard per D-06 with tests for private ranges,
  redirects and DNS rebinding.
