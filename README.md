# Lead Hunter AI

Self-hosted service for a solo software/AI/IoT studio: it finds real demand signals from
permitted sources, scores them with explicit rules and prepares offer drafts that the operator
reviews and sends by hand. Target: Raspberry Pi 4B (Linux ARM64), running 24/7.

Status: szkielet repozytorium (F-01). Działa serwer z `/api/health`, baza z migracjami i pusta
powłoka interfejsu; źródła, analiza i punktacja dojdą w kolejnych slice'ach.
Product brief: [`lead-hunter-ai-PRD.md`](lead-hunter-ai-PRD.md).
Development follows the spec-driven workflow in [`docs/workflow.md`](docs/workflow.md);
the roadmap is tracked as GitHub issues.

## Uruchomienie

```sh
mkdir -p data
cp .env.example .env
# w .env ustaw OPERATOR_PASSWORD_HASH: wynik polecenia `pnpm auth:hash` albo, tylko z Dockerem,
# `docker compose run --rm --no-deps app node apps/api/dist/cli/auth-hash.js` (potrzebuje istniejącego .env)
docker compose up --build
```

Sprawdź: <http://127.0.0.1:8080/api/health>. Interfejs: <http://127.0.0.1:8080/>.
Baza leży w `data/lead-hunter.db` (poza repozytorium). Więcej: [`deploy/README.md`](deploy/README.md).

## Rozwój

```sh
pnpm install
pnpm dev          # API (8080) + Vite
pnpm typecheck && pnpm lint && pnpm test
pnpm e2e          # wymaga: pnpm exec playwright install chromium
pnpm docker:build
```

Baza deweloperska: `apps/api/data/lead-hunter.db`. Migracje: `pnpm db:migrate`.

## Co działa / Co wymaga kluczy / Co wymaga ręcznej weryfikacji

- **Co działa:** serwer, `GET /api/health`, migracje Drizzle, OpenAPI poza produkcją, redakcja
  sekretów w logach, polska powłoka UI, `pnpm discover` (uruchamia raz każde włączone źródło; bez źródeł pisze `brak skonfigurowanych źródeł`); logowanie operatora
  (hasło w `OPERATOR_PASSWORD_HASH`, sesja w ciasteczku `HttpOnly` + `SameSite=Strict` ważna 30 dni
  bez aktywności, wylogowanie, limit 5 prób na 15 minut); każdy `/api/*` poza health i logowaniem
  wymaga sesji; profil operatora (`GET`/`PUT /api/profile`, widok *Profil* w UI, przykładowy profil
  z etykietą `PRZYKŁAD` przy pierwszym uruchomieniu); błędy walidacji ciała żądania mają jeden
  kształt `{ error: "validation_failed", fields }`; ręczny import ogłoszenia (widok *Import*,
  `POST /api/signals/import`: wklejony tekst i/lub adres URL, który jest tylko zapisywany, nie
  pobierany; powtórka rozpoznawana po adresie lub treści; limit długości w
  `IMPORT_MAX_TEXT_CHARS`, domyślnie 20000), lista *Okazje* z filtrami, sortowaniem i stronami oraz
  podgląd okazji; filtr wstępny (reguły nazwane, np. `seeking_work` → „oferta wykonawcy, nie
  zlecenie"), analiza dostawcą `mock` (`LLM_PROVIDER=mock`; wynik reguł, w UI zawsze z etykietą
  `DEMO / MOCK`, nie analiza AI), deterministyczna ocena 0–100 z rozbiciem na pięć składników i
  osobną pewnością (reguły w [`docs/scoring.md`](docs/scoring.md)), dzienny limit analiz
  (`ANALYSIS_DAILY_LIMIT`, domyślnie 20; reszta czeka do następnego dnia czasu Europe/Warsaw),
  `GET /api/analysis/status`, filtry listy (min. ocena z linkiem „Tylko ≥ 65", wiek, kwota,
  język, tryb pracy, kraj, wykluczone branże). Karta okazji (`/okazje/:id`) ma dwanaście
  elementów z briefu §8, a przy każdej wartości etykietę pochodzenia (`ze źródła`, `wniosek
  modelu`, `szacunek (hipoteza)`, `wyliczone regułami`, `brak danych`); akcje `Zapisz`, `Odrzuć`
  (z powodem) i `Dodaj notatkę` (`POST /api/opportunities/:id/status` i `/notes`) oraz historia
  zmian statusu i notatek; `Przygotuj ofertę` i `Oznacz jako kontakt` są wyłączone do kolejnych
  wersji. Prawdziwi dostawcy: `anthropic` i
  `openai-compatible` (ten sam runner, schemat i kontrola wyniku co `mock`), koszt każdej analizy,
  miesięczny limit `LLM_MONTHLY_BUDGET_USD` (płatny dostawca bez limitu nic nie analizuje),
  ponowne użycie wyniku dla tej samej treści, przyciski „Ponów analizę" / „Analizuj ponownie"
  (`POST /api/opportunities/:id/analysis`); co dokładnie wysyłamy i jak liczymy koszt:
  [`docs/llm.md`](docs/llm.md). Bez `LLM_PROVIDER` UI mówi, że analiza nie jest skonfigurowana, a
  okazje czekają jako „Analiza: oczekuje".
- **Źródła RSS/Atom:** widok *Źródła* (`/zrodla`): dodanie gotowego kanału jednym kliknięciem
  (Hacker News „Seeking freelancer", We Work Remotely: programming, full-stack, back-end, devops)
  albo dowolnego adresu RSS/Atom, włączanie i wyłączanie, **Uruchom teraz** i **Sprawdź**, status
  ostatniej próby i błąd z powodem. Wpisy trafiają do *Okazji* z nazwą źródła, bez duplikatów po
  ponownym odczycie. Odstęp między przebiegami jednego źródła: `SOURCE_MIN_INTERVAL_MINUTES`
  (domyślnie 60), ponowienia przy 429/503: `SOURCE_MAX_ATTEMPTS` (domyślnie 3). Zasady dostępu,
  regulaminy i limity: [`docs/source-policy.md`](docs/source-policy.md). Harmonogram automatycznych
  przebiegów dojdzie ze slice'em S-12; do tego czasu przebiegi są ręczne lub przez `pnpm discover`.
- **Co wymaga kluczy:** Anthropic (`LLM_PROVIDER=anthropic`, `LLM_API_KEY`, `LLM_MONTHLY_BUDGET_USD`);
  serwer OpenAI-compatible (`LLM_BASE_URL`, `LLM_MODEL`, klucz opcjonalny); skrzynka IMAP ze
  slice'em S-11. Zmienne analizy: `LLM_*`, `ANALYSIS_DAILY_LIMIT`, `PREFILTER_MAX_AGE_DAYS`
  (patrz `.env.example`).
- **Co wymaga ręcznej weryfikacji:** prawdziwe analizy Anthropic i OpenAI-compatible (czy schemat
  jest przyjęty, czy `json_object` i zużycie tokenów działają u danego dostawcy), wygląd
  komunikatów o limicie kosztów na telefonie, prawdziwe kanały hnrss.org i We Work Remotely (adresy
  presetów w `apps/api/src/modules/sources/presets.ts`, format wpisów, regulaminy; agent nie miał
  do nich dostępu), widok *Źródła* na telefonie, nagranie fixture'ów poleceniem
  `pnpm fixtures:record <id źródła>` (zapisuje do `apps/api/test/fixtures/feeds/` pierwsze 5
  wpisów bez adresów e-mail, autorów, numerów i obcych adresów URL; plik trzeba przejrzeć przed
  commitem), uruchomienie `docker compose up` na Raspberry Pi
  (czas budowania better-sqlite3 na ARM64), wygląd powłoki i formularza logowania na telefonie, widok *Profil* na telefonie i komunikaty
  błędów przy polach,
  flaga `Secure` ciasteczka za Tailscale (w Dockerze serwer widzi adres bramy, nie loopback,
  więc flaga nie jest ustawiana; patrz decyzja D-6 w `context/changes/operator-login/plan.md`).

## Dostęp zdalny

Serwer domyślnie słucha tylko na `127.0.0.1`. Zdalnie: `tailscale serve` kierujące na
`127.0.0.1:8080` (szczegóły i weryfikacja na Raspberry Pi: slice S-16).
