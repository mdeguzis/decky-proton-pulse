# Report Detail Navigation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-place overlay `overlayMode` system in `ConfigureTab` with a `showModal()`-based fullscreen detail view, and fix gamepad `DIR_LEFT` event consumption across all tabs so input never leaks back to the sidebar.

**Architecture:** `ReportDetailModal` (new) opens fullscreen via `showModal(..., { bAllowFullSize: true })`; `EditReportModal` (new) opens on top of it. `ConfigureTab` becomes a pure card browser — all overlay state, refs, and focus plumbing removed. Every tab root `Focusable` calls `evt.preventDefault()` (not just `return`) for `DIR_LEFT`.

**Tech Stack:** TypeScript, React, `@decky/ui` (`ModalRoot`, `PanelSection`, `PanelSectionRow`, `Field`, `TextField`, `DropdownItem`, `DialogButton`, `SteamSpinner`, `showModal`), Decky plugin loader.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/components/ReportDetailModal.tsx` | **Create** | Fullscreen modal showing a single report's detail + Apply/Edit/Upvote actions |
| `src/components/EditReportModal.tsx` | **Create** | Edit-form modal with native `TextField`/`DropdownItem` fields |
| `src/components/tabs/ConfigureTab.tsx` | **Modify** | Remove overlay machinery; wire `openReportDetail` to `showModal`; replace custom spinner + filter button with native components |
| `src/components/Modal.tsx` | **Modify** | Remove `overlayHost`/`overlayLocked` state and all blocking divs |
| `src/components/tabs/ManageTab.tsx` | **Modify** | Move `handleRootDirection` inside component; add `evt.preventDefault()` for `DIR_LEFT` |
| `src/components/tabs/LogsTab.tsx` | **Modify** | Add `evt.preventDefault()` for `DIR_LEFT` in `handleDirection` |
| `src/components/tabs/SettingsTab.tsx` | **Modify** | Add `evt.preventDefault()` for `DIR_LEFT` in `handleRootDirection` |
| `src/components/tabs/AboutTab.tsx` | **Modify** | Add `evt.preventDefault()` for `DIR_LEFT` in `handleRootDirection` |
| `src/components/tabs/GeneralSettingsTab.tsx` | **Modify** | Add `evt.preventDefault()` for `DIR_LEFT` in `handleRootDirection` |

---

## Task 1: Create `ReportDetailModal.tsx`

**Files:**
- Create: `src/components/ReportDetailModal.tsx`

`showModal` injects `closeModal` into the component props. `onApply` and `onUpvote` are called from `ConfigureTab` — they handle their own data logic; the modal owns the loading state for the buttons.

- [ ] **Step 1.1: Create the file**

```tsx
// src/components/ReportDetailModal.tsx
import { useState } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  Field,
  DialogButton,
  SteamSpinner,
} from '@decky/ui';
import { toaster } from '@decky/api';
import { showModal } from '@decky/ui';
import type { SystemInfo } from '../types';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';
import { EditReportModal } from './EditReportModal';
import { logFrontendEvent } from '../lib/logger';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  borked: '#ff4444',
  pending: '#888888',
};

function formatProtonLabel(version: string): string {
  const trimmed = version.trim();
  if (/^ge-proton/i.test(trimmed)) return `Proton GE ${trimmed.replace(/^ge-proton/i, '')}`;
  return `Proton ${trimmed}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function buildLaunchOptionPreview(protonVersion: string): string {
  return `PROTON_VERSION="${protonVersion}" %command%`;
}

function matchLabel(report: DisplayReportCard, sysInfo: SystemInfo | null): string {
  if (!sysInfo?.gpu_vendor || report.gpuTier === 'unknown') return 'Unknown GPU match';
  return report.gpuTier === sysInfo.gpu_vendor
    ? 'Matches your GPU vendor'
    : 'Different GPU vendor';
}

export interface ReportDetailModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  appId: number;
  appName: string;
  sysInfo: SystemInfo | null;
  currentLaunchOptions: string;
  onApply: (report: DisplayReportCard) => Promise<void>;
  onUpvote: (report: DisplayReportCard) => Promise<void>;
  onSaveEdit: (entry: EditedReportEntry) => void;
}

export function ReportDetailModal({
  closeModal,
  report,
  appId,
  appName,
  sysInfo,
  currentLaunchOptions,
  onApply,
  onUpvote,
  onSaveEdit,
}: ReportDetailModalProps) {
  const [applying, setApplying] = useState(false);
  const [upvoting, setUpvoting] = useState(false);

  const cappedScore = Math.min(100, report.score);
  const confScore = (cappedScore / 10).toFixed(1);
  const ratingColor = RATING_COLORS[report.rating] ?? '#888';

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(report);
    } finally {
      setApplying(false);
    }
  };

  const handleUpvote = async () => {
    setUpvoting(true);
    try {
      await onUpvote(report);
    } finally {
      setUpvoting(false);
    }
  };

  const handleEditConfig = () => {
    showModal(
      <EditReportModal
        report={report}
        onSave={(entry) => {
          onSaveEdit(entry);
          closeModal?.();
        }}
      />,
    );
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <PanelSection>
        <PanelSectionRow>
          <Field
            label={appName || `App ${appId}`}
            description={`AppID ${appId}`}
            icon={
              <img
                src={STEAM_HEADER_URL(appId)}
                style={{ height: 40, borderRadius: 3, objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            }
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label={formatProtonLabel(report.protonVersion)}
            description={`${matchLabel(report, sysInfo)} · ${confScore}/10 confidence`}
          >
            <span
              style={{
                background: ratingColor,
                color: '#111',
                borderRadius: 999,
                padding: '2px 9px',
                fontWeight: 700,
                fontSize: 10,
                textTransform: 'uppercase',
              }}
            >
              {report.rating}
            </span>
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Actions">
        <PanelSectionRow>
          <DialogButton
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? <SteamSpinner /> : 'Apply Config'}
          </DialogButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton onClick={handleEditConfig}>
            Edit Config
          </DialogButton>
        </PanelSectionRow>
        <PanelSectionRow>
          <DialogButton
            onClick={handleUpvote}
            disabled={upvoting}
          >
            {upvoting ? <SteamSpinner /> : 'Upvote'}
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Launch">
        <PanelSectionRow>
          <Field
            label="Launch Preview"
            description={buildLaunchOptionPreview(report.protonVersion)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label="Current Launch Options"
            description={currentLaunchOptions || 'No launch options set.'}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Hardware Match">
        <PanelSectionRow>
          <Field label="GPU" description={report.gpu || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="OS" description={report.os || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Kernel" description={report.kernel || '—'} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Driver" description={report.gpuDriver || '—'} />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Report">
        <PanelSectionRow>
          <Field label="Confidence" description={`${confScore}/10`} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="GPU Tier" description={report.gpuTier.toUpperCase()} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Votes" description={String(report.upvotes)} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Submitted" description={formatTimestamp(report.timestamp)} />
        </PanelSectionRow>
        {report.isEdited && (
          <PanelSectionRow>
            <Field
              label="Edited"
              description={report.editLabel || 'Custom variant'}
            />
          </PanelSectionRow>
        )}
        {report.notes && (
          <PanelSectionRow>
            <Field label="Notes" description={report.notes} />
          </PanelSectionRow>
        )}
      </PanelSection>
    </ModalRoot>
  );
}
```

- [ ] **Step 1.2: Verify TypeScript compiles**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1 | tail -20
```

Expected: build succeeds or shows only errors in files not yet modified (e.g., `ConfigureTab.tsx` still exports `EditedReportEntry` — that's fine, we fix that in Task 3). The new file itself must have zero errors.

---

## Task 2: Create `EditReportModal.tsx`

**Files:**
- Create: `src/components/EditReportModal.tsx`

The `EditedReportEntry` and `CdnReport` types live in `ConfigureTab.tsx` today (they are unexported internal types). In Task 3 we will export `EditedReportEntry` from `ConfigureTab.tsx`. For now, duplicate the minimal interface needed here; Task 3 will replace it with the real import.

- [ ] **Step 2.1: Create the file**

```tsx
// src/components/EditReportModal.tsx
import { useState } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  TextField,
  DialogButton,
  DropdownItem,
} from '@decky/ui';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';

const RATING_OPTIONS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending'] as const;

export interface EditReportModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  onSave: (entry: EditedReportEntry) => void;
}

export function EditReportModal({ closeModal, report, onSave }: EditReportModalProps) {
  const [label, setLabel]               = useState('');
  const [protonVersion, setProtonVersion] = useState(report.protonVersion);
  const [rating, setRating]             = useState(report.rating);
  const [gpu, setGpu]                   = useState(report.gpu);
  const [gpuDriver, setGpuDriver]       = useState(report.gpuDriver);
  const [os, setOs]                     = useState(report.os);
  const [kernel, setKernel]             = useState(report.kernel);
  const [ram, setRam]                   = useState(report.ram);
  const [notes, setNotes]               = useState(report.notes);

  const handleSave = () => {
    const entry: EditedReportEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim(),
      baseReportKey: `${report.timestamp}_${report.protonVersion}`,
      report: {
        appId: report.appId,
        cpu: report.cpu,
        duration: report.duration,
        gpu,
        gpuDriver,
        kernel,
        notes,
        os,
        protonVersion,
        ram,
        rating,
        timestamp: report.timestamp,
        title: report.title,
      },
      updatedAt: Date.now(),
    };
    onSave(entry);
    closeModal?.();
  };

  return (
    <ModalRoot onCancel={closeModal}>
      <PanelSection title="Edit Report">
        <PanelSectionRow>
          <TextField
            label="Label"
            description="Short name for this custom variant"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="Proton Version"
            value={protonVersion}
            onChange={(e) => setProtonVersion(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label="Rating"
            rgOptions={RATING_OPTIONS.map((r) => ({ data: r, label: r }))}
            selectedOption={rating}
            onChange={(opt) => setRating(opt.data)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="GPU"
            value={gpu}
            onChange={(e) => setGpu(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="GPU Driver"
            value={gpuDriver}
            onChange={(e) => setGpuDriver(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="OS"
            value={os}
            onChange={(e) => setOs(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="Kernel"
            value={kernel}
            onChange={(e) => setKernel(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="RAM"
            value={ram}
            onChange={(e) => setRam(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            bShowClearAction
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection>
        <PanelSectionRow>
          <DialogButton onClick={handleSave}>
            Save Edits
          </DialogButton>
        </PanelSectionRow>
      </PanelSection>
    </ModalRoot>
  );
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1 | tail -20
```

Expected: new file compiles clean. Errors only possible in not-yet-modified files.

---

## Task 3: Refactor `ConfigureTab.tsx`

**Files:**
- Modify: `src/components/tabs/ConfigureTab.tsx`

This is the largest change. Do it in three sub-steps to keep each diff reviewable.

### Step 3a — Export `EditedReportEntry`, remove overlay state and refs

- [ ] **Step 3.1: Export `EditedReportEntry` so the new modals can import it**

In `ConfigureTab.tsx`, find the `interface EditedReportEntry` declaration (currently around line 48) and add `export`:

```ts
// Before:
interface EditedReportEntry {

// After:
export interface EditedReportEntry {
```

- [ ] **Step 3.2: Remove overlay-only state declarations**

Find and delete these `useState` lines inside `ConfigureTabContent` (around lines 651–660):

```ts
// DELETE these lines:
const [overlayMode, setOverlayMode] = useState<'list' | 'detail' | 'edit'>('list');
const [applying, setApplying] = useState(false);
const [upvoting, setUpvoting] = useState(false);
const [focusedToolbarControl, setFocusedToolbarControl] = useState<'sort' | 'filter' | null>(null);
const [focusedActionControl, setFocusedActionControl] = useState<ActionControlKey | null>(null);
const [focusedDetailRow, setFocusedDetailRow] = useState<DetailRowKey | null>(null);
const [editDraft, setEditDraft] = useState<EditableReportFields | null>(null);
```

- [ ] **Step 3.3: Remove overlay-only refs**

Find and delete these `useRef` declarations (around lines 665–683):

```ts
// DELETE these lines:
const detailScrollRef = useRef<HTMLDivElement>(null);
const actionStripRef = useRef<HTMLDivElement>(null);
const gameRowRef = useRef<HTMLDivElement>(null);
const launchRowRef = useRef<HTMLDivElement>(null);
const currentRowRef = useRef<HTMLDivElement>(null);
const hardwareRowRef = useRef<HTMLDivElement>(null);
const scoringRowRef = useRef<HTMLDivElement>(null);
const reportRowRef = useRef<HTMLDivElement>(null);
const detailRowRefs: Record<Exclude<DetailRowKey, 'actions'>, RefObject<HTMLDivElement | null>> = {
  game: gameRowRef,
  launch: launchRowRef,
  current: currentRowRef,
  hardware: hardwareRowRef,
  scoring: scoringRowRef,
  report: reportRowRef,
};
```

- [ ] **Step 3.4: Remove the `overlayMode` reset lines inside the `useEffect` that resets state on appId change**

In the `useEffect` triggered by `[appId, appName, loadNonce, sysInfo, isActive]` (around line 758), delete:

```ts
// DELETE from the useEffect body:
setOverlayMode('list');
...
setEditDraft(null);
setFocusedDetailRow(null);
```

Also in the `useEffect` on `[selectedKey, sortedReports]` (around line 839), delete:

```ts
// DELETE from that useEffect body:
setOverlayMode('list');
setFocusedDetailRow(null);
```

- [ ] **Step 3.5: Remove the `overlayMode === 'detail' | 'edit'` useLayoutEffects**

Delete the two `useLayoutEffect` blocks (around lines 877–910) that:
- Scroll + focus the action strip when overlay opens
- Hide the "Manage This Game" sidebar title via DOM hack

- [ ] **Step 3.6: Remove the overlay-only `useEffect` blocks**

Delete:
- The `useEffect` on `[overlayMode]` that calls `debugMovement('overlay-mode-changed', ...)` (around line 912)
- The `useEffect` on `[overlayMode, appId]` that calls `setManageGameLoadNonce` (around line 72 in Modal.tsx, not ConfigureTab — skip)
- The `useEffect` on `[onOverlayOpenChange, overlayOpen]` (around line 1409)
- The focus-recovery `useEffect` on `[actionOrder, focusedActionControl, focusedDetailRow, overlayOpen]` (around line 1413)

### Step 3b — Remove overlay functions and simplify `handleApply` / `handleUpvote`

- [ ] **Step 3.7: Delete overlay-only functions**

Delete these functions entirely (search by name, they are all inside `ConfigureTabContent`):

- `handleBackOneLevel`
- `handleOverlayDirection`
- `focusActionByName`
- `focusDetailRow`
- `focusDetailScroll`
- `nudgeIntoDetailContent`
- `focusFirstReportCard`
- `focusToolbarControl`
- `findMainPaneManageTitle` (module-level helper, around line 257)
- `gamepadButtonLabel` (module-level helper, around line 268)
- `describeActiveElement` (module-level helper, around line 281)
- `consumeGamepadEvent` (module-level helper, around line 299)

- [ ] **Step 3.8: Refactor `handleApply` to accept the report as a parameter**

Replace the existing `handleApply` function with this version that takes the report directly (removing dependency on `selected` state and `setApplying`):

```ts
const handleApply = async (targetReport: DisplayReportCard) => {
  void logFrontendEvent('INFO', 'Apply launch option requested', {
    appId,
    appName,
    protonVersion: targetReport.protonVersion,
  });
  const running = (SteamClient.GameSessions as any)?.GetRunningApps?.() ?? [];
  if (running.length > 0) {
    void logFrontendEvent('WARNING', 'Apply blocked because a game is running', { appId, runningCount: running.length });
    toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
    return;
  }
  try {
    const availability = await checkProtonVersionAvailability(targetReport.protonVersion);
    let launchProtonVersion = availability.managed
      ? (availability.normalized_version ?? targetReport.protonVersion)
      : targetReport.protonVersion;
    if (availability.managed && !availability.installed) {
      const managerState = await getProtonGeManagerState(false);
      const latestInstalledTool = findLatestInstalledTool(managerState);
      const closestInstalledTool = findClosestInstalledTool(
        managerState,
        availability.normalized_version ?? targetReport.protonVersion,
      );
      const installedTools = managerState.installed_tools;

      const choice = await new Promise<MissingVersionChoice>((resolve) => {
        const modal = showModal(
          <MissingVersionModal
            requiredVersion={availability.normalized_version ?? targetReport.protonVersion}
            latestInstalledLabel={latestInstalledTool?.display_name ?? null}
            closestInstalledLabel={closestInstalledTool?.display_name ?? null}
            onResolve={(nextChoice) => { resolve(nextChoice); modal.Close(); }}
            onCancel={() => { resolve('cancel'); modal.Close(); }}
          />,
        );
      });

      if (choice === 'cancel') {
        toaster.toast({ title: 'Proton Pulse', body: 'Apply cancelled.' });
        return;
      }
      if (choice === 'pick') {
        if (installedTools.length === 0) {
          toaster.toast({ title: 'Proton Pulse', body: 'No installed compatibility tools were available. Using the required version instead.' });
        } else {
          const pickedVersion = await new Promise<string | null>((resolve) => {
            const modal = showModal(
              <InstalledVersionPickerModal
                tools={installedTools}
                onPick={(version) => { resolve(version); modal.Close(); }}
                onCancel={() => { resolve(null); modal.Close(); }}
              />,
            );
          });
          if (!pickedVersion) {
            toaster.toast({ title: 'Proton Pulse', body: 'Apply cancelled.' });
            return;
          }
          launchProtonVersion = pickedVersion;
        }
      } else if (choice === 'closest') {
        if (closestInstalledTool) {
          launchProtonVersion = launchVersionValueForTool(closestInstalledTool);
          toaster.toast({ title: 'Proton Pulse', body: `Using closest installed version: ${closestInstalledTool.display_name}` });
        } else if (latestInstalledTool) {
          launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
          toaster.toast({ title: 'Proton Pulse', body: `No close match found. Using latest installed: ${latestInstalledTool.display_name}` });
        } else {
          const installResult = await installProtonGe(availability.normalized_version);
          if (!installResult.success) {
            toaster.toast({ title: 'Proton Pulse', body: `Closest-version search failed, and install failed for ${availability.normalized_version}.` });
          } else if (availability.normalized_version) {
            launchProtonVersion = availability.normalized_version;
          }
        }
      } else if (choice === 'latest') {
        if (latestInstalledTool) {
          launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
        } else {
          toaster.toast({ title: 'Proton Pulse', body: 'No installed compatibility tools were available. Using the required version instead.' });
        }
      } else {
        const installResult = await installProtonGe(availability.normalized_version);
        if (!installResult.success) {
          if (latestInstalledTool) {
            launchProtonVersion = launchVersionValueForTool(latestInstalledTool);
            toaster.toast({ title: 'Proton Pulse', body: `Install failed for ${availability.normalized_version}. Using ${latestInstalledTool.display_name} instead.` });
          } else {
            toaster.toast({ title: 'Proton Pulse', body: `Install failed for ${availability.normalized_version}. Applying with the requested version anyway.` });
          }
        } else {
          toaster.toast({
            title: 'Proton Pulse',
            body: installResult.already_installed
              ? `${availability.normalized_version} is already installed.`
              : `Installed ${availability.normalized_version}. Steam may need a restart before the new compatibility tool appears everywhere.`,
          });
          launchProtonVersion = availability.normalized_version ?? targetReport.protonVersion;
        }
      }
    }
    await SteamClient.Apps.SetAppLaunchOptions(appId, `PROTON_VERSION="${launchProtonVersion}" %command%`);
    const detailsResult = await getSteamAppDetails(appId);
    const appliedLaunchOptions = getLaunchOptionsFromDetails(detailsResult.details);
    setCurrentLaunchOptions(appliedLaunchOptions);
    void logFrontendEvent('INFO', 'Launch options applied', { appId, appName, protonVersion: launchProtonVersion, appliedLaunchOptions });
    toaster.toast({ title: 'Proton Pulse', body: appliedLaunchOptions || `Applied for ${appName}` });
  } catch (e) {
    void logFrontendEvent('ERROR', 'Failed to apply launch options', {
      appId, appName, protonVersion: targetReport.protonVersion,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error('Proton Pulse: apply failed', e);
    toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
  }
};
```

- [ ] **Step 3.9: Refactor `handleUpvote` to accept the report as a parameter**

Replace the existing `handleUpvote` with:

```ts
const handleUpvote = async (targetReport: DisplayReportCard) => {
  const token = getSetting<string>('gh-votes-token', '');
  if (!token) {
    void logFrontendEvent('WARNING', 'Upvote blocked because GitHub token is missing', { appId, appName });
    toaster.toast({ title: 'Proton Pulse', body: 'Set a GitHub token in Settings to upvote.' });
    return;
  }
  void logFrontendEvent('INFO', 'Upvote requested', {
    appId, appName, protonVersion: targetReport.protonVersion, reportTimestamp: targetReport.timestamp,
  });
  try {
    const reportKey = (r: { timestamp: number; protonVersion: string }) =>
      `${r.timestamp}_${r.protonVersion}`;
    const ok = await postUpvote(String(appId), reportKey(targetReport), token);
    if (ok) {
      void logFrontendEvent('INFO', 'Upvote accepted by remote endpoint', { appId, appName });
      toaster.toast({ title: 'Proton Pulse', body: 'Vote submitted! Count updates in ~60s.' });
      const capturedAppId = appId;
      setTimeout(() => {
        if (capturedAppId) {
          void logFrontendEvent('DEBUG', 'Refreshing votes after upvote delay', { appId: capturedAppId });
          getVotes(String(capturedAppId)).then(setVotes).catch(console.error);
        }
      }, 90_000);
    } else {
      void logFrontendEvent('WARNING', 'Upvote request failed at remote endpoint', { appId, appName });
      toaster.toast({ title: 'Proton Pulse', body: 'Vote failed. Check the token value and its repo/actions permissions.' });
    }
  } catch (e) {
    void logFrontendEvent('ERROR', 'Upvote threw an error', {
      appId, appName, error: e instanceof Error ? e.message : String(e),
    });
    toaster.toast({ title: 'Proton Pulse', body: 'Upvote failed — check logs.' });
  }
};
```

### Step 3c — Replace `openReportDetail`, update toolbar, clean up Props and type imports

- [ ] **Step 3.10: Replace `openReportDetail` with `showModal` call**

Replace the existing `openReportDetail` function with:

```ts
const openReportDetail = (report: DisplayReportCard) => {
  setSelectedKey(report.displayKey);
  void logFrontendEvent('DEBUG', 'Opening report detail modal', {
    appId,
    protonVersion: report.protonVersion,
    displayKey: report.displayKey,
  });
  showModal(
    <ReportDetailModal
      report={report}
      appId={appId}
      appName={appName}
      sysInfo={sysInfo}
      currentLaunchOptions={currentLaunchOptions}
      onApply={handleApply}
      onUpvote={handleUpvote}
      onSaveEdit={(entry) => setEditedReports((prev) => [entry, ...prev])}
    />,
    window,
    { bAllowFullSize: true },
  );
};
```

- [ ] **Step 3.11: Replace `FilterMenuButton` with `Dropdown` in the toolbar**

In the JSX, find the two `<FilterMenuButton>` usages (sort and filter dropdowns) and replace them with `<Dropdown>`:

Sort button (was `FilterMenuButton` with sort options):
```tsx
<Dropdown
  rgOptions={[
    { data: 'score', label: 'Best Match' },
    { data: 'votes', label: 'Most Votes' },
  ]}
  selectedOption={sortMode}
  onChange={(opt) => setSortPreference(opt.data as SortMode)}
/>
```

Filter button (was `FilterMenuButton` with GPU tier options):
```tsx
<Dropdown
  rgOptions={FILTER_ORDER.map((tier) => ({
    data: tier,
    label: tier === 'all' ? 'All' : FILTER_LABELS[tier],
  }))}
  selectedOption={filter}
  onChange={(opt) => setFilterMode(opt.data as FilterTier)}
/>
```

Remove the `<Focusable>` wrappers that were around each `FilterMenuButton` and the `sortControlRef`/`filterControlRef` refs.

- [ ] **Step 3.12: Replace the custom loading spinner with `SteamSpinner`**

Find the `<LoadingIndicator>` usage (around line 1429) and the `{loading ? <LoadingIndicator ...> :` branch and replace:

```tsx
// Before:
{loading ? (
  <LoadingIndicator label="Fetching ProtonDB reports…" />
) : ...}

// After:
{loading ? (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
    <SteamSpinner />
  </div>
) : ...}
```

Also delete the `LoadingIndicator` function definition (around lines 529–546).

- [ ] **Step 3.13: Simplify the root `Focusable` `handleRootDirection`**

The root `Focusable`'s `onGamepadDirection` now only needs to trap `DIR_LEFT`. Replace `handleRootDirection` with:

```ts
const handleRootDirection = (evt: GamepadEvent) => {
  if (evt.detail.button === GamepadButton.DIR_LEFT) {
    evt.preventDefault();
  }
};
```

Remove the rest of the existing `handleRootDirection` body (all the overlay-mode branching).

- [ ] **Step 3.14: Remove the `overlayOpen` conditional JSX branch**

The entire `{overlayOpen ? <detail JSX> : <list JSX>}` split is now gone. The component always renders only the card list view. Delete the `overlayOpen` ternary and keep only the card list portion:

```tsx
// The content area after the toolbar should just be:
<div ref={reportListRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
  <div style={{ marginBottom: 12, color: '#9db0c4', fontSize: 11 }}>
    {detectingGpu
      ? 'Detecting your GPU tier before narrowing the list. Showing all reports for now.'
      : 'Select a report card to view the full report.'}
  </div>
  <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid #2a3a4a' }}>
    {sortedReports.length === 0 ? (
      <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
        {detectingGpu ? 'Detecting GPU tier…' : 'No reports for this GPU tier.'}
      </div>
    ) : (
      sortedReports.map((r) => (
        <ReportCard
          key={r.displayKey}
          report={r}
          selected={selectedKey === r.displayKey}
          focused={focusedCardKey === r.displayKey}
          onFocus={(report) => {
            setFocusedCardKey(report.displayKey);
            setSelectedKey(report.displayKey);
          }}
          onSelect={openReportDetail}
        />
      ))
    )}
  </div>
</div>
```

- [ ] **Step 3.15: Update the `Props` interface — remove `onOverlayOpenChange`, `overlayHost`, `loadNonce`, `isActive`**

```ts
// Before:
interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
  isActive?: boolean;
  loadNonce?: number;
  onOverlayOpenChange?: (open: boolean) => void;
  overlayHost?: HTMLElement | null;
}

// After:
interface Props {
  appId: number | null;
  appName: string;
  sysInfo: SystemInfo | null;
}
```

- [ ] **Step 3.16: Remove unused type aliases**

Delete these type aliases that were only used by the overlay:
```ts
// DELETE:
type DetailRowKey = 'actions' | 'game' | 'launch' | 'current' | 'hardware' | 'scoring' | 'report';
type ActionControlKey = 'apply' | 'edit' | 'upvote' | 'back' | 'save' | 'cancel';
```

Also delete `EditableReportFields` interface and `makeEditableFields`, `applyEditableFields` functions — these only served the in-place edit view. Edit logic now lives entirely in `EditReportModal`.

- [ ] **Step 3.17: Add new imports, remove unused imports**

Add to the import from `@decky/ui`:
```ts
import { Focusable, GamepadButton, DialogButton, ConfirmModal, showModal,
         Menu, MenuItem, showContextMenu, PanelSection, PanelSectionRow,
         Dropdown, SteamSpinner } from '@decky/ui';
```

Remove `showContextMenu`, `Menu`, `MenuItem` if no longer used after the `FilterMenuButton` replacement.

Add component imports:
```ts
import { ReportDetailModal } from '../ReportDetailModal';
```

- [ ] **Step 3.18: Verify TypeScript compiles with no errors**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1 | tail -30
```

Expected: zero TypeScript errors. If there are errors, fix them before continuing.

---

## Task 4: Clean up `Modal.tsx` (ProtonPulsePage)

**Files:**
- Modify: `src/components/Modal.tsx`

- [ ] **Step 4.1: Remove overlay state**

Delete these `useState` and derived variable lines inside `ProtonPulsePage`:

```ts
// DELETE:
const [manageGameLoadNonce, setManageGameLoadNonce] = useState(0);
const [manageGameOverlayOpen, setManageGameOverlayOpen] = useState(false);
const [overlayHost, setOverlayHost] = useState<HTMLDivElement | null>(null);
const overlayLocked =
  activePage === 'manage-game' &&
  (manageGameOverlayOpen || ((overlayHost?.childElementCount ?? 0) > 0));
```

- [ ] **Step 4.2: Remove overlay-related effects**

Delete the `useEffect` that increments `manageGameLoadNonce`:
```ts
// DELETE:
useEffect(() => {
  if (tab === 'manage-game' && id) {
    setManageGameLoadNonce((value) => value + 1);
  }
}, ...);
```

And the `useEffect` on `[activePage, appId]` that also increments nonce.

- [ ] **Step 4.3: Remove `overlayLocked` guard from `onPageRequested`**

```ts
// Before:
onPageRequested={(page) => {
  if (overlayLocked) {
    void logFrontendEvent('INFO', 'Ignored sidebar page request while report detail overlay is open', { ... });
    return;
  }
  void logFrontendEvent('INFO', 'Sidebar page requested', { ... });
  setActivePage(page);
}}

// After:
onPageRequested={(page) => {
  void logFrontendEvent('INFO', 'Sidebar page requested', { page, appId, appName });
  setActivePage(page);
}}
```

- [ ] **Step 4.4: Remove the overlay blocking divs and B Back hint from JSX**

Delete:
```tsx
// DELETE the overlayHost ref div:
<div
  ref={setOverlayHost}
  style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: overlayLocked ? 'auto' : 'none' }}
/>

// DELETE the sidebar-cover div:
{activePage === 'manage-game' && overlayLocked && (
  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 362, zIndex: 3, ... }} />
)}

// DELETE the "B Back" hint badge:
<div style={{ position: 'absolute', top: 10, right: 138, zIndex: 2, ... }}>
  <span style={{ fontSize: 10, color: '#f4fbff', letterSpacing: 0.3 }}>B Back</span>
</div>
```

- [ ] **Step 4.5: Remove `onOverlayOpenChange` and `overlayHost` from `ConfigureTab` usage**

In the `pages` array where `ConfigureTab` is rendered:

```tsx
// Before:
content: (
  <ConfigureTab
    appId={appId}
    appName={appName}
    sysInfo={sysInfo}
    isActive={activePage === 'manage-game'}
    loadNonce={manageGameLoadNonce}
    onOverlayOpenChange={setManageGameOverlayOpen}
    overlayHost={overlayHost}
  />
),

// After:
content: (
  <ConfigureTab
    appId={appId}
    appName={appName}
    sysInfo={sysInfo}
  />
),
```

- [ ] **Step 4.6: Remove the outer `<div style={{ position: 'relative', height: '100%' }}>` wrapper if it only existed for overlay positioning**

The `ProtonPulsePage` return can now be simplified to just the `SidebarNavigation`:

```tsx
return (
  <SidebarNavigation
    title="Proton Pulse"
    showTitle={false}
    pages={pages}
    page={activePage}
    onPageRequested={(page) => {
      void logFrontendEvent('INFO', 'Sidebar page requested', { page, appId, appName });
      setActivePage(page);
    }}
    disableRouteReporting={true}
  />
);
```

- [ ] **Step 4.7: Verify TypeScript compiles**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1 | tail -20
```

Expected: zero errors.

---

## Task 5: Fix `DIR_LEFT` `evt.preventDefault()` across all tabs

**Files:**
- Modify: `src/components/tabs/ManageTab.tsx`
- Modify: `src/components/tabs/LogsTab.tsx`
- Modify: `src/components/tabs/SettingsTab.tsx`
- Modify: `src/components/tabs/AboutTab.tsx`
- Modify: `src/components/tabs/GeneralSettingsTab.tsx`

Every `handleRootDirection` / `handleDirection` currently does `return` for `DIR_LEFT` without calling `evt.preventDefault()`. The event still propagates and can reach the sidebar. The fix is to add `evt.preventDefault()` before returning.

- [ ] **Step 5.1: Fix `ManageTab.tsx`**

The `handleRootDirection` function is currently defined **outside** the `ManageTab` component (after its closing brace on line 93). Move it **inside** the component and add `evt.preventDefault()`:

```tsx
// src/components/tabs/ManageTab.tsx
// Inside ManageTab function body, before the return statement:
const handleRootDirection = (evt: GamepadEvent) => {
  if (evt.detail.button === GamepadButton.DIR_LEFT) {
    evt.preventDefault();
  }
};
```

Delete the module-level `handleRootDirection` declaration that currently lives after the closing `}` of `ManageTab`.

- [ ] **Step 5.2: Fix `LogsTab.tsx`**

In `handleDirection`, add `evt.preventDefault()` to the `DIR_LEFT` branch:

```ts
// Before:
if (evt.detail.button === GamepadButton.DIR_LEFT) {
  return;
}

// After:
if (evt.detail.button === GamepadButton.DIR_LEFT) {
  evt.preventDefault();
  return;
}
```

- [ ] **Step 5.3: Fix `SettingsTab.tsx`**

In `handleRootDirection`, add `evt.preventDefault()`:

```ts
// Before:
const handleRootDirection = (evt: GamepadEvent) => {
  if (evt.detail.button === GamepadButton.DIR_LEFT) {
    return;
  }
};

// After:
const handleRootDirection = (evt: GamepadEvent) => {
  if (evt.detail.button === GamepadButton.DIR_LEFT) {
    evt.preventDefault();
  }
};
```

- [ ] **Step 5.4: Fix `AboutTab.tsx`**

Same change as Step 5.3, applied to `AboutTab`'s `handleRootDirection`.

- [ ] **Step 5.5: Fix `GeneralSettingsTab.tsx`**

Same change as Step 5.3, applied to `GeneralSettingsTab`'s `handleRootDirection`.

- [ ] **Step 5.6: Verify TypeScript compiles**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1 | tail -10
```

Expected: zero errors.

---

## Task 6: Full build, test suite, deploy, and verify

**Files:** None — verification only.

- [ ] **Step 6.1: Run the full TypeScript build**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm build 2>&1
```

Expected: `created dist/index.js` (or equivalent rollup success output), zero TypeScript errors.

- [ ] **Step 6.2: Run the existing test suite**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse && pnpm test 2>&1
```

Expected: all tests pass. These tests cover `scoring.ts`, `protondb.ts`, `settings.ts`, `pageState.ts` — none of the UI changes touch these. If any fail, investigate before proceeding.

- [ ] **Step 6.3: Deploy to the Deck**

```bash
DECK_IP=192.168.0.173 make build-and-deploy
```

Expected: build succeeds, plugin files copied to Deck over SSH, Decky reloads the plugin.

- [ ] **Step 6.4: Pull fresh logs**

```bash
DECK_IP=192.168.0.173 make get-logs
```

Check `logs/` directory for the newest log file. Verify no crash or render errors on plugin load.

- [ ] **Step 6.5: Manual verification checklist**

On the Deck, verify each item:

**Report detail navigation:**
- [ ] Game settings gear → ProtonDB Config → "Manage This Game" tab → card list loads
- [ ] Select a report card → fullscreen `ReportDetailModal` opens (no sidebar visible)
- [ ] B button from detail modal → returns to card list
- [ ] "Apply Config" button → shows loading state → applies and shows toast
- [ ] "Edit Config" button → `EditReportModal` opens on top of detail modal
- [ ] B button from edit modal → returns to detail modal
- [ ] "Save Edits" in edit modal → new entry appears at top of card list, detail modal closes

**Input isolation:**
- [ ] In "Manage This Game" card list: pressing LEFT D-pad does NOT switch to the sidebar tabs
- [ ] In "Manage Configurations" tab: pressing LEFT D-pad does NOT switch sidebar tabs
- [ ] In "Logs" tab: pressing LEFT D-pad does NOT switch sidebar tabs
- [ ] In "Compatibility Tools" tab: pressing LEFT D-pad does NOT switch sidebar tabs
- [ ] In "Settings" tab: pressing LEFT D-pad does NOT switch sidebar tabs
- [ ] In "About" tab: pressing LEFT D-pad does NOT switch sidebar tabs

- [ ] **Step 6.6: Commit**

```bash
cd /home/mike/src/decky-proton-pulse-project/decky-proton-pulse
git add \
  src/components/ReportDetailModal.tsx \
  src/components/EditReportModal.tsx \
  src/components/tabs/ConfigureTab.tsx \
  src/components/Modal.tsx \
  src/components/tabs/ManageTab.tsx \
  src/components/tabs/LogsTab.tsx \
  src/components/tabs/SettingsTab.tsx \
  src/components/tabs/AboutTab.tsx \
  src/components/tabs/GeneralSettingsTab.tsx \
  docs/superpowers/specs/2026-04-04-report-detail-navigation-design.md \
  docs/superpowers/plans/2026-04-04-report-detail-navigation.md
git commit -m "$(cat <<'EOF'
fix: replace overlay navigation with native showModal for report detail

Removes the in-place overlayMode system from ConfigureTab and replaces it
with showModal(bAllowFullSize) so Steam's modal stack handles focus
isolation natively. Fixes gamepad input leaking to sidebar tabs.

Adds ReportDetailModal and EditReportModal using native @decky/ui
components (ModalRoot, PanelSection, Field, TextField, DropdownItem).
Fixes evt.preventDefault() for DIR_LEFT across all tab root Focusables.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `ReportDetailModal` with `bAllowFullSize` → Task 1
- ✅ `EditReportModal` with native `TextField`/`DropdownItem` → Task 2
- ✅ Remove `overlayMode`, all refs, focus functions from `ConfigureTab` → Task 3
- ✅ `handleApply` / `handleUpvote` refactored to accept report param → Task 3
- ✅ `Dropdown` replaces `FilterMenuButton` → Task 3
- ✅ `SteamSpinner` replaces custom spinner → Task 3
- ✅ `Modal.tsx` overlay machinery removed → Task 4
- ✅ `DIR_LEFT` `evt.preventDefault()` in all five remaining tabs → Task 5
- ✅ Full deploy + verification → Task 6

**Type consistency:** `EditedReportEntry` is exported from `ConfigureTab.tsx` in Step 3.1 and imported by `ReportDetailModal` and `EditReportModal`. `DisplayReportCard` is imported from `ReportCard.tsx` in both new files. `handleApply(report)` and `handleUpvote(report)` signatures match `onApply`/`onUpvote` props in `ReportDetailModalProps`.
