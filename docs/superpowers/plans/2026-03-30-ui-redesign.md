# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline sidebar with a 4-button nav that opens a multi-tab full-page modal (Configure / Manage / Logs / Settings / About), fix currentAppId detection via URL parsing, add badge onClick, and persist showBadge via localStorage.

**Architecture:** New tab components live in `src/components/tabs/`. `src/components/Modal.tsx` becomes the tabbed modal shell using `@decky/ui`'s `Tabs` component (typed interface confirmed in node_modules). `src/lib/settings.ts` provides typed localStorage persistence. `src/index.tsx` is rewritten with URL-first appId detection and a compact sidebar with 4 `ButtonItem` entries.

**Tech Stack:** React 19, TypeScript 5, `@decky/ui` v4.11 (`ButtonItem`, `ToggleField`, `ModalRoot`, `Tabs`, `Tab`, `DialogButton`, `DialogHeader`), `@decky/api` (`callable`, `showModal`), `localStorage` for settings persistence.

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Create | `src/lib/settings.ts` | localStorage get/set helpers |
| Modify | `src/components/Badge.tsx` | Add `onClick` prop + cursor |
| Create | `src/components/tabs/ConfigureTab.tsx` | Ranked report list (moved from Modal.tsx) |
| Create | `src/components/tabs/ManageTab.tsx` | Clear launch options |
| Create | `src/components/tabs/LogsTab.tsx` | Full-height LogViewer wrapper |
| Create | `src/components/tabs/SettingsTab.tsx` | Debug + showBadge toggles |
| Create | `src/components/tabs/AboutTab.tsx` | Static about content |
| Rewrite | `src/components/Modal.tsx` | Tabbed modal shell with `Tabs` |
| Rewrite | `src/index.tsx` | URL-based appId detection, compact sidebar |

---

## Task 1: Settings utility

**Files:**
- Create: `src/lib/settings.ts`

- [ ] **Step 1: Create the settings utility**

```ts
// src/lib/settings.ts
const PREFIX = 'proton-pulse:';

export function getSetting<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: `dist/index.js` created with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat: add localStorage settings utility"
```

---

## Task 2: Badge onClick prop

**Files:**
- Modify: `src/components/Badge.tsx`

- [ ] **Step 1: Add onClick prop**

Replace the entire file with:

```tsx
// src/components/Badge.tsx
import type { ProtonDBSummary } from '../types';

interface Props {
  summary: ProtonDBSummary | null;
  gpuVendor: string | null;
  badgeColor?: string;
  onClick?: () => void;
}

const DEFAULT_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  borked:   '#ff4444',
};

const TIER_LABEL: Record<string, string> = {
  platinum: 'Platinum',
  gold:     'Gold',
  silver:   'Silver',
  bronze:   'Bronze',
  borked:   'Borked',
};

export function ProtonPulseBadge({ summary, gpuVendor, badgeColor, onClick }: Props) {
  if (!summary || !summary.tier || summary.tier === 'pending') return null;

  const color = badgeColor ?? DEFAULT_COLORS[summary.tier] ?? '#888';
  const tier = TIER_LABEL[summary.tier] ?? summary.tier;
  const vendorLabel = gpuVendor ? gpuVendor.toUpperCase() : '';
  const label = vendorLabel ? `PP·${vendorLabel} ${tier}` : `PP ${tier}`;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
        background: color,
        color: '#111',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      title={`Proton Pulse: ${tier} (${summary.total} reports)`}
    >
      ⚡ {label}
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Badge.tsx
git commit -m "feat: add onClick prop to ProtonPulseBadge"
```

---

## Task 3: ConfigureTab

**Files:**
- Create: `src/components/tabs/ConfigureTab.tsx`

This contains the inner content currently in `Modal.tsx` (GPU filter + ranked report list + Apply/Clear/Exit buttons).

- [ ] **Step 1: Create ConfigureTab**

```tsx
// src/components/tabs/ConfigureTab.tsx
import { useState } from 'react';
import { DialogButton } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from '../ReportCard';
import { scoreReport, bucketByGpuTier } from '../../lib/scoring';
import type { ProtonDBReport, ScoredReport, SystemInfo, GpuVendor } from '../../types';

interface Props {
  appId: number | null;
  appName: string;
  reports: ProtonDBReport[];
  sysInfo: SystemInfo | null;
  closeModal: () => void;
}

type FilterTier = GpuVendor | 'all';

export function ConfigureTab({ appId, appName, reports, sysInfo, closeModal }: Props) {
  if (!sysInfo || reports.length === 0) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Use "Configure This Game" from the sidebar to load ProtonDB reports.
      </div>
    );
  }

  const scored = reports.map(r => scoreReport(r, sysInfo));
  const buckets = bucketByGpuTier(scored);

  const gpuVendor = sysInfo.gpu_vendor;
  const initialFilter: FilterTier = (gpuVendor === 'nvidia' || gpuVendor === 'amd') ? gpuVendor : 'other';
  const [filter, setFilter] = useState<FilterTier>(initialFilter);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);

  const visibleReports: ScoredReport[] = filter === 'all'
    ? [...buckets.nvidia, ...buckets.amd, ...buckets.other]
    : filter === 'nvidia' ? buckets.nvidia
    : filter === 'amd'    ? buckets.amd
    :                       buckets.other;

  const FILTER_OPTIONS: Array<{ value: FilterTier; label: string }> = [
    { value: 'nvidia', label: 'NVIDIA' },
    { value: 'amd',   label: 'AMD'   },
    { value: 'other', label: 'Other' },
    { value: 'all',   label: 'All'   },
  ];

  const handleApply = async () => {
    if (!selected || !appId) return;
    const running = (SteamClient.GameSessions as any).GetRunningApps();
    if (running.length > 0) {
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }
    setApplying(true);
    try {
      const launchOptions = `STEAM_COMPAT_TOOL_INSTALL_PATH="" PROTON_VERSION="${selected.protonVersion}" %command%`;
      await SteamClient.Apps.SetAppLaunchOptions(appId, launchOptions);
      toaster.toast({ title: 'Proton Pulse', body: `Launch options applied for ${appName}` });
      closeModal();
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleClear = async () => {
    if (!appId) return;
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
      closeModal();
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontWeight: filter === value ? 700 : 400,
              background: filter === value ? '#4c9eff' : '#333',
              color: filter === value ? '#fff' : '#aaa',
              fontSize: 11,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 10 }}>
        {visibleReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No ProtonDB reports found for this GPU tier.
          </div>
        ) : (
          visibleReports.map((r, i) => (
            <ReportCard key={i} report={r} selected={selected === r} onSelect={setSelected} />
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <DialogButton onClick={handleClear} style={{ background: '#555' }}>Clear</DialogButton>
        <DialogButton onClick={closeModal} style={{ background: '#333' }}>Exit</DialogButton>
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={{ background: selected ? '#4c9eff' : '#333' }}
        >
          {applying ? 'Applying…' : 'Apply ▶'}
        </DialogButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/ConfigureTab.tsx
git commit -m "feat: extract ConfigureTab from Modal"
```

---

## Task 4: ManageTab

**Files:**
- Create: `src/components/tabs/ManageTab.tsx`

- [ ] **Step 1: Create ManageTab**

```tsx
// src/components/tabs/ManageTab.tsx
import { DialogButton } from '@decky/ui';
import { toaster } from '@decky/api';

interface Props {
  appId: number | null;
  appName: string;
}

export function ManageTab({ appId, appName }: Props) {
  if (!appId) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
        Navigate to a game first.
      </div>
    );
  }

  const handleClear = async () => {
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#ccc' }}>
        <strong>{appName || `App ${appId}`}</strong>
      </div>
      <div style={{ marginBottom: 12, fontSize: 11, color: '#888' }}>
        To view current launch options, open Steam → Library → right-click the game → Properties → General.
      </div>
      <DialogButton onClick={handleClear} style={{ background: '#555' }}>
        Clear Launch Options
      </DialogButton>
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/ManageTab.tsx
git commit -m "feat: add ManageTab with clear launch options"
```

---

## Task 5: LogsTab

**Files:**
- Create: `src/components/tabs/LogsTab.tsx`

- [ ] **Step 1: Create LogsTab**

```tsx
// src/components/tabs/LogsTab.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

export function LogsTab() {
  const [logs, setLogs] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const content = await getLogContents();
        if (active) setLogs(content);
      } catch {
        // log file may not exist yet
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div
      style={{
        height: 460,
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.4)',
        borderRadius: 4,
        padding: 8,
        fontSize: 10,
        fontFamily: 'monospace',
        color: '#bbb',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {logs || <span style={{ color: '#666' }}>No logs yet.</span>}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/LogsTab.tsx
git commit -m "feat: add LogsTab with full-height log viewer"
```

---

## Task 6: SettingsTab

**Files:**
- Create: `src/components/tabs/SettingsTab.tsx`

- [ ] **Step 1: Create SettingsTab**

```tsx
// src/components/tabs/SettingsTab.tsx
import { useState } from 'react';
import { ToggleField } from '@decky/ui';
import { callable } from '@decky/api';
import { getSetting, setSetting } from '../../lib/settings';

const setLogLevel = callable<[level: string], boolean>('set_log_level');

export function SettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [showBadge, setShowBadge] = useState(() => getSetting('showBadge', true));

  const handleDebugToggle = async (enabled: boolean) => {
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
    await setLogLevel(enabled ? 'DEBUG' : 'INFO');
  };

  const handleShowBadgeToggle = (enabled: boolean) => {
    setShowBadge(enabled);
    setSetting('showBadge', enabled);
  };

  return (
    <div style={{ padding: 8 }}>
      <ToggleField
        label="Debug Logs"
        description="Enable verbose logging in plugin activity log"
        checked={debugEnabled}
        onChange={handleDebugToggle}
      />
      <ToggleField
        label="Show Badge"
        description="Display Proton Pulse badge in the sidebar"
        checked={showBadge}
        onChange={handleShowBadgeToggle}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/SettingsTab.tsx
git commit -m "feat: add SettingsTab with debug and showBadge toggles"
```

---

## Task 7: AboutTab

**Files:**
- Create: `src/components/tabs/AboutTab.tsx`

- [ ] **Step 1: Create AboutTab**

```tsx
// src/components/tabs/AboutTab.tsx

const LINKS: Array<{ label: string; url: string }> = [
  { label: 'GitHub', url: 'https://github.com/mdeguzis/decky-proton-pulse' },
  { label: 'ProtonDB', url: 'https://www.protondb.com' },
];

export function AboutTab() {
  return (
    <div style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Proton Pulse</div>
      <div style={{ color: '#888', marginBottom: 12 }}>v0.1.0</div>
      <div style={{ marginBottom: 16, lineHeight: 1.5 }}>
        Ranks ProtonDB community reports by system compatibility and applies the best-matching
        Proton launch options to your Steam games — all from the Decky sidebar.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {LINKS.map(({ label, url }) => (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#4c9eff', textDecoration: 'none' }}
          >
            {label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/AboutTab.tsx
git commit -m "feat: add AboutTab with plugin info and links"
```

---

## Task 8: Modal shell rewrite

**Files:**
- Rewrite: `src/components/Modal.tsx`

The existing content (GPU filter + report list) moves to `ConfigureTab` (Task 3). This file becomes the tabbed modal shell. It exports `setPendingTab()` so `index.tsx` can control which tab opens first.

Note: `Tabs` from `@decky/ui` is typed as `any` but its props interface (`TabsProps`) is correctly typed. Cast the component call via the `TabsProps` interface.

- [ ] **Step 1: Rewrite Modal.tsx**

```tsx
// src/components/Modal.tsx
import { useState } from 'react';
import { ModalRoot, type Tab } from '@decky/ui';
import type { ProtonDBReport, SystemInfo } from '../types';
import { ConfigureTab } from './tabs/ConfigureTab';
import { ManageTab } from './tabs/ManageTab';
import { LogsTab } from './tabs/LogsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { AboutTab } from './tabs/AboutTab';

// Decky's Tabs component is typed as `any`; import the runtime value
import { Tabs } from '@decky/ui';

export type TabId = 'configure' | 'manage' | 'logs' | 'settings' | 'about';

// Module-level — set by index.tsx before calling showModal to control initial tab
let _pendingTab: TabId = 'configure';
export function setPendingTab(tab: TabId): void {
  _pendingTab = tab;
}

interface Props {
  appId: number | null;
  appName: string;
  reports: ProtonDBReport[];
  sysInfo: SystemInfo | null;
  closeModal: () => void;
}

export function ProtonPulseModal({ appId, appName, reports, sysInfo, closeModal }: Props) {
  const [activeTab, setActiveTab] = useState<string>(_pendingTab);

  const tabs: Tab[] = [
    {
      id: 'configure',
      title: 'Configure',
      content: (
        <ConfigureTab
          appId={appId}
          appName={appName}
          reports={reports}
          sysInfo={sysInfo}
          closeModal={closeModal}
        />
      ),
    },
    {
      id: 'manage',
      title: 'Manage',
      content: <ManageTab appId={appId} appName={appName} />,
    },
    {
      id: 'logs',
      title: 'Logs',
      content: <LogsTab />,
    },
    {
      id: 'settings',
      title: 'Settings',
      content: <SettingsTab />,
    },
    {
      id: 'about',
      title: 'About',
      content: <AboutTab />,
    },
  ];

  return (
    <ModalRoot onCancel={closeModal} style={{ width: '90vw', maxWidth: 640 }}>
      <Tabs tabs={tabs} activeTab={activeTab} onShowTab={setActiveTab} autoFocusContents={false} />
    </ModalRoot>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: No TypeScript errors. If `Tabs` import causes TS errors (typed as `any`), this is expected and can be silenced with `// eslint-disable-line`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Modal.tsx
git commit -m "feat: rewrite Modal as multi-tab shell using Tabs component"
```

---

## Task 9: Sidebar rewrite (index.tsx)

**Files:**
- Rewrite: `src/index.tsx`

Key changes:
1. URL-based appId detection on mount (`window.location.pathname.match(/\/library\/app\/(\d+)/)`)
2. `showBadge` from localStorage, gates badge rendering
3. 4 `ButtonItem` entries using `description` prop for subtitles
4. `setPendingTab` called before `showModal` to open at the right tab
5. LogViewer removed from sidebar (moved to modal LogsTab)
6. Debug toggle removed from sidebar (moved to modal SettingsTab)
7. `fetchReports` + `sysInfo` only fetched for Configure/badge flow

- [ ] **Step 1: Rewrite index.tsx**

```tsx
// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  staticClasses,
  showModal,
} from '@decky/ui';
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
  routerHook,
} from '@decky/api';
import { useState, useEffect } from 'react';
import { FaBolt } from 'react-icons/fa';

import { ProtonPulseModal, setPendingTab } from './components/Modal';
import { ProtonPulseBadge } from './components/Badge';
import { getSetting } from './lib/settings';
import type { SystemInfo, ProtonDBReport, ProtonDBSummary } from './types';

// ─── Backend callables ────────────────────────────────────────────────────────
const getSystemInfo  = callable<[], SystemInfo>('get_system_info');
const fetchSummary   = callable<[app_id: string], ProtonDBSummary>('fetch_protondb_summary');
const fetchReports   = callable<[app_id: string], ProtonDBReport[]>('fetch_protondb_reports');
const isGameRunning  = callable<[], boolean>('is_game_running');

// ─── Module-level state ───────────────────────────────────────────────────────
let pendingAppId: number | null = null;

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const [sysInfo, setSysInfo]             = useState<SystemInfo | null>(null);
  const [gameRunning, setGameRunning]     = useState(false);
  const [currentAppId, setCurrentAppId]   = useState<number | null>(null);
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentSummary, setCurrentSummary] = useState<ProtonDBSummary | null>(null);
  const [showBadge]                       = useState(() => getSetting('showBadge', true));

  useEffect(() => {
    // Fetch system info
    getSystemInfo().then(setSysInfo).catch(console.error);

    // URL-first appId detection (most reliable — works if sidebar opens on game page)
    const match = window.location.pathname.match(/\/library\/app\/(\d+)/);
    if (match) {
      const appId = parseInt(match[1], 10);
      setCurrentAppId(appId);
      fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
    } else if (pendingAppId !== null) {
      setCurrentAppId(pendingAppId);
      fetchSummary(String(pendingAppId)).then(setCurrentSummary).catch(console.error);
      pendingAppId = null;
    }

    // Poll game-running state
    const checkGame = async () => {
      const running = await isGameRunning();
      setGameRunning(running);
    };
    checkGame();
    const interval = setInterval(checkGame, 5000);
    return () => clearInterval(interval);
  }, []);

  // Called from routerHook when user navigates to a game page mid-session
  const onGameFocus = (appId: number, appName: string) => {
    setCurrentAppId(appId);
    setCurrentAppName(appName);
    setCurrentSummary(null);
    fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
  };
  (Content as any)._onGameFocus = onGameFocus;
  (Content as any)._onGameStart = () => setGameRunning(true);

  // ─── Modal helpers ──────────────────────────────────────────────────────────

  // Open modal at any tab without fetching reports (Manage / Logs / Settings / About)
  const openModalAt = (tab: 'manage' | 'logs' | 'settings' | 'about') => {
    setPendingTab(tab);
    const modalRef: { hide?: () => void } = {};
    const modal = showModal(
      <ProtonPulseModal
        appId={currentAppId}
        appName={currentAppName}
        reports={[]}
        sysInfo={sysInfo}
        closeModal={() => modalRef.hide?.()}
      />
    );
    modalRef.hide = modal.Close;
  };

  // Open Configure tab — fetches reports first
  const handleConfigure = async () => {
    if (!currentAppId || gameRunning) return;

    toaster.toast({ title: 'Proton Pulse', body: 'Fetching ProtonDB reports…' });
    try {
      const [reports, info] = await Promise.all([
        fetchReports(String(currentAppId)),
        sysInfo ? Promise.resolve(sysInfo) : getSystemInfo(),
      ]);
      if (!sysInfo) setSysInfo(info);

      if (reports.length === 0) {
        toaster.toast({ title: 'Proton Pulse', body: 'No ProtonDB reports found for this game.' });
        return;
      }

      setPendingTab('configure');
      const modalRef: { hide?: () => void } = {};
      const modal = showModal(
        <ProtonPulseModal
          appId={currentAppId}
          appName={currentAppName}
          reports={reports}
          sysInfo={info}
          closeModal={() => modalRef.hide?.()}
        />
      );
      modalRef.hide = modal.Close;
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to fetch reports — check logs.' });
    }
  };

  // Badge click → same as Configure button
  const handleBadgeClick = () => handleConfigure();

  // ─── Disable reasons ────────────────────────────────────────────────────────
  const configureDescription = gameRunning
    ? 'Quit your game first'
    : currentAppId
    ? 'Find & apply ProtonDB launch options'
    : 'Navigate to a game first';

  const manageDescription = currentAppId
    ? 'View and clear applied configs'
    : 'Navigate to a game first';

  return (
    <PanelSection>
      {/* Badge row */}
      {showBadge && currentAppId && (
        <PanelSectionRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aaa' }}>
            <span>{currentAppName || `App ${currentAppId}`}</span>
            <ProtonPulseBadge
              summary={currentSummary}
              gpuVendor={sysInfo?.gpu_vendor ?? null}
              onClick={handleBadgeClick}
            />
          </div>
        </PanelSectionRow>
      )}

      {/* Game section */}
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={gameRunning || !currentAppId}
          onClick={handleConfigure}
          description={configureDescription}
        >
          Configure This Game ▶
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={!currentAppId}
          onClick={() => openModalAt('manage')}
          description={manageDescription}
        >
          Manage Configurations ▶
        </ButtonItem>
      </PanelSectionRow>

      {/* Plugin section */}
      <PanelSection title="Plugin">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => openModalAt('logs')}
            description="View plugin activity log"
          >
            Logs ▶
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => openModalAt('settings')}
            description="Debug mode and display options"
          >
            Settings ▶
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

  let focusedAppId: number | null = null;
  void focusedAppId;

  const patchGamePage = routerHook.addPatch(
    '/library/app/:appid',
    (props: any) => {
      const appId = props.appid ? parseInt(props.appid, 10) : null;
      focusedAppId = appId;
      if (appId) {
        const appName = (globalThis as any).SteamClient?.Apps?.GetAppOverviewByAppID?.(appId)?.display_name ?? '';
        if ((Content as any)._onGameFocus) {
          (Content as any)._onGameFocus(appId, appName);
        } else {
          pendingAppId = appId;
        }
      }
      return props;
    }
  );

  const gameStartListener = addEventListener(
    'game_start',
    (appId: number) => {
      console.log(`Proton Pulse: game started ${appId}`);
      if ((Content as any)._onGameStart) {
        (Content as any)._onGameStart();
      }
    }
  );

  return {
    name: 'Proton Pulse',
    titleView: <div className={staticClasses.Title}>Proton Pulse</div>,
    content: <Content />,
    icon: <FaBolt />,
    onDismount() {
      console.log('Proton Pulse unloading');
      routerHook.removePatch('/library/app/:appid', patchGamePage);
      removeEventListener('game_start', gameStartListener);
    },
  };
});
```

- [ ] **Step 2: Verify build succeeds**

Run: `make build`
Expected: `dist/index.js` produced with no TypeScript errors.

- [ ] **Step 3: Run all tests**

Run: `make test`
Expected: 9 TS tests passing, 17 Python tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: rewrite sidebar with URL-based appId detection and 4-button nav"
```

---

## Task 10: Final verification

**Files:** None — verification only.

- [ ] **Step 1: Clean build**

```bash
make clean && make build
```

Expected: `dist/index.js` produced, no errors.

- [ ] **Step 2: Full test suite**

```bash
make test
```

Expected: 9 TS + 17 Python tests passing.

- [ ] **Step 3: Remove unused LogViewer import from index.tsx if present**

Check that `src/index.tsx` does NOT import `LogViewer` (it was used by the old sidebar, now lives only in `LogsTab`).

Run: `grep -n "LogViewer" src/index.tsx`
Expected: No output (no longer imported).

- [ ] **Step 4: Verify Badge.tsx no longer has the old sidebar import in index.tsx**

Run: `grep -n "LogViewer\|ToggleField\|setLogLevel" src/index.tsx`
Expected: No output — these have moved to their respective tab components.

- [ ] **Step 5: Commit final cleanup if needed**

If step 3/4 found leftover imports, clean them and commit:
```bash
git add src/index.tsx
git commit -m "chore: remove unused imports after UI redesign"
```

---

## Self-Review

**Spec coverage check against `docs/superpowers/specs/2026-03-30-ui-redesign-design.md`:**

| Spec requirement | Covered in task |
|-----------------|-----------------|
| Badge `onClick` prop | Task 2 |
| URL-based appId detection | Task 9 (Content mount `useEffect`) |
| `pendingAppId` fallback retained | Task 9 |
| Inline LogViewer → modal Logs tab | Tasks 5 + 9 (removed from sidebar) |
| 4-button sidebar layout | Task 9 |
| `Field`+`description` pattern | Task 9 (`ButtonItem description` prop) |
| Multi-tab modal (Configure/Manage/Logs/Settings/About) | Task 8 |
| ConfigureTab content | Task 3 |
| ManageTab with Clear | Task 4 |
| LogsTab full-height | Task 5 |
| SettingsTab debug + showBadge | Task 6 |
| AboutTab static content | Task 7 |
| `showBadge` persisted | Tasks 6 + 9 |
| `debugEnabled` persisted | Tasks 1 + 6 |
| `Tabs` component from `@decky/ui` | Task 8 |
| `setPendingTab` for per-button tab selection | Tasks 8 + 9 |
| Badge click opens Configure tab | Task 9 (`handleBadgeClick`) |
| Game-running disable on Configure button | Task 9 |
| "Navigate to game" disable state | Tasks 9 + 4 |
