# Feature: OSINT Business Intelligence — wykrywanie wczesnych sygnałów biznesowych

**Projekt:** `lead-hunter-ai`  
**Typ:** rozszerzenie funkcjonalne istniejącej aplikacji  
**Status:** propozycja feature do backlogu  
**Zakres dokumentu:** opis biznesowy i oczekiwane zachowanie funkcji (bez architektury i implementacji)

## 1. Cel funkcji

Rozszerzyć `lead-hunter-ai` o analizę publicznie dostępnych informacji (OSINT), aby wykrywać **potencjalne potrzeby biznesowe firm, zanim pojawi się bezpośrednie ogłoszenie o zleceniu**.

Obecne wyszukiwanie okazji opiera się przede wszystkim na identyfikowaniu jawnych potrzeb: ogłoszeń, zapytań, ofert współpracy czy dyskusji o konkretnych problemach. Nowa funkcja ma dodatkowo identyfikować **sygnały pośrednie**, które mogą wskazywać na przyszłe zapotrzebowanie na usługi software, AI, automatyzacji lub IoT.

Funkcja nie ma zastępować istniejącego procesu odkrywania leadów. Dostarcza do niego kolejny rodzaj informacji: hipotezy biznesowe, każdorazowo oparte na weryfikowalnych źródłach.

## 2. Problem biznesowy

Wiele okazji komercyjnych nie pojawia się od razu jako formalne zapytanie o wykonawcę. Potrzeba współpracy może wynikać z kilku publicznych zdarzeń, np.:

- firma pozyskała finansowanie i zapowiada rozwój produktu;
- organizacja rekrutuje jednocześnie na kilka ról technologicznych;
- przedsiębiorstwo ogłasza ekspansję na nowe rynki;
- firma uruchamia nową usługę wymagającą integracji lub automatyzacji;
- publiczne komunikaty wskazują na modernizację procesów lub infrastruktury;
- spółka ogłasza przetarg, zapytanie ofertowe lub program partnerski.

Pojedyncze zdarzenie nie przesądza o istnieniu zlecenia. Połączenie wielu niezależnych sygnałów może jednak uzasadniać dalszy research lub świadome nawiązanie relacji biznesowej.

Bez takiej analizy operator widzi głównie okazje już ogłoszone i konkurencyjne, a może przeoczyć firmy na wcześniejszym etapie formowania potrzeb.

## 3. Odbiorca i wartość

**Główny odbiorca:** operator `lead-hunter-ai` — freelancer, właściciel jednoosobowego studia software/AI/IoT lub małego zespołu usługowego.

**Wartość:**

1. Wcześniejsze wykrywanie organizacji potencjalnie zainteresowanych usługami.
2. Mniej czasu poświęconego na ręczne przeglądanie rozproszonych źródeł.
3. Lepsza selekcja firm dzięki zestawieniu faktów, dopasowania do kompetencji i aktualności zdarzeń.
4. Możliwość przygotowania bardziej trafnego, spersonalizowanego kontekstu rozmowy handlowej.
5. Odróżnienie sygnałów potwierdzonych od spekulacji i marketingowego szumu.

**Oczekiwany rezultat:** niewielka liczba konkretnych, aktualnych i uzasadnionych okazji, przy których wiadomo, co warto sprawdzić lub zrobić dalej — nie masowa baza firm.

## 4. Zakres funkcjonalny

### F-01. Definiowanie obszaru obserwacji

Operator może wskazać, jakie organizacje, branże, rynki, technologie i typy potrzeb biznesowych go interesują. Może obserwować konkretną firmę albo szerzej poszukiwać nowych organizacji spełniających jego kryteria.

Obserwacja uwzględnia istniejący profil kompetencji, preferowane usługi i ograniczenia komercyjne operatora. Zmiana profilu powinna wpływać na ocenę nowych sygnałów, bez konieczności ponownego definiowania całego obszaru obserwacji.

### F-02. Zbieranie publicznych sygnałów

Funkcja identyfikuje informacje z legalnie dostępnych źródeł, takich jak:

- strony firmowe, aktualności i komunikaty prasowe;
- publiczne oferty pracy i strony kariery;
- rejestry firm oraz komunikaty o zmianach organizacyjnych;
- ogłoszenia o przetargach i zapytaniach ofertowych;
- publikacje branżowe i informacje o inwestycjach;
- otwarte repozytoria oraz publiczne komunikaty dotyczące projektów technologicznych;
- inne dopuszczone źródła dotyczące rynku i potrzeb biznesowych.

Użytkownik może też ręcznie dodać link lub informację do przeanalizowania.

Nie każde odnalezione źródło musi stać się leadem. Dane mogą służyć wyłącznie do uzupełnienia kontekstu już obserwowanej organizacji.

### F-03. Rozpoznawanie organizacji i łączenie informacji

System przypisuje informacje do właściwych podmiotów i grupuje powtarzające się lub powiązane zdarzenia. Powinien odróżniać organizacje o podobnych nazwach i sygnalizować niejednoznaczności zamiast arbitralnie łączyć rekordy.

Zdarzenia dotyczące tej samej firmy tworzą kontekst: historię sygnałów, ich chronologię i wzajemne powiązania.

### F-04. Wykrywanie typów sygnałów biznesowych

System rozpoznaje co najmniej następujące kategorie:

| Kategoria | Przykładowy sygnał | Możliwa interpretacja biznesowa |
| --- | --- | --- |
| Bezpośrednia potrzeba | Publiczne zapytanie o wykonawcę systemu | Potencjalne zlecenie wymagające sprawdzenia warunków |
| Rozwój zespołu | Nowe rekrutacje React/Node.js | Możliwy wzrost inwestycji w software |
| Finansowanie i ekspansja | Informacja o finansowaniu lub nowym rynku | Potencjalny budżet lub zapotrzebowanie na skalowanie |
| Rozwój produktu | Zapowiedź nowej platformy lub funkcji | Możliwa potrzeba rozwoju, integracji lub automatyzacji |
| Zmiana technologiczna | Publiczna zapowiedź migracji lub wdrożenia | Potencjalne prace specjalistyczne |
| Partnerstwa i zakupy | Program partnerski lub przetarg | Potencjalna ścieżka współpracy B2B |

Wykryta kategoria opisuje **sygnał**, a nie dowód, że firma poszukuje podwykonawcy.

### F-05. Korelacja i ocena wiarygodności

System łączy informacje z różnych dat i źródeł, identyfikuje zgodne oraz sprzeczne doniesienia i odróżnia:

- **fakt potwierdzony** — informację bezpośrednio wspartą źródłem;
- **wniosek analityczny** — interpretację kilku faktów;
- **hipotezę** — możliwość wymagającą dalszej weryfikacji;
- **informację niezweryfikowaną** — sygnał bez wystarczających dowodów.

Wynik powinien wskazywać, na czym oparto ocenę. Liczba wzmianek nie oznacza automatycznie wielu niezależnych potwierdzeń: kilka portali może powielać ten sam komunikat.

### F-06. Dopasowanie do profilu operatora

Wykryte sygnały są oceniane pod kątem przydatności komercyjnej: dopasowania technologicznego, rodzaju usług, rynku, aktualności, ewentualnych ograniczeń i prawdopodobnej możliwości podjęcia działania.

System zachowuje spójność z istniejącym scoringiem okazji `lead-hunter-ai` (0–100), ale **oddziela dopasowanie biznesowe od pewności informacji**. Wysoka ocena dopasowania nie może zostać przedstawiona jako wysokie prawdopodobieństwo podpisania kontraktu.

### F-07. Karta sygnału OSINT

Każdy istotny sygnał ma czytelną kartę prezentującą:

1. Nazwę organizacji i krótki opis jej działalności.
2. Wykryte zdarzenie oraz kategorię sygnału.
3. Datę zdarzenia, datę publikacji (jeśli dostępna) i datę wykrycia.
4. Źródła oraz wskazanie informacji, które je potwierdzają.
5. Ocenę wiarygodności i ewentualne niepewności.
6. Dopasowanie do profilu operatora i uzasadnienie.
7. Hipotezę dotyczącą możliwej potrzeby biznesowej.
8. Proponowane następne kroki do ręcznej decyzji.
9. Status obsługi i historię zmian.

Karta nie powinna przedstawiać przypuszczeń jako zweryfikowanych potrzeb zakupowych.

### F-08. Monitoring zmian i powiadomienia

Operator może obserwować firmy lub tematy w czasie. System informuje o nowych, znaczących zdarzeniach, a nie o każdym powtórzeniu tej samej wiadomości.

Przykłady:

- nowy sygnał w obserwowanej firmie;
- drugi niezależny fakt potwierdzający wcześniejszą hipotezę;
- znaczący wzrost dopasowania do profilu operatora;
- informacja podważająca wcześniej uznany sygnał;
- przeterminowanie lub utrata aktualności okazji.

### F-09. Przekształcenie sygnału w okazję

Operator może przenieść interesujący sygnał do istniejącego procesu obsługi okazji w `lead-hunter-ai`.

Przeniesiona okazja zachowuje kontekst firmy, źródła, historię i uzasadnienie. Dalej podlega standardowemu workflow: ocenie, decyzji operatora, ewentualnemu przygotowaniu szkicu oferty i ręcznemu kontaktowi.

**Brak automatycznego kontaktowania się z firmami, wysyłania ofert lub aplikowania na ogłoszenia.**

### F-10. Informacja zwrotna i jakość wyników

Operator może oznaczać sygnały jako wartościowe, nieistotne, błędne, nieaktualne lub wymagające obserwacji. Może też podać powód odrzucenia.

Informacja zwrotna powinna pomagać w poprawie przyszłych rekomendacji oraz ograniczaniu powtarzających się fałszywych alarmów.

## 5. Scenariusze użytkownika

### Scenariusz A — wczesne wykrycie potencjalnego klienta

1. Operator określa zainteresowanie projektami Node.js/React i automatyzacją AI.
2. System znajduje wiadomość o finansowaniu rozwoju produktu w firmie technologicznej.
3. W kolejnych źródłach identyfikuje rekrutacje backendowe i zapowiedź nowego modułu produktu.
4. Łączy zdarzenia w jedną historię firmy.
5. Tworzy sygnał z interpretacją: firma może rozbudowywać kompetencje software.
6. Operator sprawdza dowody i decyduje, czy dalej badać firmę lub przygotować propozycję kontaktu.

### Scenariusz B — monitoring obserwowanej firmy

1. Operator dodaje firmę do obserwacji.
2. Przez pewien czas nie pojawiają się istotne zmiany.
3. System wykrywa nowy publiczny przetarg związany z oprogramowaniem.
4. Powiadomienie wskazuje konkretną zmianę, źródło i termin, jeżeli ten został podany.
5. Operator podejmuje decyzję o dalszym działaniu.

### Scenariusz C — odrzucenie fałszywego sygnału

1. System wiąże nowy artykuł z obserwowaną firmą.
2. Operator zauważa, że tekst dotyczy innego podmiotu o podobnej nazwie.
3. Odrzuca sygnał, podając powód.
4. Błędny rekord nie powinien wpływać na ranking właściwej firmy ani powracać jako nowe odkrycie bez nowych dowodów.

## 6. Integracja z dotychczasowym działaniem `lead-hunter-ai`

Funkcja OSINT jest dodatkowym źródłem kandydatów i kontekstu, a nie osobną aplikacją.

| Istniejący element | Zmiana z perspektywy użytkownika |
| --- | --- |
| Profil kompetencji i celów | Służy również do oceniania sygnałów OSINT |
| Lista okazji i ranking | Może zawierać kandydatów pochodzących z analizy OSINT, wyraźnie oznaczonych jako hipotezy |
| Karta okazji | Pokazuje dodatkowe dowody, chronologię i ocenę wiarygodności |
| Dzienny brief | Zawiera najważniejsze nowe lub zmienione sygnały biznesowe |
| Przygotowanie oferty | Wykorzystuje zweryfikowany kontekst, ale pozostaje pod kontrolą operatora |
| Statusy i śledzenie wyniku | Obsługują także okazje utworzone na podstawie OSINT |

Funkcja jest komplementarna wobec planowanej analizy CV i agregowania ofert pracy. **Oferty zatrudnienia** mogą być zarówno samodzielnymi pozycjami dopasowywanymi do profilu, jak i **sygnałami rozwoju firmy** w analizie OSINT; te zastosowania powinny pozostać rozróżnione.

## 7. Reguły jakości i bezpieczeństwa biznesowego

- Każde istotne twierdzenie musi mieć identyfikowalne źródło lub być jasno oznaczone jako wniosek.
- System odróżnia datę publikacji od daty pozyskania informacji.
- Informacje starsze, podważone lub nieaktualne są odpowiednio oznaczane.
- Duplikaty i przedruki nie powinny sztucznie zwiększać wiarygodności.
- Dopasowanie do kompetencji nie oznacza potwierdzonego zamiaru zakupu usług.
- Nie należy tworzyć fikcyjnych kontaktów, budżetów, stanowisk ani informacji o kontraktach.
- Źródła muszą być wykorzystywane zgodnie z prawem, zasadami dostępu i warunkami ich użycia.
- Dane osobowe są ograniczone do tego, co uzasadnione celem i zgodne z właściwymi zasadami ochrony danych; funkcja koncentruje się na organizacjach i ich publicznych działaniach.
- Ostateczna ocena i decyzja o kontakcie należą do operatora.

## 8. Poza zakresem tej funkcji

- Ogólny system prowadzenia śledztw dotyczących dowolnych osób.
- Monitoring prywatnego życia, profilowanie wrażliwych danych osobowych lub ustalanie prywatnych kontaktów.
- Aktywne testy bezpieczeństwa lub skanowanie cudzej infrastruktury bez uprawnień.
- GEOINT/UAV, analiza satelitarna i monitoring zdarzeń terenowych niezwiązanych z pozyskiwaniem leadów.
- Masowe wysyłanie wiadomości, automatyczne składanie ofert i autonomiczne negocjacje.
- Deklarowanie pewności uzyskania zlecenia na podstawie sygnałów pośrednich.
- Budowa niezależnego, uniwersalnego produktu OSINT poza `lead-hunter-ai`.

## 9. Kryteria akceptacji biznesowej

Feature można uznać za spełniający oczekiwania, gdy:

1. Operator potrafi określić, jakie firmy, obszary i typy sygnałów chce obserwować.
2. System wykrywa zarówno sygnały bezpośrednie, jak i pośrednie oraz odróżnia te klasy.
3. Każdy prezentowany sygnał ma czytelne uzasadnienie i dostępne źródła.
4. Powtarzające się wiadomości o tym samym zdarzeniu są grupowane.
5. System pokazuje, dlaczego informacja pasuje lub nie pasuje do profilu operatora.
6. Wiarygodność informacji jest prezentowana osobno od dopasowania biznesowego.
7. Operator może zweryfikować, odrzucić, zachować do obserwacji lub przekształcić sygnał w okazję.
8. Nowe istotne zmiany mogą pojawić się w dotychczasowym briefie i powiadomieniach.
9. Sygnały nie prowadzą do automatycznego kontaktowania się z firmami.
10. System rozróżnia fakt, hipotezę i brak danych — również w przypadku analiz generowanych przez AI.

## 10. Miary wartości

Po uruchomieniu feature warto mierzyć:

- **Trafność sygnałów:** jaki odsetek nowych rekomendacji operator uznaje za przydatne.
- **Konwersję sygnał → okazja:** ile wykrytych zdarzeń prowadzi do utworzenia rzeczywistej okazji w `lead-hunter-ai`.
- **Konwersję okazja → rozmowa/kontrakt:** czy sygnały OSINT dostarczają jakościowych wyników biznesowych.
- **Świeżość sygnałów:** czas między publicznym zdarzeniem a jego przedstawieniem operatorowi.
- **Redukcję szumu:** odsetek duplikatów i odrzuconych hipotez.
- **Użyteczność briefu:** czy operator może na jego podstawie podjąć konkretną decyzję bez czasochłonnego researchu od zera.

Miary należy porównywać z istniejącym sposobem pozyskiwania okazji, bez zakładania z góry wzrostu konwersji.

## 11. Podsumowanie

**OSINT Business Intelligence** zmienia `lead-hunter-ai` z narzędzia reagującego głównie na opublikowane potrzeby w system, który dodatkowo **rozpoznaje wczesne sygnały potencjalnego popytu**.

Najważniejszą funkcją nie jest samo gromadzenie danych, lecz przedstawienie operatorowi **małej liczby sensownych hipotez popartych dowodami**, dopasowanych do jego kompetencji i możliwych do wykorzystania w obecnym procesie pozyskiwania klientów.
