import { describe, test, expect, beforeEach, vi } from 'vitest';

import { draftKey, saveReportDraft, loadReportDraft, clearReportDraft } from './reportDraft';

vi.mock('./logger', () => ({ logFrontendEvent: () => Promise.resolve() }));

const store: Record<string, string> = {};

vi.stubGlobal('localStorage', {
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('reportDraft', () => {
  test('draftKey scopes by appId + configKey so two profiles on one game do not clash', () => {
    const a = draftKey(730);
    const b = draftKey(730, 'cfg-1');
    const c = draftKey(730, 'cfg-2');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).toContain('730');
    expect(b).toContain('cfg-1');
  });

  test('save + load round-trips the draft object with a saved-at timestamp', () => {
    saveReportDraft(730, null, { notes: 'hello', canInstall: 'yes' });
    const loaded = loadReportDraft(730, null);
    expect(loaded).not.toBeNull();
    expect(loaded!.draft.notes).toBe('hello');
    expect(loaded!.draft.canInstall).toBe('yes');
    expect(typeof loaded!.savedAt).toBe('number');
    expect(loaded!.savedAt).toBeGreaterThan(0);
  });

  test('loadReportDraft returns null when there is no saved draft', () => {
    expect(loadReportDraft(999, null)).toBeNull();
  });

  test('clearReportDraft removes the entry so a subsequent load returns null', () => {
    saveReportDraft(730, 'k', { notes: 'x' });
    expect(loadReportDraft(730, 'k')).not.toBeNull();
    clearReportDraft(730, 'k');
    expect(loadReportDraft(730, 'k')).toBeNull();
  });

  test('malformed JSON in storage returns null instead of throwing', () => {
    store[draftKey(730, null)] = '{not-valid-json';
    expect(loadReportDraft(730, null)).toBeNull();
  });

  test('payload missing the draft field returns null so we do not surface an empty object as a restore', () => {
    store[draftKey(730, null)] = JSON.stringify({ savedAt: 1 });
    expect(loadReportDraft(730, null)).toBeNull();
  });
});
