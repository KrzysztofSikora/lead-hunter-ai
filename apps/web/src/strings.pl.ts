export const strings = {
  appName: 'Lead Hunter AI',
  tagline:
    'Zbiera sygnały zapotrzebowania z dozwolonych źródeł, ocenia je według jawnych reguł i przygotowuje szkice ofert do ręcznego wysłania.',
  status: {
    loading: 'Sprawdzam stan serwera…',
    ok: 'Serwer działa · baza danych: OK',
    error: 'Serwer niedostępny lub baza danych zgłasza błąd',
  },
  login: {
    title: 'Zaloguj się',
    passwordLabel: 'Hasło',
    submit: 'Zaloguj',
    submitting: 'Logowanie…',
    invalid: 'Nieprawidłowe hasło.',
    throttled: (minutes: number) => `Za dużo prób. Spróbuj ponownie za ${minutes} min.`,
    notConfigured:
      'Logowanie jest wyłączone: ustaw OPERATOR_PASSWORD_HASH (polecenie pnpm auth:hash) i uruchom serwer ponownie.',
    failed: 'Nie udało się zalogować. Spróbuj ponownie.',
    logout: 'Wyloguj',
  },
} as const;
