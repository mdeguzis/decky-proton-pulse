# main.py
import os
import logging
import logging.handlers
import subprocess
import json

import decky


class Plugin:

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def _main(self):
        self._system_info: dict = {}
        self._debug_handler: logging.Handler | None = None
        decky.logger.info("Proton Pulse starting up")
        self._system_info = await self.get_system_info()
        decky.logger.info(f"System detected: {self._system_info}")

    async def _unload(self):
        decky.logger.info("Proton Pulse unloading")

    async def _uninstall(self):
        decky.logger.info("Proton Pulse uninstalled")

    async def _migration(self):
        decky.migrate_logs(
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-proton-pulse", "proton-pulse.log")
        )
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "proton-pulse.json"),
            os.path.join(decky.DECKY_USER_HOME, ".config", "decky-proton-pulse"),
        )

    # ─── Logging ──────────────────────────────────────────────────────────────

    def _sync_set_log_level(self, level: str) -> bool:
        """Synchronous helper used by tests and the async callable."""
        valid = {"DEBUG": logging.DEBUG, "INFO": logging.INFO,
                 "WARNING": logging.WARNING, "ERROR": logging.ERROR}
        if level not in valid:
            return False
        numeric = valid[level]
        previous_level = logging.getLevelName(decky.logger.level)
        decky.logger.setLevel(numeric)
        if numeric == logging.DEBUG:
            self._enable_debug_log()
            decky.logger.info(
                f"Log level changed from {previous_level} to DEBUG; verbose frontend/backend logging enabled"
            )
        else:
            decky.logger.info(
                f"Log level changed from {previous_level} to {level}; verbose debug logging disabled"
            )
            self._disable_debug_log()
        return True

    def _enable_debug_log(self) -> None:
        if hasattr(self, '_debug_handler') and self._debug_handler is not None:
            return
        debug_path = os.path.join(decky.DECKY_PLUGIN_LOG_DIR, 'plugin-debug.log')
        handler = logging.handlers.RotatingFileHandler(
            debug_path, maxBytes=20 * 1024 * 1024, backupCount=3
        )
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        ))
        decky.logger.addHandler(handler)
        self._debug_handler = handler
        decky.logger.debug("Debug log enabled")

    def _disable_debug_log(self) -> None:
        if not hasattr(self, '_debug_handler') or self._debug_handler is None:
            return
        decky.logger.removeHandler(self._debug_handler)
        self._debug_handler.close()
        self._debug_handler = None

    async def set_log_level(self, level: str) -> bool:
        return self._sync_set_log_level(level)

    async def get_log_contents(self) -> str:
        log_paths = [
            decky.DECKY_PLUGIN_LOG,
            os.path.join(decky.DECKY_PLUGIN_LOG_DIR, 'plugin-debug.log'),
        ]
        chunks: list[str] = []

        for path in log_paths:
            try:
                with open(path, "r") as f:
                    lines = f.readlines()
                if lines:
                    chunks.append(f"===== {os.path.basename(path)} =====\n")
                    chunks.append("".join(lines[-200:]))
            except FileNotFoundError:
                continue

        return "\n".join(chunks)

    async def log_frontend_event(self, level: str, message: str, context: dict | None = None) -> bool:
        valid = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
        }
        numeric = valid.get(level.upper())
        if numeric is None:
            return False

        suffix = ""
        if context:
            try:
                suffix = f" | context={json.dumps(context, sort_keys=True)}"
            except TypeError:
                suffix = f" | context={str(context)}"

        decky.logger.log(numeric, f"[frontend] {message}{suffix}")
        return True

    async def get_plugin_version(self) -> str:
        return getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")

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
            decky.logger.warning(f"is_game_running check failed: {e}")
            return False

    # ─── System Detection ─────────────────────────────────────────────────────

    async def get_system_info(self) -> dict:
        info = {
            'cpu': None, 'ram_gb': None, 'gpu': None, 'gpu_vendor': None,
            'driver_version': None, 'kernel': None, 'distro': None, 'proton_custom': None
        }
        for field, fn in [
            ('cpu',            self._read_cpu),
            ('ram_gb',         self._read_ram_gb),
            ('kernel',         self._read_kernel),
            ('distro',         self._read_distro),
            ('driver_version', self._read_driver_version),
            ('proton_custom',  self._read_custom_proton),
        ]:
            try:
                info[field] = fn()
            except Exception as e:
                decky.logger.warning(f"System detection failed for {field}: {e}")

        try:
            gpu, vendor = self._read_gpu()
            info['gpu'] = gpu
            info['gpu_vendor'] = vendor
        except Exception as e:
            decky.logger.warning(f"GPU detection failed: {e}")

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
            decky.logger.warning(f"DRM driver version read failed: {e}")
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
