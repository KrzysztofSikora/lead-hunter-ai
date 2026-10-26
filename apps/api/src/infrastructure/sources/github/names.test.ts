import { describe, expect, it } from 'vitest';
import { issueKey, parseIssueUrl } from './names.js';

describe('parseIssueUrl', () => {
  it('reads an issue url', () => {
    expect(parseIssueUrl('https://github.com/demo-org/demo.repo/issues/42')).toEqual({
      owner: 'demo-org',
      repo: 'demo.repo',
      number: 42,
    });
  });

  it.each([
    'https://github.com/../repo/issues/1',
    'https://github.com/owner/../issues/1',
    'https://github.com/owner/./issues/1',
    'https://github.com/%2e%2e/repo/issues/1',
    'https://github.com/owner/repo%2e%2e/issues/1',
    'https://github.com/owner/repo/issues/1?x=1',
    'https://github.com/owner/repo/issues/1#c',
    'https://github.com/owner/repo/pull/1',
    'https://github.com/owner/repo/issues/0',
    'https://github.com/owner/repo/issues/1000000001',
    `https://github.com/${'a'.repeat(40)}/repo/issues/1`,
    'http://github.com/owner/repo/issues/1',
    'https://evil.example/owner/repo/issues/1',
    42,
    null,
  ])('refuses %s', (value) => {
    expect(parseIssueUrl(value)).toBeNull();
  });

  it('accepts a 39-character owner and builds the one key form', () => {
    const ref = parseIssueUrl(`https://github.com/${'a'.repeat(39)}/r/issues/3`);
    expect(ref).not.toBeNull();
    expect(issueKey(ref!)).toBe(`github:${'a'.repeat(39)}/r#3`);
  });
});
