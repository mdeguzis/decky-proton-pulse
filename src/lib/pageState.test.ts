// src/lib/pageState.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NAVIGATE_EVENT, dispatchNavigate, pageState, rememberReturnPath } from './pageState';
import type { NavigatePayload } from './pageState';

// Shim window with an EventTarget so CustomEvent dispatch works in Node.
const target = new EventTarget();
vi.stubGlobal('window', target);
vi.stubGlobal('CustomEvent', class CustomEvent<T> extends Event {
  detail: T;
  constructor(type: string, init?: CustomEventInit<T>) {
    super(type, init);
    this.detail = init?.detail as T;
  }
});

beforeEach(() => {
  // Reset pageState to defaults before each test.
  pageState.initialPage = 'manage';
  pageState.appId = null;
  pageState.appName = '';
  pageState.returnPath = null;
  pageState.pendingNavigate = null;
  pageState.pendingNavigateVersion = 0;
});

describe('NAVIGATE_EVENT', () => {
  it('has the expected constant value', () => {
    expect(NAVIGATE_EVENT).toBe('proton-pulse:navigate');
  });
});

describe('pageState defaults', () => {
  it('initialPage defaults to manage', () => {
    expect(pageState.initialPage).toBe('manage');
  });

  it('appId defaults to null', () => {
    expect(pageState.appId).toBeNull();
  });

  it('appName defaults to empty string', () => {
    expect(pageState.appName).toBe('');
  });

  it('returnPath defaults to null', () => {
    expect(pageState.returnPath).toBeNull();
  });
});

describe('dispatchNavigate', () => {
  it('fires a CustomEvent on window with the correct event type', () => {
    const received: NavigatePayload[] = [];
    const handler = (e: Event) => {
      received.push((e as CustomEvent<NavigatePayload>).detail);
    };
    (window as unknown as EventTarget).addEventListener(NAVIGATE_EVENT, handler);

    dispatchNavigate({ tab: 'manage-game', appId: 42, appName: 'Half-Life 3' });

    (window as unknown as EventTarget).removeEventListener(NAVIGATE_EVENT, handler);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ tab: 'manage-game', appId: 42, appName: 'Half-Life 3' });
    expect(pageState.initialPage).toBe('manage-game');
    expect(pageState.appId).toBe(42);
    expect(pageState.appName).toBe('Half-Life 3');
    expect(pageState.pendingNavigate).toEqual({ tab: 'manage-game', appId: 42, appName: 'Half-Life 3' });
    expect(pageState.pendingNavigateVersion).toBe(1);
  });

  it('fires with null appId for manage navigation', () => {
    const received: NavigatePayload[] = [];
    const handler = (e: Event) => {
      received.push((e as CustomEvent<NavigatePayload>).detail);
    };
    (window as unknown as EventTarget).addEventListener(NAVIGATE_EVENT, handler);

    dispatchNavigate({ tab: 'manage', appId: null, appName: '' });

    (window as unknown as EventTarget).removeEventListener(NAVIGATE_EVENT, handler);

    expect(received[0].appId).toBeNull();
    expect(received[0].tab).toBe('manage');
  });

  it('fires correct tab for each PageId', () => {
    const tabs = ['manage-game', 'manage', 'logs', 'compatibility-tools', 'settings', 'about'] as const;
    tabs.forEach(tab => {
      const received: NavigatePayload[] = [];
      const handler = (e: Event) => {
        received.push((e as CustomEvent<NavigatePayload>).detail);
      };
      (window as unknown as EventTarget).addEventListener(NAVIGATE_EVENT, handler);
      dispatchNavigate({ tab, appId: null, appName: '' });
      (window as unknown as EventTarget).removeEventListener(NAVIGATE_EVENT, handler);
      expect(received[0].tab).toBe(tab);
    });
  });
});

describe('rememberReturnPath', () => {
  it('stores non-plugin paths for exiting back', () => {
    rememberReturnPath('/library/app/123');
    expect(pageState.returnPath).toBe('/library/app/123');
  });

  it('ignores plugin paths', () => {
    rememberReturnPath('/proton-pulse');
    expect(pageState.returnPath).toBeNull();
  });
});
