# Lead Hunter AI

Self-hosted service for a solo software/AI/IoT studio: it finds real demand signals from
permitted sources, scores them with explicit rules and prepares offer drafts that the operator
reviews and sends by hand. Target: Raspberry Pi 4B (Linux ARM64), running 24/7.

Status: MVP bez prawdziwego dostawcy LLM. Działa import ręczny, źródła RSS/Atom, analiza dostawcą
`mock`, ocena, lejek z płatnościami, widok *Dziś* i harmonogram; instalacja na Raspberry Pi opisana
niżej.
Product brief: [`lead-hunter-ai-PRD.md`](lead-hunter-ai-PRD.md).
Development follows the spec-driven workflow in [`docs/workflow.md`](docs/workflow.md);
the roadmap is tracked as GitHub issues.

## Instalacja na Raspberry Pi 4B (64-bit)

Wymagania: Raspberry Pi 4B, 64-bitowy Raspberry Pi OS (`uname -m` pokazuje `aarch64`), dostęp do
internetu przy instalacji.

1. Zainstaluj Docker Engine z wtyczką Compose według oficjalnej instrukcji dla Debiana
   (<https://docs.docker.com/engine/install/debian/>), potem:

   ```sh
   sudo usermod -aG docker "$USER"   # wyloguj się i zaloguj ponownie
   sudo systemctl enable docker      # Docker startuje po restarcie Pi
   ```

2. Pobierz repozytorium i przygotuj katalog danych. Kontener działa jako użytkownik `node`
   (uid 1000), więc katalog `data` musi do niego należeć:

   ```sh
   git clone <adres repozytorium> lead-hunter-ai && cd lead-hunter-ai
   mkdir -p data && sudo chown 1000:1000 data
   cp .env.example .env
   ```

3. Ustaw hasło operatora. Skrót zrobisz poleceniem (wymaga istniejącego `.env`, może być pusty):

   ```sh
   docker compose run --rm --no-deps app node apps/api/dist/cli/auth-hash.js
   ```

   (przy pierwszym uruchomieniu zbuduje obraz) i wklej wypisaną linię do `.env` jako
   `OPERATOR_PASSWORD_HASH=...`. Bez skrótu aplikacja w kontenerze nie wystartuje.
   Zmienne i domyślne wartości: komentarze w `.env.example`.

4. Zbuduj i uruchom (na Pi budowanie obrazu arm64 trwa kilka minut):

   ```sh
   docker compose up -d --build
   ```

5. Sprawdź:

   ```sh
   docker compose ps                      # stan: healthy
   curl http://127.0.0.1:8080/api/health  # {"status":"ok",...}
   ```

   Interfejs: <http://127.0.0.1:8080/> (z innego komputera patrz *Dostęp zdalny*).

Usługa ma `restart: unless-stopped`, więc wraca po restarcie Pi i po awarii procesu (ręczne
`docker compose stop` ją zatrzymuje). Port jest opublikowany tylko na `127.0.0.1:8080`
(`ss -tlnp | grep 8080`). Baza leży w `./data/lead-hunter.db`, poza obrazem i poza
repozytorium (`data/` jest w `.gitignore`).

### Aktualizacja

```sh
git pull
docker compose up -d --build
```

Dane w `./data` zostają. Migracje bazy uruchamiają się przy starcie aplikacji. Przed
aktualizacją zrób kopię (niżej).

### Dostęp zdalny (Tailscale)

Serwer słucha tylko na `127.0.0.1`. Zdalnie, z telefonu: zainstaluj Tailscale na Pi
(wersja z `tailscale serve --bg`, czyli 1.52 lub nowsza), włącz w panelu tailnetu MagicDNS i
certyfikaty HTTPS, po czym:

```sh
tailscale serve --bg 8080
tailscale serve status    # pokazuje https://<maszyna>.<tailnet>.ts.net
```

Nie używaj Tailscale Funnel: panel nie ma być dostępny z publicznego internetu. Uwaga: w Dockerze
serwer widzi adres bramy mostu, nie loopback, więc ciasteczko sesji nie dostaje flagi `Secure`
(decyzja D-6 w `context/changes/operator-login/plan.md`). Łącze w tailnecie jest szyfrowane
(WireGuard); nie wystawiaj portu 8080 poza tailnet.

### Kopia zapasowa (tymczasowo, do slice'a S-15)

Zimna kopia jest spójna. Katalog kopii jest w `data/backups/` (poza repozytorium, w `.gitignore`):

```sh
docker compose stop
d="data/backups/$(date +%F-%H%M)" && mkdir -p "$d" && cp data/lead-hunter.db* "$d"/
docker compose start
```

Przywrócenie: `docker compose stop`, skopiuj pliki `lead-hunter.db*` z wybranego katalogu do
`data/`, `docker compose start`. Polecenie kopii i przywracania dojdzie ze slice'em S-15 i
zastąpi tę sekcję.

### Bez internetu

Panel (na Pi w lokalnej przeglądarce albo przez `ssh -L 8080:127.0.0.1:8080 pi`; port nasłuchuje tylko na loopbacku), import tekstu, zmiany statusu, notatki, płatności i lejek działają bez
internetu. Źródła RSS i import z adresu URL nie: w widoku *Źródła* i w przebiegu pokazują błąd z
powodem, nigdy „brak wyników"; wcześniej zapisane okazje zostają. Bez `LLM_PROVIDER` analiza
czeka. Przebieg przerwany awarią zostaje w historii jako nieudany i nie jest nadrabiany.

### Opcjonalnie: Ollama

Lokalny model może działać obok aplikacji. Usługa jest wyłączona domyślnie i startuje tylko z
profilem:

```sh
docker compose --profile ollama up -d
docker compose exec ollama ollama pull <mały model>
```

Na Pi 4B nadają się tylko małe modele (patrz D-08 w `context/prd.md`). **Aplikacja jeszcze
z niej nie korzysta**: dostawcy LLM dojdą ze slice'em S-05, wtedy będzie ona dostępna pod
`http://ollama:11434/v1`. Usługa nie publikuje portu na hoście.

### Pomiary na Raspberry Pi

`deploy/pi-check.sh` (z katalogu repozytorium; opis w [`deploy/README.md`](deploy/README.md)):

```sh
deploy/pi-check.sh rss          # pamięć procesu serwera po przebiegu (cel NFR-01: <= 500 MB)
deploy/pi-check.sh perf 10000   # 10 000 sygnałów DEMO w jednorazowym kontenerze; cel NFR-02: <= 500 ms
deploy/pi-check.sh integrity    # PRAGMA integrity_check na bazie z ./data
```

Do pomiaru `rss`: zrestartuj kontener, kliknij *Uruchom teraz*, poczekaj na koniec przebiegu,
wywołaj `rss`. Test awarii (NFR-04): podczas przebiegu
`sudo kill -9 $(docker compose top app | awk '/dist\/server.js/ {print $2}')` (pid procesu serwera na
hoście) — kontener wraca sam
(`docker kill` liczy się jako ręczne zatrzymanie i go nie podnosi), przebieg jest w historii jako
nieudany, a `integrity` wypisuje `ok`.

## Konfiguracja

- **Co trafia do LLM:** dziś nic. Jedyny dostawca to `mock` (reguły lokalne, bez żadnego
  wywołania sieciowego). Lista elementów wysyłanych do prawdziwego dostawcy (FR-24 AC3) powstanie
  ze slice'em S-05.
- **Źródła:** sposób dostępu, regulamin i limity każdego adaptera: [`docs/source-policy.md`](docs/source-policy.md).

| Adapter | Dostęp | Limity |
|---------|--------|--------|
| Import ręczny | wklejony tekst; adres tylko zapisywany lub pobierany na polecenie | `IMPORT_MAX_TEXT_CHARS`, `FETCH_*` |
| RSS: hnrss.org (HN) | `GET` kanału, robots.txt sprawdzany | `SOURCE_MIN_INTERVAL_MINUTES`, `SOURCE_MAX_ATTEMPTS` |
| RSS: We Work Remotely | oficjalne kanały kategorii | jak wyżej |
| RSS: kanał własny | adres podany przez operatora | jak wyżej |

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
  sekretów w logach, polska powłoka UI, `pnpm discover` (uruchamia raz każde włączone źródło; bez źródeł pisze `brak skonfigurowanych źródeł`; gdy trwa inny przebieg, pisze `przebieg w toku` i kończy się kodem 1; blokada po awarii CLI w osobnym kontenerze `docker compose run` zwalnia się po 2 minutach); logowanie operatora
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
  wersji. Bez `LLM_PROVIDER` UI mówi, że analiza nie jest
  skonfigurowana, a okazje czekają jako „Analiza: oczekuje".
- **Dziś, harmonogram, lejek:** widok *Dziś* (`/`): podsumowanie dnia z listą okazji i
  zadań do wykonania; harmonogram przebiegów (`DISCOVERY_TIMES`, domyślnie 08:00 i 18:00) z
  historią przebiegów, przebieg przerwany awarią oznaczany jako nieudany; lejek (`/lejek`):
  statusy okazji, kontakt, wygrana i zapis płatności (kwoty w groszach, waluta).
- **Źródła RSS/Atom:** widok *Źródła* (`/zrodla`): dodanie gotowego kanału jednym kliknięciem
  (Hacker News „Seeking freelancer", We Work Remotely: programming, full-stack, back-end, devops)
  albo dowolnego adresu RSS/Atom, włączanie i wyłączanie, **Uruchom teraz** i **Sprawdź**, status
  ostatniej próby i błąd z powodem. Wpisy trafiają do *Okazji* z nazwą źródła, bez duplikatów po
  ponownym odczycie. Odstęp między przebiegami jednego źródła: `SOURCE_MIN_INTERVAL_MINUTES`
  (domyślnie 60), ponowienia przy 429/503: `SOURCE_MAX_ATTEMPTS` (domyślnie 3). Zasady dostępu,
  regulaminy i limity: [`docs/source-policy.md`](docs/source-policy.md). Automatyczne przebiegi:
  codziennie o 08:00 i 18:00 (Europe/Warsaw), zmiana przez `DISCOVERY_TIMES`; przebieg pominięty,
  gdy aplikacja była wyłączona, nie jest nadrabiany.
- **Co wymaga kluczy:** prawdziwy dostawca LLM (Anthropic, OpenAI-compatible) dojdzie ze slice'em
  S-05; skrzynka IMAP ze slice'em S-11. Zmienne analizy: `LLM_PROVIDER`, `ANALYSIS_DAILY_LIMIT`,
  `PREFILTER_MAX_AGE_DAYS` (patrz `.env.example`).
- **Co wymaga ręcznej weryfikacji:** prawdziwe kanały hnrss.org i We Work Remotely (adresy
  presetów w `apps/api/src/modules/sources/presets.ts`, format wpisów, regulaminy; agent nie miał
  do nich dostępu), widok *Źródła* na telefonie, nagranie fixture'ów poleceniem
  `pnpm fixtures:record <id źródła>` (zapisuje do `apps/api/test/fixtures/feeds/` pierwsze 5
  wpisów bez adresów e-mail, autorów, numerów i obcych adresów URL; plik trzeba przejrzeć przed
  commitem), budowanie i start `docker compose up -d --build` na Raspberry Pi (czas, restart po `reboot`, pomiary NFR-01/NFR-02, tryb bez internetu, `tailscale serve`; kroki w sekcji *Instalacja na Raspberry Pi*; dowody w `context/changes/pi-deployment/evidence/`), wygląd powłoki i formularza logowania na telefonie, widok *Profil* na telefonie i komunikaty
  błędów przy polach,
  flaga `Secure` ciasteczka za Tailscale (w Dockerze serwer widzi adres bramy, nie loopback,
  więc flaga nie jest ustawiana; patrz decyzja D-6 w `context/changes/operator-login/plan.md`).
