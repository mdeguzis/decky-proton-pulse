# Config Manager & Launch Option Toggles Design

## Overview

A config management system that tracks all games configured through Proton Pulse, provides a list UI for viewing/editing/deleting configs, and offers a toggle-based editor for common launch option environment variables (MANGOHUD, DXVK_ASYNC, PROTON_ENABLE_NVAPI, etc.). Inspired by [decky-proton-launch](https://github.com/moi952/decky-proton-launch).

## Data Model

### TrackedConfig

When Proton Pulse applies launch options to a game, a tracking record is saved to localStorage:

```typescript
interface TrackedConfig {
  appId: number;
  appName: string;
  protonVersion: string;       // e.g. "GE-Proton9-27"
  launchOptions: string;       // e.g. 'MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%'
  enabledVars: Record<string, string>; // e.g. { MANGOHUD: "1", DXVK_ASYNC: "1" }
  appliedAt: number;           // Date.now() timestamp
  isEdited?: boolean;          // true if applied from an EditedReportEntry
}
```

Stored as a single array under localStorage key `proton-pulse:tracked-configs`. One config per game — upserts by appId.

### TrackedConfigs module (`src/lib/trackedConfigs.ts`)

- `getTrackedConfigs(): TrackedConfig[]` — returns all tracked configs
- `addTrackedConfig(config: TrackedConfig): void` — upserts by appId
- `removeTrackedConfig(appId: number): void` — removes from tracking AND clears launch options via `SteamClient.Apps.SetAppLaunchOptions(appId, '')`
- `getTrackedConfig(appId: number): TrackedConfig | null` — lookup by appId

## Launch Option Toggles

### Variable Catalog

Env vars shipped inline as a typed constant in `src/lib/launchVars.ts`. Not fetched remotely — keeps it simple and offline-friendly.

#### Categories and Variables

**NVIDIA**
| Variable | Type | Description |
|---|---|---|
| `PROTON_DLSS4_UPGRADE` | bool | Enable DLSS4 upgrade |
| `PROTON_DLSS_INDICATOR` | bool | Show DLSS indicator overlay |
| `NVPRESENT_ENABLE_SMOOTH_MOTION` | bool | NVIDIA smooth motion |

**AMD**
| Variable | Type | Description |
|---|---|---|
| `PROTON_FSR4_UPGRADE` | bool | FSR4 upgrade |
| `PROTON_FSR4_RDNA3_UPGRADE` | bool | FSR4 RDNA3-specific upgrade |
| `PROTON_FSR4_INDICATOR` | bool | Show FSR4 indicator |

**Intel**
| Variable | Type | Description |
|---|---|---|
| `PROTON_XESS_UPGRADE` | bool | XeSS upgrade |
| `PROTON_XESS_INDICATOR` | bool | Show XeSS indicator |

**Wrappers**
| Variable | Type | Description |
|---|---|---|
| `__LSFG` | bool | Lossless Scaling Frame Gen |
| `__FGMOD` | bool | FG Mod |

**Performance**
| Variable | Type | Description |
|---|---|---|
| `DXVK_ASYNC` | bool | DXVK async compilation |
| `PROTON_USE_NTSYNC` | bool | NTSync |
| `RADV_PERFTEST` | enum: `aco`, `gpl` | RADV perf test mode |

**Compatibility**
| Variable | Type | Description |
|---|---|---|
| `PROTON_USE_WINED3D` | bool | Force WineD3D instead of Vulkan |
| `PROTON_HIDE_NVIDIA_GPU` | bool | Hide NVIDIA GPU |
| `PROTON_ENABLE_NVAPI` | bool | Enable NVAPI |
| `ENABLE_HDR_WSI` | bool | HDR WSI extension |
| `PROTON_ENABLE_HDR` | bool | Proton HDR |
| `PROTON_VKD3D_HEAP` | bool | VKD3D heap workaround |
| `SteamDeck` | bool (value `0`) | Spoof Steam Deck identity |

**Debug**
| Variable | Type | Description |
|---|---|---|
| `PROTON_LOG` | bool | Enable Proton logging |
| `MANGOHUD` | bool | Enable MangoHud overlay |
| `MANGOHUD_CONFIG` | enum: `no_display`, `fps_only=1`, `full` | MangoHud config preset |

### Variable Definition Type

```typescript
interface LaunchVarDef {
  key: string;                          // env var name
  type: 'bool' | 'enum';
  category: 'nvidia' | 'amd' | 'intel' | 'wrappers' | 'performance' | 'compatibility' | 'debug';
  description: string;
  defaultValue?: string;                // for SteamDeck, default is "0"
  options?: string[];                   // for enum type
}
```

### Build & Parse Functions

```typescript
// Compose launch options from proton version + enabled vars
buildLaunchOptions(protonVersion: string | null, enabledVars: Record<string, string>): string
// → 'MANGOHUD=1 DXVK_ASYNC=1 PROTON_VERSION="GE-Proton9-27" %command%'

// Extract proton version and enabled vars from existing launch options string
parseLaunchOptions(launchOptions: string): { protonVersion: string | null; vars: Record<string, string> }
```

These must round-trip cleanly: `parseLaunchOptions(buildLaunchOptions(v, vars))` should return `{ protonVersion: v, vars }`.

### Custom Variables

Users can add arbitrary `KEY=VALUE` entries beyond the catalog. These are stored in `enabledVars` alongside catalog vars and composed into the launch options string the same way.

## Config Editor Modal

A new `ConfigEditorModal` component used for both Create and Edit flows. Opens fullscreen (same pattern as `ReportDetailModal`).

### Layout

1. **Header** — game thumbnail + name + appId
2. **Proton Version** — version picker dropdown (reuse `buildVersionOptions()` extracted from `EditReportModal`)
3. **Toggle Sections** — collapsible category groups. Each category is a titled section with:
   - Bool vars → `ToggleField`
   - Enum vars → `DropdownItem`
   - Categories auto-hide based on GPU vendor from `sysInfo` (hide NVIDIA on AMD device, etc.) but can be expanded manually
4. **Custom Variables** — "Add custom variable" button, appends KEY=VALUE text field pairs
5. **Live Preview** — monospace bar at the bottom showing the composed launch options string, updated live as toggles change
6. **Action Buttons** — "Apply" (saves tracking + sets launch options) and "Cancel"

### Create Flow

1. User clicks "Create Config" on the config list page
2. If a game is focused in the library, it's auto-selected. Otherwise, a game picker dropdown appears (lists owned Steam games)
3. ConfigEditorModal opens with all toggles off and no proton version selected. The game picker uses `SteamClient.Apps.GetAllShortcuts()` combined with the user's library apps. If this API is unavailable or slow, fall back to only offering the focused game or manual appId entry.
4. User configures toggles + picks a proton version
5. "Apply" → calls `SteamClient.Apps.SetAppLaunchOptions()` + `addTrackedConfig()`

### Edit Flow

1. User clicks "Edit" on a config row
2. ConfigEditorModal opens with toggles pre-populated via `parseLaunchOptions()` on the saved config
3. User adjusts toggles / version
4. "Apply" → updates launch options + tracking entry

## Config List Page (ManageTab replacement)

Replaces the current `ManageTab` component.

### Row Layout (Compact)

Each row shows:
- Game thumbnail (capsule image from Steam CDN)
- Game name
- Proton version label
- "Applied X ago" relative timestamp
- Edit button → opens ConfigEditorModal
- Delete button → confirmation dialog → clears launch options + removes tracking

### Current Game Highlighting

If the user has a game focused in the library (`pageState.focusedAppId`), that game's row gets:
- Blue left border (`3px solid #4c9eff`)
- Subtle blue background (`rgba(76,158,255,0.08)`)
- Sorted to top of the list

### Header

A "Create Config" button at the top of the list.

### Empty State

Instructional message: "No configurations yet. Right-click a game in your library and select ProtonDB Config to get started."

Plus a "Configure Current Game" button if `pageState.focusedAppId` is set.

### D-pad Navigation

- Vertical D-pad navigates between rows
- Horizontal D-pad navigates between Edit/Delete buttons within a row
- Same `Focusable` with `display: flex` pattern used in SettingsTab

### Delete Confirmation

`showModal(<ConfirmModal>)` asking "Delete config for {gameName}? This will clear the game's launch options."

## Integration Points

- `ConfigureTab.handleApply` → add `addTrackedConfig()` call after `SetAppLaunchOptions()`
- `ReportDetailModal` "Apply" button → add `addTrackedConfig()` call
- `buildVersionOptions()` → extract from `EditReportModal` to a shared util in `src/lib/compatTools.ts` or `src/lib/versionPicker.ts`
- New i18n keys needed in `TranslationTree` for config list labels, toggle descriptions, category names, editor UI

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/trackedConfigs.ts` | TrackedConfig type, get/add/remove, localStorage persistence |
| Create | `src/lib/trackedConfigs.test.ts` | Tests for CRUD operations |
| Create | `src/lib/launchVars.ts` | Variable catalog, categories, buildLaunchOptions(), parseLaunchOptions() |
| Create | `src/lib/launchVars.test.ts` | Tests for build/parse round-tripping, toggle composition |
| Create | `src/components/ConfigEditorModal.tsx` | Fullscreen modal with version picker + toggle sections + preview |
| Modify | `src/components/tabs/ManageTab.tsx` | Replace with config list UI |
| Modify | `src/components/tabs/ConfigureTab.tsx` | Add addTrackedConfig() in handleApply |
| Modify | `src/components/ReportDetailModal.tsx` | Add addTrackedConfig() in Apply handler |
| Modify | `src/components/EditReportModal.tsx` | Extract buildVersionOptions() to shared util |
| Modify | `src/lib/i18n.ts` | Add new TranslationTree keys |
| Modify | `src/lib/translations/*.ts` | Add translations for new keys (all 9 files) |
