import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from './clipboard.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('uses the Clipboard API when it exists', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(await copyText('abc')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('abc');
});

it('falls back to a textarea and execCommand on a plain-HTTP page', async () => {
  vi.stubGlobal('navigator', {});
  const exec = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  expect(await copyText('abc')).toBe(true);
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.querySelector('textarea')).toBeNull();
});

it('reports failure when both ways fail', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
  });
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn().mockReturnValue(false),
    configurable: true,
  });
  expect(await copyText('abc')).toBe(false);
});
