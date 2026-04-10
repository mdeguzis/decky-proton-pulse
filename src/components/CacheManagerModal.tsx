// src/components/CacheManagerModal.tsx
//
// Native modal for managing the local data cache. Opened via showModal()
// from the Advanced Settings section. Clean rows with game name on left,
// refresh/delete icons on right. Filter at top, sorted by recently accessed.

import { useState, useEffect, useMemo } from 'react';
import { Focusable, DialogButton, ConfirmModal, showModal } from '@decky/ui';
import { toaster } from '../lib/notify';
import { logFrontendEvent } from '../lib/logger';
import { invalidate, invalidateAll, getCacheStats, getCachedAppIds, getCached } from '../lib/cache';
import type { CacheEntry } from '../lib/cache';
import { getProtonDBReportsWithDiagnostics } from '../lib/protondb';
import { getSteamAppOverview } from '../lib/steamApps';
import { getVoteTotals } from '../lib/voting';
import { t } from '../lib/i18n';

interface CacheRow {
  appId: string;
  entry: CacheEntry;
  gameName: string;
}

function resolveGameName(appId: string, entry: CacheEntry): string {
  if (entry.reports.length > 0 && entry.reports[0].title) {
    return entry.reports[0].title;
  }
  try {
    const numericAppId = Number(appId);
    const overview = getSteamAppOverview(numericAppId);
    const overviewName = overview?.display_name ?? overview?.strDisplayName;
    if (typeof overviewName === 'string' && overviewName.trim()) return overviewName;

    const collection = (globalThis as any).collectionStore?.allAppsCollection;
    const allApps = Array.isArray(collection?.allApps)
      ? collection.allApps
      : collection?.apps && Symbol.iterator in collection.apps
        ? Array.from(collection.apps)
        : [];
    const libraryEntry = allApps.find((app: any) => Number(app?.appid) === numericAppId);
    const libraryName = libraryEntry?.display_name ?? libraryEntry?.strDisplayName ?? libraryEntry?.name;
    if (typeof libraryName === 'string' && libraryName.trim()) return libraryName;
  } catch { /* not available */ }
  return `App ${appId}`;
}

function formatAge(ms: number): string {
  const extras = t().extras!;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return extras.cacheAgeMinutesAgo(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return extras.cacheAgeHoursAgo(hrs);
  return extras.cacheAgeDaysAgo(Math.floor(hrs / 24));
}

// the modal content, used with showModal(<CacheManagerModalContent />)
export function CacheManagerModalContent({ closeModal }: { closeModal?: () => void }) {
  const extras = t().extras!;
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  const loadRows = () => {
    const ids = getCachedAppIds();
    const result: CacheRow[] = [];
    for (const appId of ids) {
      const entry = getCached(appId);
      if (!entry) continue;
      result.push({
        appId,
        entry,
        gameName: resolveGameName(appId, entry),
      });
    }
    result.sort((a, b) => b.entry.lastAccessedAt - a.entry.lastAccessedAt);
    setRows(result);
  };

  useEffect(() => { loadRows(); }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter(r =>
      r.gameName.toLowerCase().includes(q) || r.appId.includes(q),
    );
  }, [rows, filter]);

  const stats = getCacheStats();

  const handleRefresh = async (appId: string, gameName: string) => {
    setRefreshing(prev => new Set(prev).add(appId));
    void logFrontendEvent('INFO', 'Cache refresh started', { appId, gameName });
    invalidate(appId);
    try {
      const [reportResult, voteTotals] = await Promise.all([
        getProtonDBReportsWithDiagnostics(appId),
        getVoteTotals(appId),
      ]);
      void logFrontendEvent('INFO', 'Cache refresh complete', {
        appId,
        reports: reportResult.reports.length,
        votes: Object.keys(voteTotals).length,
      });
      toaster.toast({ title: extras.cacheManagerTitle(), body: extras.cacheRefreshed(gameName), duration: 2000 });
    } catch (err) {
      void logFrontendEvent('ERROR', 'Cache refresh failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      toaster.toast({
        title: extras.cacheManagerTitle(),
        body: extras.cacheRefreshFailed(gameName, err instanceof Error ? err.message : 'unknown error'),
        duration: 3000,
      });
    }
    setRefreshing(prev => {
      const next = new Set(prev);
      next.delete(appId);
      return next;
    });
    loadRows();
  };

  const handleDelete = (appId: string, gameName: string) => {
    invalidate(appId);
    toaster.toast({ title: extras.cacheManagerTitle(), body: extras.cacheRemoved(gameName), duration: 2000 });
    loadRows();
  };

  const handleClearAll = () => {
    showModal(
      <ConfirmModal
        strTitle={extras.clearEntireCacheTitle()}
        strDescription={extras.clearEntireCacheDescription(stats.size)}
        strOKButtonText={extras.clearAll()}
        onOK={() => {
          invalidateAll();
          toaster.toast({ title: extras.cacheManagerTitle(), body: extras.cacheCleared(stats.size), duration: 2000 });
          loadRows();
        }}
        onCancel={() => {}}
      />,
    );
  };

  return (
    <ConfirmModal
      strTitle={extras.cacheManagerTitle()}
      strOKButtonText={t().common.close}
      onOK={() => closeModal?.()}
      onCancel={() => closeModal?.()}
    >
      <div style={{ width: '100%', overflow: 'hidden' }}>
        {/* stats header */}
        <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {extras.cacheStatsSummary(stats.size, stats.maxSize, stats.oldestMs !== null ? formatAge(stats.oldestMs) : null)}
          </span>
          <Focusable
            onClick={handleClearAll}
            onOKButton={handleClearAll}
            style={{ cursor: 'pointer', color: '#f44336', fontSize: 11 }}
          >
            {extras.clearAll()}
          </Focusable>
        </div>
        {stats.networkFetchAvgMs !== null && (
          <div style={{ fontSize: 10, color: '#5dade2', marginBottom: 10 }}>
            {extras.cdnFetchAvg()}: {stats.networkFetchAvgMs}ms
            {stats.networkFetchP95Ms !== null ? ` (p95: ${stats.networkFetchP95Ms}ms` : ''}
            {stats.networkFetchMaxMs !== null ? `${stats.networkFetchP95Ms !== null ? ', ' : ' ('}max: ${stats.networkFetchMaxMs}ms` : ''}
            {(stats.networkFetchP95Ms !== null || stats.networkFetchMaxMs !== null) ? ')' : ''}
          </div>
        )}

        {/* search filter */}
        <input
          type="text"
          placeholder={extras.cacheFilterPlaceholder()}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            background: '#0d1b2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            color: '#ddd',
            fontSize: 12,
            outline: 'none',
            marginBottom: 10,
          }}
        />

        {/* game list */}
        <div style={{
          maxHeight: 400,
          overflowY: 'auto',
          borderRadius: 6,
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#556b7a', fontSize: 12 }}>
              {rows.length === 0 ? extras.cacheEmpty() : extras.cacheNoMatches()}
            </div>
          )}
          {filtered.map(row => (
            <div
              key={row.appId}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                gap: 12,
              }}
            >
                {/* game info - left side */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    color: '#e8f4ff',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}>
                    {row.gameName}
                  </div>
                  <div style={{ fontSize: 10, color: '#556b7a', marginTop: 2 }}>
                    {extras.cacheRowSummary(
                      row.appId,
                      row.entry.reports.length,
                      extras.cacheSourceLabel(row.entry.source),
                      formatAge(Date.now() - row.entry.cachedAt),
                    )}
                  </div>
                </div>

                {/* action buttons - right side */}
                <DialogButton
                  style={{
                    minWidth: 36,
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: refreshing.has(row.appId) ? 0.4 : 1,
                    order: 2,
                  }}
                  disabled={refreshing.has(row.appId)}
                  onClick={() => void handleRefresh(row.appId, row.gameName)}
                >
                  {refreshing.has(row.appId) ? '...' : '↻'}
                </DialogButton>

                <DialogButton
                  style={{
                    minWidth: 36,
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#f44336',
                    order: 1,
                  }}
                  onClick={() => handleDelete(row.appId, row.gameName)}
                >
                  ✕
                </DialogButton>
            </div>
          ))}
        </div>
      </div>
    </ConfirmModal>
  );
}
