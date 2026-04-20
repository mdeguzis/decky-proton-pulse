// src/lib/clipboard.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// fall through and stage 3 (backend) is exercised. The first two describes
// stub navigator/document to exercise stages 1 and 2 explicitly

describe('copyToClipboard', () => {
  beforeEach(() => {
    copyToClipboardBackendMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('returns false and logs when the backend callable throws', async () => {
    copyToClipboardBackendMock.mockRejectedValueOnce(new Error('no wl-copy'));
    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });

  it('uses navigator.clipboard when available and returns early on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('via-nav')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('via-nav');
    // stage 3 should not have been reached
    expect(copyToClipboardBackendMock).not.toHaveBeenCalled();
  });

  it('falls through to stage 2 when navigator.clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Document is not focused'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    // Minimal document shim that makes execCommand('copy') succeed. The code
    // creates a textarea, appends it, focuses, selects, runs execCommand, and
    // removes it. We just need each of those to be a callable no-op
    const body = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };
    const textarea = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body,
      execCommand: vi.fn(() => true),
    });

    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('via-exec')).resolves.toBe(true);
    // stage 3 should not have been reached
    expect(copyToClipboardBackendMock).not.toHaveBeenCalled();
  });

  it('falls through to stage 3 when execCommand returns false', async () => {
    // Force stage 1 miss (no navigator.clipboard)
    vi.stubGlobal('navigator', {});
    const textarea = {
      value: '', style: {} as Record<string, string>,
      setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn(() => false),
    });
    copyToClipboardBackendMock.mockResolvedValueOnce(true);

    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('via-backend')).resolves.toBe(true);
    expect(copyToClipboardBackendMock).toHaveBeenCalledWith('via-backend');
  });

  it('falls through to stage 3 when execCommand itself throws', async () => {
    vi.stubGlobal('navigator', {});
    const textarea = {
      value: '', style: {} as Record<string, string>,
      setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn(() => { throw new Error('CEF blocked it'); }),
    });
    copyToClipboardBackendMock.mockResolvedValueOnce(false);

    const { copyToClipboard } = await import('./clipboard');
    await expect(copyToClipboard('nope')).resolves.toBe(false);
  });
});
