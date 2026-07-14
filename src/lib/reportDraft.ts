// Local draft store for the Native Pulse report modal. Persists every field
// the user has answered so an interrupted submission (missing title, blank
// hardware, network flake, plugin reload) does not force them to fill the
// form out again. Keyed by appId + configKey so a shortcut with two proton
// profiles gets two independent drafts.
//
// Storage: localStorage. Kept small on purpose -- one entry per game, no
// per-answer history. LRU eviction is not needed because the modal always
// writes to a stable key and clears it on successful submit.

import { logFrontendEvent } from './logger';

const KEY_PREFIX = 'pp:report-draft';

export function draftKey(appId: number | string, configKey?: string | null): string {
  const cfg = configKey ? `:${configKey}` : '';
  return `${KEY_PREFIX}:${appId}${cfg}`;
}

export function saveReportDraft(
  appId: number | string,
  configKey: string | null | undefined,
  draft: Record<string, unknown>,
): void {
  const key = draftKey(appId, configKey);
  const payload = JSON.stringify({ savedAt: Date.now(), draft });
  try {
    localStorage.setItem(key, payload);
    void logFrontendEvent('INFO', 'Report draft saved', {
      key, fields: Object.keys(draft).length, source: 'reportDraft.saveReportDraft',
    });
  } catch (err) {
    void logFrontendEvent('WARNING', 'Report draft save failed', {
      key, error: err instanceof Error ? err.message : String(err), source: 'reportDraft.saveReportDraft',
    });
  }
}

export function loadReportDraft(
  appId: number | string,
  configKey: string | null | undefined,
): { savedAt: number; draft: Record<string, unknown> } | null {
  const key = draftKey(appId, configKey);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.draft) return null;
    void logFrontendEvent('DEBUG', 'Report draft loaded', {
      key, savedAt: parsed.savedAt, source: 'reportDraft.loadReportDraft',
    });
    return { savedAt: Number(parsed.savedAt) || 0, draft: parsed.draft };
  } catch (err) {
    void logFrontendEvent('WARNING', 'Report draft load failed', {
      key, error: err instanceof Error ? err.message : String(err), source: 'reportDraft.loadReportDraft',
    });
    return null;
  }
}

export function clearReportDraft(
  appId: number | string,
  configKey: string | null | undefined,
): void {
  const key = draftKey(appId, configKey);
  try {
    localStorage.removeItem(key);
    void logFrontendEvent('DEBUG', 'Report draft cleared', {
      key, source: 'reportDraft.clearReportDraft',
    });
  } catch { /* ignore */ }
}
