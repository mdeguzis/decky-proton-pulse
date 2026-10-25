import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logMock, showModalMock, closeMock } = vi.hoisted(() => ({
  logMock: vi.fn(), showModalMock: vi.fn(), closeMock: vi.fn(),
}));
vi.mock('./logger', () => ({ logFrontendEvent: logMock }));
vi.mock('react', () => ({ createElement: (type: unknown, props: unknown) => ({ type, props }) }));
vi.mock('./i18n', () => ({
  t: () => ({
    common: { close: 'Close' },
    extras: {
      steamRestartTitle: (tool: string) => `Restart Steam to use ${tool}`,
      steamRestartBody: (tool: string) => `${tool} is installed.`,
      steamRestartNow: () => 'Restart Steam',
    },
  }),
}));
vi.mock('@decky/ui', () => ({
  ConfirmModal: (props: unknown) => props,
  showModal: showModalMock,
}));

import { isAlreadyInstalledMessage, promptSteamRestartForTool, restartSteam } from './steamRestartPrompt';

let startRestart: ReturnType<typeof vi.fn>;
beforeEach(() => {
  logMock.mockReset();
  closeMock.mockReset();
  showModalMock.mockReset().mockReturnValue({ Close: closeMock });
  startRestart = vi.fn();
  (globalThis as any).SteamClient = { User: { StartRestart: startRestart } };
});
afterEach(() => { delete (globalThis as any).SteamClient; });

describe('restartSteam (#137)', () => {
  it('asks Steam to restart', () => {
    expect(restartSteam('test')).toBe(true);
    expect(startRestart).toHaveBeenCalledWith(false);
  });

  it('reports false and logs when the API is missing or throws', () => {
    (globalThis as any).SteamClient = { User: {} };
    expect(restartSteam('test')).toBe(false);
    expect(logMock).toHaveBeenCalledWith('ERROR', 'restartSteam: SteamClient.User.StartRestart missing', { source: 'test' });
    (globalThis as any).SteamClient = { User: { StartRestart: () => { throw new Error('nope'); } } };
    expect(restartSteam('test')).toBe(false);
  });
});

describe('isAlreadyInstalledMessage', () => {
  it('spots the backend messages for a version that was already there', () => {
    expect(isAlreadyInstalledMessage('GE-Proton11-5 is already installed.')).toBe(true);
    expect(isAlreadyInstalledMessage('Proton-GE-Latest already points to GE-Proton11-11.')).toBe(true);
    expect(isAlreadyInstalledMessage('Installed GE-Proton11-5-x86_64.')).toBe(false);
    expect(isAlreadyInstalledMessage(null)).toBe(false);
  });
});

describe('promptSteamRestartForTool', () => {
  it('shows Restart Steam / Close, and Restart Steam restarts', () => {
    promptSteamRestartForTool('GE-Proton11-5', 'test');
    const props = showModalMock.mock.calls[0][0].props;
    expect(props.strTitle).toBe('Restart Steam to use GE-Proton11-5');
    expect(props.strOKButtonText).toBe('Restart Steam');
    expect(props.strCancelButtonText).toBe('Close');
    props.onOK();
    expect(startRestart).toHaveBeenCalledWith(false);
    expect(closeMock).toHaveBeenCalled();
  });

  it('Close leaves Steam running', () => {
    promptSteamRestartForTool('GE-Proton11-5', 'test');
    showModalMock.mock.calls[0][0].props.onCancel();
    expect(startRestart).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });
});
