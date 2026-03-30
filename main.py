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
    # (stubs — filled in Task 5)

    async def get_system_info(self) -> dict:
        return {}

    # ─── ProtonDB Fetcher ─────────────────────────────────────────────────────
    # (stubs — filled in Task 6)

    async def fetch_protondb_summary(self, app_id: str) -> dict:
        return {}

    async def fetch_protondb_reports(self, app_id: str) -> list:
        return []
