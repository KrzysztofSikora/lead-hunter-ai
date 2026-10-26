# Polityka źródeł

Lista adapterów źródeł: sposób dostępu, regulamin, limity i to, co zapisujemy (FR-26 AC2).
Źródła czytamy tylko przez dostęp oficjalny lub dozwolony; nie omijamy CAPTCHA ani limitów.
Treść ze źródła jest daną, nigdy instrukcją. Pozycje oznaczone `DO WERYFIKACJI` czekają na
ręczną kontrolę (patrz `context/changes/rss-sources/plan.md`, *Human checks*).

## Wspólne reguły adapterów RSS/Atom

| Reguła | Wartość |
|--------|---------|
| Dostęp | `GET` kanału RSS 2.0 lub Atom przez chroniony klient HTTP (ochrona SSRF, tylko http/https, przekierowania sprawdzane na każdym kroku) |
| robots.txt | sprawdzany przed pobraniem kanału, wynik w pamięci 24 h; zakaz lub niedostępny plik = błąd źródła `robots_disallowed` / `robots_unavailable` |
| Odstęp | co najmniej `SOURCE_MIN_INTERVAL_MINUTES` (domyślnie 60, zakres 60–1440) między przebiegami jednego źródła, także ręcznymi; **Sprawdź** czeka 60 s od ostatniej próby |
| Ponowienia | tylko `429` i `503`, do `SOURCE_MAX_ATTEMPTS` zapytań (domyślnie 3) z opóźnieniem wykładniczym; `Retry-After` powyżej 30 s kończy próbę od razu. Następna próba nie wcześniej niż `max(Retry-After, odstęp)`, najwyżej 7 dni |
| Limity | czas jednego zapytania `FETCH_TIMEOUT_MS` (20 s), rozmiar odpowiedzi `FETCH_MAX_BYTES` (1 MiB), co najwyżej 200 wpisów na kanał, dwa zapytania równolegle |
| Kodowanie | treść XML czytana jako UTF-8, niezależnie od deklaracji w nagłówku XML |
| Zapisujemy | źródło, adres wpisu, tytuł, skrócony tekst (do `IMPORT_MAX_TEXT_CHARS`), datę publikacji lub brak, czas pobrania, skrót treści. Nie zapisujemy autora ani danych kanału |
| Błąd | zawsze jawny (powód i kod HTTP na źródle i w przebiegu), nigdy „brak wyników"; wcześniejsze sygnały zostają |
| Logi | id źródła, host, powód i liczniki; nigdy treść wpisów |

## Adaptery

### Import ręczny (tekst lub adres URL)
- **Dostęp:** operator wkleja tekst i/lub adres. Pobranie strony (`manual_fetch`) tylko na jego
  polecenie, jednorazowo, tym samym klientem i z kontrolą robots.txt.
- **Regulamin:** odpowiedzialność operatora za treść, którą wkleja.
- **Limity:** `IMPORT_MAX_TEXT_CHARS`, `FETCH_TIMEOUT_MS`, `FETCH_MAX_BYTES`.

### RSS: Hacker News przez hnrss.org (`hn-freelance`; `hn-jobs-contract` wycofany)
- **Dostęp:** kanały `https://hnrss.org/whoishiring/freelance` (miesięczny wątek „Freelancer?
  Seeking freelancer?") i `https://hnrss.org/jobs?q=contract`. hnrss.org to nieoficjalne lustro
  Hacker News, nie sam serwis. `DO WERYFIKACJI`: adresy i format wpisów.
- **Regulamin:** projekt <https://github.com/hnrss/hnrss> (opis kanałów i zasad użycia).
  `DO WERYFIKACJI` przez operatora względem aktualnej strony.
- **Wycofany:** `hn-jobs-contract` (`https://hnrss.org/jobs?q=contract`) to ogłoszenia o pracę, nie
  zapytania o zlecenie; nie jest już oferowany (wycofany, shape D-15). Istniejące źródło działa
  dalej i ma w widoku znacznik „preset wycofany".
- **Limity:** wspólne reguły wyżej. Tytuł wpisu „New comment by …" zastępujemy pierwszą linią
  komentarza (D-12); komentarze typu „SEEKING WORK" odrzuca domyślny filtr źródła `hn-freelance`, a starsze źródła
  te komentarze nadal łapie filtr wstępny (FR-07).

### RSS: We Work Remotely (`wwr-programming`, `wwr-full-stack`, `wwr-back-end`, `wwr-devops`) — wycofany (shape D-15)
- **Dostęp:** oficjalne kanały kategorii pod `https://weworkremotely.com/categories/<kategoria>.rss`.
  `DO WERYFIKACJI`: nazwy kategorii i odpowiedź 200.
- **Regulamin:** <https://weworkremotely.com/terms>. `DO WERYFIKACJI` przez operatora.
- **Wycofany:** kanały to ogłoszenia o pracę, nie zapytania o zlecenie (wycofany, shape D-15);
  nie są już oferowane. Istniejące źródła działają dalej ze znacznikiem „preset wycofany".
- **Limity:** wspólne reguły wyżej. Wpis linkuje do ogłoszenia na We Work Remotely.

### RSS: Freelancer.com (`freelancer-nodejs`, `freelancer-react`, `freelancer-typescript`, `freelancer-arduino`, `freelancer-raspberry-pi`, `freelancer-iot`, `freelancer-3d-printing`, `freelancer-pcb-layout`, `freelancer-ai-automation`)
- **Dostęp:** kanał projektów `https://www.freelancer.com/rss.xml?keyword=<fraza>`, jeden na
  umiejętność. `DO WERYFIKACJI`: adres, parametr `keyword` (jeśli jest ignorowany, wszystkie
  źródła zwrócą ten sam kanał), format wpisów i robots.txt. Zakaz w robots.txt kończy się jawnym
  błędem `robots_disallowed`.
- **Regulamin:** <https://www.freelancer.com/about/terms>. `DO WERYFIKACJI` przez operatora, czy
  regulamin dopuszcza automatyczny odczyt kanału.
- **Limity:** wspólne reguły wyżej. Wpis linkuje do projektu na Freelancer.com; budżet zostaje
  tekstem źródła. Filtr źródła domyślnie wyłączony.

### RSS: Arduino Forum, „Jobs and Paid Consultancy" (`arduino-jobs`)
- **Dostęp:** kategoria Discourse jako kanał `https://forum.arduino.cc/c/community/jobs/42.rss`.
  `DO WERYFIKACJI`: adres kategorii, kanał `.rss` i robots.txt.
- **Regulamin:** <https://www.arduino.cc/en/terms-conditions>. `DO WERYFIKACJI` przez operatora.
- **Limity:** wspólne reguły wyżej. Domyślny filtr źródła odrzuca wpisy zawierające `[FOR HIRE]`
  lub `looking for work`.

### RSS: kanał dodany ręcznie
- **Dostęp:** dowolny adres RSS/Atom podany przez operatora, te same reguły.
- **Regulamin:** operator sprawdza, czy serwis zezwala na odczyt kanału; aplikacja tego nie
  weryfikuje.

### API: e-Zamówienia, Biuletyn Zamówień Publicznych (`bzp-it`)
- **Dostęp:** publiczne API `GET https://ezamowienia.gov.pl/mo-board/api/v1/notice`; odczyt
  ogłoszeń krajowych jest publiczny i bezpłatny, bez klucza i zgłoszenia integracji
  (<https://ezamowienia.gov.pl/pl/integracja/>). Pytamy tylko o ogłoszenia o zamówieniu
  (`ContractNotice`), plasterkami po jednej dobie UTC, a prefiksy CPV z konfiguracji źródła
  (domyślnie 72, 48, 73; edytor w widoku Źródła) dopasowujemy po stronie klienta.
- **Regulamin:** Zarządzenie nr 1/2023 z załącznikami
  (<https://media.ezamowienia.gov.pl/pod/2023/02/Regulamin-korzystania-z-API-1.pdf>) i regulamin
  platformy (<https://ezamowienia.gov.pl/pl/regulamin/>). `DO WERYFIKACJI` przez operatora:
  aktualne brzmienie obu dokumentów; licencja na treść ogłoszeń (nie znaleziono wyraźnej, podstawą
  jest ustawa o otwartych danych i ponownym wykorzystywaniu informacji sektora publicznego).
- **Limity:** gwarantowane 30 zapytań na minutę na adres IP; po przekroczeniu API odpowiada
  `403`, nie `429`. Odstęp między zapytaniami adaptera to co najmniej 2 100 ms (także przy
  **Sprawdź**), czyli najwyżej 28 zapytań na minutę; `403` kończy przebieg jako `rate_limited`
  (z kodem HTTP 403) i kolejna próba czeka co najmniej odstęp źródła, `429`/`503` mają wspólne
  ponowienia. Strona ma 100 ogłoszeń (maksimum spada z 500 na 100 od 2027-01-11), najwyżej 10
  stron na przebieg; ucięty przebieg jest `partial`, a kolejny wznawia od pierwszej
  niedokończonej doby, więc ogłoszenia nie przepadają po cichu.
- **robots.txt:** nie sprawdzamy (D-12 zmiany `public-tenders`). Dostęp idzie przez udokumentowane
  API, które wydawca udostępnia do odczytu maszynowego; jego warunki są w regulaminie powyżej.
  Dla kanałów RSS zasada się nie zmienia.
- **Zapisujemy:** adres strony ogłoszenia, tytuł, opis (ogłoszenie bez znaczników, do 200 000
  znaków wejścia), datę publikacji i termin składania ofert, nazwę zamawiającego, kody CPV,
  szacunkową wartość tylko gdy odczyta ją wąski wzorzec (inaczej „nieznana", nigdy zgadywana),
  skrót treści. Nie zapisujemy danych osób kontaktowych ani adresów e-mail. Fixture
  `test/fixtures/tenders/bzp-page.json` jest syntetyczny i oznaczony `DEMO`.
- **Pokrycie z TED:** to samo postępowanie może być w BZP i w TED pod różnymi adresami i
  tekstami. Pierwsze źródło, które je zapisze, jest właścicielem okazji; drugie wchodzi jako
  dowód `REPEAT_IMPORT`, gdy zgadza się adres lub skrót treści, a w przeciwnym razie zostaje
  osobną okazją (brak dopasowania po numerze czy nazwie, by nie zlać różnych części). Ogłoszenia
  poniżej progów unijnych są tylko w BZP, powyżej tylko w TED, więc nakładanie jest rzadkie.
- **Import ręczny przed przebiegiem:** gdy operator wklei adres ogłoszenia, zanim źródło je
  pobierze, okazja zostaje ręczna: bez poziomu `PUBLIC_TENDER` i bez terminu z ogłoszenia, a
  ogłoszenie z API wchodzi jako dowód `REPEAT_IMPORT`. Pierwsze źródło decyduje.
- **`DO WERYFIKACJI` (pierwszy przebieg na żywo):** nazwy parametrów (`NoticeType`,
  `PublicationDateFrom/To`, `PageSize`, `PageNumber`), kształt odpowiedzi i pisownia `noticeType`,
  czy `htmlBody` jest wypełnione i czy jest w nim wartość, adres publicznej strony ogłoszenia
  (`mo-client-board/bzp/notice-details/id/<objectId>`), odczyt terminu bez strefy jako czasu
  Europe/Warsaw, rozmiar strony w bajtach, brak `403`/`429`.

### API: TED, Tenders Electronic Daily (`ted-pl-it`)
- **Dostęp:** Search API v3 `POST https://api.ted.europa.eu/v3/notices/search`, anonimowo, bez
  klucza (<https://docs.ted.europa.eu/api/latest/search.html>). Zapytanie: ogłoszenia
  otwierające postępowanie (`cn-standard`, `cn-social`, `cn-desg`, `subco`, `pin-cfc-standard`,
  `pin-cfc-social`; bez `qu-sy`, to nie wezwanie do składania ofert), kraj zamawiającego
  (`buyer-country`, kody alfa-3 z tabeli UE i EOG; domyślnie `PL`) i prefiksy CPV z
  konfiguracji źródła (domyślnie 72, 48, 73), plasterkami po jednej dobie UTC.
- **Regulamin:** Decyzja Komisji 2011/833/UE; ogłoszenia można swobodnie ponownie wykorzystywać,
  także komercyjnie (<https://ted.europa.eu/en/legal-notice>). `DO WERYFIKACJI` przez operatora:
  aktualne brzmienie noty prawnej.
- **Limity:** zasada uczciwego użycia 700 zapytań na minutę na adres IP
  (<https://ted.europa.eu/en/news/fair-usage-policy-on-ted>); `DO WERYFIKACJI`, czy dotyczy też
  API. Adapter zachowuje odstęp 2 000 ms, strona ma 100 ogłoszeń, najwyżej 5 stron na przebieg;
  pełna strona bez tokenu kolejnej jest przebiegiem ściętym (`partial`), nigdy kompletnym.
  `403` to `http_status` (bez ponowienia), `429`/`503` ponawiamy jak w BZP. Zapytanie to
  `POST`, więc idzie przez ten sam chroniony klient HTTP (ochrona SSRF, bez przekierowań).
- **robots.txt:** nie sprawdzamy, z tego samego powodu co w BZP.
- **Zapisujemy:** adres strony ogłoszenia na `ted.europa.eu` (inny adres z odpowiedzi jest
  ignorowany), tytuł, opis, datę publikacji i termin składania ofert, zamawiającego, kody CPV,
  wartość szacunkową z pola postępowania lub z jednej części (kilka części bez wartości
  postępowania daje „nieznana", nie sumę), kod typu ogłoszenia. Brak pola wartości w odpowiedzi
  to „nie podano ze źródła". Fixture `test/fixtures/tenders/ted-page.json` jest syntetyczny.
- **Pokrycie z BZP i import ręczny:** jak w BZP powyżej.
- **`DO WERYFIKACJI` (pierwszy przebieg na żywo):** nazwy pól (`TED_FIELDS` w
  `ted/map-notice.ts`), filtr `buyer-country` w alfa-3 i składnia dat w `ted/query.ts`, formy
  daty i godziny (`2026-11-24+01:00` z osobnym polem czasu), obiekty wielojęzyczne, pola
  wartości, kształt odnośnika HTML, liczba zapytań na przebieg i rozmiar strony.

### API: GitHub, wyszukiwanie zgłoszeń z nagrodą (`github-bounties`)
- **Dostęp:** oficjalne API `GET https://api.github.com/search/issues`, odczyt publiczny. Zapytanie
  to zawsze `is:issue is:open archived:false`, etykiety z konfiguracji źródła (domyślnie `bounty`,
  `paid`, `💎 Bounty`) i, osobno dla każdego języka z konfiguracji (domyślnie z profilu, najwyżej
  5), `language:"X"`; strona 1, 30 wyników, `sort=updated`. Edytor w widoku Źródła zmienia
  etykiety i języki; nie ma wolnego zapytania.
- **Regulamin:** Warunki korzystania z GitHub i zasady API
  (<https://docs.github.com/en/site-policy/github-terms/github-terms-of-service>).
  `DO WERYFIKACJI` przez operatora: aktualne brzmienie warunków dla automatycznego odczytu
  publicznych zgłoszeń.
- **Limity:** wyszukiwanie to 10 zapytań na minutę bez tokenu i 30 z tokenem. Odstęp między
  zapytaniami to 6 100 ms bez tokenu i 2 100 ms z tokenem. Wyczerpany limit podstawowy lub
  wtórny kończy przebieg jako `rate_limited` (kolejna próba czeka do czasu z nagłówków, nie
  dłużej niż godzinę), nigdy jako „brak wyników". Jeśli pierwsze zapytania się udały, a późniejsze
  nie, przebieg jest `partial`. Każdy przebieg widzi tylko 30 ostatnio zmienianych zgłoszeń na
  język; starsze zgłoszenie bez zmian nie jest osiągane.
- **Token:** `GITHUB_TOKEN` w `.env` jest opcjonalny. Używaj tokenu tylko do odczytu danych
  publicznych (bez uprawnień do repozytoriów prywatnych). Token wysyłamy wyłącznie do
  `https://api.github.com`, nie do Opire ani na inny adres, i nie zapisujemy go w logach,
  odpowiedziach API ani bazie. Bez tokenu adapter działa anonimowo.
- **robots.txt:** nie sprawdzamy (D-13 zmiany `code-bounties`). Dostęp idzie przez udokumentowane
  API; `api.github.com/robots.txt` zabrania indeksowania całej domeny, co zablokowałoby to API.
- **Zapisujemy:** adres zgłoszenia, tytuł, etykiety, repozytorium (`owner/repo`), treść zgłoszenia
  (do limitu importu), skrót treści i, osobno jako fakt, nagrodę, jeśli zgłoszenie ją podaje
  (etykieta, tytuł lub wiersz o nagrodzie w treści; jedna kwota, bez stawek i przedziałów;
  inaczej „nieznana", nigdy zgadywana). Daty publikacji nie zapisujemy, data utworzenia jest
  tylko wierszem tekstu. Nie czytamy komentarzy, więc kwota podana tylko przez bota (np. Algora)
  zostaje nieznana. Zgłoszenie jest `DIRECT_REQUEST` tylko przy podanej kwocie albo jawnym
  zwrocie o płatnej pracy w tytule lub treści; sama etykieta nie wystarcza. Fixture
  `test/fixtures/bounties/github-*.json` są syntetyczne, oznaczone `DEMO` i `UNVERIFIED`.
- **Nakładanie z Opire:** to samo zgłoszenie ma ten sam adres i klucz w obu źródłach. Pierwsze
  źródło, które je zapisze, jest właścicielem okazji i jej nagrody (D-12); drugie wchodzi jako
  dowód `REPEAT_IMPORT` i nie nadpisuje kwoty.
- **`DO WERYFIKACJI` (pierwszy przebieg na żywo):** czy dodanie etykiety zmienia `updated_at`
  (`sort=updated`), nagłówki limitu wtórnego (`retry-after`), rozmiar odpowiedzi, brak `403`
  bez tokenu i z tokenem.

### API: Opire, nagrody za zgłoszenia (`opire-rewards`)
- **Dostęp:** publiczne API `GET https://api.opire.dev/rewards`, bez klucza. Adres i kształt
  odpowiedzi pochodzą z opisów osób trzecich, nie z dokumentacji (`UNVERIFIED`). Odczyt
  odpowiedzi jest w jednym pliku (`opire/map-reward.ts`); zmiana kształtu daje `invalid_feed`,
  nie „brak wyników".
- **Regulamin:** <https://opire.dev>. `DO WERYFIKACJI` przez operatora: czy regulamin pozwala na
  automatyczny odczyt publicznego API. Jeśli nie, preset wycofujemy mechanizmem
  `WITHDRAWN_PRESETS`.
- **Limity:** nie znamy limitów Opire (`DO WERYFIKACJI`); jedno zapytanie na przebieg. Stan
  zgłoszenia sprawdzamy w API GitHub (nie w Opire): do 20 zapytań o zgłoszenie na przebieg, w
  tych samych odstępach i z tym samym tokenem co wyżej (limit rdzenia 60 na godzinę bez tokenu).
  Powyżej 20 przebieg jest `partial`. Zamknięte lub nieistniejące zgłoszenia są pomijane,
  zapisywane w logu i zapamiętywane w kursorze, więc nie są sprawdzane ponownie; nie liczą się
  jako błąd.
- **Token:** do Opire nie wysyłamy tokenu GitHub.
- **robots.txt:** nie sprawdzamy, z tego samego powodu co dla GitHub.
- **Zapisujemy:** adres zgłoszenia na GitHub (nie strony Opire), treść zgłoszenia z API GitHub,
  repozytorium i nagrodę jako fakt, tylko gdy Opire podaje ją w centach USD (`USD_CENT`); inna
  jednostka to „nieznana". Fixture `test/fixtures/bounties/opire-rewards.json` jest syntetyczny.
- **Nakładanie z GitHub:** jak wyżej.
- **`DO WERYFIKACJI` (pierwszy przebieg na żywo):** adres, koperta odpowiedzi, nazwy pól i
  jednostka kwoty, liczba otwartych, zamkniętych i pominiętych nagród, regulamin.

### Baza Konkurencyjności (tylko import ręczny)
- **Dostęp:** brak udokumentowanego publicznego API w serwisie ani w regulaminie
  (<https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/>). Nie ma adaptera: operator wkleja
  adres lub tekst zapytania ofertowego przez import ręczny (zasady jak wyżej).
- **Regulamin:** `DO WERYFIKACJI` przez operatora; aplikacja niczego stamtąd nie pobiera sama.

## Filtr źródła

Każde źródło ma filtr: frazy do odrzucenia (`exclude`), frazy wymagane (`include`) i przełącznik.
- **Dopasowanie:** bez rozróżniania wielkości liter i krotności spacji (NFKC), podciąg w tytule
  i fragmencie tekstu; polskie znaki zostają. Najpierw `exclude` (pierwsza pasująca fraza w
  kolejności z konfiguracji), potem `include` (niepusta lista bez trafienia = „brak frazy").
  Włączony filtr z pustymi listami przepuszcza wszystko.
- **Kiedy:** przy przebiegu źródła, tylko dla nowego wpisu. Duplikat (także ręcznie zaimportowany)
  nie jest odrzucany ponownie, a zmiana filtru nie dotyka zapisanych sygnałów. Wpis wspólny dla
  kilku źródeł (np. ten sam projekt w kilku kanałach Freelancer.com) rozstrzyga źródło, które
  zobaczy go pierwsze: jego filtr może ukryć wpis, który inne źródło by przepuściło.
- **Skutek:** wpis jest zapisany jako `REJECTED` z powodem „filtr źródła: <fraza>" lub „filtr
  źródła: brak frazy", nie trafia do filtra wstępnego ani do LLM i nie wraca do kolejki. Liczba
  takich wpisów jest w wyniku przebiegu, historii przebiegów i w `pnpm discover`.
- **Wyłączenie** filtru zachowuje frazy; wpisy trafiają wtedy do analizy jak zwykle.
