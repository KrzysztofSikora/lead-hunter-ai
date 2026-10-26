import { describe, expect, it } from 'vitest';
import { toExportRow } from './export-rows.js';

describe('toExportRow', () => {
  it('turns epoch ms of …At columns into ISO UTC strings and keeps null', () => {
    expect(toExportRow({ createdAt: Date.UTC(2026, 0, 2, 3, 4, 5), publishedAt: null })).toEqual({
      createdAt: '2026-01-02T03:04:05.000Z',
      publishedAt: null,
    });
  });

  it('leaves other numbers alone, money included', () => {
    expect(toExportRow({ amountMinor: 123456, score: 80, id: 3 })).toEqual({
      amountMinor: 123456,
      score: 80,
      id: 3,
    });
  });

  it('parses …Json columns and names them without the suffix', () => {
    expect(toExportRow({ resultJson: '{"a":[1,2]}', cursorJson: null })).toEqual({
      result: { a: [1, 2] },
      cursorJson: null,
    });
  });

  it('keeps bad JSON as the raw string under the original key', () => {
    expect(toExportRow({ resultJson: '{broken' })).toEqual({ resultJson: '{broken' });
  });

  it('keeps an epoch outside the date range as the number', () => {
    expect(toExportRow({ createdAt: 9e15 })).toEqual({ createdAt: 9e15 });
  });
});
