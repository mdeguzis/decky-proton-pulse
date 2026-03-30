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

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def _main(self):
        self._system_info: dict = {}
        self._reports_cache: dict = {}
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
        if result.returncode != 0:
            return None, None
        for line in result.stdout.splitlines():
            lower = line.lower()
            if any(k in lower for k in ['vga', '3d controller', 'display controller']):
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
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except FileNotFoundError:
            pass
        try:
            import glob
            for path in glob.glob("/sys/class/drm/card*/device/driver/module/version"):
                with open(path) as f:
                    return f.read().strip()
        except OSError as e:
            self._logger.warning(f"DRM driver version read failed: {e}")
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
        compat_dir = os.path.join(decky.DECKY_USER_HOME, ".steam", "root", "compatibilitytools.d")
        if not os.path.isdir(compat_dir):
            return None
        entries = [d for d in os.listdir(compat_dir)
                   if os.path.isdir(os.path.join(compat_dir, d))]
        return entries[0] if len(entries) == 1 else (", ".join(entries) if entries else None)

    # ─── ProtonDB Fetcher ─────────────────────────────────────────────────────
    # (stubs — filled in Task 6)

    async def fetch_protondb_summary(self, app_id: str) -> dict:
        return {}

    async def fetch_protondb_reports(self, app_id: str) -> list:
        return []
