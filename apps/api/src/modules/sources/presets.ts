import type { SourceFilter, SourcePreset } from '@lead-hunter/contracts';

/**
 * S-17: ready-made sources that bring requests for work, not job ads. Every URL and terms link
 * here is `UNVERIFIED` until the Phase 3 human check; this file is the one place to correct them
 * (D-9, D-11).
 */

const POLL_NOTE = 'Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt.';
const off = (): SourceFilter => ({ enabled: false, include: [], exclude: [] });

/** D-9: Freelancer.com project feed per skill. */
const FREELANCER_SKILLS: readonly [slug: string, label: string, keyword: string][] = [
  ['nodejs', 'Node.js', 'nodejs'],
  ['react', 'React', 'react'],
  ['typescript', 'TypeScript', 'typescript'],
  ['arduino', 'Arduino', 'arduino'],
  ['raspberry-pi', 'Raspberry Pi', 'raspberry pi'],
  ['iot', 'IoT', 'iot'],
  ['3d-printing', 'druk 3D', '3d printing'],
  ['pcb-layout', 'projekt PCB', 'pcb layout'],
  ['ai-automation', 'AI i automatyzacja', 'ai automation'],
];

export const PRESETS: readonly SourcePreset[] = [
  {
    id: 'hn-freelance',
    name: 'Hacker News — Seeking freelancer',
    url: 'https://hnrss.org/whoishiring/freelance',
    accessNote: `Kanał RSS serwisu hnrss.org (nieoficjalne lustro Hacker News): komentarze z miesięcznego wątku „Freelancer? Seeking freelancer?”. ${POLL_NOTE}`,
    termsUrl: 'https://github.com/hnrss/hnrss',
    filter: { enabled: true, include: ['SEEKING FREELANCER'], exclude: [] },
  },
  ...FREELANCER_SKILLS.map(([slug, label, keyword]): SourcePreset => ({
    id: `freelancer-${slug}`,
    name: `Freelancer.com — ${label}`,
    url: `https://www.freelancer.com/rss.xml?keyword=${encodeURIComponent(keyword)}`,
    accessNote: `Kanał RSS projektów Freelancer.com dla słowa kluczowego „${keyword}”: zlecenia, nie oferty pracy. ${POLL_NOTE} Adres i regulamin do weryfikacji.`,
    termsUrl: 'https://www.freelancer.com/about/terms',
    filter: off(),
  })),
  {
    id: 'arduino-jobs',
    name: 'Arduino Forum — Jobs and Paid Consultancy',
    url: 'https://forum.arduino.cc/c/community/jobs/42.rss',
    accessNote: `Kanał RSS kategorii „Jobs and Paid Consultancy” forum Arduino (Discourse): wątki ze zleceniami. ${POLL_NOTE} Adres i regulamin do weryfikacji.`,
    termsUrl: 'https://www.arduino.cc/en/terms-conditions',
    filter: { enabled: true, include: [], exclude: ['[FOR HIRE]', 'looking for work'] },
  },
];

/**
 * D-7: no longer offered (job ads, not requests for work). A source created from one earlier keeps
 * working and keeps its access note and terms link (FR-04 AC7).
 */
export const WITHDRAWN_PRESETS: readonly SourcePreset[] = [
  {
    id: 'hn-jobs-contract',
    name: 'Hacker News — Jobs (contract)',
    url: 'https://hnrss.org/jobs?q=contract',
    accessNote: `Kanał RSS serwisu hnrss.org: ogłoszenia z działu Jobs zawierające „contract”. ${POLL_NOTE}`,
    termsUrl: 'https://github.com/hnrss/hnrss',
    filter: off(),
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
    accessNote: `Oficjalny kanał RSS kategorii We Work Remotely. ${POLL_NOTE}`,
    termsUrl: 'https://weworkremotely.com/terms',
    filter: off(),
  })),
];

export const MANUAL_ACCESS_NOTE =
  'Kanał RSS/Atom dodany ręcznie. Jedno zapytanie na przebieg, co najmniej godzina odstępu, zgodnie z robots.txt; dopilnuj, by regulamin serwisu zezwalał na odczyt kanału.';
