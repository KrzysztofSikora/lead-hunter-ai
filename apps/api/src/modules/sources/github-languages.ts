import { GITHUB_LANGUAGES, type OperatorProfile } from '@lead-hunter/contracts';

/** S-19 D-4: profile tags that name a Linguist language under another spelling. */
const ALIASES: Record<string, string> = {
  'node.js': 'JavaScript',
  nodejs: 'JavaScript',
  node: 'JavaScript',
  js: 'JavaScript',
  ts: 'TypeScript',
  golang: 'Go',
  cpp: 'C++',
  csharp: 'C#',
  bash: 'Shell',
  python3: 'Python',
};

const MAX_LANGUAGES = 5;
const BY_NAME = new Map<string, string>(GITHUB_LANGUAGES.map((name) => [name.toLowerCase(), name]));

/**
 * S-19 D-4: the default search languages for the GitHub preset: `skills ∪ preferredTechnologies`
 * in profile order, kept when they name a GitHub language, at most five.
 */
export function languagesFromProfile(
  profile: Pick<OperatorProfile, 'skills' | 'preferredTechnologies'>,
): string[] {
  const found: string[] = [];
  for (const tag of [...profile.skills, ...profile.preferredTechnologies]) {
    const key = tag.trim().toLowerCase();
    const language = ALIASES[key] ?? BY_NAME.get(key);
    if (language !== undefined && !found.includes(language)) found.push(language);
    if (found.length === MAX_LANGUAGES) break;
  }
  return found;
}
