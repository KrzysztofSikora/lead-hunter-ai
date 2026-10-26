import { describe, expect, it } from 'vitest';
import { languagesFromProfile } from './github-languages.js';

const profile = (skills: string[], preferredTechnologies: string[] = []) => ({
  skills,
  preferredTechnologies,
});

describe('languagesFromProfile (D-4)', () => {
  it('maps the profile tags onto GitHub languages in profile order', () => {
    expect(languagesFromProfile(profile(['TypeScript', 'Node.js'], ['Arduino']))).toEqual([
      'TypeScript',
      'JavaScript',
    ]);
  });

  it('reads skills before preferred technologies, case-insensitively, without duplicates', () => {
    expect(languagesFromProfile(profile(['python', 'RUST'], ['react', 'ts', 'Python']))).toEqual([
      'Python',
      'Rust',
      'JavaScript',
      'TypeScript',
    ]);
  });

  it('takes the first five and gives none when nothing matches', () => {
    expect(
      languagesFromProfile(profile(['Go', 'Rust', 'Zig', 'Lua', 'Dart', 'Swift', 'Ruby'])),
    ).toEqual(['Go', 'Rust', 'Zig', 'Lua', 'Dart']);
    expect(languagesFromProfile(profile(['Arduino', 'Raspberry Pi']))).toEqual([]);
  });
});
