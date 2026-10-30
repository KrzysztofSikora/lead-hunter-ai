# Features

Feature briefs written by the operator, after the product PRD (`lead-hunter-ai-PRD.md`).
A brief here is input to the workflow, like the PRD: it does not replace it. Before any code,
it goes through `/shape` → `/prd` → `/roadmap` (new FR-n, decisions and roadmap items with
GitHub issues), then each item through `ship`.

| Brief | Status | Notes |
|-------|--------|-------|
| [cv-job-matching.md](cv-job-matching.md) | proposed, not shaped | Review notes below |

## Review notes: cv-job-matching (2026-10-30)

Points to settle in `/shape` before the roadmap. The brief itself is kept as written.

1. **Product scope.** The PRD says the product is not a job-ad aggregator (§1), and D-15 withdrew
   the job-board feeds on 2026-10-25. The brief adds jobs on purpose as a second, separate stream
   (own tab, own score). Record that as a decision that amends §1 for the Jobs stream only.
2. **One profile.** S-02 already has an operator profile with skills, rates and exclusions. The
   CV profile must extend or version that profile, not add a second one (§8.1 of the brief agrees).
3. **Refresh rate.** §9 suggests 30–60 minutes per source; the app runs discovery at 08:00 and
   18:00 Europe/Warsaw with a one-hour minimum per source (A-03, S-12). Decide per source in the plan.
4. **LLM limits and privacy.** CV decomposition and job matching need their own daily limits next
   to the 20 analyses and 5 drafts a day (D-09), and the operator's consent before the CV text goes
   to an external provider (§10). Local Ollama on a LAN machine keeps the CV off external APIs.
5. **Plan location.** Phase 0 asks for `docs/implementation-plan-cv-jobs.md`; in this repo plans
   live in `context/changes/<id>/plan.md` (CLAUDE.md). The logical `features/...` tree in §8 maps
   to `apps/api/src/modules/` and `apps/web/src/`.
6. **Live job source.** No job source is chosen yet. Candidates must be checked for terms and
   access at plan time (official API or feed only); the manual adapter works without them.
7. **Data ownership.** New tables (CV imports, extractions, job postings, matches) must join the
   S-15 delete, export allow-list and retention rules; the CV text and PDF are never exported to
   the repository or logs.
8. **PDF parsing on ARM64.** Use a pure-JS parser (no native build) so the image still builds on
   the Pi; scanned PDFs return `TEXT_EXTRACTION_FAILED` (OCR is out of scope).
