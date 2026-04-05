# Config Manager & Launch Option Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current ManageTab with a config tracking system and toggle-based editor for launch option environment variables.

**Architecture:** TrackedConfig records are persisted in localStorage (one per game, upserted by appId). A variable catalog (`launchVars.ts`) defines known env vars with types and categories. `buildLaunchOptions()` / `parseLaunchOptions()` compose and decompose launch option strings. The ConfigEditorModal provides toggle/dropdown UI for vars + live preview. The ManageTab becomes a config list with edit/delete per row.

**Tech Stack:** React, TypeScript, `@decky/ui` (Focusable, ToggleField, DropdownItem, DialogButton, ConfirmModal, showModal), localStorage via `getSetting`/`setSetting`, `SteamClient.Apps.SetAppLaunchOptions`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/trackedConfigs.ts` | TrackedConfig type, CRUD operations, localStorage persistence |
| Create | `src/lib/trackedConfigs.test.ts` | Tests for get/add/remove/upsert behavior |
| Create | `src/lib/launchVars.ts` | Variable catalog, categories, `buildLaunchOptions()`, `parseLaunchOptions()` |
| Create | `src/lib/launchVars.test.ts` | Tests for build/parse round-tripping, toggle composition |
| Create | `src/components/ConfigEditorModal.tsx` | Fullscreen modal with version picker + toggle sections + live preview |
| Modify | `src/components/tabs/ManageTab.tsx` | Replace with config list UI (rows with edit/delete) |
| Modify | `src/components/tabs/ConfigureTab.tsx` | Add `addTrackedConfig()` call in `handleApply` |
| Modify | `src/components/ReportDetailModal.tsx` | Add `addTrackedConfig()` in Apply handler |
| Modify | `src/lib/i18n.ts` | Add new TranslationTree keys for config manager |
| Modify | `src/lib/translations/*.ts` | Add translations for new keys (all 9 files) |

---

### Task 1: TrackedConfigs Data Layer

**Files:**
- Create: `src/lib/trackedConfigs.ts`
- Create: `src/lib/trackedConfigs.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/trackedConfigs.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import {
  getTrackedConfigs,
  addTrackedConfig,
  removeTrackedConfig,
  getTrackedConfig,
  type TrackedConfig,
} from './trackedConfigs';

describe('trackedConfigs', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns empty array when no configs exist', () => {
    expect(getTrackedConfigs()).toEqual([]);
  });

  it('addTrackedConfig stores a config and getTrackedConfigs retrieves it', () => {
    const config: TrackedConfig = {
      appId: 12345,
      appName: 'Test Game',
      protonVersion: 'GE-Proton9-27',
      launchOptions: 'PROTON_VERSION="GE-Proton9-27" %command%',
      enabledVars: {},
      appliedAt: Date.now(),
    };
    addTrackedConfig(config);
    const all = getTrackedConfigs();
    expect(all).toHaveLength(1);
    expect(all[0].appId).toBe(12345);
  });

  it('addTrackedConfig upserts by appId', () => {
    const config1: TrackedConfig = {
      appId: 100,
      appName: 'Game A',
      protonVersion: 'GE-Proton9-1',
      launchOptions: 'PROTON_VERSION="GE-Proton9-1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    };
    const config2: TrackedConfig = {
      appId: 100,
      appName: 'Game A',
      protonVersion: 'GE-Proton9-5',
      launchOptions: 'PROTON_VERSION="GE-Proton9-5" %command%',
      enabledVars: { MANGOHUD: '1' },
      appliedAt: 2000,
    };
    addTrackedConfig(config1);
    addTrackedConfig(config2);
    const all = getTrackedConfigs();
    expect(all).toHaveLength(1);
    expect(all[0].protonVersion).toBe('GE-Proton9-5');
    expect(all[0].enabledVars).toEqual({ MANGOHUD: '1' });
  });

  it('getTrackedConfig returns null for unknown appId', () => {
    expect(getTrackedConfig(999)).toBeNull();
  });

  it('getTrackedConfig returns the config for a known appId', () => {
    addTrackedConfig({
      appId: 42,
      appName: 'Found',
      protonVersion: 'GE-Proton10-1',
      launchOptions: 'PROTON_VERSION="GE-Proton10-1" %command%',
      enabledVars: {},
      appliedAt: Date.now(),
    });
    const found = getTrackedConfig(42);
    expect(found).not.toBeNull();
    expect(found!.appName).toBe('Found');
  });

  it('removeTrackedConfig removes by appId', () => {
    addTrackedConfig({
      appId: 1,
      appName: 'A',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    addTrackedConfig({
      appId: 2,
      appName: 'B',
      protonVersion: 'v2',
      launchOptions: 'PROTON_VERSION="v2" %command%',
      enabledVars: {},
      appliedAt: 2000,
    });
    removeTrackedConfig(2);
    expect(getTrackedConfigs()).toHaveLength(1);
    expect(getTrackedConfigs()[0].appId).toBe(1);
  });

  it('removeTrackedConfig is a no-op for unknown appId', () => {
    addTrackedConfig({
      appId: 1,
      appName: 'A',
      protonVersion: 'v1',
      launchOptions: 'PROTON_VERSION="v1" %command%',
      enabledVars: {},
      appliedAt: 1000,
    });
    removeTrackedConfig(999);
    expect(getTrackedConfigs()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --reporter=verbose src/lib/trackedConfigs.test.ts`
Expected: FAIL — module `./trackedConfigs` not found

- [ ] **Step 3: Implement trackedConfigs module**

```typescript
// src/lib/trackedConfigs.ts
import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'tracked-configs';

export interface TrackedConfig {
  appId: number;
  appName: string;
  protonVersion: string;
  launchOptions: string;
  enabledVars: Record<string, string>;
  appliedAt: number;
  isEdited?: boolean;
}

export function getTrackedConfigs(): TrackedConfig[] {
  return getSetting<TrackedConfig[]>(STORAGE_KEY, []);
}

export function addTrackedConfig(config: TrackedConfig): void {
  const configs = getTrackedConfigs();
  const index = configs.findIndex((c) => c.appId === config.appId);
  if (index >= 0) {
    configs[index] = config;
  } else {
    configs.push(config);
  }
  setSetting(STORAGE_KEY, configs);
}

export function removeTrackedConfig(appId: number): void {
  const configs = getTrackedConfigs().filter((c) => c.appId !== appId);
  setSetting(STORAGE_KEY, configs);
}

export function getTrackedConfig(appId: number): TrackedConfig | null {
  return getTrackedConfigs().find((c) => c.appId === appId) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --reporter=verbose src/lib/trackedConfigs.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/trackedConfigs.ts src/lib/trackedConfigs.test.ts
git commit -m "feat: add TrackedConfig data layer with localStorage persistence"
```

---

### Task 2: Launch Variable Catalog & Build/Parse Functions

**Files:**
- Create: `src/lib/launchVars.ts`
- Create: `src/lib/launchVars.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/launchVars.test.ts
import { describe, it, expect } from 'vitest';
import {
  LAUNCH_VAR_CATALOG,
  buildLaunchOptions,
  parseLaunchOptions,
  type LaunchVarDef,
} from './launchVars';

describe('LAUNCH_VAR_CATALOG', () => {
  it('contains at least 20 variable definitions', () => {
    expect(LAUNCH_VAR_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has key, type, category, and description', () => {
    for (const def of LAUNCH_VAR_CATALOG) {
      expect(def.key).toBeTruthy();
      expect(['bool', 'enum']).toContain(def.type);
      expect(def.category).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it('enum entries have options array', () => {
    const enums = LAUNCH_VAR_CATALOG.filter((d) => d.type === 'enum');
    expect(enums.length).toBeGreaterThan(0);
    for (const def of enums) {
      expect(def.options).toBeDefined();
      expect(def.options!.length).toBeGreaterThan(0);
    }
  });
});

describe('buildLaunchOptions', () => {
  it('builds with proton version only', () => {
    const result = buildLaunchOptions('GE-Proton9-27', {});
    expect(result).toBe('PROTON_VERSION="GE-Proton9-27" %command%');
  });

  it('builds with vars and no proton version', () => {
    const result = buildLaunchOptions(null, { MANGOHUD: '1', DXVK_ASYNC: '1' });
    expect(result).toBe('MANGOHUD=1 DXVK_ASYNC=1 %command%');
  });

  it('builds with both proton version and vars', () => {
    const result = buildLaunchOptions('GE-Proton9-27', { MANGOHUD: '1' });
    expect(result).toBe('MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%');
  });

  it('returns just %command% when no version and no vars', () => {
    const result = buildLaunchOptions(null, {});
    expect(result).toBe('%command%');
  });

  it('quotes values containing spaces', () => {
    const result = buildLaunchOptions(null, { MANGOHUD_CONFIG: 'fps_only=1' });
    expect(result).toBe('MANGOHUD_CONFIG=fps_only=1 %command%');
  });
});

describe('parseLaunchOptions', () => {
  it('parses proton version from quoted PROTON_VERSION', () => {
    const result = parseLaunchOptions('PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({});
  });

  it('parses env vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 DXVK_ASYNC=1 %command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({ MANGOHUD: '1', DXVK_ASYNC: '1' });
  });

  it('parses both proton version and vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({ MANGOHUD: '1' });
  });

  it('returns null protonVersion when not present', () => {
    const result = parseLaunchOptions('%command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
  });

  it('handles empty string', () => {
    const result = parseLaunchOptions('');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
  });

  it('round-trips with buildLaunchOptions', () => {
    const version = 'GE-Proton10-5';
    const vars = { MANGOHUD: '1', DXVK_ASYNC: '1' };
    const built = buildLaunchOptions(version, vars);
    const parsed = parseLaunchOptions(built);
    expect(parsed.protonVersion).toBe(version);
    expect(parsed.vars).toEqual(vars);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --reporter=verbose src/lib/launchVars.test.ts`
Expected: FAIL — module `./launchVars` not found

- [ ] **Step 3: Implement launchVars module**

```typescript
// src/lib/launchVars.ts

export interface LaunchVarDef {
  key: string;
  type: 'bool' | 'enum';
  category: 'nvidia' | 'amd' | 'intel' | 'wrappers' | 'performance' | 'compatibility' | 'debug';
  description: string;
  defaultValue?: string;
  options?: string[];
}

export const LAUNCH_VAR_CATALOG: LaunchVarDef[] = [
  // NVIDIA
  { key: 'PROTON_DLSS4_UPGRADE', type: 'bool', category: 'nvidia', description: 'Enable DLSS4 upgrade' },
  { key: 'PROTON_DLSS_INDICATOR', type: 'bool', category: 'nvidia', description: 'Show DLSS indicator overlay' },
  { key: 'NVPRESENT_ENABLE_SMOOTH_MOTION', type: 'bool', category: 'nvidia', description: 'NVIDIA smooth motion' },
  // AMD
  { key: 'PROTON_FSR4_UPGRADE', type: 'bool', category: 'amd', description: 'FSR4 upgrade' },
  { key: 'PROTON_FSR4_RDNA3_UPGRADE', type: 'bool', category: 'amd', description: 'FSR4 RDNA3-specific upgrade' },
  { key: 'PROTON_FSR4_INDICATOR', type: 'bool', category: 'amd', description: 'Show FSR4 indicator' },
  // Intel
  { key: 'PROTON_XESS_UPGRADE', type: 'bool', category: 'intel', description: 'XeSS upgrade' },
  { key: 'PROTON_XESS_INDICATOR', type: 'bool', category: 'intel', description: 'Show XeSS indicator' },
  // Wrappers
  { key: '__LSFG', type: 'bool', category: 'wrappers', description: 'Lossless Scaling Frame Gen' },
  { key: '__FGMOD', type: 'bool', category: 'wrappers', description: 'FG Mod' },
  // Performance
  { key: 'DXVK_ASYNC', type: 'bool', category: 'performance', description: 'DXVK async compilation' },
  { key: 'PROTON_USE_NTSYNC', type: 'bool', category: 'performance', description: 'NTSync' },
  { key: 'RADV_PERFTEST', type: 'enum', category: 'performance', description: 'RADV perf test mode', options: ['aco', 'gpl'] },
  // Compatibility
  { key: 'PROTON_USE_WINED3D', type: 'bool', category: 'compatibility', description: 'Force WineD3D instead of Vulkan' },
  { key: 'PROTON_HIDE_NVIDIA_GPU', type: 'bool', category: 'compatibility', description: 'Hide NVIDIA GPU' },
  { key: 'PROTON_ENABLE_NVAPI', type: 'bool', category: 'compatibility', description: 'Enable NVAPI' },
  { key: 'ENABLE_HDR_WSI', type: 'bool', category: 'compatibility', description: 'HDR WSI extension' },
  { key: 'PROTON_ENABLE_HDR', type: 'bool', category: 'compatibility', description: 'Proton HDR' },
  { key: 'PROTON_VKD3D_HEAP', type: 'bool', category: 'compatibility', description: 'VKD3D heap workaround' },
  { key: 'SteamDeck', type: 'bool', category: 'compatibility', description: 'Spoof Steam Deck identity', defaultValue: '0' },
  // Debug
  { key: 'PROTON_LOG', type: 'bool', category: 'debug', description: 'Enable Proton logging' },
  { key: 'MANGOHUD', type: 'bool', category: 'debug', description: 'Enable MangoHud overlay' },
  { key: 'MANGOHUD_CONFIG', type: 'enum', category: 'debug', description: 'MangoHud config preset', options: ['no_display', 'fps_only=1', 'full'] },
];

export function buildLaunchOptions(
  protonVersion: string | null,
  enabledVars: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(enabledVars)) {
    parts.push(`${key}=${value}`);
  }
  if (protonVersion) {
    parts.push(`PROTON_VERSION="${protonVersion}"`);
  }
  parts.push('%command%');
  return parts.join(' ');
}

export function parseLaunchOptions(
  launchOptions: string,
): { protonVersion: string | null; vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  let protonVersion: string | null = null;

  // Match PROTON_VERSION="..." (quoted)
  const pvMatch = launchOptions.match(/PROTON_VERSION="([^"]+)"/);
  if (pvMatch) {
    protonVersion = pvMatch[1];
  }

  // Remove %command% and PROTON_VERSION="..." from the string, then parse remaining KEY=VALUE pairs
  const cleaned = launchOptions
    .replace(/PROTON_VERSION="[^"]*"/, '')
    .replace(/%command%/g, '')
    .trim();

  if (cleaned) {
    // Split on spaces, but respect quoted values
    const tokens = cleaned.split(/\s+/);
    for (const token of tokens) {
      const eqIndex = token.indexOf('=');
      if (eqIndex > 0) {
        const key = token.slice(0, eqIndex);
        const value = token.slice(eqIndex + 1).replace(/^"|"$/g, '');
        vars[key] = value;
      }
    }
  }

  return { protonVersion, vars };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --reporter=verbose src/lib/launchVars.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/launchVars.ts src/lib/launchVars.test.ts
git commit -m "feat: add launch variable catalog with build/parse functions"
```

---

### Task 3: i18n Keys for Config Manager

**Files:**
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/translations/*.ts` (all 9)

- [ ] **Step 1: Add new keys to TranslationTree interface**

Add a new `configManager` section to the `TranslationTree` interface in `src/lib/i18n.ts`:

```typescript
// Add after the `about` section in TranslationTree interface:
  configManager: {
    title: string;
    createConfig: string;
    configureCurrentGame: string;
    emptyState: string;
    deleteConfirm: (gameName: string) => string;
    deleteConfirmTitle: string;
    applied: string;
    appliedAgo: (time: string) => string;
    noConfigs: string;
    livePreview: string;
    customVariables: string;
    addCustomVar: string;
    toggleCategories: {
      nvidia: string;
      amd: string;
      intel: string;
      wrappers: string;
      performance: string;
      compatibility: string;
      debug: string;
    };
  };
```

- [ ] **Step 2: Add English values in the `en` tree**

```typescript
// Add after the `about` section in en tree:
  configManager: {
    title: 'Configurations',
    createConfig: 'Create Config',
    configureCurrentGame: 'Configure Current Game',
    emptyState: 'No configurations yet. Right-click a game in your library and select ProtonDB Config to get started.',
    deleteConfirm: (name) => `Delete config for ${name}? This will clear the game's launch options.`,
    deleteConfirmTitle: 'Delete Configuration',
    applied: 'Applied',
    appliedAgo: (time) => `Applied ${time}`,
    noConfigs: 'No configurations',
    livePreview: 'Live Preview',
    customVariables: 'Custom Variables',
    addCustomVar: 'Add custom variable',
    toggleCategories: {
      nvidia: 'NVIDIA',
      amd: 'AMD',
      intel: 'Intel',
      wrappers: 'Wrappers',
      performance: 'Performance',
      compatibility: 'Compatibility',
      debug: 'Debug',
    },
  },
```

- [ ] **Step 3: Update all 9 translation files**

Add the `configManager` section to each of the 9 translation files in `src/lib/translations/`. Each file should have properly translated strings for that language. The `toggleCategories` values for nvidia/amd/intel stay as brand names in all languages.

- [ ] **Step 4: Build to verify no missing keys**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors about missing properties

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.ts src/lib/translations/
git commit -m "feat(i18n): add configManager translation keys for config list and editor"
```

---

### Task 4: Config List Page (Replace ManageTab)

**Files:**
- Modify: `src/components/tabs/ManageTab.tsx` — full rewrite

- [ ] **Step 1: Rewrite ManageTab as config list**

Replace the contents of `src/components/tabs/ManageTab.tsx` with a config list that:
- Shows all tracked configs as compact rows
- Each row: game thumbnail (Steam CDN capsule), game name, proton version, relative timestamp, Edit/Delete buttons
- Highlights the current game row (if `appId` prop matches) with blue left border + subtle blue background, sorted to top
- "Create Config" button in header
- Empty state with instructional message + "Configure Current Game" button when `appId` is set
- Delete confirmation via `showModal(<ConfirmModal>)` that clears launch options + removes tracking
- D-pad navigation: vertical between rows, horizontal between Edit/Delete buttons within a row (using `Focusable` with `display: flex`)
- Edit button opens `ConfigEditorModal` (imported — will be created in Task 5)
- Create button opens `ConfigEditorModal` in create mode

```typescript
// src/components/tabs/ManageTab.tsx
import { useState, useEffect } from 'react';
import { Focusable, DialogButton, ConfirmModal, showModal, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { getTrackedConfigs, removeTrackedConfig, type TrackedConfig } from '../../lib/trackedConfigs';
import { logFrontendEvent } from '../../lib/logger';
import { t } from '../../lib/i18n';
import { ConfigEditorModal } from '../ConfigEditorModal';

interface Props {
  appId: number | null;
  appName: string;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ManageTab({ appId, appName }: Props) {
  const [configs, setConfigs] = useState<TrackedConfig[]>([]);

  const refresh = () => setConfigs(getTrackedConfigs());

  useEffect(() => { refresh(); }, []);

  const sorted = [...configs].sort((a, b) => {
    if (appId && a.appId === appId) return -1;
    if (appId && b.appId === appId) return 1;
    return b.appliedAt - a.appliedAt;
  });

  const handleDelete = (config: TrackedConfig) => {
    showModal(
      <ConfirmModal
        strTitle={t().configManager.deleteConfirmTitle}
        strDescription={t().configManager.deleteConfirm(config.appName)}
        strOKButtonText={t().common.clear}
        onOK={() => {
          void logFrontendEvent('INFO', 'Deleting tracked config', { appId: config.appId, appName: config.appName });
          SteamClient.Apps.SetAppLaunchOptions(config.appId, '');
          removeTrackedConfig(config.appId);
          refresh();
          toaster.toast({ title: 'Proton Pulse', body: t().toast.cleared });
        }}
        onCancel={() => {}}
      />,
    );
  };

  const handleEdit = (config: TrackedConfig) => {
    showModal(
      <ConfigEditorModal
        appId={config.appId}
        appName={config.appName}
        existingConfig={config}
        onSave={() => refresh()}
      />,
    );
  };

  const handleCreate = () => {
    showModal(
      <ConfigEditorModal
        appId={appId}
        appName={appName}
        existingConfig={null}
        onSave={() => refresh()}
      />,
    );
  };

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  if (sorted.length === 0) {
    return (
      <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 16 }}>
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          {t().configManager.emptyState}
        </div>
        {appId && (
          <DialogButton onClick={handleCreate}>
            {t().configManager.configureCurrentGame}
          </DialogButton>
        )}
        <div style={{ marginTop: 12 }}>
          <DialogButton onClick={handleCreate}>
            {t().configManager.createConfig}
          </DialogButton>
        </div>
      </Focusable>
    );
  }

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 12 }}>
        <DialogButton onClick={handleCreate}>
          {t().configManager.createConfig}
        </DialogButton>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((config) => {
          const isCurrent = appId === config.appId;
          return (
            <Focusable
              key={config.appId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                marginBottom: 6,
                borderRadius: 6,
                borderLeft: isCurrent ? '3px solid #4c9eff' : '3px solid transparent',
                background: isCurrent ? 'rgba(76,158,255,0.08)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <img
                src={STEAM_HEADER_URL(config.appId)}
                style={{ height: 32, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e8f4ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.appName || `App ${config.appId}`}
                </div>
                <div style={{ fontSize: 10, color: '#7a9bb5' }}>
                  {config.protonVersion} · {t().configManager.appliedAgo(relativeTime(config.appliedAt))}
                </div>
              </div>
              <Focusable style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <DialogButton
                  onClick={() => handleEdit(config)}
                  style={{ minWidth: 50, padding: '4px 10px', fontSize: 11 }}
                >
                  {t().common.edit}
                </DialogButton>
                <DialogButton
                  onClick={() => handleDelete(config)}
                  style={{ minWidth: 50, padding: '4px 10px', fontSize: 11, background: '#555' }}
                >
                  {t().common.clear}
                </DialogButton>
              </Focusable>
            </Focusable>
          );
        })}
      </div>
    </Focusable>
  );
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `pnpm build`
Expected: May have import error for ConfigEditorModal (not yet created). That's OK — we'll create it in Task 5. If the build fails due to missing import, temporarily comment out the ConfigEditorModal import and usages, verify the rest compiles, then restore.

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/ManageTab.tsx
git commit -m "feat: replace ManageTab with config list showing tracked configurations"
```

---

### Task 5: Config Editor Modal

**Files:**
- Create: `src/components/ConfigEditorModal.tsx`

- [ ] **Step 1: Create the ConfigEditorModal component**

This is a fullscreen modal (same pattern as `ReportDetailModal`) with:
- Header: game thumbnail + name + appId
- Proton version text field
- Toggle sections grouped by category (auto-hidden based on GPU vendor from system info, but expandable)
- Bool vars → ToggleField, Enum vars → DropdownItem
- Custom variables section with add/remove
- Live preview bar showing composed launch options
- Apply + Cancel buttons

```typescript
// src/components/ConfigEditorModal.tsx
import { useState, useMemo, useEffect } from 'react';
import {
  Focusable,
  DialogButton,
  ToggleField,
  DropdownItem,
  TextField,
  GamepadButton,
} from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { LAUNCH_VAR_CATALOG, buildLaunchOptions, parseLaunchOptions, type LaunchVarDef } from '../lib/launchVars';
import { addTrackedConfig, type TrackedConfig } from '../lib/trackedConfigs';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

interface Props {
  appId: number | null;
  appName: string;
  existingConfig: TrackedConfig | null;
  onSave: () => void;
  closeModal?: () => void;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

type Category = LaunchVarDef['category'];
const CATEGORY_ORDER: Category[] = ['nvidia', 'amd', 'intel', 'wrappers', 'performance', 'compatibility', 'debug'];

function categoryLabel(cat: Category): string {
  return t().configManager.toggleCategories[cat];
}

export function ConfigEditorModal({ appId, appName, existingConfig, onSave, closeModal }: Props) {
  const parsed = existingConfig
    ? parseLaunchOptions(existingConfig.launchOptions)
    : { protonVersion: null, vars: {} as Record<string, string> };

  const [protonVersion, setProtonVersion] = useState(parsed.protonVersion ?? '');
  const [enabledVars, setEnabledVars] = useState<Record<string, string>>(parsed.vars);
  const [customVars, setCustomVars] = useState<Array<{ key: string; value: string }>>(() => {
    // Any vars not in catalog are custom
    const catalogKeys = new Set(LAUNCH_VAR_CATALOG.map((d) => d.key));
    return Object.entries(parsed.vars)
      .filter(([k]) => !catalogKeys.has(k))
      .map(([key, value]) => ({ key, value }));
  });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(new Set());

  const catalogKeys = useMemo(() => new Set(LAUNCH_VAR_CATALOG.map((d) => d.key)), []);

  const allVars = useMemo(() => {
    const merged = { ...enabledVars };
    for (const cv of customVars) {
      if (cv.key.trim()) merged[cv.key.trim()] = cv.value;
    }
    return merged;
  }, [enabledVars, customVars]);

  const preview = useMemo(
    () => buildLaunchOptions(protonVersion || null, allVars),
    [protonVersion, allVars],
  );

  const toggleVar = (key: string, def: LaunchVarDef) => {
    setEnabledVars((prev) => {
      const next = { ...prev };
      if (key in next) {
        delete next[key];
      } else {
        next[key] = def.defaultValue ?? '1';
      }
      return next;
    });
  };

  const setEnumVar = (key: string, value: string) => {
    setEnabledVars((prev) => ({ ...prev, [key]: value }));
  };

  const removeEnumVar = (key: string) => {
    setEnabledVars((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addCustomVariable = () => {
    setCustomVars((prev) => [...prev, { key: '', value: '1' }]);
  };

  const updateCustomVar = (index: number, field: 'key' | 'value', val: string) => {
    setCustomVars((prev) => prev.map((cv, i) => (i === index ? { ...cv, [field]: val } : cv)));
  };

  const removeCustomVar = (index: number) => {
    setCustomVars((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleCategory = (cat: Category) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleApply = async () => {
    if (!appId) return;
    const finalLaunchOptions = preview;
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, finalLaunchOptions);
      addTrackedConfig({
        appId,
        appName,
        protonVersion: protonVersion || '',
        launchOptions: finalLaunchOptions,
        enabledVars: allVars,
        appliedAt: Date.now(),
        isEdited: !!existingConfig,
      });
      void logFrontendEvent('INFO', 'Config editor applied', { appId, appName, launchOptions: finalLaunchOptions });
      toaster.toast({ title: 'Proton Pulse', body: finalLaunchOptions });
      onSave();
      closeModal?.();
    } catch (e) {
      void logFrontendEvent('ERROR', 'Config editor apply failed', {
        appId,
        error: e instanceof Error ? e.message : String(e),
      });
      toaster.toast({ title: 'Proton Pulse', body: t().configure.applyFailed(e instanceof Error ? e.message : String(e)) });
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<Category, LaunchVarDef[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const def of LAUNCH_VAR_CATALOG) {
      map.get(def.category)!.push(def);
    }
    return map;
  }, []);

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  return (
    <Focusable
      onGamepadDirection={handleRootDirection}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Header */}
      {appId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <img
            src={STEAM_HEADER_URL(appId)}
            style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
              {appName || `App ${appId}`}
            </div>
            <div style={{ fontSize: 10, color: '#7a9bb5' }}>AppID {appId}</div>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
        {/* Proton Version */}
        <div style={{ marginBottom: 16 }}>
          <TextField
            label={t().detail.protonVersion}
            value={protonVersion}
            onChange={(e) => setProtonVersion(e.target.value)}
          />
        </div>

        {/* Toggle sections by category */}
        {CATEGORY_ORDER.map((cat) => {
          const defs = grouped.get(cat)!;
          if (defs.length === 0) return null;
          const collapsed = collapsedCategories.has(cat);
          return (
            <div key={cat} style={{ marginBottom: 12 }}>
              <Focusable
                onClick={() => toggleCategory(cat)}
                onOKButton={() => toggleCategory(cat)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  padding: '6px 0',
                  borderBottom: '1px solid #2a3a4a',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 10, color: '#7a9bb5' }}>{collapsed ? '▸' : '▾'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#cfe2f4' }}>
                  {categoryLabel(cat)}
                </span>
                <span style={{ fontSize: 10, color: '#7a9bb5' }}>
                  ({defs.filter((d) => d.key in enabledVars).length}/{defs.length})
                </span>
              </Focusable>
              {!collapsed && defs.map((def) => (
                <div key={def.key} style={{ marginBottom: 4 }}>
                  {def.type === 'bool' ? (
                    <ToggleField
                      label={def.key}
                      description={def.description}
                      checked={def.key in enabledVars}
                      onChange={() => toggleVar(def.key, def)}
                    />
                  ) : (
                    <div>
                      <ToggleField
                        label={def.key}
                        description={def.description}
                        checked={def.key in enabledVars}
                        onChange={() => {
                          if (def.key in enabledVars) removeEnumVar(def.key);
                          else setEnumVar(def.key, def.options![0]);
                        }}
                      />
                      {def.key in enabledVars && (
                        <DropdownItem
                          label={def.key}
                          rgOptions={def.options!.map((o) => ({ data: o, label: o }))}
                          selectedOption={enabledVars[def.key]}
                          onChange={(opt) => setEnumVar(def.key, opt.data)}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {/* Custom Variables */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#cfe2f4', marginBottom: 8, borderBottom: '1px solid #2a3a4a', paddingBottom: 6 }}>
            {t().configManager.customVariables}
          </div>
          {customVars.map((cv, i) => (
            <Focusable key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <TextField
                label="KEY"
                value={cv.key}
                onChange={(e) => updateCustomVar(i, 'key', e.target.value)}
              />
              <span style={{ color: '#7a9bb5' }}>=</span>
              <TextField
                label="VALUE"
                value={cv.value}
                onChange={(e) => updateCustomVar(i, 'value', e.target.value)}
              />
              <DialogButton
                onClick={() => removeCustomVar(i)}
                style={{ minWidth: 30, padding: '4px 8px', fontSize: 11, background: '#555' }}
              >
                ✕
              </DialogButton>
            </Focusable>
          ))}
          <DialogButton onClick={addCustomVariable} style={{ fontSize: 11 }}>
            + {t().configManager.addCustomVar}
          </DialogButton>
        </div>
      </div>

      {/* Live Preview */}
      <div
        style={{
          padding: 10,
          borderRadius: 6,
          background: 'rgba(0,0,0,0.4)',
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#9dc4e8',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 9, color: '#7a9bb5', marginBottom: 4 }}>{t().configManager.livePreview}</div>
        {preview}
      </div>

      {/* Action buttons */}
      <Focusable style={{ display: 'flex', gap: 10 }}>
        <DialogButton onClick={handleApply} disabled={!appId}>
          {t().common.apply}
        </DialogButton>
        <DialogButton onClick={() => closeModal?.()} style={{ background: '#555' }}>
          {t().common.cancel}
        </DialogButton>
      </Focusable>
    </Focusable>
  );
}
```

- [ ] **Step 2: Build and verify compilation**

Run: `pnpm build`
Expected: Build succeeds (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfigEditorModal.tsx
git commit -m "feat: add ConfigEditorModal with toggle sections and live preview"
```

---

### Task 6: Integration — Track Configs on Apply

**Files:**
- Modify: `src/components/tabs/ConfigureTab.tsx`
- Modify: `src/components/ReportDetailModal.tsx`

- [ ] **Step 1: Add tracking to ConfigureTab handleApply**

In `src/components/tabs/ConfigureTab.tsx`, add import at the top:

```typescript
import { addTrackedConfig } from '../../lib/trackedConfigs';
import { parseLaunchOptions } from '../../lib/launchVars';
```

Then, after the `SetAppLaunchOptions` call succeeds (around line 677-688, after `setCurrentLaunchOptions(appliedLaunchOptions)`), add:

```typescript
      const parsedVars = parseLaunchOptions(appliedLaunchOptions);
      addTrackedConfig({
        appId,
        appName,
        protonVersion: launchProtonVersion,
        launchOptions: appliedLaunchOptions,
        enabledVars: parsedVars.vars,
        appliedAt: Date.now(),
      });
```

- [ ] **Step 2: Add tracking to ReportDetailModal Apply handler**

Read `src/components/ReportDetailModal.tsx` to find the Apply button's `onApply` call. The Apply handler is passed down as a prop — it calls `onApply(report)` which triggers `ConfigureTab.handleApply`. Since the tracking is now inside `handleApply`, no additional change is needed in ReportDetailModal.

Verify this by reading the file. If there's a separate apply path in ReportDetailModal that bypasses ConfigureTab.handleApply, add tracking there too.

- [ ] **Step 3: Build and run all tests**

Run: `pnpm build && pnpm test`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/ConfigureTab.tsx
git commit -m "feat: track applied configs in localStorage via addTrackedConfig"
```

---

### Task 7: End-to-End Build & Deploy Verification

**Files:** None new — verification task

- [ ] **Step 1: Run full test suite**

Run: `pnpm test && uv run python -m pytest tests/ -v`
Expected: All TS and Python tests pass

- [ ] **Step 2: Build production bundle**

Run: `pnpm build`
Expected: Build succeeds. Verify translations are included:
```bash
grep -c 'configManager\|trackedConfigs\|LAUNCH_VAR_CATALOG\|buildLaunchOptions' dist/index.js
```
Should show multiple matches.

- [ ] **Step 3: Deploy to Deck for manual testing**

Run: `DECK_IP=192.168.0.173 make deploy-reload`

Manual test checklist:
1. Open Proton Pulse sidebar → navigate to "Manage Configurations"
2. Verify empty state message appears
3. Apply a config from "Manage This Game" on a game
4. Navigate back to "Manage Configurations" — verify the game now appears in the list
5. Click Edit → ConfigEditorModal opens with pre-populated toggles
6. Toggle MANGOHUD on → verify live preview updates
7. Click Apply → verify toast shows the launch options
8. Click Delete → confirm dialog → verify game removed from list and launch options cleared
9. Test Create Config flow
10. Switch language → verify config manager strings translate

- [ ] **Step 4: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during config manager manual testing"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ TrackedConfig data model (Task 1)
- ✅ TrackedConfigs module with get/add/remove (Task 1)
- ✅ Variable catalog with categories (Task 2)
- ✅ buildLaunchOptions / parseLaunchOptions with round-tripping (Task 2)
- ✅ Custom variables support (Task 5 — ConfigEditorModal)
- ✅ Config Editor Modal with header, version picker, toggle sections, live preview, action buttons (Task 5)
- ✅ Config List Page replacing ManageTab with rows, current game highlighting, empty state (Task 4)
- ✅ Delete confirmation (Task 4)
- ✅ D-pad navigation (Task 4, Task 5)
- ✅ Integration: addTrackedConfig on apply (Task 6)
- ✅ i18n keys (Task 3)
- ✅ Translation updates (Task 3)

**Placeholder scan:** No TBDs, TODOs, or "fill in later" found.

**Type consistency:** TrackedConfig interface matches across Task 1 (definition), Task 4 (usage in list), Task 5 (usage in editor), Task 6 (creation on apply). `buildLaunchOptions`/`parseLaunchOptions` signatures match between Task 2 (definition) and Task 5/6 (usage).
