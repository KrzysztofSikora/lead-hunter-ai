# Scoring (rubric version 1)

Wynik 0–100 jest liczony **regułami**, nie przez model (PRD §7). Model dostarcza tylko
ustrukturyzowaną analizę (schemat v1); `apps/api/src/modules/scoring/` zamienia ją na punkty.
Te same dane wejściowe i ten sam profil dają zawsze ten sam wynik. Nie ma żadnego
„prawdopodobieństwa zamknięcia”.

Każdy wynik ma rozbicie na pięć składników (suma = wynik, każdy ≤ maksimum) i polskie
uzasadnienie każdego składnika. Pewność (`confidence`) jest zapisywana osobno i nie wchodzi do
sumy.

## Składniki

| Składnik | Maks. | Reguła |
|----------|-------|--------|
| Popyt (`demand`) | 30 | Poziom dowodu, potwierdzony / niepotwierdzony nabywca: `DIRECT_REQUEST` 30 / 22, `PUBLIC_TENDER` 30 / 22 (przetarg: źródło `bzp`/`ted`, nadawany regułą), `EXPLICIT_PROBLEM` 18 / 12, `INDIRECT_SIGNAL` 10 / 6, `SPECULATIVE` 6 / 3 |
| Dopasowanie umiejętności (`skillFit`) | 25 | Liczba różnych umiejętności i preferowanych technologii z profilu, które model wskazał w `relevantSkills` (bez rozróżniania wielkości liter): 0 → 0, 1 → 10, 2 → 16, 3 → 21, ≥ 4 → 25. Wymieniona wykluczona technologia → 0 |
| Szybkość (`speed`) | 20 | Baza kategorii: `DIRECT_GIG` 12, `B2B_SUBCONTRACT` 10, `HARDWARE_IOT` 6, `UNMET_NEED` 4, `PRODUCT_HYPOTHESIS` 2; plus przedział `estimatedHours.max`: ≤ 40 h → 8, ≤ 120 h → 5, ≤ 400 h → 2, powyżej → 0, nieznane → 3 |
| Opłacalność (`profitability`) | 15 | Tylko budżet podany w źródle. Górna granica poniżej minimalnej wartości zlecenia z profilu (ta sama waluta) → 0. Inaczej stawka wynikająca z budżetu i szacowanych godzin w relacji do pierwszej stawki godzinowej z profilu (ta sama waluta): ≥ 100 % → 15, ≥ 75 % → 10, ≥ 50 % → 5, poniżej → 0. Brak budżetu, godzin lub stawki → 5 („brak danych — wartość neutralna”) |
| Powtarzalność (`repeatability`) | 10 | Baza kategorii: `PRODUCT_HYPOTHESIS` 8, `UNMET_NEED` 7, `B2B_SUBCONTRACT` 6, `HARDWARE_IOT` 5, `DIRECT_GIG` 4; +2 dla modelu `SUBSCRIPTION` lub `PRODUCT_SALE`; maksimum 10 |

Cena zaproponowana przez model (`proposedPrice`) to **szacunek (hipoteza)**, zbudowany ze stawek
z profilu. Nie wpływa na opłacalność (ocenianie jej względem tych samych stawek byłoby
kołowe) i w każdym widoku jest oznaczona „szacunek (hipoteza)”. Budżet ze źródła jest pokazywany
osobno, jako cytat „ze źródła”.

## Pewność

Reguły, w kolejności:

1. `LOW` — poziom dowodu `SPECULATIVE` albo co najmniej 5 pozycji w `unknowns`;
2. `HIGH` — poziom `DIRECT_REQUEST`, `PUBLIC_TENDER` lub `EXPLICIT_PROBLEM`, nabywca potwierdzony i najwyżej
   2 pozycje w `unknowns`;
3. `MEDIUM` — pozostałe przypadki.

## Filtr wstępny (D-6)

Zanim sygnał trafi do analizy, przechodzi twarde, wyjaśnialne reguły
(`modules/analysis/prefilter.ts`). Wygrywa pierwsza reguła, która odrzuca; nieznane dane przechodzą.
Odrzucony sygnał dostaje status analizy `SKIPPED`, a w UI powód (nie jest usuwany).

| Kolejność | Reguła | Tekst w UI | Kiedy |
|-----------|--------|------------|-------|
| 1 | `no_text` | brak treści do analizy | pusty tekst |
| 2 | `seeking_work` | oferta wykonawcy, nie zlecenie | tekst zaczyna się od „SEEKING WORK” |
| 3 | `spam` | wygląda na spam | ponad 10 linków albo fraza ze znanej listy |
| 4 | `language` | język spoza profilu | wykryty język (`pl` / `en`) nie jest w profilu; brak wykrycia przepuszcza |
| 5 | `too_old` | zbyt stare | data publikacji starsza niż limit dni; brak daty przepuszcza |
| 6 | `excluded_technology` | wykluczona technologia | tekst zawiera technologię wykluczoną w profilu |
| 7 | `excluded_category` | wykluczona kategoria | tekst zawiera kategorię wykluczoną w profilu |
| 8 | `no_profile_match` | brak dopasowania do profilu | zero dopasowań i źródło inne niż import ręczny |

Liczba dopasowanych terminów z profilu ustala kolejność kolejki analiz.

## Straż wyniku modelu (D-14)

Po walidacji schematu, niezależnie od dostawcy (`modules/analysis/output-guard.ts`), wszystko,
czego źródło nie powiedziało, jest usuwane lub obniżane, a każda zmiana trafia do notatek straży:

- **Fakty „ze źródła”** (`sourceFacts`) zostają tylko wtedy, gdy występują w tekście
  (bez rozróżniania wielkości liter i białych znaków); puste fakty są usuwane.
- **Budżet ze źródła** zostaje tylko wtedy, gdy cytat występuje w tekście **i** zawiera obie kwoty
  (`minMinor`, `maxMinor`), walutę zgodną z budżetem i nie zaczyna się ani nie kończy w środku
  dłuższej liczby w tekście (np. „500 zł” z „1 500 zł”); inaczej jest usuwany, a opłacalność liczy się jako brak danych.
- **Przetarg publiczny** (źródło `bzp` lub `ted`): poziom dowodu jest zawsze `PUBLIC_TENDER`,
  niezależnie od odpowiedzi modelu; budżet ze źródła pochodzi z wartości szacunkowej ogłoszenia
  (brak wartości = brak budżetu), a nabywca jest potwierdzony tylko, gdy pasuje do pola
  „Zamawiający” ogłoszenia. Dla przetargu nie obowiązuje obniżanie poziomu i kategorii z braku
  sygnału zlecenia. `PUBLIC_TENDER` z innego źródła zmienia się na `DIRECT_REQUEST` i podlega
  regule poniżej.
- **Poziom dowodu** `DIRECT_REQUEST` bez sygnału zlecenia lub płatności w tekście spada do
  `EXPLICIT_PROBLEM`.
- **Kategoria** płatna (`DIRECT_GIG`, `B2B_SUBCONTRACT`) bez takiego sygnału zmienia się na
  `UNMET_NEED`.

## Wersje

Rozbicie niesie `version: 1`. Zmiana tabel powyżej podnosi wersję; zapisane wyniki zachowują
wersję, według której powstały.
