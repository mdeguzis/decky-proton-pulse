// src/lib/clipboard.test.ts
import { describe, expect, it, vi } from 'vitest';

const copyToClipboardBackendMock = vi.fn();

vi.mock('@decky/api', () => ({
  callable: vi.fn(() => copyToClipboardBackendMock),
}));

// Clipboard uses logFrontendEvent for its three-stage debug trail. Mock logger
// so it doesn't share the @decky/api callable mock queue with the backend
vi.mock('./logger', () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(true),
}));

// In node env, navigator and document are both undefined, so stages 1 and 2
// fall through and stage 3 (backend) is exercised

describe('copyToClipboard', () => {
  it('falls through to the backend callable and returns true when it succeeds', async () => {
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
