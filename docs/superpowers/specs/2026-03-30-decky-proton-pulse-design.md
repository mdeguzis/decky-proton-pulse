# Decky Proton Pulse — Phase 1 Design Spec
**Date:** 2026-03-30
**Scope:** Phase 1 — ProtonDB fetcher + weighted ranker + modal UI + badge injection + CEF apply
**Plugin name:** decky-proton-pulse
**Target platform:** Steam Deck / Linux (CachyOS, Arch-based), Decky Loader

---

## 1. Overview

Decky Proton Pulse is a Decky Loader plugin that automatically fetches ProtonDB compatibility reports for the currently focused game, scores them against the user's local system specs using a weighted algorithm, and presents a ranked modal list of ProtonDB profiles. The user selects a profile and clicks Apply — the plugin writes the launch options directly to Steam via CEF IPC (no VDF editing).

**Phase 1 scope:**
- System spec auto-detection (Python)
- ProtonDB API fetch (summary + full reports)
- Weighted scoring + GPU tier bucketing (TypeScript)
- Ranked report modal with card UI (React)
- Game page badge injection (right of existing ProtonDB badge)
- CEF launch option apply (TypeScript, via `SteamClient.Apps.SetAppLaunchOptions`)
- File logger with in-plugin log viewer + debug toggle
- Helper scripts for dev setup and deployment

**Deferred to Phase 2:**
- Local SQLite thumbs-up/down database
- Score adjustment from local ratings
- Settings overrides for detected specs

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│  Steam Client (CEF)                             │
│  ┌─────────────────┐   ┌──────────────────────┐ │
│  │  Game Page      │   │  Decky Sidebar       │ │
│  │  [PP Badge] ──┐ │   │  [Check ProtonDB]    │ │
│  └───────────────┼─┘   │  [Debug toggle]      │ │
│                  │     │  [Log viewer]        │ │
│                  │     └──────────┬───────────┘ │
│                  │  React/TS      │             │
│           ┌──────▼────────────────▼──────┐      │
│           │   Scoring Engine (TS)        │      │
│           │   Modal + Badge Renderer     │      │
│           └──────────────┬──────────────┘      │
│                          │ @decky/api callable  │
└──────────────────────────┼──────────────────────┘
                           │
         ┌─────────────────▼──────────────────┐
         │  Python Backend (main.py)           │
         │  - System spec detection            │
         │  - ProtonDB API fetcher             │
         │  - CEF launch option apply (TypeScript, via `SteamClient.Apps.SetAppLaunchOptions`)       │
         │  - File logger → /tmp/pp.log        │
         └─────────────────────────────────────┘
```

**Boundaries:**
- **Python owns:** all system I/O, network calls, CEF writes, disk logging
- **TypeScript owns:** weighted scoring, GPU tier bucketing, all UI rendering
- **Communication:** `callable()` for request/response, `emit()` for async events
- **Badge injection:** Decky `routerHook` / `gamepadSlotHook` — no Steam file patching

---

## 3. Python Backend

### 3.1 System Detection
Runs once at `_main()`, result cached for the session.

```python
get_system_info() → {
  cpu: str,           # e.g. "AMD Ryzen 9 9950X3D"
  ram_gb: int,        # e.g. 64
  gpu: str,           # e.g. "NVIDIA GeForce RTX 5080"
  gpu_vendor: str,    # "nvidia" | "amd" | "intel" | "other"
  driver_version: str,
  kernel: str,
  distro: str,
  proton_custom: str | None   # detected from Steam compatibilitytools.d/
}
```

**Sources:**
| Field | Source |
|---|---|
| cpu | `/proc/cpuinfo` → `model name` |
| ram_gb | `/proc/meminfo` → `MemTotal` |
| gpu / gpu_vendor | `lspci \| grep -i vga` |
| driver_version | `nvidia-smi --query-gpu=driver_version` (NVIDIA) or `/sys/class/drm/*/device/uevent` |
| kernel | `uname -r` |
| distro | `/etc/os-release` → `PRETTY_NAME` |
| proton_custom | `~/.steam/root/compatibilitytools.d/` directory scan |

Any field that fails detection is set to `null` and logged at `WARN`. Never raises.

### 3.2 ProtonDB API Fetcher

**Endpoints:**
- **Summary** (badge prefetch): `https://www.protondb.com/api/v1/reports/summaries/{app_id}.json`
- **Full reports** (modal): `https://www.protondb.com/api/v1/reports/app/{app_id}`

**Headers:**
```python
{
    "User-Agent": "decky-proton-pulse/0.1.0 (github.com/<owner>/decky-proton-pulse)"  # replace <owner> with GitHub username
}
```
Mirrors the approach used by protondb-decky (OMGDuke) to avoid being blocked.

**Methods:**
```python
fetch_protondb_summary(app_id: str) → dict | None
fetch_protondb_reports(app_id: str) → list[dict]
```

**Retry / timeout:**
- Timeout: 10 seconds
- On 429: exponential backoff (2s, 4s, 8s), max 3 retries
- On 404: return empty list (no reports exist)
- On other error: return empty list, log at ERROR

**Cache:** In-memory per `app_id` for the session. Invalidated on plugin reload.

### 3.3 Game-Running Guard (Backend)

```python
is_game_running() → bool
```

Returns `True` if any game process is active (checked via `/proc` scan or `SteamClient.GameSessions` state). Used as defense-in-depth — frontend enforces this first, backend confirms before any destructive operation.

> **CEF injection note:** `SteamClient.Apps.SetAppLaunchOptions` is a JavaScript API accessible only within the Steam CEF context. It is called directly from TypeScript (see Section 4.3), not from Python. Python has no role in the Apply action.

### 3.4 Logger

- **File:** `/tmp/decky-proton-pulse.log`
- **Rotation:** 5MB max, 2 backups
- **Format:** `[YYYY-MM-DD HH:MM:SS] [LEVEL] message`
- **Default level:** `INFO`
- **Runtime toggle:** `set_log_level(level: str)` callable — frontend sends `"DEBUG"` or `"INFO"`
- **Read for UI:** `get_log_contents() → str` — returns last 200 lines of log file

---

## 4. Frontend (TypeScript / React)

### 4.1 Decky Sidebar Panel

```
┌─────────────────────────┐
│  Proton Pulse           │
│  ─────────────────────  │
│  [Check ProtonDB ▶]     │  ← disabled if game running
│                         │
│  ─ Settings ─────────── │
│  Debug Logs  [toggle]   │
│                         │
│  ─ Logs ─────────────── │
│  [scrollable log view]  │  ← auto-scrolls to bottom
└─────────────────────────┘
```

- **Check ProtonDB button:** Disabled with tooltip "Quit your game first" if `SteamClient.GameSessions.GetRunningApps()` is non-empty
- **Debug toggle:** Calls `set_log_level("DEBUG" | "INFO")` on backend; state persisted in Decky settings
- **Log viewer:** Polls `get_log_contents()` every 3 seconds when panel is open; `useEffect` + `ref.scrollIntoView()` ensures auto-scroll to bottom on new content. Shows "No logs yet" placeholder if log file absent.

### 4.2 Game Page Badge

- **Injection point:** `routerHook` on game detail pages, positioned to the right of any existing ProtonDB badge
- **Content:** Top score for the user's GPU tier — e.g. `⚡ NVIDIA Platinum`
- **Style:** Matches ProtonDB badge visual style; badge color and label text customizable via plugin settings
- **Data source:** Summary endpoint (`fetch_protondb_summary`) — lightweight, fetched on game focus
- **Fallback:** Hidden if no data, no error shown

### 4.3 Ranked Report Modal

Opened by the "Check ProtonDB" button in the sidebar. Fetches full reports on open (not before).

```
┌─────────── Proton Pulse ────────────┐
│  GPU Filter: [NVIDIA ▼]             │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ ★ 94  [NVIDIA] GE-Proton9-7  │   │
│  │ 3 months ago · 12 reports    │   │
│  │ PROTON_LOG=1 DXVK_HUD=...   │   │
│  │                      [✓ sel] │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ ★ 87  [NVIDIA] Proton 9.0   │   │
│  │ ...                          │   │
│  └──────────────────────────────┘   │
│                                     │
│  [Clear]   [Exit]   [Apply ▶]       │
└─────────────────────────────────────┘
```

- **GPU filter:** Dropdown — NVIDIA / AMD / Other / All. Defaults to user's detected GPU vendor.
- **Cards:** Score badge, GPU tier badge, Proton version, recency, reporter count, truncated launch options
- **Selection:** Checkbox per card; only one selectable at a time (radio behavior)
- **Apply:** Calls `SteamClient.Apps.SetAppLaunchOptions(parseInt(app_id), selectedOptions)` directly in TypeScript (CEF JS API). Shows toast on success/failure. Guards against game-running state before calling.
- **Clear:** Calls `SteamClient.Apps.SetAppLaunchOptions(parseInt(app_id), "")` to wipe launch options
- **Exit:** Closes modal, no changes

### 4.4 Scoring Engine

Pure TypeScript function, no side effects, easily unit-testable.

```typescript
function scoreReport(report: ProtonDBReport, sysInfo: SystemInfo): ScoredReport
```

**Weights:**

| Factor | Points / Multiplier |
|---|---|
| Base ProtonDB rating (0–1 scale) | × 60 pts max |
| Recency < 3 months | +15 pts |
| Recency 3–12 months | +5 pts |
| Recency > 12 months | −5 pts |
| Reporter history > 5 reports | +8 pts |
| Custom Proton used | +10 pts |
| GPU vendor match (same) | × 1.0 |
| GPU vendor mismatch (different) | × 0.5 |
| GPU vendor unknown | × 0.75 |

**Max possible score:** ~100 pts

Reports are sorted descending within each GPU tier bucket (NVIDIA / AMD / Other).

---

## 5. Data Flow

```
User focuses game in library (no game running)
         │
         ▼
Frontend detects app_id via routerHook
         │
         ▼
fetch_protondb_summary(app_id) → badge updated
         │
         ▼
User opens Decky panel → clicks "Check ProtonDB"
         │
         ▼
fetch_protondb_reports(app_id) → Python (cache miss: HTTP GET)
         │
         ▼
emit("reports_ready", app_id, reports)
         │
         ▼
Frontend: scoreReport() on each report → sorted, bucketed by GPU tier
         │
         ▼
Modal opens with ranked card list
         │
         ▼
User selects report → clicks Apply
         │
         ▼
SteamClient.Apps.SetAppLaunchOptions(parseInt(app_id), options)
(called directly in TypeScript — CEF JS API, no Python round-trip)
         │
         ▼
Toast: "Launch options applied for [Game Name]"
```

---

## 6. Error Handling

| Scenario | Behavior |
|---|---|
| ProtonDB network timeout | Toast "Couldn't reach ProtonDB", badge hidden |
| ProtonDB 404 (no reports) | Badge shows `? No Data`, modal shows "No reports found" |
| ProtonDB 429 rate limit | Exponential backoff (2s/4s/8s × 3), then toast |
| System detection field fails | Field set to `null`, logged WARN, scoring uses fallback |
| `SetAppLaunchOptions` throws | Toast "Failed to apply — check logs", error logged to file |
| Game starts while panel open | Button disables automatically, backend guard returns early |
| Log file missing | Log viewer shows "No logs yet" placeholder |

---

## 7. File Structure (Phase 1)

```
decky-proton-pulse/
├── src/
│   ├── index.tsx           # Plugin entry, sidebar panel, badge injection
│   ├── components/
│   │   ├── Modal.tsx       # Ranked report modal
│   │   ├── ReportCard.tsx  # Individual report card
│   │   ├── Badge.tsx       # Game page badge
│   │   └── LogViewer.tsx   # Scrollable log viewer
│   ├── lib/
│   │   └── scoring.ts      # Weighted scoring engine (pure TS)
│   └── types.ts            # Shared TypeScript types
├── main.py                 # Python backend
├── docs/
│   ├── superpowers/specs/  # Design docs
│   └── tasks/              # Task tracking (pre-deploy)
├── scripts/
│   ├── dev-setup.sh        # Quick start based on decky-plugin-template README
│   └── deploy.sh           # Helper for beta/stable/autobuild targets
├── plugin.json
├── package.json
└── README.md
```

---

## 8. Helper Scripts

### `scripts/dev-setup.sh`
Based on decky-plugin-template quickstart:
1. Check Node.js ≥ 16.14 and pnpm v9 installed
2. Run `pnpm i` and `pnpm run build`
3. Print SSH deploy instructions for Steam Deck

### `scripts/deploy.sh`
Accepts `--target beta|stable|autobuild` flag. Packages plugin zip per Decky distribution spec and optionally SCP to a connected Steam Deck over local network.

---

## 9. Constraints & Notes

- Plugin requires `_root` flag (already set in `plugin.json`) for CEF access
- All lookups blocked while any game is running — enforced in both frontend and backend
- ProtonDB API access mirrors protondb-decky (OMGDuke) header pattern
- No disk cache in Phase 1 — reports live in frontend React state for the session
- Badge must not break if an existing ProtonDB badge is present — append, don't replace
- Scoring weights are constants at the top of `scoring.ts` for easy tuning
