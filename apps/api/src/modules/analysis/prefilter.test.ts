import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { profile } from '../../../test/helpers/analysis.js';
import { detectLanguage, prefilter } from './prefilter.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/llm/${name}`, import.meta.url), 'utf8');

const now = new Date('2026-10-25T12:00:00Z');
const options = { now, maxAgeDays: 30 };
const run = (
  text: string,
  overrides: Parameters<typeof profile>[0] = {},
  signal: { sourceType?: 'manual_text' | 'manual_url'; publishedAt?: number | null } = {},
) =>
  prefilter(
    {
      text,
      sourceType: signal.sourceType ?? 'manual_text',
      publishedAt: signal.publishedAt ?? null,
    },
    profile(overrides),
    options,
  );

describe('prefilter rules (D-6)', () => {
  it('rejects SEEKING WORK and passes SEEKING FREELANCER (FR-07 AC2)', () => {
    expect(run(fixture('synthetic-seeking-work.txt')).rule).toBe('seeking_work');
    expect(run(fixture('synthetic-seeking-freelancer.txt')).rule).toBeNull();
  });

  it('rejects empty text with no_text', () => {
    expect(run('  \n ').rule).toBe('no_text');
  });

  it('rejects spam by phrase and by more than ten links', () => {
    expect(run('DEMO: guaranteed income, write to us').rule).toBe('spam');
    const links = Array.from({ length: 11 }, (_, i) => `https://example.invalid/${i}`).join(' ');
    expect(run(`TypeScript ${links}`).rule).toBe('spam');
    expect(run(`TypeScript ${links.split(' ').slice(0, 10).join(' ')}`).rule).toBeNull();
  });

  it('rejects a detected language the profile does not list, and passes an undetected one', () => {
    const german = 'DEMO: wir suchen einen Entwickler für TypeScript';
    expect(run(german, { languages: ['pl'] }).rule).toBeNull();
    const english =
      'DEMO: we are looking for a TypeScript developer that can work with our team and the API';
    expect(run(english, { languages: ['pl'] }).rule).toBe('language');
    expect(run(english, { languages: ['en'] }).rule).toBeNull();
  });

  it('rejects an old dated post and passes an undated one', () => {
    const day = 86_400_000;
    const text = 'DEMO: TypeScript developer wanted';
    expect(run(text, {}, { publishedAt: now.getTime() - 31 * day }).rule).toBe('too_old');
    expect(run(text, {}, { publishedAt: now.getTime() - 30 * day }).rule).toBeNull();
    expect(run(text, {}, { publishedAt: null }).rule).toBeNull();
  });

  it('rejects an excluded technology and an excluded category as whole words', () => {
    expect(run('DEMO: need a PHP developer', { excludedTechnologies: ['PHP'] }).rule).toBe(
      'excluded_technology',
    );
    expect(
      run('DEMO: TypeScript phpunit tests', { excludedTechnologies: ['PHP'] }).rule,
    ).toBeNull();
    expect(run('DEMO: casino site in TypeScript', { excludedCategories: ['casino'] }).rule).toBe(
      'excluded_category',
    );
  });

  it('does not apply no_profile_match to manual imports', () => {
    expect(run('DEMO: someone needs a cake').rule).toBeNull();
  });

  it('counts distinct profile terms as matches', () => {
    const outcome = run('DEMO: TypeScript and typescript with ESP32, plus Node.js', {
      skills: ['TypeScript', 'ESP32', 'Node.js', 'Rust'],
    });
    expect(outcome.matches).toBe(3);
  });

  it('applies the first failing rule in order', () => {
    expect(run('SEEKING WORK: PHP', { excludedTechnologies: ['PHP'] }).rule).toBe('seeking_work');
  });
});

describe('detectLanguage', () => {
  it('detects Polish and English by stop words and leaves short texts undetected', () => {
    expect(detectLanguage('Szukam programisty, który jest dla nas ważny oraz nie drogi')).toBe(
      'pl',
    );
    expect(detectLanguage('We need the best developer for this and that')).toBe('en');
    expect(detectLanguage('TypeScript')).toBeNull();
  });
});
