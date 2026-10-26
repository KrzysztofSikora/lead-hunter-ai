import { describe, expect, it } from 'vitest';
import { languagesFromProfile } from './github-languages.js';

describe('languagesFromProfile (S-19 D-4)', () => {
  it('maps tags onto GitHub languages in profile order and drops the rest', () => {
    expect(
      languagesFromProfile({
        skills: ['TypeScript', 'Node.js', 'Arduino'],
        preferredTechnologies: ['react'],
      }),
    ).toEqual(['TypeScript', 'JavaScript']);
  });

  it('is case-insensitive, deduplicates and keeps at most five', () => {
    expect(
      languagesFromProfile({
        skills: ['python', 'PYTHON', 'go', 'rust', 'java', 'kotlin'],
        preferredTechnologies: ['swift'],
      }),
    ).toEqual(['Python', 'Go', 'Rust', 'Java', 'Kotlin']);
  });

  it('gives an empty list when nothing matches', () => {
    expect(languagesFromProfile({ skills: ['Arduino'], preferredTechnologies: [] })).toEqual([]);
  });
});
