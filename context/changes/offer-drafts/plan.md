# Plan: offer-drafts (S-07)

## Goal and end state
When the operator clicks "Przygotuj ofertę" on an opportunity card, the app asks the configured
LLM (or the deterministic mock) for one offer draft, guards it, and stores it as the
opportunity's current draft. Nothing is ever sent anywhere by the app; the operator edits,
approves, copies or exports the text and marks it as sent by hand.

Observable when done:
- FR-13 AC1: a draft contains client problem and plan, value proposition, MVP scope and
  exclusions, time range with assumptions, a price or billing model as a range labelled as an
  estimate, 3–6 clarifying questions, a short message in the source's language and an
  alternative full B2B proposal.
- FR-13 AC2: URLs and e-mail addresses the source and the operator profile do not contain are
  removed from the draft, with a visible note. The prompt forbids references, past projects,
  client names and experience the profile and source do not contain. The profile's `experience`
  text is the only experience the model receives.
- FR-13 AC3: edits are saved; draft status moves `DRAFT → REVIEWED → COPIED_OR_EXPORTED →
  SENT_MANUALLY`, and only through operator actions ("Zapisz i zatwierdź", "Kopiuj treść",
  "Eksportuj Markdown", "Oznacz jako wysłane").
- FR-13 AC4: a test that fails on any outbound request other than the configured LLM drives
  every draft action.
- FR-13 AC5: analysis never creates a draft.
- Draft generation counts against the same monthly cap as analyses (FR-09 AC2) and has its
  own daily limit, 5 by default (FR-09 AC3, deferred here by S-05 D-11).
- Regenerating creates a new current draft. The earlier drafts stay readable in the card's
  history (roadmap *Decided up front*).
- The e2e main path includes the draft step (S-08 `[FOLLOW-UP]`, S-08 D-13).

## Scope
- In: `offer_drafts` table and migration; shared contracts; a `draftOffer` call on the mock,
  Anthropic and OpenAI-compatible adapters using `LLM_MODEL_OFFER`; the offer prompt and its
  docs (FR-24 AC3); the draft output guard; budget and daily limit for drafts; routes `POST
  /api/opportunities/:id/offer-drafts` and `PATCH /api/offer-drafts/:id`; the draft panel on
  the card (edit, approve, copy, Markdown export, mark as sent, history); the follow-up hint
  for `SENT_MANUALLY` drafts (S-08 D-12 `[FOLLOW-UP]`); the e2e draft step; test-plan status
  of TR-04.
- Out: the draft count in the Today brief (FR-09 AC3's "the brief shows the count" for
  drafts, logged as `[FOLLOW-UP]`); "sent" in Pipeline totals counting `SENT_MANUALLY` drafts
  (S-14, S-08 `[FOLLOW-UP]`); delete/export of drafts (S-15); editing older drafts; any
  sending, mail or marketplace integration (NG-01); detecting invented names in free prose
  (see Risks).

## Findings
- **Provider port.** `LlmProvider` (`apps/api/src/modules/analysis/ports.ts:59`) has only
  `analyzeOpportunity`. Its `model` is the analysis model. The brief §6.3 names `draftOffer`
  on the same abstraction. `LLM_MODEL_OFFER` is already parsed into `LlmConfig.offerModel`
  (`packages/config/src/env.ts:224`) and documented in `.env.example:47`, but nothing reads it.
  S-05 left it for this item (`context/changes/llm-providers/plan.md:41`).
- **Adapters.** `AnthropicProvider` (`apps/api/src/infrastructure/llm/anthropic.ts:43`) and
  `OpenAiCompatibleProvider` (`openai-compatible.ts:46`) each build one request from
  `systemPrompt()` and `buildUserMessage()` (`prompt.ts`), map errors through
  `toProviderError` and parse JSON with `parseBilledJson`. The JSON-schema stripping in
  `prompt.ts:41` (`strip`) is generic, so the offer schema can reuse it.
- **Budget.** `budgetGate` and `costMicroUsd` are pure (`modules/analysis/budget.ts`). Month
  spend is `analyses.cost_micro_usd` only (`infrastructure/db/analysis-repository.ts:119`).
  S-05 D-5 says S-07 adds its own rows to the same sum. The price comes from
  `config.prices[model]` (`create-provider.ts:50`), so drafts need the offer model's price.
- **Guard.** `removeInventedLinks` (`modules/analysis/output-guard.ts:132`) walks any JSON
  value and replaces URLs and e-mails missing from an allowed text. It is module-private today.
  The guard does not detect names in free prose (`output-guard.ts:160`).
- **Status side effects.** `activity.changeStatus(id, to, decide, …)`
  (`modules/opportunities/ports.ts:131`) applies an operator move in one transaction, records
  `skipped` and clears a follow-up. `checkMove(from, 'OFFER_DRAFTED')` is a forward move from
  `NEW`, `QUALIFIED`, `SAVED` and `NEEDS_VERIFICATION` (`packages/contracts/src/status.ts`).
- **Card.** "Przygotuj ofertę" is a disabled button with the note `offerLater`
  (`apps/web/src/CardActions.tsx:190-200`, `strings.pl.ts:387-389`). Card actions return an
  `OpportunityDetail` and the page swaps it in (`OpportunityPage.tsx:175`).
- **e2e.** `e2e/vertical-main-path.spec.ts:57-67` asserts the button is disabled and that
  `OFFER_DRAFTED` is skipped. Both change in this item.
- **Network isolation.** `apps/api/test/setup.ts` installs a `MockAgent` with
  `disableNetConnect()`. The Anthropic and OpenAI SDKs use global `fetch`, which goes through
  that dispatcher (`analysis-llm.int.test.ts` mocks `/v1/messages` that way). An unmocked call
  throws, but a thrown call inside a caught path would not fail a test by itself, so AC4 needs
  an explicit record of every dispatched origin (D-12).
- **Clipboard (external).** `navigator.clipboard` exists only in secure contexts (MDN,
  "Clipboard API": HTTPS or `localhost`/loopback). The app is reached over plain HTTP on the
  LAN or Tailscale IP (FR-20), so "Kopiuj treść" needs a fallback: select a hidden textarea and
  call `document.execCommand('copy')`, which still works on HTTP pages. Playwright Chromium on
  `127.0.0.1` is a secure context, so the e2e test uses the Clipboard API after
  `context.grantPermissions(['clipboard-read', 'clipboard-write'])`.
- **Layers.** Modules may import other modules (analysis imports scoring), but not
  infrastructure or drivers (`eslint.config.mjs`). A new `modules/offers` can reuse
  `analysis/budget.ts` and the exported link guard.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Draft storage shape | One table `offer_drafts`: `id`, `opportunity_id` (FK, cascade), `status` (`DRAFT`, `REVIEWED`, `COPIED_OR_EXPORTED`, `SENT_MANUALLY`, or internal `FAILED`), `language`, `subject`, `message_markdown`, `proposal_markdown` (editable), `content_json` (the guarded generated plan sections, never edited), `guard_notes_json`, `provider`, `model`, `prompt_version`, `schema_version`, `error`, `input_tokens`, `output_tokens`, `cost_micro_usd`, `created_at`, `updated_at`, `status_changed_at`. Current draft = newest non-`FAILED` row of the opportunity; older ones are history | B: brief §14 columns `scope_json`/`pricing_json` (closer to the brief's table, but the other AC1 sections would need more columns); C: a draft table plus a revisions table holding every edit (full edit history, beyond the roadmap's "previous text in history") | Follows *Decided up front* (regenerate keeps the old text) with one table. A failed attempt needs a row because of the billed-answer lesson | costly (schema) | agent + lesson |
| D-2 | What is editable and what "Kopiuj treść" copies | Editable: subject, short message (Markdown), full B2B proposal (Markdown). Plan sections (problem and plan, value, scope and exclusions, time, price, questions) are shown read-only as generated, labelled "szkic modelu" / "szacunek (hipoteza)". "Kopiuj treść" copies subject + short message; "Kopiuj wariant B2B" copies the proposal; "Eksportuj Markdown" downloads one `.md` with everything | B: one editable Markdown document with all sections (everything editable, but Polish working notes and price assumptions would be copied into a message to a foreign client); C: all sections editable as a structured form (most flexible, about twice the UI) | Keeps client-facing text separate from working notes. The operator can still change price or scope in the message text | cheap | agent |
| D-3 | Draft status rule | Pure `nextDraftStatus(status, action)` in `packages/contracts/src/offer-drafts.ts`, shared by API and web. `save`: `DRAFT`/`REVIEWED` → `REVIEWED`, `COPIED_OR_EXPORTED` stays. `copied`/`exported`: `REVIEWED`/`COPIED_OR_EXPORTED` → `COPIED_OR_EXPORTED`. `sent`: `COPIED_OR_EXPORTED` → `SENT_MANUALLY`. Anything else, including any action on `SENT_MANUALLY` (the text that was sent stays as it was), is refused. Never moves back | B: copy and export straight from `DRAFT`, skipping `REVIEWED` (one click fewer); C: allow edits after `SENT_MANUALLY` (fixes typos, but the record of what was sent is lost) | §9.2 is a linear acceptance workflow. Approving without changes costs one click ("Zapisz i zatwierdź" with the text unchanged) | cheap | agent |
| D-4 | Effect on the opportunity's business status | Generating a draft moves the opportunity to `OFFER_DRAFTED`, and "Oznacz jako wysłane" moves it to `CONTACTED`, each only when `checkMove` calls that a `forward` move. Both are recorded as operator status changes through the existing `activity.changeStatus`. Otherwise the business status stays | B: never touch the business status (no side effects, but the funnel shows `SAVED` next to a sent offer and the operator clicks twice); C: always move, back moves included (needs a note the click cannot provide) | Both clicks are operator actions that mean exactly these stages (§10.1). Forward-only cannot reopen a rejected row by accident | cheap | agent |
| D-5 | Synchronous or queued generation | Synchronous `POST`: the request waits for the provider (SDK timeout 120 s, S-05 D-8). An in-memory per-opportunity in-flight set refuses a second call with 409 `in_progress` | B: queue like analysis, with a `GENERATING` state and polling (survives a closed tab, but adds a state, a runner and polling UI for a single-operator, on-demand call) | On demand, one operator, one call. The UI shows "Przygotowuję szkic…" | cheap | agent |
| D-6 | Provider shape for drafts | New port `OfferDrafter` in `modules/offers/ports.ts` (`name`, `paid`, `model`, `demo`, `offerPromptVersion`, `draftOffer(input)`). The three adapter classes implement it next to `LlmProvider`. Each adapter moves its SDK call into one private `request(system, user, schema)` used by both methods. `createOfferDrafter(config)` builds a second instance with `model = config.offerModel` | B: add `draftOffer` to `LlmProvider` and pass the model per call (one interface as in brief §6.3, but every call site and fake would have to choose a model); C: separate adapter classes for drafts (no change to analysis code, but two copies of the SDK error mapping) | Analysis code and its fakes stay unchanged. The offer model is fixed at construction, as the analysis model is | cheap | agent |
| D-7 | Daily draft limit and what counts | New env `OFFER_DRAFT_DAILY_LIMIT` (integer 1–100, default 5) in `packages/config`, listed in `.env.example`. Counted: `offer_drafts` rows created since the Europe/Warsaw day start, failed ones included (each was a provider call). The limit applies to mock too, like the analysis limit | B: hard-coded 5 (no config, but the PRD calls it a default); C: count successful drafts only (a failing provider could be called without bound) | PRD FR-09 AC3 default; counting attempts follows the analysis rule (`countSince`) | cheap | prd + agent |
| D-8 | Shared monthly cap | The month spend becomes the sum over `analyses` **and** `offer_drafts` (`spentSince` in `analysis-repository.ts`; the unknown-cost count also counts non-failed, non-mock drafts with no cost). Analysis status and draft generation read the same figure. Drafts use `budgetGate` with the offer model's price | B: a separate `llm_usage` ledger (one source for every call, but it copies tokens and migrates S-05 data); C: separate caps (FR-09 AC2 says one cap stops both) | S-05 D-5 planned exactly this. One query changes | costly (money) | prd + agent |
| D-9 | Failed generation | Provider error, invalid output, secret echo or a guard result that fails the contract: a `FAILED` row is stored with the reason code (never an SDK message or model text), usage and cost. The route answers 502 `{ error: 'provider_failed', reason }`. No draft becomes current and the business status stays | B: store nothing on failure (simpler, but billed calls would be missing from the cap, against the lesson) | Lesson "store every billed provider answer…"; reason codes follow S-05 D-9 | cheap | lesson |
| D-10 | What the model receives (FR-24 AC3) | System prompt (fixed text plus the offer JSON schema); `<source_data>` `{title, text, sourceType}`; `<analysis>` with the current completed analysis fields `category, problem, mvpScope, exclusions, estimatedHours, proposedPrice, pricingAssumptions, requiredClarifications` (or `null`), also untrusted; `<profile>` `{skills, serviceTypes, preferredTechnologies, experience, languages, rateRanges, billingModels, minimumJobValue}`; `<target_language>` = the pre-filter language (`pl`/`en`) or `null` (the model then follows the source). All JSON-escaped like `buildUserMessage`. Never the source URL, operator contact data, other opportunities, the key | B: source only (cheaper, but the price and scope could not use the profile's rates); C: the whole profile (simplest, but sends more than the task needs, against FR-24 AC3) | Each field supports an AC1 section. `experience` is the only experience the draft may claim (AC2) | cheap | prd + agent |
| D-11 | Draft output guard (AC2) | `guardOfferDraft(content, allowedText)` in `modules/offers/output-guard.ts`: links and e-mails missing from source text + profile `experience` are removed through the exported `removeInventedLinks`, and phone numbers missing from them are removed the same way (new pattern, drafts only). Each removal adds a Polish note. The guarded result is re-parsed with the contract before storing (lesson) | B: also strip capitalised words that look like names (false positives on technologies and Polish sentence starts) | Deterministic where detection is reliable. Names in prose stay a prompt rule and a human check (Risks) | cheap | lesson + agent |
| D-12 | How the AC4 test detects outbound calls | `offer-drafts.int.test.ts` wraps the global `MockAgent` in a recording dispatcher (subclass of undici `Dispatcher` whose `dispatch` logs `origin` and delegates). It configures `LLM_PROVIDER=anthropic` with `LLM_BASE_URL` set to a mocked origin, runs generate → save → copied → exported → sent, and asserts that the recorded origins equal exactly `[LLM origin]` (one call) and that no `MockAgent` interceptor other than the LLM was registered | B: rely on `disableNetConnect()` alone (a swallowed rejection would not fail the test); C: spy on `node:net` (also covers raw sockets, but ESM namespaces cannot be spied and the app has no raw-socket client) | Fails on any HTTP request, caught or not; the app has no other transport | cheap | agent |
| D-13 | Follow-up suggestion (FR-14 AC4, S-08 D-12 `[FOLLOW-UP]`) | When the current draft is `SENT_MANUALLY` and no follow-up is set, the card shows "Wysłano ręcznie {data}. Ustaw przypomnienie o follow-up." next to the existing follow-up form. Nothing is scheduled or sent | B: leave it to a later item (FR-14 AC4 stays half done) | One string and one condition; S-08 sent it here | cheap | agent |
| D-14 | Generation without a completed analysis | Allowed: `<analysis>` is `null` and the draft rests on source and profile; the card says "Szkic bez analizy" | B: refuse with 409 `analysis_required` (better drafts, but AC1 says "Given an opportunity" and a failed analysis would block drafting) | Follows the AC wording; the label keeps it honest | cheap | prd + agent |
| D-15 | The alternative variant | The main message is always the short reply in the source's language; the alternative is always the full B2B proposal (Markdown, same language) | B: the model picks which variant is primary (more natural for some posts, but the UI and copy buttons would need to follow a per-draft choice) | AC1 lists exactly these two; fixed roles keep the UI simple | cheap | agent |
| D-16 | Edits after copying (plan-review 1, 6) | `save` with changed subject/message/proposal from `COPIED_OR_EXPORTED` moves to `REVIEWED` (copy or export again before `sent`); `save` with unchanged text keeps the status. "Kopiuj wariant B2B" sends `copied`. The UI copies and exports only saved text (buttons disabled while the form is dirty). Phase 4 test adds `copied → save(changed) → sent` refused. Replaces the `save` line of D-3 | B: keep `COPIED_OR_EXPORTED` on save (breaks "the sent text is what was copied") | Closes the side door the lesson on two-step paths describes | cheap | agent (plan-review) |
| D-17 | Guard scope (plan-review 2) | D-11 drops phone-number removal (left to the prompt rule). A guard result that leaves a list under its contract minimum (e.g. `questions` < 3) means a `FAILED` row, as the re-parse already implies | B: pinned phone regex with unit cases (more protection, more false positives on prices) | AC2 asks for URLs and e-mails; money and day ranges must survive | cheap | agent (plan-review) |
| D-18 | Today brief cost (plan-review 3) | Phase 1 adds `offer_drafts` tokens to `llmUsageSince` (`analyses` count stays the analysis count) so FR-16 AC1 cost matches the cap | B: `[FOLLOW-UP]` only (under-reports until done) | One query, with a test | cheap | agent (plan-review) |
| D-19 | `pricing.model` type (plan-review 4) | `BillingModel` from the profile plus `UNKNOWN` (`FIXED_PRICE, HOURLY, DAILY, RETAINER, UNKNOWN`), so the model can state the operator's billing models | B: `MonetizationModel` (mismatches the profile) | Persisted in `content_json` v1, costly to change later | costly (schema) | agent (plan-review) |
| D-20 | Concurrency and latency (plan-review 7, 8) | The in-flight guard is global: one draft at a time (409 `in_progress`), which also keeps the daily limit and budget reads race-free. Latency bound is about 3 × 120 s (`MAX_RETRIES = 2`). References fixed: `eslint.config.js`, `.env.example:49` | B: per-opportunity (races past the limit) | Single operator | cheap | agent (plan-review) |

## Design

### Contracts (`packages/contracts/src/offer-drafts.ts`)
- `OFFER_SCHEMA_VERSION = 1`.
- `OfferDraftContent` (what the model returns; `.strict()`):
  - `language`: `/^[a-z]{2}$/`;
  - `problem`: string 1–1000; `plan`: string[] 1–8 (each ≤ 300);
  - `valueProposition`: string 1–1000;
  - `mvpScope`: string[] 1–10; `exclusions`: string[] 0–10;
  - `timeline`: `{ minDays: int 1–365, maxDays: int 1–730, assumptions: string[] 1–6 }`, with
    min ≤ max;
  - `pricing`: `{ model: BillingModel | 'UNKNOWN' (D-19), range: MoneyRange | null, assumptions: string[] 1–6 }`
    (an estimate by contract; the UI always labels it);
  - `questions`: string[] **3–6**;
  - `message`: `{ subject: 1–200, body: 1–4000 }`; `proposal`: `{ body: 1–8000 }`.
- `OfferDraftStatus` = `DRAFT | REVIEWED | COPIED_OR_EXPORTED | SENT_MANUALLY`.
- `OfferDraftAction` = `save | copied | exported | sent`; `nextDraftStatus(status, action):
  OfferDraftStatus | null` (D-3).
- `OfferDraft` (API): `id, opportunityId, status, language, subject, message, proposal,
  content: OfferDraftContent | null` (null if stored JSON no longer parses), `guardNotes,
  provider, model, promptVersion, demo, analysed` (D-14), `inputTokens, outputTokens,
  costMicroUsd, createdAt, updatedAt, statusChangedAt`.
- `OfferDraftHistoryItem`: `id, status, language, subject, message, proposal, createdAt,
  statusChangedAt` (newest first, at most 20).
- `OpportunityDetail` gains `offerDraft: OfferDraft | null` and `offerDraftHistory:
  OfferDraftHistoryItem[]`.
- `OfferDraftPatch` = discriminated union on `action`: `{ action: 'save', subject, message,
  proposal }` (same limits as above) | `{ action: 'copied' | 'exported' | 'sent' }`.
- `OfferDraftRefused` 409 `{ error: 'in_progress' | 'daily_limit' | 'not_configured' |
  'budget_missing' | 'price_unknown' | 'budget_reached' }`; `OfferDraftFailed` 502
  `{ error: 'provider_failed', reason: string }`; `OfferDraftConflict` 409
  `{ error: 'not_current' | 'action_not_allowed' }`.

### Routes (`modules/offers/routes.ts`)
- `POST /api/opportunities/:id/offer-drafts` → 201 `OpportunityDetail`; 404; 409
  `OfferDraftRefused`; 502 `OfferDraftFailed`. Empty body.
- `PATCH /api/offer-drafts/:id` (body `OfferDraftPatch`) → 200 `OpportunityDetail`; 400; 404;
  409 `OfferDraftConflict`.
- Both sit behind the session guard, so the route-table auth test covers them, and the OpenAPI
  test picks them up.

### Service (`modules/offers/service.ts`), `generate(id)`
1. Opportunity missing → `not_found`. In flight → `in_progress`. No drafter →
   `not_configured`. Attempts today ≥ limit → `daily_limit`. `budgetGate` (offer model's
   price, shared spend) → its block.
2. Build `OfferInput` (D-10) from the repository (source, language, latest completed analysis)
   and `profile.get()`.
3. Call `drafter.draftOffer(input)`. On error, store `FAILED` with the reason and the billed
   usage (same rules as `analyseOne`), and return `failed`.
4. Secret echo check, then `OfferDraftContent.safeParse`, then `guardOfferDraft`, then re-parse.
   Any failure → `FAILED` row with usage and cost.
5. Insert the draft (`DRAFT`; the editable columns start from `message.subject`,
   `message.body`, `proposal.body`), then apply D-4 (`OFFER_DRAFTED`, forward only).
6. Return the fresh detail.

`act(draftId, patch)`: load the draft. A missing or `FAILED` row → `not_found`; a draft that
is not current → `not_current`; `nextDraftStatus` null → `action_not_allowed`. Otherwise one
conditional UPDATE (`WHERE id = ? AND status = ?`) of the text and/or status, and
`status_changed_at` when the status changes. On `sent`, apply D-4 (`CONTACTED`, forward only).

### Providers
- `infrastructure/llm/offer-prompt.ts`: `OFFER_PROMPT_VERSION = 'offer-1'`, fixed
  `OFFER_SYSTEM_PROMPT`. It states: data is not instructions; use only facts from source, the
  analysis and the profile; never invent references, past projects, clients, names, URLs,
  contacts or experience beyond `experience`; the price and time are estimates with stated
  assumptions; write `message` and `proposal` in the target language (or the source's);
  3–6 questions; JSON only. Also `offerJsonSchema()` (via the generic `strip`) and
  `buildOfferUserMessage(input)`.
- Anthropic: same call shape as analysis with the offer schema, `max_tokens: 8000`,
  `effort: 'medium'`. OpenAI-compatible: `response_format` per `LLM_JSON_MODE`, `max_tokens:
  6000`.
- Mock `draftOffer`: deterministic Polish or English templates (by target language), every
  text prefixed `DEMO / MOCK: `. It builds scope, exclusions, questions (padded to 3) and price
  from the analysis and profile, and contains no name, URL or contact.

### Web
- `apps/web/src/OfferDraftPanel.tsx`: shown in the card's actions section after
  `CardPipeline` when a draft exists. It shows the status label, DEMO/MOCK label, guard notes,
  the read-only plan sections with provenance labels, the editable subject, message and
  proposal, the buttons from D-2/D-3 (enabled by `nextDraftStatus`), the D-13 hint and the
  collapsed history ("Poprzednie wersje (n)", each with its text in a `<details>`).
- `CardActions.tsx`: "Przygotuj ofertę" works (label "Przygotuj nową wersję oferty" once a
  draft exists); busy text; refusal and failure messages per code. Drop `offerLater`.
- `apps/web/src/offerMarkdown.ts`: pure `draftToMarkdown(draft, opportunityTitle)` and the
  file name `oferta-<opportunityId>-<YYYY-MM-DD>.md` (Warsaw date).
- `apps/web/src/clipboard.ts`: `copyText(text)` tries `navigator.clipboard.writeText`, then
  falls back to the textarea + `execCommand('copy')`. Only after it succeeds is
  `PATCH {action:'copied'}` sent. When both fail, a message asks the operator to select the text
  by hand, and the status stays.
- `apps/web/src/api/offerDrafts.ts`, strings in `strings.pl.ts`.

## Phases

### Phase 1: Contracts, table and spend
- Files:
  - `packages/contracts/src/offer-drafts.ts` (new), `index.ts`: everything under *Contracts*.
    Contract: `OfferDraftContent`, `OfferDraft`, `OfferDraftPatch`, `nextDraftStatus`.
  - `packages/contracts/src/opportunities.ts`: `OpportunityDetail.offerDraft`,
    `offerDraftHistory`. Contract: the `GET /api/opportunities/:id` response.
  - `apps/api/src/infrastructure/db/schema.ts` + generated migration `0010_*.sql` (`pnpm
    --filter @lead-hunter/api db:generate`): table `offer_drafts` (D-1), index
    `(opportunity_id, id)`, index `created_at`.
  - `apps/api/src/infrastructure/db/offer-draft-repository.ts` (new): `insert`, `insertFailed`,
    `get(id)`, `current(opportunityId)`, `history(opportunityId, 20)`, `countSince(at)`,
    `update(id, expectedStatus, changes, at): boolean`.
  - `apps/api/src/infrastructure/db/analysis-repository.ts`: `spentSince` sums both tables
    (D-8). `digest-repository.ts` `llmUsageSince` adds draft tokens (D-18).
  - `apps/api/src/infrastructure/db/opportunity-repository.ts`, `modules/opportunities/ports.ts`,
    `service.ts`: `get()` loads the current draft and the history; the detail maps them
    (`content` through `parseStored`).
  - `packages/config/src/env.ts`, `.env.example`: `OFFER_DRAFT_DAILY_LIMIT` (D-7). Contract:
    `Config.offerDraftDailyLimit`.
  - `apps/web` compile fixes only, if the detail type requires them.
- Proves: the D-8 shared cap through an `analysis-llm.int.test.ts` case where a seeded paid
  `offer_drafts` row raises `GET /api/analysis/status` spend and blocks the next analysis at the
  cap (integration; TR-08).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Offer prompt and adapters
- Files:
  - `apps/api/src/modules/offers/ports.ts` (new): `OfferInput`, `OfferDrafter` (D-6); it reuses
    `ProviderOutput`, `ProviderError` from analysis ports.
  - `apps/api/src/infrastructure/llm/prompt.ts`: export the generic `strip` as
    `toModelSchema(zodSchema)`; no change to the analysis output.
  - `apps/api/src/infrastructure/llm/offer-prompt.ts` (new): prompt, schema and user message
    (D-10).
  - `anthropic.ts`, `openai-compatible.ts`: private `request(system, user, schema)`;
    `draftOffer`; `offerPromptVersion`.
  - `mock.ts`: `draftOffer` (deterministic, DEMO / MOCK).
  - `create-provider.ts`: `createOfferDrafter(config, tuning)` with `model = offerModel`;
    `offerDrafterDeps(config)` → `{ budget: { monthlyCapMicroUsd, price:
    prices[offerModel] }, secrets }`.
  - `apps/api/test/llm-adapters.int.test.ts`: per adapter, the captured `draftOffer` request
    has the offer model, the fixed offer system prompt, the escaped data blocks, an injection
    fixture only inside `<source_data>`, and no key in the body. A recorded synthetic answer
    parses as `OfferDraftContent`. Fixtures `anthropic-offer-valid.json`,
    `openai-offer-valid.json` (synthetic, DEMO).
  - `apps/api/src/infrastructure/llm/mock.test.ts`: the mock draft parses as
    `OfferDraftContent` for pl and en, and has no URL or e-mail (one table-driven case).
  - `docs/llm.md`: section "Szkic oferty (prompt `offer-1`)": what is sent, model, limits.
- Proves: FR-13 AC1 shape at the adapter level, FR-24 AC3 for drafts, TR-02 for the offer
  prompt (integration and unit).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none (the real-provider check is in Phase 5).

### Phase 3: Generate a draft
- Files:
  - `apps/api/src/modules/analysis/output-guard.ts`: export `removeInventedLinks` (unchanged
    behaviour).
  - `apps/api/src/modules/offers/output-guard.ts` (new): `guardOfferDraft` (D-11).
  - `apps/api/src/modules/offers/service.ts` (new): `generate` per *Service*. Contract: result
    union `ok | not_found | refused(code) | failed(reason)`.
  - `apps/api/src/modules/offers/routes.ts` (new): `POST /api/opportunities/:id/offer-drafts`.
  - `apps/api/src/app.ts`, `server.ts`, `test/helpers/app.ts`: wire `offers` deps (drafter,
    repository, spend reader, profile, activity, clock, limit, budget, secrets); helper option
    `drafter?: OfferDrafter | null`.
  - `apps/api/test/offer-drafts.int.test.ts` (new), generation cases:
    - AC1: mock, import + analyse + generate → 201; `offerDraft` has every section, 3–6
      questions, `status: DRAFT`, `language` = pre-filter language; business status
      `OFFER_DRAFTED` with an operator status event;
    - AC2: a fake drafter returns a portfolio URL, an e-mail and a phone number absent from the
      source and profile, plus a URL that is in the source → the invented ones are removed and
      the source URL is kept, with guard notes;
    - AC5: import + drain with the mock → `offerDraft` null, `offer_drafts` empty;
    - regenerate → new current draft, the old one in `offerDraftHistory` with its text;
    - refusals: the 6th call in one Warsaw day → 409 `daily_limit`; paid provider at the cap →
      409 `budget_reached`; no provider → 409 `not_configured`;
    - failure: a fake drafter throws a billed `ProviderError('not_json', …, usage)` → 502, a
      `FAILED` row with usage and cost, no current draft, business status unchanged.
- Proves: FR-13 AC1, AC2, AC5 (integration); FR-09 AC2–AC3 for drafts; TR-01 for drafts.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Draft actions and the no-send proof
- Files:
  - `apps/api/src/modules/offers/service.ts`: `act(draftId, patch)` per *Service*.
  - `apps/api/src/modules/offers/routes.ts`: `PATCH /api/offer-drafts/:id`.
  - `apps/api/test/offer-drafts.int.test.ts`:
    - AC3: save (text changed, `REVIEWED`) → copied → exported (stays) → sent (`SENT_MANUALLY`,
      business status `CONTACTED`). Refused with 409 `action_not_allowed`: `sent` from
      `DRAFT`, `copied` from `DRAFT`, `save` after `SENT_MANUALLY`. Refused with 409
      `not_current`: an action on a history draft. Two-step check (lesson): after
      `SENT_MANUALLY`, a regenerate creates a new `DRAFT` and leaves the sent text unchanged in
      history;
    - AC4 (D-12): Anthropic configured against a mocked origin; recording dispatcher; generate,
      save, copied, exported, sent → recorded origins are exactly one request to the LLM origin.
- Proves: FR-13 AC3, AC4 (integration); TR-04 for drafts.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 5: Draft panel and the e2e draft step
- Files:
  - `apps/web/src/OfferDraftPanel.tsx` (new), `OpportunityPage.module.css` (panel styles),
    `OpportunityPage.tsx` (render the panel).
  - `apps/web/src/CardActions.tsx`: working "Przygotuj ofertę" (Design → Web).
  - `apps/web/src/offerMarkdown.ts`, `clipboard.ts`, `api/offerDrafts.ts` (new),
    `strings.pl.ts` (draft statuses, buttons, refusal and failure messages, D-13 hint; remove
    `offerLater`).
  - `e2e/vertical-main-path.spec.ts`: after "Zapisz": "Przygotuj ofertę" → panel with
    DEMO/MOCK and history "Zapisana → Szkic oferty"; edit the message → "Zapisz i zatwierdź" →
    "Sprawdzony"; grant clipboard permissions, "Kopiuj treść" → the clipboard holds the subject
    and message; "Eksportuj Markdown" → a download named `oferta-*.md`; "Oznacz jako wysłane" →
    "Wysłany ręcznie", history "Szkic oferty → Skontaktowano się", D-13 hint. The separate
    "Oznacz jako kontakt" step and the `pominięto: Szkic oferty` assertion are replaced by
    this. Evidence `draft-360.jpg` into `context/changes/offer-drafts/evidence/` only with
    `E2E_EVIDENCE=1`. The rest of the path is unchanged.
  - `context/test-plan.md`: TR-04 → covered for drafts (S-07; S-11 pending), TR-01 mentions
    the draft guard.
- Proves: FR-13 AC1–AC4 through the UI (e2e main path, 360 px, no overflow).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
- Human checks:
  - Card at 360 px and on a laptop: the panel reads well, and plan sections, estimates and the
    DEMO label are clearly separated from the editable message (evidence `draft-360.jpg`).
  - Over the LAN IP (plain HTTP, not localhost), "Kopiuj treść" copies through the fallback,
    or says to select the text by hand.
  - Real provider: with `LLM_PROVIDER=anthropic` and a cap, one draft for a Polish and one for
    an English DEMO import. The message is in the source's language, and there are no
    references, clients or experience beyond the profile. Save the guarded JSON (no key) under
    `evidence/`, and note the cost shown.

## Risks and unknowns
- Names, clients or past projects in free prose cannot be detected reliably (D-11). Mitigated
  by the prompt, the profile `experience` being the only experience sent, the "szkic modelu"
  label, the mandatory review step (D-3) and the real-provider human check.
- A synchronous call can take up to the 120 s SDK timeout (D-5). A closed tab loses the answer
  but not its cost: the row is still stored, because the service saves the draft whether or
  not the client is still connected.
- `effort: 'medium'` and `max_tokens: 8000` on the offer model cost more per call than an
  analysis does. The cap and the 5-per-day limit bound this.
- `document.execCommand('copy')` is deprecated, but browsers still support it. If it goes, the
  manual-select message is the fallback.
- The model's `language` may disagree with the pre-filter language. The stored `language` is
  the model's, and the human check compares it with the source.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Contracts, table and spend
- [x] Phase 2: Offer prompt and adapters
- [x] Phase 3: Generate a draft
- [x] Phase 4: Draft actions and the no-send proof
- [x] Phase 5: Draft panel and the e2e draft step

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 5) Card at 360 px and on a laptop: plan sections, estimates and the DEMO label are clearly separated from the editable message — run: `docker compose up --build`, import a DEMO post, "Przygotuj ofertę" — evidence: `context/changes/offer-drafts/evidence/draft-360.jpg`
- [ ] (Phase 5) Over the LAN IP (plain HTTP), "Kopiuj treść" copies through the fallback or says to select the text by hand — run: open `http://<pi-ip>:8080`, press "Kopiuj treść", paste elsewhere — evidence: none
- [ ] (Phase 5) Real provider: with `LLM_PROVIDER=anthropic` and a cap, one draft for a Polish and one for an English DEMO import; message in the source's language, no references, clients or experience beyond the profile; note the cost shown — run: "Przygotuj ofertę" on each card — evidence: save guarded JSON (no key) under `context/changes/offer-drafts/evidence/`

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [FOLLOW-UP] FR-09 AC3: show the number of drafts made today, against the limit, in the Today
  brief (`GET /api/digest/today`). The card shows the limit refusal, but the brief does not
  show the count yet.
- [minor] Phase 1 created `modules/offers/ports.ts` (row types and `OfferDraftRepository`) because the
  opportunity detail needs `OfferDraftRow`; Phase 2 adds `OfferInput` and `OfferDrafter` to it.
- [minor] D-18: the brief's `llm.analyses` now counts every stored LLM call (analyses and drafts),
  so `reported` never exceeds it; the field name stays (contract unchanged).
- [minor] Phase 2: `OfferInput` has no `schemaVersion` (the plan's shape did not list one); `escapeJson`
  in `prompt.ts` is exported so the offer prompt reuses it. `createOfferDrafter` and
  `createLlmProvider` share one private `build`.
- [minor] Phase 2: the offer prompt asks for the plan sections (`plan`, `valueProposition`, scope,
  timeline, pricing, `questions`) in Polish (working notes for the operator, D-2) and for
  `message`/`proposal` in the target or source language; the plan only fixed the latter.
- [minor] Phase 3: the service reads the opportunity through a new port `OfferSourceReader`
  (`modules/offers/ports.ts`, implemented in `offer-draft-repository.ts`), because the plan's
  `OfferInput` needs the source text, pre-filter language and newest completed analysis, which no
  existing repository returns. The guard's allowed text is source title + text + profile `experience`.
- [minor] Phase 3: `AppDeps.offers` is the built `OfferService`; `server.ts` and `buildTestApp`
  build it with `createOpportunityService(...).get` as its `detail` reader (one shared
  `opportunityDeps`). An added test covers the global in-flight guard (D-20).
- [minor] Phase 5: `e2e/smoke.spec.ts` asserted the disabled "Przygotuj ofertę" button; it now asserts
  enabled. The panel's plan sections sit in a collapsed `<details>` labelled "szkic modelu"; the
  editable texts are always visible.
- [FOLLOW-UP] S-14: Pipeline/Insights "sent" should count `SENT_MANUALLY` drafts (S-08 D-9).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
