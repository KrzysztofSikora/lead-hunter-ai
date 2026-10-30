# FEATURE: CV Intelligence & Job Opportunity Matching

**Projekt:** `lead-hunter-ai`  
**Typ:** Feature specification / rozszerzenie istniejącego PRD  
**Status:** Ready for implementation planning  
**Priorytet:** P1 — po działającym podstawowym przepływie Lead Hunter  
**Repozytorium:** prywatne (na obecnym etapie)  
**Środowisko docelowe:** Raspberry Pi 4B (ARM64), Docker Compose, SQLite, Node.js / TypeScript

## 1. Cel

Rozszerzyć `lead-hunter-ai` o analizę CV w PDF i zbieranie ofert pracy/kontraktów dopasowanych do umiejętności operatora. Zamiast ręcznie wpisywać stos technologiczny i wyszukiwać wiele wariantów fraz, użytkownik importuje CV, zatwierdza ustrukturyzowany profil, a agent wykorzystuje go do budowania zapytań, filtrowania i rankingu ogłoszeń.

System ma obsługiwać **dwa niezależne strumienie okazji**, korzystające z jednego, edytowalnego profilu:

- **Business Leads** — zlecenia i potrzeby firm, istniejący przepływ `lead-hunter-ai`.
- **Job Opportunities** — zatrudnienie, kontrakty B2B, freelance i współpraca projektowa.

**Rezultat dla użytkownika:** regularnie otrzymuje kilka nowych, udokumentowanych i wysoko dopasowanych ofert, z wyjaśnieniem „dlaczego pasuje / czego brakuje / jaki następny krok”, bez automatycznej aplikacji.

## 2. Zakres i założenia

### In scope — MVP

1. Import PDF z lokalnego panelu WWW.
2. Ekstrakcja tekstu z PDF, z wykryciem PDF bez warstwy tekstowej.
3. Dekompozycja CV na profil kompetencji i doświadczenia, przy użyciu modelu LLM ze ściśle walidowaną strukturą odpowiedzi.
4. Widok przeglądu i ręcznej korekty profilu przed aktywacją.
5. Preferencje pracy/kontraktu edytowane **niezależnie od CV**.
6. Generowanie synonimów i zapytań wyszukiwania z profilu.
7. Co najmniej jeden realnie działający, dozwolony adapter źródła ofert oraz import ogłoszenia przez URL lub ręcznie wklejoną treść; dobór źródła po sprawdzeniu dostępności i warunków dostępu.
8. Normalizacja, deduplikacja i zapisywanie ogłoszeń z linkiem źródłowym i datami.
9. Twarde filtry, ranking dopasowania, uzasadnienie, luki kompetencyjne i poziom pewności.
10. Osobna zakładka `Jobs` w istniejącym panelu, z listą, szczegółami, statusami i opcją zapisania oferty.
11. Cykl okresowego sprawdzania źródeł, odporny na restart i ponowne uruchomienie.
12. Testy, dokumentacja uruchomienia na Raspberry Pi i obsługa błędów integracji.

### Out of scope — MVP

- Automatyczne wysyłanie CV, aplikowanie, pisanie do rekruterów, logowanie na cudze konta.
- Scraping stron zakazany regulaminem lub obchodzenie zabezpieczeń antybotowych.
- Trenowanie modelu na prywatnym CV.
- Wektorowa baza danych, RAG, multi-agent framework, Redis i osobna kolejka, jeśli nie są uzasadnione potrzebą.
- Generowanie nowego CV pod każde ogłoszenie i fikcyjnych osiągnięć.
- OCR skanowanego CV w pierwszym wydaniu (wyraźny komunikat i możliwość zastąpienia PDF tekstowym); OCR jako późniejsze rozszerzenie.

## 3. Scenariusz użytkownika end-to-end

1. Wchodzę w `Profile > Import CV` i przesyłam plik `cv.pdf`.
2. System wyciąga tekst i informuje, czy udało się go odczytać. Jeśli nie, dostaję instrukcję użycia tekstowego PDF.
3. Agent proponuje profil: doświadczenie, technologie, projekty, specjalizacje, języki i poziom pewności każdego pola.
4. Przeglądam profil, poprawiam błędy, dopisuję brakujące kompetencje i zatwierdzam.
5. Ustawiam preferencje: lokalizacja, remote/hybrid, B2B/UoP, seniority, widełki, język, wykluczenia, strefa godzinowa, branże.
6. Agent generuje zestaw zapytań i okresowo sprawdza aktywne źródła ofert.
7. Każde ogłoszenie zostaje zapisane, przefiltrowane i ocenione względem aktualnego profilu.
8. Rano w zakładce `Jobs` widzę 5–10 najlepszych nowych wyników; każdy zawiera źródło, wynagrodzenie (jeżeli ogłoszone), dopasowania, braki i propozycję następnego działania.
9. Otwieram oryginalne ogłoszenie i **samodzielnie** aplikuję albo odrzucam ofertę.
10. Zapisuję status i ewentualny wynik procesu. Agent mierzy jakość rekomendacji na podstawie mojej oceny, nie deklaruje sukcesu bez danych.

## 4. CV Decomposer — ekstrakcja i normalizacja

### 4.1 Dane wejściowe

- PDF przesłany przez zalogowanego operatora.
- Maksymalny rozmiar ustawiany konfiguracyjnie (domyślnie 10 MB).
- Odrzuć plik niebędący poprawnym PDF; nie ufaj samemu rozszerzeniu lub MIME od klienta.
- Przetwarzanie wyłącznie po stronie serwera; brak wysyłania pełnego CV do logów.
- Parser PDF z obsługą wielostronicowości; zachowaj możliwość audytu fragmentów źródła w ramach prywatnej sesji importu.
- Jeżeli ekstrakcja jest pusta albo podejrzanie uboga, zwróć `TEXT_EXTRACTION_FAILED` i zaproponuj poprawę pliku.

### 4.2 Struktura profilu

| Pole | Przykład / wymaganie |
|---|---|
| `headline` | Full-stack / AI-assisted Software Engineer |
| `roles[]` | Wykonywane role i okresy — tylko jeśli udokumentowane |
| `totalExperienceYears` | Liczba tylko jeśli możliwa do wiarygodnego wyliczenia; w innym wypadku `null` |
| `skills[]` | Kanoniczna nazwa, kategoria, aliasy, evidence, confidence |
| `projects[]` | Nazwa/opis, zastosowane technologie, rezultat wyłącznie gdy potwierdzony |
| `domains[]` | SaaS, e-commerce, IoT, AI, automatyzacje itd. |
| `languages[]` | Język i poziom tylko jeśli CV go deklaruje |
| `education[]` | Kwalifikacje i kierunki, jeśli zawarte w CV |
| `links[]` | GitHub / portfolio / LinkedIn, jeśli zawarte w CV |
| `uncertainties[]` | Pytania i brakujące lub niejednoznaczne informacje |

Przykładowe kategorie umiejętności: `frontend`, `backend`, `databases`, `cloud_devops`, `ai_llm`, `automation`, `hardware_iot`, `soft_skills`.

**Wymóg śladu dowodowego:** każda pozycja automatycznie wyciągnięta z CV ma referencję do fragmentu tekstu źródłowego (np. strona + cytowany krótki fragment); kompetencje dodane ręcznie mają `source=MANUAL`.

### 4.3 Reguły jakości

- Normalizuj warianty: `Node`, `Node.js`, `nodejs` → `Node.js`; `Postgres` → `PostgreSQL`.
- Nie utożsamiaj pojęć bliskoznacznych bez podstaw: `React` nie oznacza automatycznie `Next.js`, `LLM` nie oznacza doświadczenia w produkcyjnym RAG.
- Rozróżniaj „używał w projekcie” od „ekspert”. Nie wnioskuj poziomu seniority wyłącznie z jednej technologii.
- Zachowaj raw extraction i wersję struktury; użytkownik może ponownie uruchomić analizę.
- Wprowadzaj zmiany profilu dopiero po wyraźnym zatwierdzeniu. Nowy import nie może nadpisać ręcznych korekt bez potwierdzenia.
- Usunięcie importu umożliwia usunięcie oryginału PDF, wyekstrahowanego tekstu i zapisanych kopii prywatnych danych; wyniki ocen oznacz jako zależne od poprzedniej wersji profilu.

## 5. Job Hunter — zbieranie ofert

### 5.1 Źródła

Adapter źródła może korzystać z: oficjalnego API, otwartej publicznej listy ofert, legalnego RSS lub dozwolonego pobrania publicznej strony. Integracja wymaga sprawdzenia aktualnych warunków i limitów. Żadnych fikcyjnych ofert ani nieudokumentowanych „aktywnych” linków.

Dostarcz:

- `ManualJobAdapter`: ręczne dodanie URL/treści — zawsze dostępne, nawet bez innych integracji.
- `LiveJobAdapter`: minimum jeden zweryfikowany realny adapter jako część feature, po sprawdzeniu warunków dostępu podczas implementacji.
- Rozszerzalny interfejs `JobSourceAdapter` do kolejnych źródeł.

Kontrakt adaptera (pseudotyp):

```ts
interface JobSourceAdapter {
  id: string;
  fetchJobs(params: {
    queries: string[];
    since?: string;
    cursor?: string;
  }): Promise<{
    jobs: RawJob[];
    nextCursor?: string;
  }>;
}
```

### 5.2 Generowanie zapytań z CV

- Wybierz kompetencje podstawowe i role z profilu zatwierdzonego przez użytkownika.
- Rozszerz je o prawidłowe aliasy, np. `TypeScript + Node.js`, `React developer`, `Full-stack JavaScript`, `AI Engineer`, `LLM integration`.
- Dołącz preferencje lokalizacji, trybu pracy i formy współpracy.
- Zapytania pokazuj i udostępnij do edycji w UI; pozwól wykluczać frazy i dodawać własne.
- W przypadku źródeł z ograniczonym filtrowaniem pobierz wyniki szerzej, a następnie stosuj reguły lokalnie.
- Limituj liczbę zapytań i monitoruj zużycie API, aby nie generować dużych kosztów.

### 5.3 Normalizacja i deduplikacja

`JobPosting` powinien zawierać m.in.:

- `id`, `sourceId`, `externalId?`, `canonicalUrl`, `title`, `company?`, `location?`;
- `workMode` (`REMOTE`/`HYBRID`/`ONSITE`/`UNKNOWN`);
- `contractTypes[]`, `seniority?`, `employmentType?`;
- `salaryMin?`, `salaryMax?`, `currency?`, `salaryPeriod?`, `salaryGrossNet?`;
- `technologiesRequired[]`, `technologiesOptional[]`, `description`, `language?`;
- `publishedAt?`, `firstSeenAt`, `lastSeenAt`, `expiresAt?`, `sourceUrl`, `rawSnapshotRef?`;
- `status` (`ACTIVE`/`EXPIRED`/`UNKNOWN`) i dowody tego statusu.

Nie przypisuj domyślnie `REMOTE`, `B2B` ani wynagrodzenia, gdy nie ma ich w źródle. Nie porównuj automatycznie stawek miesięcznych z godzinowymi bez jawnej konwersji i założeń. Deduplikuj po `(sourceId, externalId)` i kanonicznym URL; podobne ogłoszenia z różnych źródeł łącz ostrożnie.

## 6. Filtry i scoring ofert pracy

**Uwaga:** nie używaj bezpośrednio scoringu leadów biznesowych 30/25/20/15/10 — jest on przeznaczony do oceny potencjału sprzedaży. Dla ogłoszeń stwórz osobny `JobMatchScore`.

### 6.1 Filtry twarde

Konfigurowalne przez operatora:

- `remoteOnly`, dozwolone miasta/kraje, minimalny poziom zdalności;
- dozwolone rodzaje umowy (`B2B`, `UOP`, `CONTRACT`, `FREELANCE`);
- wykluczone role/branże, ograniczenia strefy godzinowej lub godzin pracy;
- widełki minimalne, jeśli wynagrodzenie jest podane;
- język, poziom stanowiska i maksymalny wiek ogłoszenia.

Jeśli wartość jest nieznana, domyślnie oznacz `NEEDS_REVIEW` zamiast udawać, że filtr przeszedł albo nie przeszedł. Użytkownik decyduje, czy ukrywać wyniki niepełne.

### 6.2 Ranking dopasowania (0–100)

| Wymiar | Maks. pkt |
|---|---:|
| Umiejętności wymagane i zakres doświadczenia | 35 |
| Dopasowanie do roli i odpowiedzialności | 20 |
| Preferencje zatrudnienia, trybu pracy i lokalizacji | 20 |
| Dopasowanie stawki / warunków, jeśli podane | 15 |
| Domena, potencjał rozwoju i kompetencje dodatkowe | 10 |
| **Łącznie** | **100** |

Score liczony jawnie z rubryk i informacji wyciągniętych przez LLM, nie jako arbitralna liczba podana przez model. Niezależny `confidence` (`LOW`/`MEDIUM`/`HIGH`) oraz `missingInformation[]`.

Każde dopasowanie ma zawierać:

- `matchedSkills[]` — wymaganie + dowód kompetencji z profilu;
- `missingSkills[]` — obowiązkowe wymagania bez potwierdzenia;
- `transferableSkills[]` — kompetencje pokrewne, oznaczone jako takie;
- `hardFilterResults[]` — wyniki filtrów i powód;
- `scoreBreakdown` z uzasadnieniem;
- `recommendation` (`APPLY`/`REVIEW`/`SKIP`);
- `nextAction` — konkretna czynność, np. „przeczytaj ofertę i wyślij CV”.

LLM nigdy nie może przedstawiać brakującej kompetencji jako istniejącej tylko po to, by podnieść wynik.

## 7. Interfejs i statusy

### 7.1 Profile

- `Profile > CV`: import PDF, status parsowania, podgląd wyników i różnic między wersjami.
- `Profile > Skills`: edytowalna lista umiejętności wraz z pochodzeniem i dowodami.
- `Profile > Job Preferences`: remote/hybrid, umowa, stawki, seniority, lokalizacja, język, ograniczenia.
- Możliwość usunięcia danych CV i wyłączenia modułu Jobs bez wpływu na Business Leads.

### 7.2 Jobs

- Lista z filtrami: `new`, `recommended`, `needs review`, `saved`, `applied`, `rejected`, `expired`.
- Karta: tytuł, firma, lokalizacja, tryb pracy, forma współpracy, ogłoszone wynagrodzenie, daty i link.
- Score + rozbicie, kluczowe dopasowania i luki, podstawa rekomendacji.
- Przyciski: `Otwórz źródło`, `Zapisz`, `Odrzuć`, `Oznacz jako aplikowane`, `Dodaj notatkę`.
- Statusy: `NEW`, `SAVED`, `APPLIED`, `REPLIED`, `INTERVIEW`, `OFFER`, `REJECTED`, `EXPIRED`.
- Brak samoczynnego przejścia do `APPLIED` po wygenerowaniu materiałów.
- Dzienny brief: maksymalnie 5–10 **nowych** dopasowanych ofert; jeśli brak wyników, pokaż informację o braku nowych ofert i kondycji źródeł.

## 8. Architektura i integracja z istniejącym PRD

Rozszerz istniejące monorepo i moduły, bez duplikowania infrastruktury:

```text
Existing lead-hunter-ai
├── shared/operator-profile
│   ├── profile-versioning
│   └── preferences
├── features/business-leads       # istniejący proces
├── features/cv-intelligence      # NOWY
│   ├── pdf-extraction
│   ├── profile-decomposer
│   └── profile-review
└── features/job-opportunities    # NOWY
    ├── adapters
    ├── query-builder
    ├── normalize-dedupe
    ├── match-and-rank
    └── job-pipeline
```

Powyższa struktura jest **logiczna**; dostosuj katalogi do faktycznego repozytorium po inspekcji kodu.

**Nie uruchamiaj drugiej aplikacji ani drugiej bazy**, jeśli istniejące API, SQLite, panel i scheduler wystarczają. Agent ma działać na Raspberry Pi w Docker Compose z trwałym wolumenem. Ekstrakcja PDF może być zrealizowana w Node.js; LLM wykonuje zewnętrzny provider przez istniejącą abstrakcję. Nie wymagaj uruchamiania lokalnego dużego modelu na Pi.

### 8.1 Sugerowane tabele

- `cv_imports` — metadane uploadu, hash, status ekstrakcji, wersja, utworzenie/usunięcie.
- `cv_extractions` — tekst, informacje o stronach i ostrzeżenia, prywatne.
- `candidate_profile_versions` — wersjonowany, zatwierdzany ustrukturyzowany profil.
- `job_preferences` — preferencje niezależne od CV.
- `job_sources` — konfiguracja i stan adapterów.
- `job_postings` — znormalizowane ogłoszenia i ślad źródłowy.
- `job_match_analyses` — wersja profilu, wynik, breakdown i confidence.
- `job_application_events` — ręczne zmiany statusu, daty, notatki.

Unikaj dwóch konkurencyjnych `operator_profile`: zaplanuj migrację lub relację do istniejącej tabeli, zachowując integralność danych leadów.

### 8.2 Proponowane endpointy

```http
POST   /api/cv/imports
GET    /api/cv/imports/:id
POST   /api/cv/imports/:id/decompose
GET    /api/profile/candidate
PUT    /api/profile/candidate
PUT    /api/profile/job-preferences
GET    /api/job-sources
POST   /api/jobs/discover
GET    /api/jobs
GET    /api/jobs/:id
POST   /api/jobs/:id/match
PATCH  /api/jobs/:id/status
```

Ścieżki są propozycją; podporządkuj się istniejącej konwencji API. Każda operacja na danych prywatnych wymaga istniejącego mechanizmu uwierzytelnienia.

## 9. Scheduler, koszty i odporność

- Kolektory mają własne częstotliwości i limity per źródło; typowo 30–60 minut dla aktywnych źródeł, jeśli regulamin na to pozwala.
- LLM analizuje tylko nowe albo zmienione ogłoszenia; dodatkowo ponowne dopasowanie po zatwierdzeniu nowej wersji CV.
- Zapewnij idempotencyjne zadania, retry z backoff i stan ostatniego sprawdzenia źródła.
- Loguj liczbę zapytań, błędy źródła, liczbę przetworzonych ofert i szacunkowy koszt LLM.
- Błąd jednej integracji nie blokuje Business Leads ani pozostałych źródeł.
- Zapisuj `lastSuccessfulSyncAt` i informuj, jeśli dane są nieaktualne.
- Nie wysyłaj pełnego CV w powiadomieniach.

## 10. Bezpieczeństwo i prywatność

- Repo pozostaje prywatne; mimo to **żadne CV, dane kontaktowe, historie aplikacji, tokeny ani klucze API nie trafiają do Gita**.
- Pliki i baza w trwałym, prywatnym wolumenie z odpowiednimi uprawnieniami; ogranicz logowanie PII.
- Zabezpiecz panel (uwierzytelnienie); nie wystawiaj panelu publicznie bez dodatkowych zabezpieczeń.
- Jeśli analiza CV wysyła tekst do zewnętrznego LLM, pokaż użytkownikowi, który provider otrzyma dane; pozwól świadomie zaakceptować przetwarzanie.
- Dane z ogłoszeń traktuj jako niezaufane (prompt injection): treść oferty nie może wykonywać poleceń ani modyfikować konfiguracji agenta.
- Przestrzegaj warunków korzystania ze źródeł; nie używaj nieautoryzowanego scrapingu ani omijania zabezpieczeń.
- Umożliw usunięcie CV i powiązanych danych. Nie przechowuj oryginału PDF dłużej niż wymaga tego funkcjonalność.

## 11. Definition of Done — kryteria akceptacyjne

1. **Import:** upload prawidłowego, wielostronicowego PDF działa; błędny plik jest odrzucany; PDF bez tekstu daje jednoznaczny komunikat.
2. **Dekompozycja:** ekstrakcja tworzy profil zgodny ze schematem, z pochodzeniem umiejętności; brakujących danych nie uzupełnia domysłami.
3. **Review:** zmiany i korekty są zapisywane; dopiero zatwierdzony profil jest używany do matchingu.
4. **Preferencje:** użytkownik może ustawić np. `remoteOnly`, `B2B`, `mid/mid+` i minimalną stawkę; są respektowane przez wyszukiwanie i ranking.
5. **Źródło:** co najmniej jeden realny adapter działa na żywych danych albo informuje o ograniczeniu dostępu; import ręczny działa niezależnie.
6. **Deduplikacja:** ponowny import tego samego ogłoszenia nie tworzy nowej oferty; różne ogłoszenia nie są błędnie scalane.
7. **Scoring:** ten sam profil i treść oferty dają deterministyczny score breakdown; LLM jedynie ekstrahuje oceniane fakty.
8. **Missing data:** brak informacji o pensji, trybie pracy lub dacie jest widoczny jako `unknown`, a nie wypełniany fikcyjnymi wartościami.
9. **UI:** istnieje odrębna zakładka `Jobs` z wynikami, filtrami, źródłami i ręcznym śledzeniem statusu.
10. **Zero auto-apply:** system nie wysyła aplikacji ani wiadomości bez interakcji użytkownika.
11. **Isolation:** błędy Job Hunter nie zatrzymują wykrywania leadów biznesowych.
12. **Deploy:** nowy moduł uruchamia się na ARM64 z istniejącym Docker Compose; dane trwają po restarcie i rekreacji kontenera.
13. **Testy:** testy parsera (także PDF bez tekstu), walidacji schematu, normalizacji, scoringu, duplikatów, API i przynajmniej jeden test integracyjny vertical slice.
14. **Brak fikcyjnych wyników:** jeżeli nie ma dopasowanych, zweryfikowanych ofert, widok pokazuje stan pusty i błędy źródeł.

## 12. Plan implementacji dla Claude Code

### Faza 0 — Inspekcja i plan

- Przeczytaj główny `lead-hunter-ai-PRD.md`, obejrzyj repo i sprawdź modele `operator_profile`, adapterów, API, scheduler, auth oraz Docker Compose.
- Przygotuj `docs/implementation-plan-cv-jobs.md` z mapą integracji i migracjami.

### Faza 1 — CV vertical slice

- Upload PDF → ekstrakcja → walidacja → dekompozycja → ręczny review → zatwierdzony profil.
- Testy parsera, braków danych i trwałości.

### Faza 2 — Import i model oferty pracy

- `ManualJobAdapter`, normalizacja, deduplikacja, CRUD ogłoszenia, UI Jobs, zapisywanie statusu.
- Test pełnej ścieżki bez zewnętrznego API.

### Faza 3 — Match & Ranking

- Preferencje, hard filters, score breakdown, evidence, missing skills, confidence, ranking i rekomendacje.
- Testy reguł na danych syntetycznych z oczekiwanymi wynikami.

### Faza 4 — Live discovery + harmonogram

- Zweryfikowany `LiveJobAdapter`, query builder z CV, scheduler, limity, retry, stale-data indicators.
- Testy integracji live przy dostępnych credentials/źródle; w przeciwnym razie raportuj blocker, nie symuluj sukcesu.

### Faza 5 — Hardening

- Testy end-to-end, weryfikacja prywatności, deploy ARM64, dokumentacja, obsługa usuwania CV i odporność na restart.

## 13. Prompt startowy do Claude Code

```text
Przeczytaj główny PRD projektu lead-hunter-ai oraz
lead-hunter-ai-FEATURE-cv-job-matching.md.

Zaimplementuj rozszerzenie „CV Intelligence & Job Opportunity Matching”.
Najpierw zrób inspekcję repozytorium i zapisz plan w
`docs/implementation-plan-cv-jobs.md`.

Wykorzystaj istniejące API, bazę, UI, scheduler, Docker Compose
i integrację LLM. Zachowaj pełną zgodność z modułem Business Leads.

Implementuj etapami, zaczynając od pionowego przepływu:
PDF → tekst → profil → korekta → zatwierdzenie → ręcznie
wprowadzona oferta pracy → matching → karta Jobs.

Nie implementuj auto-aplikowania ani niedozwolonego scrapingu.
Nie twórz fikcyjnych źródeł, ofert, kompetencji ani wyników.
Po każdej fazie uruchom testy i sprawdź kryteria odbioru.
```

---

**Uwaga dotycząca nadrzędnego PRD:** starsza wersja głównego PRD może opisywać projekt jako Open Source i używać `systemd` jako sposobu wdrożenia. Aktualne decyzje operatora: **repo prywatne** i **Docker Compose na Raspberry Pi 4B**. Dla tej funkcji te decyzje mają pierwszeństwo; pozostałe zasady głównego PRD pozostają w mocy.
