import type { SourcePreset } from '@lead-hunter/contracts';

/**
 * D-11: ready-made sources. Every URL and terms link here is `UNVERIFIED` until the Phase 3
 * human check; this file is the one place to correct them.
 */
export const PRESETS: readonly SourcePreset[] = [
  {
    id: 'hn-freelance',
    name: 'Hacker News — Seeking freelancer',
    url: 'https://hnrss.org/whoishiring/freelance',
    accessNote:
      'Kanał RSS serwisu hnrss.org (nieoficjalne lustro Hacker News): komentarze z miesięcznego wątku „Freelancer? Seeking freelancer?”. Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt.',
    termsUrl: 'https://github.com/hnrss/hnrss',
  },
  {
    id: 'hn-jobs-contract',
    name: 'Hacker News — Jobs (contract)',
    url: 'https://hnrss.org/jobs?q=contract',
    accessNote:
      'Kanał RSS serwisu hnrss.org: ogłoszenia z działu Jobs zawierające „contract”. Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt.',
    termsUrl: 'https://github.com/hnrss/hnrss',
  },
  ...[
    ['wwr-programming', 'Programming', 'remote-programming-jobs'],
    ['wwr-full-stack', 'Full-Stack', 'remote-full-stack-programming-jobs'],
    ['wwr-back-end', 'Back-End', 'remote-back-end-programming-jobs'],
    ['wwr-devops', 'DevOps', 'remote-devops-sysadmin-jobs'],
  ].map(([id, label, slug]): SourcePreset => ({
    id: id ?? '',
    name: `We Work Remotely — ${label}`,
    url: `https://weworkremotely.com/categories/${slug}.rss`,
    accessNote:
      'Oficjalny kanał RSS kategorii We Work Remotely. Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt.',
    termsUrl: 'https://weworkremotely.com/terms',
  })),
];

export const MANUAL_ACCESS_NOTE =
  'Kanał RSS/Atom dodany ręcznie. Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt; dopilnuj, by regulamin serwisu zezwalał na odczyt kanału.';
