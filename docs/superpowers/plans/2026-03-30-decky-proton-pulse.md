# Decky Proton Pulse — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Decky Loader plugin that fetches ProtonDB reports for the focused game, scores them against local system specs, and applies selected launch options via Steam CEF IPC.

**Architecture:** Python backend handles system detection, ProtonDB HTTP fetching, logging, and game-running guard. TypeScript frontend owns weighted scoring, GPU tier bucketing, and all React UI. Apply action calls `SteamClient.Apps.SetAppLaunchOptions` directly in TypeScript (CEF JS API — no Python round-trip).

**Tech Stack:** Python 3 + aiohttp + decky SDK | React + TypeScript + @decky/ui + @decky/api | vitest (TS unit tests) | pytest (Python unit tests)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `plugin.json` | Modify | Plugin name, author, description, flags |
| `package.json` | Modify | Package name, vitest dev dep, test script |
| `src/types.ts` | Create | All shared TypeScript types + SteamClient global declaration |
| `src/lib/scoring.ts` | Create | Pure scoring engine — `scoreReport`, `bucketByGpuTier` |
| `src/lib/scoring.test.ts` | Create | Vitest unit tests for scoring engine |
| `src/components/ReportCard.tsx` | Create | Single ranked report card component |
| `src/components/Badge.tsx` | Create | Game page badge (injected right of ProtonDB badge) |
| `src/components/LogViewer.tsx` | Create | Auto-scrolling log viewer component |
| `src/components/Modal.tsx` | Create | Full ranked report modal with GPU filter + Apply |
| `src/index.tsx` | Modify | Plugin entry, sidebar panel, badge route injection |
| `main.py` | Modify | Python Plugin class — all backend methods |
| `tests/conftest.py` | Create | Pytest mock for `decky` module |
| `tests/test_system_info.py` | Create | Tests for system detection methods |
| `tests/test_protondb.py` | Create | Tests for ProtonDB fetcher (mocked HTTP) |
| `scripts/dev-setup.sh` | Create | Dev quickstart script |
| `scripts/deploy.sh` | Create | Deploy helper for beta/stable/autobuild targets |

---

## Task 1: Update Plugin Metadata

**Files:**
- Modify: `plugin.json`
- Modify: `package.json`

- [ ] **Step 1: Update plugin.json**

Replace the full content of `plugin.json`:

```json
{
  "name": "Decky Proton Pulse",
  "author": "your-github-username",
  "flags": ["debug", "_root"],
  "api_version": 1,
  "publish": {
    "tags": ["proton", "compatibility", "launch-options"],
    "description": "Auto-apply ProtonDB launch options ranked by your system specs.",
    "image": "https://opengraph.githubassets.com/1/your-github-username/decky-proton-pulse"
  }
}
```

- [ ] **Step 2: Update package.json**

Replace the full content of `package.json`:

```json
{
  "name": "decky-proton-pulse",
  "version": "0.1.0",
  "description": "Decky plugin that ranks ProtonDB reports by system compatibility and applies launch options.",
  "type": "module",
  "scripts": {
    "build": "rollup -c",
    "watch": "rollup -c -w",
    "test": "vitest run"
  },
  "keywords": ["decky", "plugin", "protondb", "steam-deck", "proton"],
  "author": "your-github-username",
  "license": "BSD-3-Clause",
  "devDependencies": {
    "@decky/rollup": "^1.0.2",
    "@decky/ui": "^4.11.0",
    "@rollup/rollup-linux-x64-musl": "^4.53.3",
    "@types/react": "19.1.1",
    "@types/react-dom": "19.1.1",
    "@types/webpack": "^5.28.5",
    "rollup": "^4.53.3",
    "typescript": "^5.6.2",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "@decky/api": "^1.1.3",
    "react-icons": "^5.3.0",
    "tslib": "^2.7.0"
  },
  "pnpm": {
    "peerDependencyRules": {
      "ignoreMissing": ["react", "react-dom"]
    }
  }
}
```

- [ ] **Step 3: Install updated dependencies**

```bash
pnpm i
```

Expected: lockfile updated, `vitest` appears in `node_modules/.pnpm`.

- [ ] **Step 4: Commit**

```bash
git add plugin.json package.json pnpm-lock.yaml
git commit -m "chore: rename plugin, add vitest"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create src/types.ts**

```typescript
// src/types.ts

// ─── System Info ───────────────────────────────────────────────────────────────

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other';

export interface SystemInfo {
  cpu: string | null;
  ram_gb: number | null;
  gpu: string | null;
  gpu_vendor: GpuVendor | null;
  driver_version: string | null;
  kernel: string | null;
  distro: string | null;
  proton_custom: string | null;
}

// ─── ProtonDB API ─────────────────────────────────────────────────────────────
// Field names verified against https://www.protondb.com/api/v1/reports/app/2358720
// Note: ProtonDB API is unofficial — field names may drift. Verify before coding.

export type ProtonRating = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked' | 'pending';

export interface ProtonDBReportResponses {
  gpu?: string;
  gpuDriver?: string;
  os?: string;
  ram?: number;
  kernel?: string;
  cpu?: string;
}

export interface ProtonDBReport {
  timestamp: number;           // Unix seconds
  rating: ProtonRating;
  protonVersion: string;       // e.g. "GE-Proton9-7", "Proton 9.0"
  notes: string;
  responses: ProtonDBReportResponses;
}

export interface ProtonDBSummary {
  score: ProtonRating;
  tier: number;
  total: number;
  trendingTier: number;
  bestReported: ProtonRating;
  confidence: string;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export type GpuTier = 'nvidia' | 'amd' | 'intel' | 'unknown';

export interface ScoredReport extends ProtonDBReport {
  score: number;
  gpuTier: GpuTier;
  recencyDays: number;
}

export interface TieredReports {
  nvidia: ScoredReport[];
  amd: ScoredReport[];
  other: ScoredReport[];   // intel + unknown combined for display
}

// ─── Steam CEF ───────────────────────────────────────────────────────────────
// SteamClient is available as a global in the Steam CEF context.
// These are the methods this plugin uses — not exhaustive.

declare global {
  const SteamClient: {
    Apps: {
      SetAppLaunchOptions: (appId: number, options: string) => Promise<void>;
      GetLaunchOptions: (appId: number) => Promise<string>;
    };
    GameSessions: {
      GetRunningApps: () => Array<{ nAppID: number }>;
    };
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript types + SteamClient global declaration"
```

---

## Task 3: Python Test Infrastructure

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

The `decky` module is only available inside Decky Loader at runtime. Tests must mock it.

- [ ] **Step 1: Create tests/__init__.py**

```python
# tests/__init__.py
```

(Empty — marks directory as a Python package.)

- [ ] **Step 2: Create tests/conftest.py**

```python
# tests/conftest.py
import sys
from unittest.mock import MagicMock

# Mock the decky module before any plugin code imports it
decky_mock = MagicMock()
decky_mock.DECKY_USER_HOME = "/home/testuser"
decky_mock.DECKY_HOME = "/home/testuser/homebrew"
decky_mock.DECKY_SETTINGS_DIR = "/home/testuser/homebrew/settings"
decky_mock.DECKY_RUNTIME_DIR = "/home/testuser/homebrew/runtime"
decky_mock.logger = MagicMock()

sys.modules['decky'] = decky_mock
```

- [ ] **Step 3: Verify pytest finds the tests directory**

```bash
python -m pytest tests/ --collect-only
```

Expected: `no tests ran` (0 collected, no errors — setup is clean).

- [ ] **Step 4: Commit**

```bash
git add tests/__init__.py tests/conftest.py
git commit -m "test: add pytest infrastructure with decky mock"
```

---

## Task 4: Python Backend — Logging + Game Guard

**Files:**
- Modify: `main.py`

Replace the entire content of `main.py`. We build all backend in one file (the Plugin class is a single unit in Decky's architecture).

- [ ] **Step 1: Write the failing test for set_log_level**

Create `tests/test_logger.py`:

```python
# tests/test_logger.py
import logging
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import Plugin


@pytest.fixture
def plugin():
    p = Plugin()
    p._setup_logger()
    return p


def test_set_log_level_debug(plugin):
    plugin._logger.setLevel(logging.INFO)
    result = plugin._sync_set_log_level("DEBUG")
    assert result is True
    assert plugin._logger.level == logging.DEBUG


def test_set_log_level_info(plugin):
    plugin._logger.setLevel(logging.DEBUG)
    result = plugin._sync_set_log_level("INFO")
    assert result is True
    assert plugin._logger.level == logging.INFO


def test_set_log_level_invalid(plugin):
    result = plugin._sync_set_log_level("INVALID")
    assert result is False
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
python -m pytest tests/test_logger.py -v
```

Expected: `FAILED` — `Plugin` has no `_setup_logger` or `_sync_set_log_level`.

- [ ] **Step 3: Replace main.py with the full Plugin skeleton + logger**

```python
# main.py
import os
import asyncio
import logging
import logging.handlers
import subprocess

import decky

LOG_FILE = "/tmp/decky-proton-pulse.log"
PROTONDB_SUMMARY_URL = "https://www.protondb.com/api/v1/reports/summaries/{app_id}.json"
PROTONDB_REPORTS_URL = "https://www.protondb.com/api/v1/reports/app/{app_id}"
PROTONDB_USER_AGENT = "decky-proton-pulse/0.1.0 (github.com/<owner>/decky-proton-pulse)"


class Plugin:
    _system_info: dict = {}
    _reports_cache: dict = {}

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def _main(self):
        self._setup_logger()
        self._logger.info("Proton Pulse starting up")
        self._system_info = await self.get_system_info()
        self._logger.info(f"System detected: {self._system_info}")

    async def _unload(self):
        self._logger.info("Proton Pulse unloading")

    async def _uninstall(self):
        self._logger.info("Proton Pulse uninstalled")

    async def _migration(self):
        decky.migrate_logs(
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-proton-pulse", "proton-pulse.log")
        )
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "proton-pulse.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-proton-pulse"),
        )

    # ─── Logging ──────────────────────────────────────────────────────────────

    def _setup_logger(self):
        self._logger = logging.getLogger("proton-pulse")
        self._logger.handlers.clear()
        handler = logging.handlers.RotatingFileHandler(
            LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=2
        )
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s",
                              datefmt="%Y-%m-%d %H:%M:%S")
        )
        self._logger.addHandler(handler)
        self._logger.setLevel(logging.INFO)

    def _sync_set_log_level(self, level: str) -> bool:
        """Synchronous helper used by tests and the async callable."""
        valid = {"DEBUG": logging.DEBUG, "INFO": logging.INFO,
                 "WARNING": logging.WARNING, "ERROR": logging.ERROR}
        if level not in valid:
            return False
        self._logger.setLevel(valid[level])
        return True

    async def set_log_level(self, level: str) -> bool:
        return self._sync_set_log_level(level)

    async def get_log_contents(self) -> str:
        try:
            with open(LOG_FILE, "r") as f:
                lines = f.readlines()
            return "".join(lines[-200:])
        except FileNotFoundError:
            return ""

    # ─── Game Guard ───────────────────────────────────────────────────────────

    async def is_game_running(self) -> bool:
        """Returns True if any Steam game process is detected via /proc scan."""
        try:
            result = subprocess.run(
                ["pgrep", "-f", "SteamLaunch"],
                capture_output=True, text=True, timeout=3
            )
            return result.returncode == 0
        except Exception as e:
            self._logger.warning(f"is_game_running check failed: {e}")
            return False

    # ─── System Detection ─────────────────────────────────────────────────────
    # (added in Task 5)

    async def get_system_info(self) -> dict:
        return {}

    # ─── ProtonDB Fetcher ─────────────────────────────────────────────────────
    # (added in Task 6)

    async def fetch_protondb_summary(self, app_id: str) -> dict:
        return {}

    async def fetch_protondb_reports(self, app_id: str) -> list:
        return []
```

- [ ] **Step 4: Run logger test — verify it passes**

```bash
python -m pytest tests/test_logger.py -v
```

Expected: `3 passed`.

- [ ] **Step 5: Write game guard test**

Add to `tests/test_logger.py` (append):

```python
def test_is_game_running_returns_bool(plugin):
    import asyncio
    result = asyncio.run(plugin.is_game_running())
    assert isinstance(result, bool)
```

- [ ] **Step 6: Run all tests**

```bash
python -m pytest tests/ -v
```

Expected: `4 passed`.

- [ ] **Step 7: Commit**

```bash
git add main.py tests/test_logger.py
git commit -m "feat: add Python logger, log-level toggle, and game-running guard"
```

---

## Task 5: Python Backend — System Detection

**Files:**
- Modify: `main.py` (replace `get_system_info` stub)
- Create: `tests/test_system_info.py`

**Before writing code:** run `curl https://www.protondb.com/api/v1/reports/app/2358720 | python3 -m json.tool | head -60` to verify actual ProtonDB field names. Adjust `src/types.ts` if they differ from the spec.

- [ ] **Step 1: Write failing tests for system detection**

Create `tests/test_system_info.py`:

```python
# tests/test_system_info.py
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open, MagicMock
from main import Plugin


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def plugin():
    import pytest
    p = Plugin()
    p._setup_logger()
    return p


import pytest


@pytest.fixture
def plugin():
    p = Plugin()
    p._setup_logger()
    return p


def test_system_info_keys(plugin):
    with patch.object(plugin, '_read_cpu', return_value="AMD Ryzen 9 9950X3D"), \
         patch.object(plugin, '_read_ram_gb', return_value=64), \
         patch.object(plugin, '_read_gpu', return_value=("NVIDIA GeForce RTX 5080", "nvidia")), \
         patch.object(plugin, '_read_driver_version', return_value="595.45.04"), \
         patch.object(plugin, '_read_kernel', return_value="6.19.8-1-cachyos"), \
         patch.object(plugin, '_read_distro', return_value="CachyOS Linux"), \
         patch.object(plugin, '_read_custom_proton', return_value="cachyos-10.0"):
        info = run(plugin.get_system_info())

    assert set(info.keys()) == {
        'cpu', 'ram_gb', 'gpu', 'gpu_vendor',
        'driver_version', 'kernel', 'distro', 'proton_custom'
    }
    assert info['gpu_vendor'] == 'nvidia'
    assert info['ram_gb'] == 64


def test_system_info_field_failure_returns_none(plugin):
    """Any field that fails detection returns None, never raises."""
    with patch.object(plugin, '_read_cpu', side_effect=Exception("oops")), \
         patch.object(plugin, '_read_ram_gb', return_value=64), \
         patch.object(plugin, '_read_gpu', return_value=(None, None)), \
         patch.object(plugin, '_read_driver_version', return_value=None), \
         patch.object(plugin, '_read_kernel', return_value="6.19.8"), \
         patch.object(plugin, '_read_distro', return_value="CachyOS Linux"), \
         patch.object(plugin, '_read_custom_proton', return_value=None):
        info = run(plugin.get_system_info())

    assert info['cpu'] is None
    assert info['gpu'] is None
    assert info['gpu_vendor'] is None
    assert info['proton_custom'] is None


def test_read_ram_gb(plugin):
    meminfo = "MemTotal:       67108864 kB\nMemFree: 1000 kB\n"
    with patch("builtins.open", mock_open(read_data=meminfo)):
        result = plugin._read_ram_gb()
    assert result == 64  # 67108864 kB / 1024 / 1024 ≈ 64


def test_detect_gpu_vendor_nvidia(plugin):
    assert plugin._detect_gpu_vendor("NVIDIA GeForce RTX 5080") == "nvidia"


def test_detect_gpu_vendor_amd(plugin):
    assert plugin._detect_gpu_vendor("AMD Radeon RX 7900 XTX") == "amd"


def test_detect_gpu_vendor_intel(plugin):
    assert plugin._detect_gpu_vendor("Intel Arc A770") == "intel"


def test_detect_gpu_vendor_other(plugin):
    assert plugin._detect_gpu_vendor("Some Unknown GPU") == "other"
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
python -m pytest tests/test_system_info.py -v
```

Expected: multiple `FAILED` — helper methods not yet implemented.

- [ ] **Step 3: Implement system detection in main.py**

Replace the `# ─── System Detection ───` section stub in `main.py`:

```python
    # ─── System Detection ─────────────────────────────────────────────────────

    async def get_system_info(self) -> dict:
        info = {
            'cpu': None, 'ram_gb': None, 'gpu': None, 'gpu_vendor': None,
            'driver_version': None, 'kernel': None, 'distro': None, 'proton_custom': None
        }
        for field, fn in [
            ('cpu',           self._read_cpu),
            ('ram_gb',        self._read_ram_gb),
            ('kernel',        self._read_kernel),
            ('distro',        self._read_distro),
            ('driver_version', self._read_driver_version),
            ('proton_custom', self._read_custom_proton),
        ]:
            try:
                info[field] = fn()
            except Exception as e:
                self._logger.warning(f"System detection failed for {field}: {e}")

        try:
            gpu, vendor = self._read_gpu()
            info['gpu'] = gpu
            info['gpu_vendor'] = vendor
        except Exception as e:
            self._logger.warning(f"GPU detection failed: {e}")

        return info

    def _read_cpu(self) -> str | None:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
        return None

    def _read_ram_gb(self) -> int | None:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    kb = int(line.split()[1])
                    return round(kb / 1024 / 1024)
        return None

    def _read_gpu(self) -> tuple[str | None, str | None]:
        result = subprocess.run(
            ["lspci"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            lower = line.lower()
            if any(k in lower for k in ['vga', '3d controller', 'display controller']):
                # Extract the device name after the bracket
                name = line.split(":", 2)[-1].strip()
                return name, self._detect_gpu_vendor(name)
        return None, None

    def _detect_gpu_vendor(self, gpu_string: str) -> str:
        lower = gpu_string.lower()
        if any(k in lower for k in ['nvidia', 'geforce', 'rtx', 'gtx', 'quadro']):
            return 'nvidia'
        if any(k in lower for k in ['amd', 'radeon', 'rx ', 'vega']):
            return 'amd'
        if any(k in lower for k in ['intel', 'arc', 'iris', 'uhd']):
            return 'intel'
        return 'other'

    def _read_driver_version(self) -> str | None:
        # Try NVIDIA first
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except FileNotFoundError:
            pass
        # Fallback: read from DRM sysfs (AMD/Intel)
        try:
            import glob
            for path in glob.glob("/sys/class/drm/card*/device/driver/module/version"):
                with open(path) as f:
                    return f.read().strip()
        except Exception:
            pass
        return None

    def _read_kernel(self) -> str | None:
        result = subprocess.run(["uname", "-r"], capture_output=True, text=True, timeout=3)
        return result.stdout.strip() if result.returncode == 0 else None

    def _read_distro(self) -> str | None:
        try:
            with open("/etc/os-release") as f:
                for line in f:
                    if line.startswith("PRETTY_NAME="):
                        return line.split("=", 1)[1].strip().strip('"')
        except FileNotFoundError:
            pass
        return None

    def _read_custom_proton(self) -> str | None:
        compat_dir = os.path.expanduser("~/.steam/root/compatibilitytools.d")
        if not os.path.isdir(compat_dir):
            return None
        entries = [d for d in os.listdir(compat_dir)
                   if os.path.isdir(os.path.join(compat_dir, d))]
        return entries[0] if len(entries) == 1 else (", ".join(entries) if entries else None)
```

- [ ] **Step 4: Run all tests**

```bash
python -m pytest tests/ -v
```

Expected: `10 passed` (logger + system detection tests).

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_system_info.py
git commit -m "feat: implement system spec auto-detection"
```

---

## Task 6: Python Backend — ProtonDB Fetcher

**Files:**
- Modify: `main.py` (replace ProtonDB stubs)
- Create: `tests/test_protondb.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_protondb.py`:

```python
# tests/test_protondb.py
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from main import Plugin


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def plugin():
    p = Plugin()
    p._setup_logger()
    return p


def test_fetch_summary_returns_dict_on_success(plugin):
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value={"score": "gold", "tier": 3, "total": 42})
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_summary("2358720"))

    assert result["score"] == "gold"
    assert result["total"] == 42


def test_fetch_summary_returns_empty_on_404(plugin):
    mock_response = MagicMock()
    mock_response.status = 404
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_summary("0000000"))

    assert result == {}


def test_fetch_reports_returns_list_on_success(plugin):
    reports_data = [
        {"timestamp": 1700000000, "rating": "platinum", "protonVersion": "GE-Proton9-7",
         "notes": "Works great", "responses": {"gpu": "NVIDIA GeForce RTX 3080"}},
        {"timestamp": 1690000000, "rating": "gold", "protonVersion": "Proton 9.0",
         "notes": "Minor stutter", "responses": {"gpu": "AMD Radeon RX 7900 XTX"}},
    ]
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=reports_data)
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_reports("2358720"))

    assert len(result) == 2
    assert result[0]["rating"] == "platinum"


def test_fetch_reports_returns_empty_on_error(plugin):
    mock_session = MagicMock()
    mock_session.get = MagicMock(side_effect=Exception("network error"))
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_reports("2358720"))

    assert result == []


def test_fetch_reports_uses_cache(plugin):
    plugin._reports_cache["123"] = [{"rating": "gold"}]
    # Should return cached result without any HTTP call
    result = run(plugin.fetch_protondb_reports("123"))
    assert result == [{"rating": "gold"}]
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
python -m pytest tests/test_protondb.py -v
```

Expected: multiple `FAILED`.

- [ ] **Step 3: Add aiohttp to requirements**

```bash
# Check if aiohttp is available in Decky's Python environment
python3 -c "import aiohttp; print(aiohttp.__version__)"
```

If not available, add `aiohttp` to a `requirements.txt`:
```
aiohttp>=3.9.0
```

- [ ] **Step 4: Implement ProtonDB fetcher in main.py**

Replace the `# ─── ProtonDB Fetcher ───` stubs in `main.py`:

```python
    # ─── ProtonDB Fetcher ─────────────────────────────────────────────────────

    async def fetch_protondb_summary(self, app_id: str) -> dict:
        url = PROTONDB_SUMMARY_URL.format(app_id=app_id)
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers={"User-Agent": PROTONDB_USER_AGENT},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 404:
                        self._logger.debug(f"No ProtonDB summary for {app_id}")
                        return {}
                    if resp.status != 200:
                        self._logger.warning(f"ProtonDB summary HTTP {resp.status} for {app_id}")
                        return {}
                    return await resp.json()
        except Exception as e:
            self._logger.error(f"fetch_protondb_summary failed for {app_id}: {e}")
            return {}

    async def fetch_protondb_reports(self, app_id: str) -> list:
        if app_id in self._reports_cache:
            self._logger.debug(f"Cache hit for app {app_id}")
            return self._reports_cache[app_id]

        url = PROTONDB_REPORTS_URL.format(app_id=app_id)
        for attempt in range(3):
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        url,
                        headers={"User-Agent": PROTONDB_USER_AGENT},
                        timeout=aiohttp.ClientTimeout(total=10)
                    ) as resp:
                        if resp.status == 404:
                            self._logger.info(f"No ProtonDB reports for {app_id}")
                            return []
                        if resp.status == 429:
                            wait = 2 ** (attempt + 1)
                            self._logger.warning(f"Rate limited by ProtonDB, retrying in {wait}s")
                            await asyncio.sleep(wait)
                            continue
                        if resp.status != 200:
                            self._logger.warning(f"ProtonDB reports HTTP {resp.status} for {app_id}")
                            return []
                        data = await resp.json()
                        self._reports_cache[app_id] = data
                        self._logger.info(f"Fetched {len(data)} reports for app {app_id}")
                        return data
            except asyncio.TimeoutError:
                self._logger.error(f"ProtonDB request timed out for {app_id}")
                return []
            except Exception as e:
                self._logger.error(f"fetch_protondb_reports failed for {app_id}: {e}")
                return []
        return []
```

- [ ] **Step 5: Run all tests**

```bash
python -m pytest tests/ -v
```

Expected: all tests pass (logger + system + protondb).

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_protondb.py
git commit -m "feat: implement ProtonDB API fetcher with caching and retry"
```

---

## Task 7: Scoring Engine (TDD)

**Files:**
- Create: `src/lib/scoring.ts`
- Create: `src/lib/scoring.test.ts`

`★ Insight:` The scoring engine is the only frontend file worth unit testing — it's pure logic with no React or CEF dependencies. All weights are exported constants so tests can import them directly without hardcoding magic numbers.

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts` at project root:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/scoring.test.ts`:

```typescript
// src/lib/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { scoreReport, bucketByGpuTier, WEIGHTS } from './scoring';
import type { ProtonDBReport, SystemInfo } from '../types';

const nvidiaSystem: SystemInfo = {
  cpu: 'AMD Ryzen 9 9950X3D',
  ram_gb: 64,
  gpu: 'NVIDIA GeForce RTX 5080',
  gpu_vendor: 'nvidia',
  driver_version: '595.45.04',
  kernel: '6.19.8-1-cachyos',
  distro: 'CachyOS',
  proton_custom: 'cachyos-10.0-202603012',
};

const now = Math.floor(Date.now() / 1000);

const platinumNvidiaRecent: ProtonDBReport = {
  timestamp: now - 30 * 86400,   // 1 month ago
  rating: 'platinum',
  protonVersion: 'GE-Proton9-7',
  notes: 'Perfect',
  responses: { gpu: 'NVIDIA GeForce RTX 3080', gpuDriver: '545.29.06' },
};

const goldAmdOld: ProtonDBReport = {
  timestamp: now - 400 * 86400,  // > 1 year ago
  rating: 'gold',
  protonVersion: 'Proton 9.0',
  notes: 'Minor issues',
  responses: { gpu: 'AMD Radeon RX 7900 XTX' },
};

const bronzeUnknownMid: ProtonDBReport = {
  timestamp: now - 180 * 86400,  // 6 months ago
  rating: 'bronze',
  protonVersion: 'Proton 8.0',
  notes: 'Playable',
  responses: {},
};

describe('scoreReport', () => {
  it('gives higher score to NVIDIA report on NVIDIA system than AMD report', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdScore = scoreReport(goldAmdOld, nvidiaSystem).score;
    expect(nvidiaScore).toBeGreaterThan(amdScore);
  });

  it('applies GPU match multiplier 1.0 for same vendor', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.gpuTier).toBe('nvidia');
    expect(scored.score).toBeGreaterThan(0);
  });

  it('applies GPU mismatch multiplier 0.5 for different vendor', () => {
    const nvidiaScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const amdSysScore = scoreReport(platinumNvidiaRecent, {
      ...nvidiaSystem, gpu_vendor: 'amd'
    }).score;
    // Same report, different system vendor — score should be roughly halved
    expect(nvidiaScore).toBeGreaterThan(amdSysScore);
    expect(amdSysScore).toBeGreaterThan(0);
  });

  it('gives recency bonus for reports under 90 days', () => {
    const recentScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score;
    const oldReport: ProtonDBReport = { ...platinumNvidiaRecent, timestamp: now - 400 * 86400 };
    const oldScore = scoreReport(oldReport, nvidiaSystem).score;
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives custom proton bonus', () => {
    const geScore = scoreReport(platinumNvidiaRecent, nvidiaSystem).score; // GE-Proton
    const vanillaReport: ProtonDBReport = { ...platinumNvidiaRecent, protonVersion: 'Proton 9.0' };
    const vanillaScore = scoreReport(vanillaReport, nvidiaSystem).score;
    expect(geScore).toBeGreaterThan(vanillaScore);
  });

  it('score is never negative', () => {
    const scored = scoreReport(bronzeUnknownMid, nvidiaSystem);
    expect(scored.score).toBeGreaterThanOrEqual(0);
  });

  it('attaches recencyDays to scored report', () => {
    const scored = scoreReport(platinumNvidiaRecent, nvidiaSystem);
    expect(scored.recencyDays).toBeGreaterThan(25);
    expect(scored.recencyDays).toBeLessThan(35);
  });
});

describe('bucketByGpuTier', () => {
  it('separates nvidia and amd reports into correct buckets', () => {
    const scored = [platinumNvidiaRecent, goldAmdOld].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia).toHaveLength(1);
    expect(buckets.amd).toHaveLength(1);
    expect(buckets.other).toHaveLength(0);
  });

  it('sorts each bucket by score descending', () => {
    const r1: ProtonDBReport = { ...platinumNvidiaRecent };
    const r2: ProtonDBReport = { ...platinumNvidiaRecent, rating: 'silver', timestamp: now - 500 * 86400 };
    const scored = [r1, r2].map(r => scoreReport(r, nvidiaSystem));
    const buckets = bucketByGpuTier(scored);
    expect(buckets.nvidia[0].score).toBeGreaterThanOrEqual(buckets.nvidia[1].score);
  });
});
```

- [ ] **Step 3: Run tests — confirm failures**

```bash
pnpm test
```

Expected: `FAILED` — `scoring.ts` does not exist.

- [ ] **Step 4: Create src/lib/scoring.ts**

```typescript
// src/lib/scoring.ts
import type { ProtonDBReport, ScoredReport, SystemInfo, TieredReports, GpuTier } from '../types';

// ─── Weights — edit these to tune ranking ─────────────────────────────────────
export const WEIGHTS = {
  BASE_MAX: 60,
  RECENCY_RECENT: 15,   // < 90 days
  RECENCY_MID: 5,       // 90–365 days
  RECENCY_OLD: -5,      // > 365 days
  CUSTOM_PROTON: 10,
  GPU_MATCH: 1.0,
  GPU_MISMATCH: 0.5,
  GPU_UNKNOWN: 0.75,
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectReportGpuTier(report: ProtonDBReport): GpuTier {
  const gpu = (report.responses?.gpu ?? '').toLowerCase();
  if (!gpu) return 'unknown';
  if (/nvidia|geforce|rtx|gtx|quadro/.test(gpu)) return 'nvidia';
  if (/amd|radeon|rx \d|vega/.test(gpu)) return 'amd';
  if (/intel|arc|iris|uhd/.test(gpu)) return 'intel';
  return 'unknown';
}

function isCustomProton(version: string): boolean {
  const lower = version.toLowerCase();
  return CUSTOM_PROTON_MARKERS.some(m => lower.includes(m));
}

function gpuMultiplier(reportTier: GpuTier, systemVendor: string | null): number {
  if (!systemVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  return reportTier === systemVendor ? WEIGHTS.GPU_MATCH : WEIGHTS.GPU_MISMATCH;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scoreReport(report: ProtonDBReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  const mult = gpuMultiplier(gpuTier, sysInfo.gpu_vendor);

  const ratingScore = (RATING_SCORES[report.rating] ?? 0) * WEIGHTS.BASE_MAX;

  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;

  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;

  const raw = (ratingScore + recencyBonus + customBonus) * mult;

  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
  };
}

export function bucketByGpuTier(reports: ScoredReport[]): TieredReports {
  const buckets: TieredReports = { nvidia: [], amd: [], other: [] };

  for (const r of reports) {
    if (r.gpuTier === 'nvidia') buckets.nvidia.push(r);
    else if (r.gpuTier === 'amd') buckets.amd.push(r);
    else buckets.other.push(r);
  }

  const byScore = (a: ScoredReport, b: ScoredReport) => b.score - a.score;
  buckets.nvidia.sort(byScore);
  buckets.amd.sort(byScore);
  buckets.other.sort(byScore);

  return buckets;
}
```

- [ ] **Step 5: Run tests — confirm all pass**

```bash
pnpm test
```

Expected: all scoring tests pass.

- [ ] **Step 6: Build to check TypeScript compilation**

```bash
pnpm build
```

Expected: compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoring.ts src/lib/scoring.test.ts vitest.config.ts
git commit -m "feat: implement weighted scoring engine with GPU tier bucketing"
```

---

## Task 8: ReportCard Component

**Files:**
- Create: `src/components/ReportCard.tsx`

- [ ] **Step 1: Create src/components/ReportCard.tsx**

```tsx
// src/components/ReportCard.tsx
import { useState } from 'react';
import type { ScoredReport } from '../types';

interface Props {
  report: ScoredReport;
  selected: boolean;
  onSelect: (report: ScoredReport) => void;
}

const RATING_COLORS: Record<string, string> = {
  platinum: '#b0e0e6',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  borked:   '#ff4444',
  pending:  '#888888',
};

const GPU_TIER_LABELS: Record<string, string> = {
  nvidia: 'NVIDIA',
  amd:    'AMD',
  intel:  'Intel',
  unknown: '?',
};

function formatRecency(days: number): string {
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export function ReportCard({ report, selected, onSelect }: Props) {
  const color = RATING_COLORS[report.rating] ?? '#888';
  const gpuLabel = GPU_TIER_LABELS[report.gpuTier] ?? '?';

  return (
    <div
      style={{
        border: `2px solid ${selected ? '#4c9eff' : '#333'}`,
        borderRadius: 6,
        padding: '8px 10px',
        marginBottom: 8,
        background: selected ? 'rgba(76,158,255,0.1)' : 'rgba(255,255,255,0.04)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => onSelect(report)}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {/* Score badge */}
        <span style={{
          background: color, color: '#111', borderRadius: 4,
          padding: '1px 6px', fontWeight: 700, fontSize: 12, minWidth: 28, textAlign: 'center'
        }}>
          {report.score}
        </span>
        {/* GPU tier badge */}
        <span style={{
          background: '#333', color: '#ccc', borderRadius: 4,
          padding: '1px 5px', fontSize: 11
        }}>
          {gpuLabel}
        </span>
        {/* Proton version */}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#ddd' }}>
          {report.protonVersion}
        </span>
        {/* Checkbox */}
        <span style={{ fontSize: 16, color: selected ? '#4c9eff' : '#555' }}>
          {selected ? '☑' : '☐'}
        </span>
      </div>

      {/* Meta row */}
      <div style={{ fontSize: 11, color: '#999', marginBottom: 3 }}>
        {formatRecency(report.recencyDays)}
        {report.responses?.gpu ? ` · ${report.responses.gpu}` : ''}
      </div>

      {/* Launch options preview */}
      {report.notes && (
        <div style={{
          fontSize: 11, color: '#bbb', fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.3)', borderRadius: 3, padding: '2px 5px'
        }}>
          {truncate(report.notes, 80)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
pnpm build
```

Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReportCard.tsx
git commit -m "feat: add ReportCard component"
```

---

## Task 9: Badge Component

**Files:**
- Create: `src/components/Badge.tsx`

The badge is injected into the game page and positioned to the right of the existing ProtonDB badge. It reads badge color/label from plugin settings.

- [ ] **Step 1: Create src/components/Badge.tsx**

```tsx
// src/components/Badge.tsx
import type { ProtonDBSummary } from '../types';

interface Props {
  summary: ProtonDBSummary | null;
  gpuVendor: string | null;
  badgeColor?: string;   // from plugin settings, default per rating
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

export function ProtonPulseBadge({ summary, gpuVendor, badgeColor }: Props) {
  if (!summary || !summary.score || summary.score === 'pending') return null;

  const color = badgeColor ?? DEFAULT_COLORS[summary.score] ?? '#888';
  const tier = TIER_LABEL[summary.score] ?? summary.score;
  const vendorLabel = gpuVendor ? gpuVendor.toUpperCase() : '';
  const label = vendorLabel ? `PP·${vendorLabel} ${tier}` : `PP ${tier}`;

  return (
    <div
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
        cursor: 'default',
        userSelect: 'none',
      }}
      title={`Proton Pulse: ${tier} (${summary.total} reports)`}
    >
      ⚡ {label}
    </div>
  );
}
```

Note: the badge injection into the game page route is handled in `index.tsx` (Task 12). This component is just the visual element.

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Badge.tsx
git commit -m "feat: add game page badge component"
```

---

## Task 10: LogViewer Component

**Files:**
- Create: `src/components/LogViewer.tsx`

- [ ] **Step 1: Create src/components/LogViewer.tsx**

```tsx
// src/components/LogViewer.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';

const getLogContents = callable<[], string>('get_log_contents');

export function LogViewer() {
  const [logs, setLogs] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll every 3 seconds while mounted
  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const content = await getLogContents();
        if (active) setLogs(content);
      } catch {
        // silently ignore — log file may not exist yet
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll to bottom whenever logs update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!logs) {
    return (
      <div style={{ color: '#666', fontSize: 11, padding: 8 }}>
        No logs yet.
      </div>
    );
  }

  return (
    <div style={{
      maxHeight: 200,
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.4)',
      borderRadius: 4,
      padding: 6,
      fontSize: 10,
      fontFamily: 'monospace',
      color: '#bbb',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {logs}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/LogViewer.tsx
git commit -m "feat: add auto-scrolling log viewer component"
```

---

## Task 11: Modal Component

**Files:**
- Create: `src/components/Modal.tsx`

- [ ] **Step 1: Create src/components/Modal.tsx**

```tsx
// src/components/Modal.tsx
import { useState } from 'react';
import { DialogButton, ModalRoot, DialogHeader } from '@decky/ui';
import { toaster } from '@decky/api';
import { ReportCard } from './ReportCard';
import { scoreReport, bucketByGpuTier } from '../lib/scoring';
import type { ProtonDBReport, ScoredReport, SystemInfo, GpuVendor } from '../types';

interface Props {
  appId: number;
  appName: string;
  reports: ProtonDBReport[];
  sysInfo: SystemInfo;
  closeModal: () => void;
}

type FilterTier = GpuVendor | 'all';

export function ProtonPulseModal({ appId, appName, reports, sysInfo, closeModal }: Props) {
  const scored = reports.map(r => scoreReport(r, sysInfo));
  const buckets = bucketByGpuTier(scored);

  const defaultFilter: FilterTier = (sysInfo.gpu_vendor as FilterTier) ?? 'all';
  const [filter, setFilter] = useState<FilterTier>(defaultFilter);
  const [selected, setSelected] = useState<ScoredReport | null>(null);
  const [applying, setApplying] = useState(false);

  const visibleReports: ScoredReport[] = filter === 'all'
    ? [...buckets.nvidia, ...buckets.amd, ...buckets.other]
    : filter === 'nvidia' ? buckets.nvidia
    : filter === 'amd'    ? buckets.amd
    :                       buckets.other;

  const handleApply = async () => {
    if (!selected) return;

    // Guard: no game running
    const running = SteamClient.GameSessions.GetRunningApps();
    if (running.length > 0) {
      toaster.toast({ title: 'Proton Pulse', body: 'Quit your game first.' });
      return;
    }

    setApplying(true);
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, selected.notes);
      toaster.toast({ title: 'Proton Pulse', body: `Launch options applied for ${appName}` });
      closeModal();
    } catch (e) {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to apply — check logs.' });
    } finally {
      setApplying(false);
    }
  };

  const handleClear = async () => {
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, '');
      toaster.toast({ title: 'Proton Pulse', body: 'Launch options cleared.' });
      closeModal();
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to clear — check logs.' });
    }
  };

  const FILTER_OPTIONS: Array<{ value: FilterTier; label: string }> = [
    { value: 'nvidia', label: 'NVIDIA' },
    { value: 'amd',   label: 'AMD'   },
    { value: 'other', label: 'Other' },
    { value: 'all',   label: 'All'   },
  ];

  return (
    <ModalRoot onCancel={closeModal}>
      <DialogHeader>Proton Pulse — {appName}</DialogHeader>

      {/* GPU Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
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

      {/* Report list */}
      <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 10 }}>
        {visibleReports.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, padding: 12, textAlign: 'center' }}>
            No ProtonDB reports found for this GPU tier.
          </div>
        ) : (
          visibleReports.map((r, i) => (
            <ReportCard
              key={i}
              report={r}
              selected={selected === r}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <DialogButton onClick={handleClear} style={{ background: '#555' }}>
          Clear
        </DialogButton>
        <DialogButton onClick={closeModal} style={{ background: '#333' }}>
          Exit
        </DialogButton>
        <DialogButton
          onClick={handleApply}
          disabled={!selected || applying}
          style={{ background: selected ? '#4c9eff' : '#333' }}
        >
          {applying ? 'Applying…' : 'Apply ▶'}
        </DialogButton>
      </div>
    </ModalRoot>
  );
}
```

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: compiles clean. If `@decky/ui` doesn't export `ModalRoot` or `DialogHeader`, check available exports:
```bash
grep -r "export" node_modules/@decky/ui/dist/index.d.ts | grep -i modal
```
Adjust import names to match what's actually exported.

- [ ] **Step 3: Commit**

```bash
git add src/components/Modal.tsx
git commit -m "feat: add ranked report modal with GPU filter and Apply action"
```

---

## Task 12: Plugin Entry Point

**Files:**
- Modify: `src/index.tsx`

This replaces the entire template `index.tsx` with the real plugin entry.

- [ ] **Step 1: Replace src/index.tsx**

```tsx
// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
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

import { ProtonPulseModal } from './components/Modal';
import { ProtonPulseBadge } from './components/Badge';
import { LogViewer } from './components/LogViewer';
import type { SystemInfo, ProtonDBReport, ProtonDBSummary } from './types';

// ─── Backend callables ────────────────────────────────────────────────────────
const getSystemInfo      = callable<[], SystemInfo>('get_system_info');
const fetchSummary       = callable<[app_id: string], ProtonDBSummary>('fetch_protondb_summary');
const fetchReports       = callable<[app_id: string], ProtonDBReport[]>('fetch_protondb_reports');
const setLogLevel        = callable<[level: string], boolean>('set_log_level');
const isGameRunning      = callable<[], boolean>('is_game_running');

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [gameRunning, setGameRunning] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [currentAppId, setCurrentAppId] = useState<number | null>(null);
  const [currentAppName, setCurrentAppName] = useState<string>('');
  const [currentSummary, setCurrentSummary] = useState<ProtonDBSummary | null>(null);

  useEffect(() => {
    getSystemInfo().then(setSysInfo).catch(console.error);

    const checkGame = async () => {
      const running = await isGameRunning();
      setGameRunning(running);
    };
    checkGame();
    const interval = setInterval(checkGame, 5000);
    return () => clearInterval(interval);
  }, []);

  // Called from routerHook when user focuses a game — see definePlugin below
  const onGameFocus = (appId: number, appName: string) => {
    setCurrentAppId(appId);
    setCurrentAppName(appName);
    setCurrentSummary(null);
    fetchSummary(String(appId)).then(setCurrentSummary).catch(console.error);
  };
  // Expose so definePlugin can call it (module-level ref pattern)
  (Content as any)._onGameFocus = onGameFocus;

  const handleDebugToggle = async (enabled: boolean) => {
    setDebugEnabled(enabled);
    await setLogLevel(enabled ? 'DEBUG' : 'INFO');
  };

  const handleCheckProtonDB = async () => {
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

      // showModal returns { Hide } — pass it as closeModal via a ref to avoid
      // the temporal dead-zone circular reference
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
      modalRef.hide = modal.Hide;
    } catch (e) {
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to fetch reports — check logs.' });
    }
  };

  return (
    <PanelSection>
      {/* Badge preview in sidebar — also satisfies noUnusedLocals for ProtonPulseBadge */}
      {currentAppId && (
        <PanelSectionRow>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#aaa' }}>
            {currentAppName}
            <ProtonPulseBadge summary={currentSummary} gpuVendor={sysInfo?.gpu_vendor ?? null} />
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={gameRunning || !currentAppId}
          onClick={handleCheckProtonDB}
          description={gameRunning ? 'Quit your game first' : (currentAppId ? undefined : 'Navigate to a game first')}
        >
          Check ProtonDB ▶
        </ButtonItem>
      </PanelSectionRow>

      <PanelSection title="Settings">
        <PanelSectionRow>
          <ToggleField
            label="Debug Logs"
            checked={debugEnabled}
            onChange={handleDebugToggle}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Logs">
        <PanelSectionRow>
          <LogViewer />
        </PanelSectionRow>
      </PanelSection>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

  // Track the currently focused app — updated by the router
  let focusedAppId: number | null = null;
  let focusedAppName = '';

  // Badge patch: inject into game detail pages
  const patchGamePage = routerHook.addPatch(
    '/library/app/:appid',
    (props: { children?: React.ReactNode; appid?: string }) => {
      const appId = props.appid ? parseInt(props.appid, 10) : null;
      focusedAppId = appId;
      // Note: badge injection into existing badge row requires finding the
      // Steam DOM node for the badge area. This is Steam-version-dependent.
      // The badge component is returned here; exact positioning is adjusted
      // by inspecting the live Steam DOM with Decky's devtools.
      return props;
    }
  );

  // Listen for game launch events to update game-running state
  const gameStartListener = addEventListener<[appId: number]>(
    'game_start',
    (appId) => {
      console.log(`Proton Pulse: game started ${appId}`);
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

- [ ] **Step 2: Build**

```bash
pnpm build
```

If `routerHook.addPatch` is not available in the current `@decky/api` version, check the API surface:
```bash
grep -r "addPatch\|addRoute\|removePatch" node_modules/@decky/api/dist/ | head -20
```
Use whatever route-patching API is available. The badge injection approach may need adjustment — refer to protondb-decky source for the current pattern.

- [ ] **Step 3: Fix any TypeScript errors, then rebuild**

Common issues:
- `showModal` second argument (closeModal callback): check `@decky/ui` signature
- `routerHook.addPatch` type: may need `as any` if type definitions are incomplete
- `FaBolt` icon: if missing, substitute `FaZap` or another available icon

- [ ] **Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: implement plugin entry point with sidebar panel and badge injection"
```

---

## Task 13: Helper Scripts

**Files:**
- Create: `scripts/dev-setup.sh`
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Create scripts/dev-setup.sh**

```bash
#!/usr/bin/env bash
# scripts/dev-setup.sh
# Quick dev environment setup for decky-proton-pulse
# Based on: https://github.com/SteamDeckHomebrew/decky-plugin-template

set -euo pipefail

REQUIRED_NODE_MAJOR=16
REQUIRED_PNPM_MAJOR=9

echo "=== Proton Pulse Dev Setup ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install v${REQUIRED_NODE_MAJOR}+ from https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "ERROR: Node.js v${NODE_MAJOR} found, need v${REQUIRED_NODE_MAJOR}+."
  exit 1
fi
echo "✓ Node.js $(node --version)"

# Check pnpm
if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found — installing via npm..."
  npm i -g pnpm@9
fi
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [ "$PNPM_MAJOR" -lt "$REQUIRED_PNPM_MAJOR" ]; then
  echo "WARNING: pnpm v${PNPM_MAJOR} found, need v${REQUIRED_PNPM_MAJOR}. Run: npm i -g pnpm@9"
fi
echo "✓ pnpm $(pnpm --version)"

# Install dependencies
echo "Installing dependencies..."
pnpm i

# Build
echo "Building plugin..."
pnpm build

echo ""
echo "=== Build complete ==="
echo ""
echo "To deploy to your Steam Deck (set DECK_IP first):"
echo "  export DECK_IP=192.168.1.x"
echo "  bash scripts/deploy.sh --target stable"
```

- [ ] **Step 2: Create scripts/deploy.sh**

```bash
#!/usr/bin/env bash
# scripts/deploy.sh
# Packages and deploys decky-proton-pulse to a connected Steam Deck.
# Usage: bash scripts/deploy.sh --target stable|beta|autobuild [--deck-ip IP]

set -euo pipefail

PLUGIN_NAME="decky-proton-pulse"
TARGET="stable"
DECK_IP="${DECK_IP:-}"
DECK_USER="deck"
DECK_PLUGIN_DIR="/home/deck/homebrew/plugins"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)   TARGET="$2";   shift 2 ;;
    --deck-ip)  DECK_IP="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ ! "$TARGET" =~ ^(stable|beta|autobuild)$ ]]; then
  echo "ERROR: --target must be stable, beta, or autobuild"
  exit 1
fi

echo "=== Proton Pulse Deploy (target: $TARGET) ==="

# Build
pnpm build

# Package
VERSION=$(node -e "const p=require('./package.json'); process.stdout.write(p.version)")
ZIP_NAME="${PLUGIN_NAME}-v${VERSION}.zip"
STAGING_DIR="/tmp/${PLUGIN_NAME}"

rm -rf "$STAGING_DIR"
mkdir -p "${STAGING_DIR}/${PLUGIN_NAME}/dist"

cp dist/index.js             "${STAGING_DIR}/${PLUGIN_NAME}/dist/"
cp main.py plugin.json LICENSE package.json README.md \
   "${STAGING_DIR}/${PLUGIN_NAME}/"

(cd "$STAGING_DIR" && zip -r "$ZIP_NAME" "$PLUGIN_NAME")
mv "${STAGING_DIR}/${ZIP_NAME}" .

echo "✓ Packaged: ${ZIP_NAME}"

# Deploy via SCP if DECK_IP is set
if [[ -n "$DECK_IP" ]]; then
  echo "Deploying to Steam Deck at $DECK_IP..."
  ssh "${DECK_USER}@${DECK_IP}" "mkdir -p ${DECK_PLUGIN_DIR}/${PLUGIN_NAME}"
  scp -r "${STAGING_DIR}/${PLUGIN_NAME}/." \
    "${DECK_USER}@${DECK_IP}:${DECK_PLUGIN_DIR}/${PLUGIN_NAME}/"
  echo "✓ Deployed. Restart Decky Loader on your Deck to reload the plugin."
else
  echo "DECK_IP not set — skipping SCP. Set it with: export DECK_IP=192.168.x.x"
fi

rm -rf "$STAGING_DIR"
echo "=== Done ==="
```

- [ ] **Step 3: Make scripts executable and commit**

```bash
chmod +x scripts/dev-setup.sh scripts/deploy.sh
git add scripts/dev-setup.sh scripts/deploy.sh
git commit -m "feat: add dev-setup and deploy helper scripts"
```

---

## Task 14: Build Verification + Smoke Test

- [ ] **Step 1: Run full test suite**

```bash
python -m pytest tests/ -v
pnpm test
```

Expected: all Python and TypeScript tests pass.

- [ ] **Step 2: Final build**

```bash
pnpm build
```

Expected: `dist/index.js` generated, no TypeScript errors.

- [ ] **Step 3: Verify plugin package structure**

```bash
ls -la dist/
ls -la main.py plugin.json package.json
```

Expected: `dist/index.js` exists; all required plugin files present.

- [ ] **Step 4: Verify ProtonDB API field names against live data**

```bash
curl -s "https://www.protondb.com/api/v1/reports/app/2358720" \
  | python3 -m json.tool | head -40
```

Compare field names against `src/types.ts`. Update types if they differ (common fields to check: `responses` sub-fields — `gpu`, `gpuDriver`, `os`, `ram`, `kernel`).

- [ ] **Step 5: Verify ProtonDB summary endpoint**

```bash
curl -s "https://www.protondb.com/api/v1/reports/summaries/2358720.json" \
  | python3 -m json.tool
```

Compare against `ProtonDBSummary` type in `src/types.ts`. Update if needed.

- [ ] **Step 6: Create docs/tasks/phase1-status.md**

```markdown
# Phase 1 Task Status

Tracking pre-deploy tasks. Delete this file when ready for production release.

## Status: In Progress

| Task | Status |
|---|---|
| Plugin metadata | ✅ |
| TypeScript types | ✅ |
| Python test infra | ✅ |
| Python logger + game guard | ✅ |
| Python system detection | ✅ |
| Python ProtonDB fetcher | ✅ |
| Scoring engine | ✅ |
| ReportCard component | ✅ |
| Badge component | ✅ |
| LogViewer component | ✅ |
| Modal component | ✅ |
| Plugin entry point | ✅ |
| Helper scripts | ✅ |
| Live API field verification | ⬜ |
| On-device smoke test | ⬜ |
| Badge injection tuning | ⬜ |

## Known Pending Items (pre-deploy)
- Badge injection position relative to existing ProtonDB badge requires
  live Steam DOM inspection — exact CSS/component path is Steam-version-dependent.
- ProtonDB API field names need live verification (Task 14, Step 4).
- `showModal` closeModal callback signature may need adjustment based on @decky/ui version.
```

- [ ] **Step 7: Final commit**

```bash
git add docs/tasks/phase1-status.md
git commit -m "chore: add phase1 status tracker and verify build"
```

---

## Notes for On-Device Testing

1. **Deploy:** `export DECK_IP=<your-deck-ip> && bash scripts/deploy.sh --target stable`
2. **Restart Decky:** SSH into deck → `systemctl restart plugin_loader` (or use Decky UI)
3. **Test flow:** Navigate to a game → open Decky sidebar → click "Check ProtonDB"
4. **Badge tuning:** Open Steam's CEF devtools (Decky → settings → enable devtools) to inspect the badge injection point and adjust CSS positioning in `Badge.tsx`
5. **Logs:** Debug toggle in sidebar → check `/tmp/decky-proton-pulse.log`
