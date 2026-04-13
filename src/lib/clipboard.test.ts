// src/lib/clipboard.test.ts
import { describe, expect, it, vi } from 'vitest';

const copyToClipboardBackendMock = vi.fn();

vi.mock('@decky/api', () => ({
  callable: vi.fn(() => copyToClipboardBackendMock),
}));

describe('copyToClipboard', () => {
  it('delegates to the backend callable and returns true on success', async () => {
    copyToClipboardBackendMock.mockResolvedValueOnce(true);
    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('hello world')).resolves.toBe(true);
    expect(copyToClipboardBackendMock).toHaveBeenCalledWith('hello world');
  });

  it('returns false when the backend callable returns false', async () => {
    copyToClipboardBackendMock.mockResolvedValueOnce(false);
    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('oops')).resolves.toBe(false);
  });
});
