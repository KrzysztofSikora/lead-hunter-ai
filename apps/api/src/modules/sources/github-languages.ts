import { GITHUB_LANGUAGES, type OperatorProfile } from '@lead-hunter/contracts';

const ALIASES: Readonly<Record<string, (typeof GITHUB_LANGUAGES)[number]>> = {
  'node.js': 'JavaScript',
  nodejs: 'JavaScript',
  node: 'JavaScript',
  react: 'JavaScript',
  js: 'JavaScript',
  ts: 'TypeScript',
};

const BY_NAME = new Map(GITHUB_LANGUAGES.map((name) => [name.toLowerCase(), name]));
export const GITHUB_DEFAULT_LANGUAGES_MAX = 5;

/**
 * S-19 D-4: the default languages of a new GitHub source. `skills` then `preferredTechnologies`,
 * each tag mapped case-insensitively onto the list GitHub knows (a few aliases), first five in
 * profile order, no duplicates. A tag with no match (Arduino) is left out.
 */
export function languagesFromProfile(
  profile: Pick<OperatorProfile, 'skills' | 'preferredTechnologies'>,
): (typeof GITHUB_LANGUAGES)[number][] {
  const found: (typeof GITHUB_LANGUAGES)[number][] = [];
  for (const tag of [...profile.skills, ...profile.preferredTechnologies]) {
    const key = tag.trim().toLowerCase();
    const language = BY_NAME.get(key) ?? ALIASES[key];
    if (language !== undefined && !found.includes(language)) found.push(language);
    if (found.length === GITHUB_DEFAULT_LANGUAGES_MAX) break;
  }
  return found;
}
