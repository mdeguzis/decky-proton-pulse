# Proton Pulse -- Full Code Walkthrough

This doc walks through every piece of the Proton Pulse codebase so someone
with general Python and TypeScript knowledge can understand how it all fits
together. Written from the perspective of a new engineer reading the code
for the first time.

<!---toc start-->

* [Proton Pulse -- Full Code Walkthrough](#proton-pulse----full-code-walkthrough)
  * [How Decky Plugins Work](#how-decky-plugins-work)
  * [Project Layout](#project-layout)
  * [The Python Backend](#the-python-backend)
    * [main.py -- the Plugin class](#mainpy----the-plugin-class)
    * [lib/system_info.py](#libsystem_infopy)
    * [lib/prefetch.py](#libprefetchpy)
    * [lib/proton_ge.py](#libproton_gepy)
    * [lib/compat_tools.py](#libcompat_toolspy)
    * [lib/http_client.py](#libhttp_clientpy)
    * [lib/cdn_cache.py](#libcdn_cachepy)
    * [Other lib/ modules](#other-lib-modules)
  * [The TypeScript Frontend](#the-typescript-frontend)
    * [src/index.tsx -- plugin entry point](#srcindextsx----plugin-entry-point)
    * [src/components/Modal.tsx -- the main page](#srccomponentsmodaltsx----the-main-page)
    * [Tab components](#tab-components)
    * [Modal components](#modal-components)
    * [src/patches/gameContextMenu.tsx](#srcpatchesgamecontextmenutsx)
  * [How the Two Sides Talk](#how-the-two-sides-talk)
  * [Data Flow: What Happens When You Open a Game](#data-flow-what-happens-when-you-open-a-game)
  * [Scoring Algorithm](#scoring-algorithm)
  * [Caching Strategy](#caching-strategy)
  * [Compatibility Tool Management (Proton-GE)](#compatibility-tool-management-proton-ge)
  * [Launch Option Management](#launch-option-management)
  * [Voting System](#voting-system)
  * [Internationalization (i18n)](#internationalization-i18n)
  * [Navigation and Routing](#navigation-and-routing)
  * [Logging and Diagnostics](#logging-and-diagnostics)
  * [Metrics and Performance Tracking](#metrics-and-performance-tracking)
  * [Screenshot Automation](#screenshot-automation)
  * [Build, Test, and Deploy](#build-test-and-deploy)
    * [Building](#building)
    * [Testing](#testing)
    * [Deploying to a Steam Deck](#deploying-to-a-steam-deck)
    * [CI](#ci)
  * [Configuration Files](#configuration-files)

<!---toc end-->

---

## How Decky Plugins Work

Decky Loader runs inside Steam's Big Picture Mode on the Steam Deck. It
injects into Steam's CEF (Chromium Embedded Framework) browser and gives
plugins two environments:

- A **Python backend** -- separate process, has filesystem/network/shell access
- A **TypeScript/React frontend** -- runs inside Steam's browser, renders the UI

The two sides talk through Decky's `callable` bridge -- frontend calls a
Python method by name, Decky handles JSON serialization both ways. It is
basically a local RPC.

Key files Decky cares about:

- `plugin.json` -- plugin metadata (name, author, flags, store info)
- `main.py` -- Python backend entry point (must export a `Plugin` class)
- `src/index.tsx` -- frontend entry point (must call `definePlugin`)
- `package.json` -- version number and build deps

---

## Project Layout

```
decky-proton-pulse/
|-- main.py                    # Python backend entry point (Plugin class)
|-- lib/                       # Python helper modules
|   |-- cdn_cache.py           # Disk-backed CDN response cache
|   |-- compat_tools.py        # Discover installed Proton/Wine builds
|   |-- http_client.py         # curl-based HTTP (avoids Python SSL issues)
|   |-- metrics_export.py      # Write perf metrics JSON to disk
|   |-- plugin_logging.py      # Logging helpers
|   |-- plugin_utils.py        # Archive unpacking, env cleanup
|   |-- prefetch.py            # Background cache warming on startup
|   |-- proton_ge.py           # Proton-GE download/install/manage
|   |-- protondb_systeminfo.py # Generate system info for ProtonDB submissions
|   |-- screenshot_catalog.py  # Organize screenshots, publish to wiki
|   |-- screenshot_manifest.py # Manifest data model for capture runs
|   |-- steam_paths.py         # Find Steam directories on disk
|   `-- system_info.py         # Detect CPU, GPU, RAM, driver, kernel
|-- src/                       # TypeScript frontend
|   |-- index.tsx              # Plugin entry, sidebar panel, lifecycle
|   |-- types.ts               # Shared TypeScript interfaces
|   |-- components/            # React components
|   |   |-- Modal.tsx          # Main full-page view (SidebarNavigation)
|   |   |-- ReportCard.tsx     # Single report card in the list
|   |   |-- ReportDetailModal.tsx  # Expanded report detail
|   |   |-- EditReportModal.tsx    # Edit launch options from a report
|   |   |-- ConfigEditorModal.tsx  # Edit saved configurations
|   |   |-- CacheManagerModal.tsx  # Inspect and clear cache
|   |   |-- LogViewerModal.tsx     # Full-screen log viewer
|   |   |-- ProtonDBSubmitModal.tsx # Prep system info for ProtonDB
|   |   `-- tabs/              # Tab components for the main page
|   |-- lib/                   # Frontend utility modules
|   `-- patches/
|       `-- gameContextMenu.tsx # Inject "Proton Pulse..." into library menu
|-- scripts/                   # Dev and automation scripts
|-- tests/                     # Python unit tests (pytest)
|-- config/                    # Screenshot manifest JSON
`-- .github/                   # CI workflows, issue templates
```

---

## The Python Backend

### main.py -- the Plugin class

The file Decky loads on startup. Defines a `Plugin` class whose async methods
become the callable API. The class itself is thin -- it wires together the
helper modules in `lib/`.

<details>
<summary>Plugin lifecycle (_main and _unload)</summary>

```python
async def _main(self) -> None:
    """Called by Decky when the plugin loads."""
    decky.logger.info("Proton Pulse backend starting")

    # Fresh install state on every reload
    self._proton_ge_install_lock = threading.Lock()
    self._proton_ge_install_cancel = threading.Event()
    self._proton_ge_install_thread = None
    self._proton_ge_install_status = make_initial_status()

    # Kick off CDN prefetch in the background.  daemon=True so it
    # won't block plugin shutdown if it's still running.
    self._prefetch_cancel = threading.Event()
    self._prefetch_thread = threading.Thread(
        target=prefetch_installed_games,
        args=(self._prefetch_cancel,),
        name="cdn-prefetch",
        daemon=True,
    )
    self._prefetch_thread.start()

async def _unload(self) -> None:
    """Shut everything down -- kill running threads, clean up."""
    self._prefetch_cancel.set()           # stop prefetch
    self._proton_ge_install_cancel.set()  # stop any GE install
```

`_main` sets up threading primitives and kicks off the background prefetch.
`_unload` signals both background threads to stop via their cancel events.
The prefetch thread is a daemon so it won't keep the process alive if Decky
shuts down before it finishes.
</details>

Important callables exposed to the frontend:

| Method | What it does |
|--------|-------------|
| `get_system_info` | Returns CPU, GPU, RAM, driver, kernel, distro |
| `get_protondb_reports` | Fetches reports from CDN year files |
| `get_protondb_summary` | Fetches the ProtonDB summary for a game |
| `get_proton_ge_manager_state` | Returns GE releases, installed tools, install status |
| `install_proton_ge` | Downloads and installs a Proton-GE release |
| `cancel_proton_ge_install` | Cancels an in-progress install |
| `uninstall_compatibility_tool` | Removes an installed Proton/Wine build |
| `set_log_level` | Switches between DEBUG and INFO |
| `get_log_contents` | Returns the current log file contents |
| `log_frontend_event` | Writes a frontend log entry to the backend log |
| `export_metrics` | Writes perf metrics JSON to disk |
| `generate_system_info_text` | Generates system info text for ProtonDB submissions |

### lib/system_info.py

Detects hardware by reading `/proc/cpuinfo`, running `lspci`, parsing
`/proc/meminfo`, checking the kernel version, and reading `/etc/os-release`.
GPU vendor detection looks for "nvidia", "amd", or "intel" in the lspci
output. Returns a dict that maps to the `SystemInfo` TypeScript interface.

### lib/prefetch.py

Runs in a background daemon thread started by `_main()`.

<details>
<summary>Prefetch entry point</summary>

```python
def prefetch_installed_games(cancel_check=None):
    """Prefetch CDN data for all installed games.

    cancel_check is a threading.Event -- if set, we bail out early.
    """
    games = discover_installed_games()
    # discover_installed_games() scans appmanifest_*.acf files in all
    # Steam library folders, parses them, and sorts by playtime

    for game in games:
        if cancel_check and cancel_check.is_set():
            break  # plugin is shutting down, stop

        app_id = game["app_id"]
        index_url = f"{CDN_BASE}/{app_id}/index.json"

        if is_fresh(index_url):
            continue  # already cached and not expired

        # Fetch the index (lists which year files exist)
        index = _fetch_cdn_json(index_url, app_id, "index.json")

        # Fetch each year file (contains the actual reports)
        if isinstance(index, list):
            for year in index:
                if cancel_check and cancel_check.is_set():
                    break
                _fetch_cdn_json(f"{CDN_BASE}/{app_id}/{year}.json", ...)

        # Also grab votes
        _fetch_cdn_json(f"{CDN_BASE}/{app_id}/votes.json", ...)
```

The idea: when the user opens a game later, the data is already on disk
and the frontend gets an instant response instead of waiting for a network
fetch. Games are sorted by playtime so the most-played ones get cached first.
</details>

### lib/proton_ge.py

The biggest backend module. Manages Proton-GE releases:

- Fetches the GitHub releases list and caches it
- Tracks which releases are installed on disk
- The "latest slot" -- a symlink called `Proton-GE-Latest` that always
  points to the newest installed GE build
- Download-extract-finalize pipeline (background thread)
- Install progress tracking with byte counts and stages
- Cancellation support

### lib/compat_tools.py

Scans the filesystem to find all installed compatibility tools. Looks in:
- `~/.steam/root/compatibilitytools.d/` (custom installs like GE)
- `~/.steam/root/steamapps/common/` (Valve-shipped Proton)

Each tool gets classified as `custom` or `valve` source.

### lib/http_client.py

Shells out to `curl` instead of using Python's urllib. This is intentional --
SteamOS has known SSL cert issues with Python's bundled OpenSSL, but curl
uses the system CA store and works reliably.

### lib/cdn_cache.py

Disk-backed cache stored under Decky's runtime directory. Layout is
`cdn_cache/{url_hash}.json` with a metadata sidecar. The frontend can check
this cache before making network requests.

### Other lib/ modules

- `protondb_systeminfo.py` -- generates the system info text block ProtonDB
  expects for report submissions
- `steam_paths.py` -- finds Steam install dirs, reads `libraryfolders.vdf`
- `plugin_utils.py` -- safe archive extraction, env cleanup
- `plugin_logging.py` -- JSON-formatted structured logging
- `metrics_export.py` -- writes frontend perf metrics to disk
- `screenshot_catalog.py` / `screenshot_manifest.py` -- screenshot automation support

---

## The TypeScript Frontend

### src/index.tsx -- plugin entry point

Where `definePlugin()` is called. On startup it:

1. Sets the initial log level from the saved debug setting
2. Initializes the in-memory cache from localStorage
3. Starts the metrics auto-flush timer
4. Kicks off CDN prefetch after a 5s delay
5. Kicks off auto-install of Proton-GE-Latest after 8s (if enabled)
6. Registers the `/proton-pulse` route for the full-page view
7. Patches the library context menu to add "Proton Pulse..."
8. Starts polling for the currently focused game

The `Content` component renders the Quick Access sidebar panel with buttons
for each section plus toggles for debug logging and notifications.

### src/components/Modal.tsx -- the main page

`ProtonPulsePage` is the full-page view at `/proton-pulse`. Uses Decky's
`SidebarNavigation` to create a tabbed layout with: Manage Game, Manage
Configurations, Compatibility Tools, General Settings, Logs, and About.

### Tab components

- **ManageTab.tsx** -- fetches ProtonDB reports, scores them, displays as
  ReportCards sorted by relevance. The main "use the plugin" screen.
- **ConfigureTab.tsx** -- saved per-game configurations (profiles). Create,
  edit, delete, apply. Each config stores Proton version, launch options,
  enabled variables.
- **SettingsTab.tsx** -- the Compatibility Tools tab. Lists installed
  Proton/Wine builds, available GE releases, install/uninstall/update.
- **GeneralSettingsTab.tsx** -- language selector, cache management,
  notification prefs, advanced options.
- **LogsTab.tsx** -- shows the frontend log ring buffer. Button to open
  the full-screen LogViewerModal.
- **AboutTab.tsx** -- project info, links, credits.

### Modal components

- **ReportDetailModal.tsx** -- full detail view for a report with score
  breakdown, vote counts, and action buttons (Apply, Edit, Submit, Clear)
- **EditReportModal.tsx** -- edit launch options derived from a report
- **ConfigEditorModal.tsx** -- edit a saved configuration
- **CacheManagerModal.tsx** -- inspect cached games, refresh or clear entries
- **LogViewerModal.tsx** -- full-screen log viewer with gamepad controls
- **ProtonDBSubmitModal.tsx** -- generates system info for ProtonDB submissions

### src/patches/gameContextMenu.tsx

Monkey-patches Steam's library context menu to add a "Proton Pulse..." item.

<details>
<summary>How the context menu patch works</summary>

```tsx
// Uses Decky's afterPatch + findModuleByExport to locate Steam's
// internal LibraryContextMenu component

export const LibraryContextMenu = fakeRenderComponent(
  (Object.values(
    findModuleByExport(
      (e) => e?.toString?.().includes('().LibraryContextMenu')
    )
  )).find((sibling) =>
    sibling?.toString().includes('navigator:')
  )
);

// afterPatch intercepts the render output and injects our MenuItem
// into the existing menu children array. When clicked, it navigates
// to /proton-pulse with the selected game's appId pre-loaded.
```

This is the standard Decky pattern for injecting into Steam's UI. The
`findModuleByExport` call searches Steam's webpack modules for the one
that contains `LibraryContextMenu`, then `afterPatch` wraps its render
method to splice in our menu item.
</details>

---

## How the Two Sides Talk

<details>
<summary>The callable bridge (with code example)</summary>

**Frontend side** (src/lib/compatTools.ts):

```typescript
import { callable } from '@decky/api';

// callable<[arg types], return type>('python_method_name')
const installProtonGeCallable = callable<
  [version?: string | null, installAsLatest?: boolean],
  { success: boolean; message: string }
>('install_proton_ge');

export async function installProtonGe(
  version?: string | null,
  installAsLatest = false,
) {
  return installProtonGeCallable(version ?? null, installAsLatest);
}
```

**Backend side** (main.py):

```python
class Plugin:
    async def install_proton_ge(self, version: str | None = None,
                                 install_as_latest: bool = False) -> dict:
        # ... does the work ...
        return {"success": True, "message": "Installed GE-Proton9-20"}
```

The callable name on the frontend (`'install_proton_ge'`) must match the
method name on the Plugin class exactly. Decky handles JSON serialization.

The `callWithTimeout` wrapper in `logger.ts` adds a timeout so the frontend
doesn't hang forever if the Python backend is dead or slow.
</details>

---

## Data Flow: What Happens When You Open a Game

1. User navigates to a game in the Steam library
2. `index.tsx` polls the current route and extracts the app ID
3. User opens Proton Pulse (sidebar or context menu)
4. `Modal.tsx` mounts, fetches system info from the backend
5. `ManageTab` receives the app ID and calls `getProtonDBReports(appId)`
6. `protondb.ts` checks: memory cache -> localStorage -> backend disk cache -> CDN -> live ProtonDB API
7. Reports come back as `CdnReport[]`
8. `scoring.ts` scores each report against the user's system info
9. Reports are sorted by score and rendered as `ReportCard` components
10. User picks a report, opens the detail modal, and hits Apply
11. `steamApps.ts` calls `SteamClient.Apps.SetAppLaunchOptions(appId, options)`
12. Steam picks up the new launch options immediately

---

## Scoring Algorithm

Located in `src/lib/scoring.ts`. Each report gets a numeric score.

<details>
<summary>Full scoring implementation with annotations</summary>

```typescript
// ---- Tuning knobs (edit these to change ranking behavior) ----
export const WEIGHTS = {
  BASE_MAX: 60,            // max points from rating alone (platinum=60, borked=0)
  RECENCY_RECENT: 15,      // bonus for reports < 90 days old
  RECENCY_MID: 5,          // bonus for 90-365 days
  RECENCY_OLD: -5,         // penalty for > 1 year old
  CUSTOM_PROTON: 10,       // bonus if report used GE/CachyOS/TKG etc
  GPU_MATCH: 1.0,          // multiplier when GPU vendor matches yours
  GPU_MISMATCH: 0.5,       // multiplier for different vendor (halves score)
  GPU_UNKNOWN: 0.75,       // multiplier when report doesn't say what GPU
  GPU_DRIVER_EXACT: 1.3,   // same vendor + same driver major version
  GPU_DRIVER_CLOSE: 1.1,   // same vendor + driver within 2 major versions
  BORKED_DECAY_DAYS: 365,  // borked reports older than this -> treated as bronze
  NOTES_MAX: 10,           // cap on sentiment modifier from user notes
};

export function scoreReport(report: CdnReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  // GPU multiplier: how closely does this report's GPU match mine?
  const mult = gpuDriverMultiplier(report, sysInfo);

  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);

  // Old borked reports get bumped to bronze -- games that were broken a
  // year ago have probably been fixed, don't let ancient reports tank the score
  const effectiveRating =
    report.rating === 'borked' && recencyDays > WEIGHTS.BORKED_DECAY_DAYS
      ? 'bronze'
      : report.rating;

  const ratingScore = (RATING_SCORES[effectiveRating] ?? 0) * WEIGHTS.BASE_MAX;
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;
  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;
  const notesModifier = parseNotesSentiment(report.notes);
  // ^ scans notes for keywords like "crash", "perfect", etc.

  // GPU multiplier scales everything EXCEPT notes sentiment, so a
  // mismatched GPU report still gets credit for good/bad user feedback
  const raw = (ratingScore + recencyBonus + customBonus) * mult + notesModifier;

  return { ...report, score: Math.max(0, Math.round(raw)), gpuTier, recencyDays, ... };
}
```

Reports are also bucketed by GPU tier (nvidia/amd/other) via `bucketByGpuTier()`
so the UI can show the most relevant group first.
</details>

---

## Caching Strategy

Three cache layers, each faster than the next:

<details>
<summary>Cache implementation details</summary>

```
Request flow:
  1. In-memory Map (src/lib/cache.ts)     -- instant, current session only
     |-- miss -->
  2. localStorage (src/lib/cache.ts)      -- survives restarts, LRU evicted
     |-- miss -->
  3. Backend disk cache (lib/cdn_cache.py) -- populated by startup prefetch
     |-- miss -->
  4. Network fetch (CDN or live ProtonDB API)
     |-- success --> write back to all 3 layers
```

```typescript
// src/lib/cache.ts -- the in-memory + localStorage layer

const memCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 200;

export function getCached(appId: string): CacheEntry | null {
  const entry = memCache.get(appId);
  if (!entry) { countCacheMiss(); return null; }
  if (isExpired(entry)) { memCache.delete(appId); countCacheMiss(); return null; }
  entry.lastAccessedAt = Date.now();  // update LRU timestamp
  countCacheHit();
  return entry;
}

// LRU eviction: when over cap, sort by lastAccessedAt and drop oldest
function evictIfNeeded(): void {
  if (memCache.size <= MAX_CACHE_ENTRIES) return;
  const sorted = Array.from(memCache.entries())
    .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);
  for (const [key] of sorted.slice(0, memCache.size - MAX_CACHE_ENTRIES)) {
    memCache.delete(key);
  }
}
```

```typescript
// src/lib/cdnCache.ts -- ties the backend disk cache into the flow

export async function cachedFetchJson<T>(url, appId, filename) {
  // 1. Ask the Python backend if it has a fresh cached copy
  const cached = await getCachedCdn(appId, filename);
  if (cached.fresh && cached.data !== null) {
    return { data: cached.data as T, fromCache: true };  // no network needed
  }

  // 2. Cache miss -- fetch from CDN
  const resp = await fetchNoCors(url);
  const data = await resp.json();

  // 3. Write back to backend cache for next time
  await putCachedCdn(appId, filename, data);
  return { data, fromCache: false };
}
```
</details>

---

## Compatibility Tool Management (Proton-GE)

The Proton-GE manager lets users install custom Proton builds without
leaving the plugin.

1. `SettingsTab.tsx` calls `getProtonGeManagerState()` on mount
2. Backend returns: available releases (GitHub), installed tools (disk scan),
   and current install status
3. User picks a release and hits Install
4. Frontend calls `installProtonGe(tagName, installAsLatest)`
5. Backend starts a background thread: download tarball -> extract ->
   move to `compatibilitytools.d/` -> optionally create `Proton-GE-Latest` symlink
6. Frontend polls `getProtonGeManagerState()` to track progress
7. On completion, the new tool appears in the installed list

The auto-update feature (`index.tsx`) runs this same flow on plugin load
if the `compat-auto-update-proton-ge` setting is enabled.

---

## Launch Option Management

Launch options are the command-line flags Steam passes to a game.

<details>
<summary>How launch variables work</summary>

```typescript
// src/lib/launchVars.ts defines a catalog of known variables:
export interface LaunchVarDef {
  key: string;           // e.g. "PROTON_USE_WINED3D"
  label: string;         // human-readable name
  description: string;   // what it does
  defaultValue: string;  // e.g. "1"
  prefix: boolean;       // true = env var (KEY=VAL %command%), false = appended after
}

// buildLaunchOptions() takes a set of enabled variables and builds the
// final string that Steam uses. Env vars go before %command%, flags after.
// Example output: "PROTON_USE_WINED3D=1 mangohud %command% -vulkan"
```

Saved configurations (`trackedConfigs.ts`) store per-game setups:

```typescript
export interface TrackedConfig {
  appId: number;
  appName: string;
  profileName: string;
  protonVersion: string;
  launchOptions: string;
  enabledVars: Record<string, string>;
  appliedAt: number;
  source?: 'protondb' | 'user';
}
```

When the user hits Apply, `steamApps.ts` calls
`SteamClient.Apps.SetAppLaunchOptions(appId, options)` and Steam picks
it up immediately.
</details>

---

## Voting System

`src/lib/voting.ts` implements Supabase-backed voting. Users can upvote or
downvote ProtonDB reports. Votes are stored in Supabase and fetched alongside
report data. Vote counts feed into the scoring algorithm.

---

## Internationalization (i18n)

`src/lib/i18n.ts` is the i18n engine:

- English strings are the canonical source (defined inline)
- Uses `useSyncExternalStore` so components re-render on language change
- Loads translations lazily from `src/lib/translations/`
- Falls back to English for any missing key
- Supports 10 languages (de, es, fr, ja, ko, pt-BR, ru, tr, zh-CN)

Translation coverage is checked at build time by `scripts/check-translations.mjs`
(90% minimum enforced).

---

## Navigation and Routing

<details>
<summary>How page navigation works</summary>

```typescript
// src/lib/pageState.ts maintains global navigation state

export const pageState = {
  initialPage: 'manage' as PageId,
  appId: null as number | null,
  appName: '',
  focusedAppId: null as number | null,
  focusedAppName: '',
};

// Components communicate navigation intent via a custom DOM event
export function dispatchNavigate(payload: NavigatePayload): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: payload }));
}

// Modal.tsx listens for this event and updates SidebarNavigation's active page
// The target tab component mounts and loads data for the given app
```

The `/proton-pulse` route is registered with Decky's `routerHook` so it
works as a full-page view within Steam's navigation system.
</details>

---

## Logging and Diagnostics

Two-channel logging (`src/lib/logger.ts`):

- **Backend channel**: `logFrontendEvent()` calls the Python backend's
  `log_frontend_event` method, which writes to the plugin log file
- **Frontend ring buffer**: every log entry is also stored in a 500-entry
  circular buffer so the Logs tab can show entries instantly

The ring buffer uses a subscriber pattern with debounced notifications
so rapid-fire logs (like during prefetch) don't thrash React.

---

## Metrics and Performance Tracking

`src/lib/metrics.ts` tracks fetch counts/timings, cache hit/miss rates,
and custom spans for any operation you want to profile. Metrics are
periodically flushed to the backend via `export_metrics` (every 60s and
on plugin unload).

---

## Screenshot Automation

For capturing screenshots of the plugin UI for documentation:

- `config/ui_screenshot_manifest.json` -- defines 31 capture targets
- `scripts/take_cef_screenshot.py` -- SSHes into the Deck, uses CEF
  DevTools Protocol to capture the screen as PNG, rsyncs it back
- `scripts/capture_project_screenshots.py` -- orchestrates a full run.
  `--auto` for zero-interaction mode, default is guided with prompts
- `scripts/publish_screenshots_to_wiki.py` -- copies screenshots into
  the wiki repo and regenerates the gallery page

---

## Build, Test, and Deploy

### Building

```bash
make setup    # install pinned Node/Python tooling, pnpm deps, and Python deps
make build    # sync-version -> check-translations -> rollup bundle
```

### Testing

```bash
uv run pytest tests/    # Python tests
pnpm test               # TypeScript tests (vitest)
```

### Deploying to a Steam Deck

```bash
DECK_IP=192.168.1.x make deploy         # one-shot deploy
DECK_IP=192.168.1.x make deploy-reload  # deploy + restart Decky
make watch                               # rebuild on file changes
```

### CI

CI uses Node 24 for frontend builds and sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so GitHub JavaScript actions run on Node 24 too.

`.github/workflows/autobuild.yml` and the reusable platform builds run on every push/PR: install deps, run tests, and run `make build`.

Coverage rules:

- Overall Python and TypeScript coverage must stay at or above `90%`.
- Pull requests must keep changed-line coverage at `95%` or higher.

---

## Configuration Files

| File | Purpose |
|------|---------|
| `plugin.json` | Decky plugin metadata (name, author, flags, store info) |
| `package.json` | npm deps and build scripts |
| `pyproject.toml` | Python project metadata and deps |
| `tsconfig.json` | TypeScript compiler options |
| `rollup.config.js` | Rollup bundler config (uses @decky/rollup) |
| `vitest.config.ts` | Vitest test runner config |
| `mypy.ini` | mypy type checking config |
| `pyrightconfig.json` | Pyright type checking config |
| `VERSION` | Single source of truth for the version number |
| `Makefile` | Build, test, deploy, and utility targets |
| `defaults/defaults.txt` | Default plugin settings |
| `decky.pyi` | Type stubs for the Decky Python API |
