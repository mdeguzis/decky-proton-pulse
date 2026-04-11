import { beforeEach, describe, expect, it, vi } from 'vitest';

const { backendLogCallable } = vi.hoisted(() => ({
  backendLogCallable: vi.fn(),
}));

vi.mock('@decky/api', () => ({
  callable: () => backendLogCallable,
}));

describe('logger', () => {
  beforeEach(() => {
    backendLogCallable.mockReset();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('stores frontend log entries and formats them as text', async () => {
    const { getLogCount, getLogEntries, getLogText, logFrontendEvent } = await import('./logger');

    await logFrontendEvent('INFO', 'Plugin ready', { appId: 620 });

    expect(getLogCount()).toBe(1);
    expect(getLogEntries()).toHaveLength(1);
    expect(getLogText()).toContain('INFO Plugin ready {"appId":620}');
    expect(backendLogCallable).toHaveBeenCalledWith('INFO', 'Plugin ready', { appId: 620 });
  });

  it('notifies subscribers once logs are flushed', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { logFrontendEvent, subscribeToLogs } = await import('./logger');
    const unsubscribe = subscribeToLogs(callback);

    await logFrontendEvent('INFO', 'First');
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    await logFrontendEvent('INFO', 'Second');
    await vi.runAllTimersAsync();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('wraps successful backend calls with start and finish log entries', async () => {
    vi.useFakeTimers();
    const { callWithTimeout, getLogEntries } = await import('./logger');

    const promise = callWithTimeout(async () => 'ok', 'get_system_info', 100);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(getLogEntries().map((entry) => entry.message)).toEqual([
      'BACKEND >> get_system_info called',
      expect.stringContaining('BACKEND << get_system_info responded'),
    ]);
  });

  it('logs and rethrows backend failures', async () => {
    vi.useFakeTimers();
    const { callWithTimeout, getLogEntries } = await import('./logger');

    const promise = callWithTimeout(async () => {
      throw new Error('backend exploded');
    }, 'get_reports', 100);
    const assertion = expect(promise).rejects.toThrow('backend exploded');
    await vi.runAllTimersAsync();

    await assertion;
    expect(getLogEntries().at(-1)?.message).toContain('BACKEND !! get_reports failed');
  });

  it('times out slow backend calls', async () => {
    vi.useFakeTimers();
    const { callWithTimeout, getLogEntries } = await import('./logger');

    const promise = callWithTimeout(
      () => new Promise<string>(() => undefined),
      'slow_call',
      25,
    );
    const assertion = expect(promise).rejects.toThrow(
      'BACKEND TIMEOUT: slow_call did not respond after 25ms - Python backend may not be running',
    );
    await vi.advanceTimersByTimeAsync(30);

    await assertion;
    expect(getLogEntries().at(-1)?.message).toContain('BACKEND TIMEOUT: slow_call');
  });

  it('swallows backend logging failures so the UI path stays alive', async () => {
    backendLogCallable.mockRejectedValue(new Error('offline'));
    const { getLogCount, logFrontendEvent } = await import('./logger');

    await expect(logFrontendEvent('WARNING', 'Keep going')).resolves.toBeUndefined();
    expect(getLogCount()).toBe(1);
  });
});
