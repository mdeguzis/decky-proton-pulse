# Proton Pulse UI Redesign — Design Spec
**Date:** 2026-03-30
**Scope:** Sidebar restructure, multi-tab full-page modal, badge click, currentAppId fix, settings additions

---

## 1. Problems Being Solved

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| Sidebar shows "Navigate to a game first" even when on game page | `pendingAppId` only works if router patch fires after Content mounts; missed when plugin loads on an already-focused game page | On Content mount, parse `window.location.pathname` for `/library/app/:appid` directly |
| Badge/icon next to ProtonDB badge navigates to ProtonDB website | Our badge has no `onClick` | Add `onClick` prop to `ProtonPulseBadge` that opens the Configure tab |
| Inline log viewer is noisy and takes up sidebar space | LogViewer rendered inline in sidebar | Replace with a "Logs ▶" button; LogViewer moves to its own tab in the full modal |
| No structured navigation between plugin sections | Everything crammed into one sidebar panel | Multi-tab full-page modal (Auto Flatpaks `Tabs` pattern), sidebar becomes compact nav |
| No "Manage Configurations" section | Not built | New Manage tab showing current launch options for the focused game + Clear |
| No badge visibility toggle | Not built | Show Badge toggle in Settings tab |

---

## 2. Reference Plugins

| Plugin | Pattern Borrowed |
|--------|----------------|
| **Auto Flatpaks** | `Tabs` component for multi-page modal (Configure / Manage / Logs / Settings / About) |
| **Wine Cellar** | "Manage" prominent button near top of sidebar, router-style navigation |
| **SteamGridDB** | `Field` with `description` prop for button subtitles |
| **Decky Ludusavi** | Logs as a modal page, not inline |

---

## 3. New Sidebar Structure

```
Proton Pulse
─────────────────────────────────
 [⚡ PP·NVIDIA Platinum]   ← badge, clickable → opens Configure tab
 Elden Ring

 [Configure This Game ▶]
  Find & apply ProtonDB launch options
  (disabled + "Quit your game first" if game running)
  (disabled + "Navigate to a game first" if no appId)

 [Manage Configurations ▶]
  View and clear applied configs

─ Plugin ─────────────────────────
 [Logs ▶]
  View plugin activity log

 [Settings ▶]
  Debug mode and display options
─────────────────────────────────
```

All four buttons use the `Field` + `description` pattern from SteamGridDB.
"Configure This Game" is the primary CTA — same behavior as clicking the badge.

---

## 4. Full-Page Modal (Tabbed)

Opened from any of the sidebar buttons. Uses `showModal` + `ModalRoot` with `Tabs` component inside (Auto Flatpaks pattern). Each button opens the modal at the correct tab via a module-level `initialTab` variable.

### Tab: Configure
- Existing ranked report modal content: GPU filter buttons, sorted ReportCard list, Apply/Clear/Exit
- Moved wholesale from `Modal.tsx` → `src/components/tabs/ConfigureTab.tsx`

### Tab: Manage
- Shows current launch options for the focused game (read via `SteamClient.Apps.GetAppLaunchOptions` if available, otherwise a note to view via Steam → game Properties)
- "Clear Launch Options" button (calls `SetAppLaunchOptions(appId, '')`)
- "No config applied" empty state

### Tab: Logs
- Full-height `LogViewer` component
- Same 3s poll, auto-scroll
- More vertical space than the old inline viewer

### Tab: Settings
- **Debug Logs** toggle (existing, moved from sidebar)
- **Show Badge** toggle — controls whether `ProtonPulseBadge` is injected on game pages (new, persisted via `decky.settingsManager`)

### Tab: About
- Plugin name, version (from `package.json`)
- Short description
- Links: GitHub, ProtonDB, Decky Loader

---

## 5. Badge Changes

`ProtonPulseBadge` gains an optional `onClick` prop:
```tsx
interface Props {
  summary: ProtonDBSummary | null;
  gpuVendor: string | null;
  badgeColor?: string;
  onClick?: () => void;   // new
}
```

When `onClick` is provided, `cursor: 'pointer'` is set and the badge opens the Configure tab.

The badge render is gated by a `showBadge` setting (default: `true`) read from `decky.settingsManager` on mount.

---

## 6. currentAppId Detection Fix

Replace the `pendingAppId` drain with a URL-first approach on Content mount:

```ts
useEffect(() => {
  // Try to detect current game from URL (most reliable)
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
  // ... rest of mount effect
}, []);
```

`pendingAppId` remains as fallback for mid-session navigations that happen while Content is unmounted.

---

## 7. Settings Persistence

Use `decky.settingsManager` (provided by Decky Loader runtime) to persist:
- `debugEnabled: boolean` (default: `false`)
- `showBadge: boolean` (default: `true`)

Read on mount, write on change.

---

## 8. File Changes

| File | Change |
|------|--------|
| `src/index.tsx` | Rewrite sidebar Content; add URL-based appId detection; `showBadge` setting |
| `src/components/Badge.tsx` | Add `onClick` prop; respect `showBadge` setting via prop |
| `src/components/Modal.tsx` | Rename/split → becomes the outer `ProtonPulseModal` with `Tabs`; inner content moves to tabs |
| `src/components/tabs/ConfigureTab.tsx` | New — contains current Modal.tsx report list content |
| `src/components/tabs/ManageTab.tsx` | New — current launch options + Clear |
| `src/components/tabs/LogsTab.tsx` | New — full-height LogViewer wrapper |
| `src/components/tabs/SettingsTab.tsx` | New — debug + showBadge toggles |
| `src/components/tabs/AboutTab.tsx` | New — static about content |
| `src/components/LogViewer.tsx` | No changes |
| `src/components/ReportCard.tsx` | No changes |
| `src/lib/scoring.ts` | No changes |
| `src/types.ts` | No changes |

---

## 9. Out of Scope

- Phase 2 features (SQLite local ratings, per-game history database)
- Actual game-page badge DOM injection position (requires live Steam DOM inspection)
- `appName` from SteamClient (keep `''` fallback, not worth the fragile API call)
