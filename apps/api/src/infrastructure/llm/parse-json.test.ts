import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../modules/analysis/ports.js';
import { parseModelJson } from './parse-json.js';

describe('parseModelJson', () => {
  it('parses plain JSON', () => {
    expect(parseModelJson(' {"a":1} ')).toEqual({ a: 1 });
  });

  it('strips one surrounding code fence, with or without a language', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('keeps a fence that appears inside a string', () => {
    expect(parseModelJson('{"a":"```x```"}')).toEqual({ a: '```x```' });
  });

  it('throws ProviderError(empty) on blank text', () => {
    expect(() => parseModelJson('  \n')).toThrow(ProviderError);
  });

  it('throws on prose', () => {
    expect(() => parseModelJson('Sure! Here is the analysis')).toThrow(SyntaxError);
  });
});
