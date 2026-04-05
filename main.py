# main.py
import os
import logging
import logging.handlers
import subprocess
import json
import re
import shutil
import tarfile
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import decky


class Plugin:
    PROTON_GE_REPO_API = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases?per_page=30"
    PROTON_GE_CACHE_TTL_SECONDS = 6 * 60 * 60
    PROTON_GE_LATEST_SLOT_NAME = "Proton-GE-Latest"
    COMPAT_TOOL_RESTART_HINT = " Steam may need a restart before the new compatibility tool appears everywhere."

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def _main(self):
        self._system_info: dict = {}
        self._debug_handler: logging.Handler | None = None
        self._proton_ge_install_lock = threading.Lock()
        self._proton_ge_install_thread: threading.Thread | None = None
        self._proton_ge_install_cancel = threading.Event()
        self._proton_ge_install_process: subprocess.Popen | None = None
        self._proton_ge_install_status: dict = {
            "state": "idle",
            "tag_name": None,
            "message": None,
            "stage": None,
            "downloaded_bytes": None,
            "total_bytes": None,
            "progress_fraction": None,
            "started_at": None,
            "finished_at": None,
            "install_as_latest": False,
        }
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

    def _system_command_env(self) -> dict[str, str]:
        env = os.environ.copy()
        for key in [
            "LD_LIBRARY_PATH",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "PYTHONHOME",
            "PYTHONPATH",
        ]:
            env.pop(key, None)
        return env

    def _extract_archive_safely(self, archive_path: Path, extract_dir: Path) -> None:
        extract_root = extract_dir.resolve()

        def _ensure_within_root(candidate: Path) -> None:
            resolved = candidate.resolve()
            if resolved != extract_root and extract_root not in resolved.parents:
                raise RuntimeError(f"Archive entry attempted to escape extraction root: {resolved}")

        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path, "r") as archive:
                for member in archive.infolist():
                    member_path = extract_dir / member.filename
                    _ensure_within_root(member_path)
                archive.extractall(extract_dir)
            return

        with tarfile.open(archive_path, "r:*") as archive:
            for member in archive.getmembers():
                member_path = extract_dir / member.name
                _ensure_within_root(member_path)
            archive.extractall(extract_dir)

    def _curl_json(self, url: str, *, headers: list[str] | None = None, timeout: int = 25) -> list | dict:
        command = [
            "curl",
            "-LfsS",
            "--http1.1",
            "--connect-timeout",
            "20",
            "--retry",
            "2",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "--max-time",
            str(timeout),
            url,
        ]
        for header in headers or []:
            command.extend(["-H", header])
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout + 10,
            env=self._system_command_env(),
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"curl failed with exit code {result.returncode}")
        return json.loads(result.stdout)

    def _curl_download(
        self,
        url: str,
        destination: Path,
        *,
        timeout: int = 900,
        total_bytes: int | None = None,
        progress_callback=None,
    ) -> None:
        command = [
            "curl",
            "-LfsS",
            "--http1.1",
            "-4",
            "--connect-timeout",
            "20",
            "--retry",
            "2",
            "--retry-all-errors",
            "--retry-delay",
            "2",
            "--speed-time",
            "60",
            "--speed-limit",
            "1024",
            "--max-time",
            str(timeout),
            url,
            "-o",
            str(destination),
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self._system_command_env(),
        )
        with self._proton_ge_install_lock:
            self._proton_ge_install_process = process
        start_time = time.time()
        last_log_time = start_time
        last_size = -1

        try:
            while True:
                if self._proton_ge_cancel_requested():
                    process.terminate()
                    try:
                        stdout, stderr = process.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        stdout, stderr = process.communicate(timeout=5)
                    raise RuntimeError((stderr or stdout or "Install cancelled").strip() or "Install cancelled")
                returncode = process.poll()
                now = time.time()
                if now - last_log_time >= 10:
                    current_size = destination.stat().st_size if destination.exists() else 0
                    growth = current_size - max(last_size, 0) if last_size >= 0 else current_size
                    decky.logger.info(
                        "curl download progress"
                        f" | destination={destination.name} bytes={current_size} growth_since_last={growth}"
                        f" elapsed={int(now - start_time)}s"
                    )
                    if progress_callback:
                        fraction = None
                        if total_bytes and total_bytes > 0:
                            fraction = max(0.0, min(1.0, current_size / total_bytes))
                        progress_callback(current_size, total_bytes, fraction)
                    last_size = current_size
                    last_log_time = now

                if returncode is not None:
                    stdout, stderr = process.communicate(timeout=5)
                    if returncode != 0 or not destination.exists() or destination.stat().st_size <= 0:
                        raise RuntimeError(
                            (stderr or stdout or f"curl failed with exit code {returncode}").strip()
                        )
                    if progress_callback:
                        current_size = destination.stat().st_size
                        fraction = None
                        if total_bytes and total_bytes > 0:
                            fraction = max(0.0, min(1.0, current_size / total_bytes))
                        progress_callback(current_size, total_bytes, fraction)
                    return

                if now - start_time > timeout + 30:
                    process.kill()
                    stdout, stderr = process.communicate(timeout=5)
                    raise RuntimeError(
                        (stderr or stdout or f"curl exceeded timeout after {timeout + 30}s").strip()
                    )

                time.sleep(1)
        finally:
            with self._proton_ge_install_lock:
                if self._proton_ge_install_process is process:
                    self._proton_ge_install_process = None

    def _proton_ge_latest_metadata_path(self) -> Path:
        return self._compat_tools_cache_dir() / "proton-ge-latest.json"

    def _write_proton_ge_latest_metadata(self, tag_name: str, directory_name: str) -> None:
        metadata_path = self._proton_ge_latest_metadata_path()
        metadata_path.write_text(json.dumps({
            "tag_name": tag_name,
            "directory_name": directory_name,
            "updated_at": int(time.time()),
        }))

    def _clear_proton_ge_latest_metadata(self, directory_name: str | None = None) -> None:
        metadata_path = self._proton_ge_latest_metadata_path()
        if not metadata_path.exists():
            return
        if directory_name is None:
            metadata_path.unlink(missing_ok=True)
            return
        try:
            payload = json.loads(metadata_path.read_text())
        except Exception:
            metadata_path.unlink(missing_ok=True)
            return
        if payload.get("directory_name") == directory_name:
            metadata_path.unlink(missing_ok=True)

    def _read_proton_ge_latest_metadata(self) -> dict | None:
        metadata_path = self._proton_ge_latest_metadata_path()
        if not metadata_path.exists():
            return None
        try:
            payload = json.loads(metadata_path.read_text())
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        return payload

    def _set_proton_ge_install_status(
        self,
        *,
        state: str,
        tag_name: str | None,
        message: str | None,
        install_as_latest: bool,
        stage: str | None = None,
        downloaded_bytes: int | None = None,
        total_bytes: int | None = None,
        progress_fraction: float | None = None,
        started_at: int | None = None,
        finished_at: int | None = None,
    ) -> None:
        with self._proton_ge_install_lock:
            current_started_at = self._proton_ge_install_status.get("started_at")
            current_stage = self._proton_ge_install_status.get("stage")
            current_downloaded_bytes = self._proton_ge_install_status.get("downloaded_bytes")
            current_total_bytes = self._proton_ge_install_status.get("total_bytes")
            current_progress_fraction = self._proton_ge_install_status.get("progress_fraction")
            self._proton_ge_install_status = {
                "state": state,
                "tag_name": tag_name,
                "message": message,
                "stage": stage if stage is not None else (current_stage if state == "running" else None),
                "downloaded_bytes": (
                    downloaded_bytes if downloaded_bytes is not None else (current_downloaded_bytes if state == "running" else None)
                ),
                "total_bytes": total_bytes if total_bytes is not None else (current_total_bytes if state == "running" else None),
                "progress_fraction": (
                    progress_fraction if progress_fraction is not None else (current_progress_fraction if state == "running" else None)
                ),
                "started_at": started_at if started_at is not None else (current_started_at if state == "running" else None),
                "finished_at": finished_at,
                "install_as_latest": install_as_latest,
            }

    def _get_proton_ge_install_status(self) -> dict:
        with self._proton_ge_install_lock:
            return dict(self._proton_ge_install_status)

    def _proton_ge_cancel_requested(self) -> bool:
        return self._proton_ge_install_cancel.is_set()

    def _finalize_extracted_compat_tool(
        self,
        archive_label: str,
        extract_dir: Path,
        compat_dir: Path,
        *,
        destination_name: str | None = None,
        replace_existing: bool = False,
    ) -> dict:
        extracted_entries = [entry for entry in extract_dir.iterdir()]
        source_dir = next((entry for entry in extracted_entries if entry.is_dir()), None)
        if source_dir is None:
            inferred_name = Path(archive_label).name
            for suffix in [".tar.gz", ".tar.xz", ".tar.bz2", ".tgz", ".zip", ".tar"]:
                if inferred_name.endswith(suffix):
                    inferred_name = inferred_name[: -len(suffix)]
                    break
            source_dir = extract_dir / inferred_name
            source_dir.mkdir(parents=True, exist_ok=True)
            for entry in extracted_entries:
                shutil.move(str(entry), source_dir / entry.name)

        destination = compat_dir / (destination_name or source_dir.name)
        if destination.exists():
            if replace_existing:
                shutil.rmtree(destination)
            else:
                return {"success": True, "already_installed": True, "message": f"{destination.name} is already installed."}

        shutil.move(str(source_dir), str(destination))
        return {"success": True, "message": f"Installed {destination.name}.{self.COMPAT_TOOL_RESTART_HINT}"}

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

    # ─── ProtonDB System Info ────────────────────────────────────────────────

    async def get_protondb_systeminfo(self) -> str:
        """Generate a Steam System Information block for ProtonDB submissions."""
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "protondb_systeminfo",
                os.path.join(os.path.dirname(__file__), "protondb_systeminfo.py"),
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.generate_system_info(home=decky.DECKY_USER_HOME)
        except Exception as e:
            decky.logger.error(f"Failed to generate ProtonDB system info: {e}")
            return f"Error generating system info: {e}"

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

    # ─── Compatibility Tools / Proton-GE ─────────────────────────────────────

    def _find_steam_root(self) -> Path | None:
        possible_roots = [
            ".local/share/Steam",
            ".steam/root",
            ".steam/steam",
            ".steam/debian-installation",
            ".var/app/com.valvesoftware.Steam/data/Steam",
        ]
        user_home = Path(decky.DECKY_USER_HOME)
        for root in possible_roots:
            candidate = user_home / root
            config_dir = candidate / "config"
            if (config_dir / "config.vdf").exists() and (config_dir / "libraryfolders.vdf").exists():
                return candidate
        return None

    def _compat_tools_dirs(self) -> list[Path]:
        detected_root = self._find_steam_root()
        candidates = [detected_root / "compatibilitytools.d"] if detected_root else []
        candidates.extend([
            Path(decky.DECKY_USER_HOME) / ".steam" / "root" / "compatibilitytools.d",
            Path(decky.DECKY_USER_HOME) / ".steam" / "steam" / "compatibilitytools.d",
            Path(decky.DECKY_USER_HOME) / ".local" / "share" / "Steam" / "compatibilitytools.d",
            Path(decky.DECKY_USER_HOME) / ".var" / "app" / "com.valvesoftware.Steam" / "data" / "Steam" / "compatibilitytools.d",
        ])
        seen: set[str] = set()
        result: list[Path] = []
        for candidate in candidates:
            key = str(candidate)
            if key in seen:
                continue
            seen.add(key)
            candidate.mkdir(parents=True, exist_ok=True)
            result.append(candidate)
        return result

    def _compat_tools_dir(self) -> Path:
        return self._compat_tools_dirs()[0]

    def _compat_tools_cache_dir(self) -> Path:
        cache_dir = Path(decky.DECKY_USER_HOME) / ".config" / "decky-proton-pulse"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir

    def _proton_ge_cache_path(self) -> Path:
        return self._compat_tools_cache_dir() / "proton-ge-releases-cache.json"

    def _normalize_proton_ge_tag(self, version: str) -> str | None:
        """Normalize a version string to a GE-Proton tag name, or None if not GE-Proton.

        Only versions that are clearly GE-Proton are recognized. Valve Proton
        versions like "10.0-3" or "Proton 9.0-4" return None (not managed).
        """
        cleaned = version.strip()
        if not cleaned:
            return None

        cleaned = cleaned.replace("_", "-")
        cleaned = re.sub(r"\s+", "", cleaned)

        # Require "GE" somewhere in the string to distinguish from Valve Proton
        if "ge" not in cleaned.lower():
            decky.logger.debug(
                f"_normalize_proton_ge_tag: '{version}' has no GE indicator, treating as Valve Proton"
            )
            return None

        match = re.search(r"GE-?Proton(\d+(?:-\d+)*)", cleaned, re.IGNORECASE)
        if not match:
            return None
        return f"GE-Proton{match.group(1)}"

    def _read_vdf_value(self, text: str, key: str) -> str | None:
        match = re.search(rf'"{re.escape(key)}"\s+"([^"]+)"', text)
        return match.group(1).strip() if match else None

    def _installed_tool_matches_version(self, tool: dict, version: str) -> bool:
        normalized = self._normalize_proton_ge_tag(version)
        if not normalized:
            return False
        latest_tag = tool.get("latest_tag")
        if isinstance(latest_tag, str) and latest_tag.lower() == normalized.lower():
            return True

        fields = [
            tool.get("directory_name") or "",
            tool.get("display_name") or "",
            tool.get("internal_name") or "",
        ]
        lowered = normalized.lower()
        return any(field.lower() == lowered for field in fields)

    def _is_proton_ge_tool(self, tool: dict) -> bool:
        if tool.get("managed_slot") == "latest":
            return True
        fields = [
            tool.get("directory_name") or "",
            tool.get("display_name") or "",
            tool.get("internal_name") or "",
        ]
        return any("ge-proton" in field.lower() for field in fields)

    def _simplify_release(self, release: dict) -> dict | None:
        if release.get("draft") or release.get("prerelease"):
            return None

        asset = next(
            (
                candidate
                for candidate in release.get("assets", [])
                if isinstance(candidate.get("name"), str)
                and candidate["name"].startswith("GE-Proton")
                and (
                    candidate["name"].endswith(".tar.gz")
                    or candidate["name"].endswith(".tar.xz")
                )
            ),
            None,
        )
        if not asset:
            return None

        return {
            "tag_name": release.get("tag_name"),
            "name": release.get("name") or release.get("tag_name"),
            "published_at": release.get("published_at"),
            "prerelease": bool(release.get("prerelease")),
            "asset_name": asset.get("name"),
            "download_url": asset.get("browser_download_url"),
            "asset_size": asset.get("size"),
        }

    def _fetch_proton_ge_releases(self) -> list[dict]:
        cache_path = self._proton_ge_cache_path()
        now = int(time.time())

        if cache_path.exists():
            try:
                cached = json.loads(cache_path.read_text())
                if now - int(cached.get("fetched_at", 0)) < self.PROTON_GE_CACHE_TTL_SECONDS:
                    return cached.get("releases", [])
            except Exception as err:
                decky.logger.warning(f"Failed to read Proton-GE cache: {err}")

        # Keep the GitHub path curl-first for now. The Deck has shown two separate
        # failure modes that we want to avoid in the hot path:
        # 1. curl + GitHub HTTP/2 PROTOCOL_ERROR on large downloads
        # 2. Python ssl/urlopen certificate validation failures on the Deck
        #
        # Future plan:
        # - replace the Python fallback with a single reliable client path
        # - ideally a small Rust helper using reqwest + rustls, similar to Wine Cellar
        # - or explicitly fix Python's CA handling with a known-good SSL context
        try:
            releases = self._curl_json(
                self.PROTON_GE_REPO_API,
                headers=[
                    "Accept: application/vnd.github+json",
                    "User-Agent: decky-proton-pulse",
                ],
                timeout=25,
            )
        except Exception as err:
            decky.logger.warning(f"curl fetch for Proton-GE releases failed, trying Python fallback: {err}")
            request = Request(
                self.PROTON_GE_REPO_API,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "decky-proton-pulse",
                },
            )
            with urlopen(request, timeout=20) as response:
                releases = json.loads(response.read().decode("utf-8"))

        simplified = [item for item in (self._simplify_release(release) for release in releases) if item]
        cache_path.write_text(json.dumps({"fetched_at": now, "releases": simplified}))
        return simplified

    def _list_installed_compatibility_tools(self) -> list[dict]:
        tools: list[dict] = []
        seen_dirs: set[str] = set()
        latest_metadata = self._read_proton_ge_latest_metadata()
        for compat_dir in self._compat_tools_dirs():
            for entry in sorted(compat_dir.iterdir(), key=lambda path: path.name.lower()):
                if not entry.is_dir():
                    continue
                if entry.name in seen_dirs:
                    continue
                seen_dirs.add(entry.name)

                vdf_path = entry / "compatibilitytool.vdf"
                display_name = entry.name
                internal_name = entry.name

                if vdf_path.exists():
                    try:
                        vdf_text = vdf_path.read_text()
                        display_name = self._read_vdf_value(vdf_text, "display_name") or display_name
                        internal_name = self._read_vdf_value(vdf_text, "internal_name") or internal_name
                    except Exception as err:
                        decky.logger.warning(f"Failed to read compatibilitytool.vdf for {entry.name}: {err}")

                tools.append(
                    {
                        "directory_name": entry.name,
                        "display_name": display_name,
                        "internal_name": internal_name,
                        "path": str(entry),
                        "source": "custom",
                        "managed_slot": (
                            "latest"
                            if entry.name == self.PROTON_GE_LATEST_SLOT_NAME
                            or (latest_metadata and latest_metadata.get("directory_name") == entry.name)
                            else "versioned" if "ge-proton" in (display_name + internal_name + entry.name).lower() else None
                        ),
                        "latest_tag": (
                            latest_metadata.get("tag_name")
                            if latest_metadata
                            and (
                                entry.name == self.PROTON_GE_LATEST_SLOT_NAME
                                or latest_metadata.get("directory_name") == entry.name
                            )
                            else None
                        ),
                    }
                )

        detected_root = self._find_steam_root()
        steam_common_dirs = [detected_root / "steamapps" / "common"] if detected_root else []
        steam_common_dirs.extend([
            Path(decky.DECKY_USER_HOME) / ".steam" / "root" / "steamapps" / "common",
            Path(decky.DECKY_USER_HOME) / ".steam" / "steam" / "steamapps" / "common",
            Path(decky.DECKY_USER_HOME) / ".local" / "share" / "Steam" / "steamapps" / "common",
            Path(decky.DECKY_USER_HOME) / ".var" / "app" / "com.valvesoftware.Steam" / "data" / "Steam" / "steamapps" / "common",
        ])
        for common_dir in steam_common_dirs:
            if not common_dir.is_dir():
                continue
            for entry in sorted(common_dir.iterdir(), key=lambda path: path.name.lower()):
                if not entry.is_dir():
                    continue
                name = entry.name
                lower = name.lower()
                if not (lower.startswith("proton") or lower.startswith("ge-proton")):
                    continue
                if name in seen_dirs:
                    continue
                seen_dirs.add(name)
                tools.append(
                    {
                        "directory_name": name,
                        "display_name": name,
                        "internal_name": name,
                        "path": str(entry),
                        "source": "valve",
                    }
                )

        return tools

    async def list_installed_compatibility_tools(self) -> list[dict]:
        return self._list_installed_compatibility_tools()

    def _get_proton_ge_releases_sync(self, force_refresh: bool = False) -> list[dict]:
        cache_path = self._proton_ge_cache_path()
        if force_refresh and cache_path.exists():
            cache_path.unlink()

        try:
            return self._fetch_proton_ge_releases()
        except Exception as err:
            decky.logger.error(f"Failed to fetch Proton-GE releases: {err}")
            if cache_path.exists():
                try:
                    cached = json.loads(cache_path.read_text())
                    return cached.get("releases", [])
                except Exception:
                    pass
            return []

    async def get_proton_ge_releases(self, force_refresh: bool = False) -> list[dict]:
        return self._get_proton_ge_releases_sync(force_refresh)

    async def get_proton_ge_manager_state(self, force_refresh: bool = False) -> dict:
        releases = await self.get_proton_ge_releases(force_refresh)
        installed = self._list_installed_compatibility_tools()
        current_release = releases[0] if releases else None
        current_installed = bool(
            current_release
            and any(self._installed_tool_matches_version(tool, current_release["tag_name"]) for tool in installed)
        )
        current_latest_slot_installed = bool(
            current_release
            and any(
                tool.get("managed_slot") == "latest"
                and self._installed_tool_matches_version(tool, current_release["tag_name"])
                for tool in installed
            )
        )
        return {
            "current_release": current_release,
            "current_installed": current_installed,
            "current_latest_slot_installed": current_latest_slot_installed,
            "installed_tools": installed,
            "releases": releases,
            "install_status": self._get_proton_ge_install_status(),
        }

    async def check_proton_version_availability(self, version: str) -> dict:
        normalized = self._normalize_proton_ge_tag(version)
        installed = self._list_installed_compatibility_tools()

        decky.logger.info(
            f"check_proton_version_availability: raw='{version}' normalized='{normalized}' "
            f"installed_count={len(installed)}"
        )

        if not normalized:
            decky.logger.info(f"  → not managed (could not normalize '{version}')")
            return {
                "managed": False,
                "installed": True,
                "normalized_version": None,
                "matched_tool_name": None,
                "closest_tool_name": None,
                "release": None,
                "message": "Version is not managed by Proton Pulse.",
            }

        # Exact match check with logging
        matched_tool = None
        for tool in installed:
            tool_name = tool.get("display_name") or tool.get("directory_name") or "?"
            if self._installed_tool_matches_version(tool, normalized):
                matched_tool = tool
                decky.logger.info(f"  → exact match: '{tool_name}'")
                break
            else:
                decky.logger.debug(
                    f"  × no match: '{tool_name}' "
                    f"(dir={tool.get('directory_name')!r} int={tool.get('internal_name')!r})"
                )

        # Find closest installed tool for diagnostics even if no exact match
        closest_tool = None
        if not matched_tool and installed:
            closest_tool = self._find_closest_installed_tool(installed, normalized)
            if closest_tool:
                decky.logger.info(
                    f"  → no exact match; closest installed: "
                    f"'{closest_tool.get('display_name')}'"
                )
            else:
                decky.logger.info(f"  → no exact match; no close installed version found")

        releases = await self.get_proton_ge_releases(False)
        release = next((item for item in releases if item.get("tag_name") == normalized), None)
        decky.logger.info(
            f"  → release_found={release is not None} "
            f"release_count={len(releases)}"
        )

        return {
            "managed": True,
            "installed": matched_tool is not None,
            "normalized_version": normalized,
            "matched_tool_name": matched_tool["display_name"] if matched_tool else None,
            "closest_tool_name": closest_tool["display_name"] if closest_tool else None,
            "release": release,
            "message": (
                f"{normalized} is already installed."
                if matched_tool
                else (
                    f"{normalized} is available to install."
                    if release
                    else f"{normalized} was not found in the Proton-GE release feed."
                )
            ),
        }

    def _find_closest_installed_tool(self, installed: list[dict], normalized: str) -> dict | None:
        """Find the installed tool whose version is closest to the target."""
        target = self._extract_version_parts(normalized)
        if not target:
            return None

        best_tool = None
        best_distance = float("inf")
        for tool in installed:
            for field in ("internal_name", "directory_name", "display_name"):
                parts = self._extract_version_parts(tool.get(field) or "")
                if parts:
                    distance = abs(parts[0] - target[0]) * 1000 + abs(parts[1] - target[1])
                    if distance < best_distance:
                        best_distance = distance
                        best_tool = tool
                    break
        return best_tool

    @staticmethod
    def _extract_version_parts(version: str) -> tuple[int, int] | None:
        match = re.search(r"(?:GE-?)?Proton(\d+)-(\d+)", version, re.IGNORECASE)
        if not match:
            match = re.search(r"(\d+)\.0-(\d+)", version)
        if not match:
            return None
        return (int(match.group(1)), int(match.group(2)))

    def _install_proton_ge_sync(self, version: str | None = None, install_as_latest: bool = False) -> dict:
        releases = self._get_proton_ge_releases_sync(False)
        release = None

        if version:
            normalized = self._normalize_proton_ge_tag(version)
            release = next((item for item in releases if item.get("tag_name") == normalized), None)
            if not release:
                return {"success": False, "message": f"Could not find release for {version}.", "release": None}
        else:
            release = releases[0] if releases else None
            normalized = release.get("tag_name") if release else None

        if not release or not normalized:
            return {"success": False, "message": "No Proton-GE release is available right now.", "release": None}

        decky.logger.info(
            "Starting Proton-GE install sync"
            f" | version={normalized} install_as_latest={install_as_latest} releases={len(releases)}"
        )

        installed = self._list_installed_compatibility_tools()
        existing_latest_slot = next(
            (tool for tool in installed if tool.get("managed_slot") == "latest"),
            None,
        )
        if install_as_latest and existing_latest_slot and self._installed_tool_matches_version(existing_latest_slot, normalized):
            return {
                "success": True,
                "already_installed": True,
                "message": f"{self.PROTON_GE_LATEST_SLOT_NAME} already points to {normalized}.",
                "release": release,
            }
        if not install_as_latest and any(self._installed_tool_matches_version(tool, normalized) for tool in installed):
            return {"success": True, "already_installed": True, "message": f"{normalized} is already installed.", "release": release}

        download_url = release.get("download_url")
        if not download_url:
            return {"success": False, "message": f"{normalized} did not expose a downloadable archive.", "release": release}

        compat_dir = self._compat_tools_dir()
        decky.logger.info(
            "Resolved Proton-GE install target"
            f" | version={normalized} asset={release.get('asset_name')} compat_dir={compat_dir}"
        )
        with tempfile.TemporaryDirectory(prefix="proton-pulse-install-") as tmp_dir:
            archive_path = Path(tmp_dir) / (release.get("asset_name") or f"{normalized}.tar.gz")

            try:
                try:
                    decky.logger.info(
                        "Downloading Proton-GE archive via curl"
                        f" | version={normalized} url={download_url} archive_path={archive_path}"
                    )
                    total_bytes = release.get("asset_size")
                    self._set_proton_ge_install_status(
                        state="running",
                        tag_name=normalized,
                        message=f"Downloading {normalized}…",
                        install_as_latest=install_as_latest,
                        stage="downloading",
                        downloaded_bytes=0,
                        total_bytes=total_bytes,
                        progress_fraction=0.0 if total_bytes else None,
                    )
                    self._curl_download(
                        download_url,
                        archive_path,
                        timeout=900,
                        total_bytes=total_bytes,
                        progress_callback=lambda downloaded, total, fraction: self._set_proton_ge_install_status(
                            state="running",
                            tag_name=normalized,
                            message=f"Downloading {normalized}…",
                            install_as_latest=install_as_latest,
                            stage="downloading",
                            downloaded_bytes=downloaded,
                            total_bytes=total,
                            progress_fraction=fraction,
                        ),
                    )
                    decky.logger.info(
                        "Downloaded Proton-GE archive via curl"
                        f" | version={normalized} bytes={archive_path.stat().st_size}"
                    )
                except Exception as err:
                    decky.logger.warning(
                        f"curl download for Proton-GE archive failed, trying Python fallback: {err}"
                    )
                    decky.logger.info(
                        "Downloading Proton-GE archive via Python fallback"
                        f" | version={normalized} url={download_url} archive_path={archive_path}"
                    )
                    total_bytes = release.get("asset_size")
                    self._set_proton_ge_install_status(
                        state="running",
                        tag_name=normalized,
                        message=f"Downloading {normalized}…",
                        install_as_latest=install_as_latest,
                        stage="downloading-python-fallback",
                        downloaded_bytes=0,
                        total_bytes=total_bytes,
                        progress_fraction=0.0 if total_bytes else None,
                    )
                    request = Request(download_url, headers={"User-Agent": "decky-proton-pulse"})
                    with urlopen(request, timeout=180) as response, open(archive_path, "wb") as archive_file:
                        shutil.copyfileobj(response, archive_file)
                    downloaded_size = archive_path.stat().st_size
                    fallback_fraction = None
                    if total_bytes and total_bytes > 0:
                        fallback_fraction = max(0.0, min(1.0, downloaded_size / total_bytes))
                    self._set_proton_ge_install_status(
                        state="running",
                        tag_name=normalized,
                        message=f"Downloading {normalized}…",
                        install_as_latest=install_as_latest,
                        stage="downloading-python-fallback",
                        downloaded_bytes=downloaded_size,
                        total_bytes=total_bytes,
                        progress_fraction=fallback_fraction,
                    )
                    decky.logger.info(
                        "Downloaded Proton-GE archive via Python fallback"
                        f" | version={normalized} bytes={archive_path.stat().st_size}"
                    )

                extract_dir = Path(tmp_dir) / "extract"
                extract_dir.mkdir(parents=True, exist_ok=True)
                if self._proton_ge_cancel_requested():
                    return {"success": False, "message": f"Install cancelled for {normalized}.", "release": release}
                self._set_proton_ge_install_status(
                    state="running",
                    tag_name=normalized,
                    message=f"Extracting {normalized}…",
                    install_as_latest=install_as_latest,
                    stage="extracting",
                    downloaded_bytes=archive_path.stat().st_size if archive_path.exists() else None,
                    total_bytes=release.get("asset_size"),
                    progress_fraction=1.0 if release.get("asset_size") else None,
                )
                decky.logger.info(
                    "Extracting Proton-GE archive"
                    f" | version={normalized} archive_path={archive_path} extract_dir={extract_dir}"
                )
                self._extract_archive_safely(archive_path, extract_dir)
                extracted_entries = [entry.name for entry in extract_dir.iterdir()]
                decky.logger.info(
                    "Extracted Proton-GE archive"
                    f" | version={normalized} entries={extracted_entries}"
                )
                if self._proton_ge_cancel_requested():
                    return {"success": False, "message": f"Install cancelled for {normalized}.", "release": release}
                decky.logger.info(
                    "Finalizing Proton-GE compatibility tool"
                    f" | version={normalized} destination_name={self.PROTON_GE_LATEST_SLOT_NAME if install_as_latest else normalized}"
                )
                self._set_proton_ge_install_status(
                    state="running",
                    tag_name=normalized,
                    message=f"Finalizing {normalized}…",
                    install_as_latest=install_as_latest,
                    stage="finalizing",
                    downloaded_bytes=archive_path.stat().st_size if archive_path.exists() else None,
                    total_bytes=release.get("asset_size"),
                    progress_fraction=1.0,
                )
                result = self._finalize_extracted_compat_tool(
                    normalized,
                    extract_dir,
                    compat_dir,
                    destination_name=self.PROTON_GE_LATEST_SLOT_NAME if install_as_latest else None,
                    replace_existing=install_as_latest,
                )
                decky.logger.info(
                    "Finalized Proton-GE compatibility tool"
                    f" | version={normalized} result={result}"
                )
                if result.get("success") and install_as_latest:
                    self._write_proton_ge_latest_metadata(normalized, self.PROTON_GE_LATEST_SLOT_NAME)
                    decky.logger.info(
                        "Updated Proton-GE latest slot metadata"
                        f" | version={normalized} directory={self.PROTON_GE_LATEST_SLOT_NAME}"
                    )
                result["release"] = release
                return result
            except Exception as err:
                decky.logger.error(f"Failed to install Proton-GE {normalized}: {err}")
                return {"success": False, "message": f"Install failed for {normalized}: {err}", "release": release}

    async def install_proton_ge(self, version: str | None = None, install_as_latest: bool = False) -> dict:
        releases = await self.get_proton_ge_releases(False)
        release = None
        normalized = None

        if version:
            normalized = self._normalize_proton_ge_tag(version)
            release = next((item for item in releases if item.get("tag_name") == normalized), None)
            if not release:
                return {"success": False, "message": f"Could not find release for {version}.", "release": None}
        else:
            release = releases[0] if releases else None
            normalized = release.get("tag_name") if release else None

        if not release or not normalized:
            return {"success": False, "message": "No Proton-GE release is available right now.", "release": None}

        with self._proton_ge_install_lock:
            existing_status = dict(self._proton_ge_install_status)
            active_thread = self._proton_ge_install_thread
            if active_thread and active_thread.is_alive():
                return {
                    "success": False,
                    "message": existing_status.get("message") or f"{existing_status.get('tag_name') or 'A Proton-GE release'} is already installing.",
                    "release": release,
                }
            self._proton_ge_install_cancel.clear()
            self._proton_ge_install_status = {
                "state": "running",
                "tag_name": normalized,
                "message": f"Installing {normalized}…",
                "stage": "queued",
                "downloaded_bytes": None,
                "total_bytes": release.get("asset_size"),
                "progress_fraction": None,
                "started_at": int(time.time()),
                "finished_at": None,
                "install_as_latest": install_as_latest,
            }

            def _worker():
                try:
                    decky.logger.info(
                        "Background Proton-GE install started"
                        f" | version={normalized} install_as_latest={install_as_latest}"
                    )
                    result = self._install_proton_ge_sync(normalized, install_as_latest)
                    if self._proton_ge_cancel_requested() and not result.get("success"):
                        self._set_proton_ge_install_status(
                            state="error",
                            tag_name=normalized,
                            message=result.get("message") or f"Install cancelled for {normalized}.",
                            install_as_latest=install_as_latest,
                            stage="cancelled",
                            finished_at=int(time.time()),
                        )
                        decky.logger.info(
                            "Background Proton-GE install cancelled"
                            f" | version={normalized} message={result.get('message')}"
                        )
                        return
                    self._set_proton_ge_install_status(
                        state="success" if result.get("success") else "error",
                        tag_name=normalized,
                        message=result.get("message"),
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                    decky.logger.info(
                        "Background Proton-GE install finished"
                        f" | version={normalized} state={'success' if result.get('success') else 'error'}"
                        f" message={result.get('message')}"
                    )
                except Exception as err:
                    decky.logger.error(f"Background Proton-GE install failed for {normalized}: {err}")
                    self._set_proton_ge_install_status(
                        state="error",
                        tag_name=normalized,
                        message=f"Install failed for {normalized}: {err}",
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                finally:
                    with self._proton_ge_install_lock:
                        self._proton_ge_install_thread = None
                        self._proton_ge_install_process = None

            self._proton_ge_install_thread = threading.Thread(
                target=_worker,
                name=f"proton-ge-install-{normalized}",
                daemon=True,
            )
            self._proton_ge_install_thread.start()

        return {
            "success": True,
            "message": f"Started installing {normalized}.",
            "release": release,
        }

    async def cancel_proton_ge_install(self) -> dict:
        with self._proton_ge_install_lock:
            active_thread = self._proton_ge_install_thread
            if not active_thread or not active_thread.is_alive():
                return {"success": False, "message": "No Proton-GE install is currently running."}
            tag_name = self._proton_ge_install_status.get("tag_name")
            self._proton_ge_install_cancel.set()
            process = self._proton_ge_install_process
            if process and process.poll() is None:
                process.terminate()
            self._proton_ge_install_status = {
                **self._proton_ge_install_status,
                "message": f"Cancelling {tag_name or 'Proton-GE'}…",
                "stage": "cancelling",
            }
        return {"success": True, "message": f"Cancelling {tag_name or 'Proton-GE'}…"}

    async def install_compatibility_tool_archive(self, archive_path: str) -> dict:
        archive_input = (archive_path or "").strip()
        if not archive_input:
            return {"success": False, "message": "No archive path was provided."}

        source_path = Path(archive_input).expanduser()
        if not source_path.is_file():
            return {"success": False, "message": f"Archive was not found: {archive_input}"}

        if not any(
            source_path.name.endswith(suffix)
            for suffix in [".zip", ".tar", ".tar.gz", ".tar.xz", ".tar.bz2", ".tgz"]
        ):
            return {"success": False, "message": "Archive must be a .zip or tar-based file."}

        compat_dir = self._compat_tools_dir()
        with tempfile.TemporaryDirectory(prefix="proton-pulse-archive-install-") as tmp_dir:
            staged_archive = Path(tmp_dir) / source_path.name
            extract_dir = Path(tmp_dir) / "extract"

            try:
                shutil.copy2(source_path, staged_archive)
                extract_dir.mkdir(parents=True, exist_ok=True)
                self._extract_archive_safely(staged_archive, extract_dir)
                return self._finalize_extracted_compat_tool(source_path.name, extract_dir, compat_dir)
            except Exception as err:
                decky.logger.error(f"Failed to install compatibility tool archive {archive_input}: {err}")
                return {"success": False, "message": f"Install failed for {source_path.name}: {err}"}

    async def uninstall_compatibility_tool(self, directory_name: str) -> dict:
        target_name = (directory_name or "").strip()
        if not target_name:
            return {"success": False, "message": "No compatibility tool was specified."}

        installed = self._list_installed_compatibility_tools()
        target = next((tool for tool in installed if tool.get("directory_name") == target_name), None)
        if not target:
            return {"success": False, "message": f"{target_name} is not installed."}

        if target.get("source") == "valve":
            return {"success": False, "message": f"{target_name} is a built-in Valve tool and cannot be removed."}

        target_path = Path(target.get("path") or "")
        if not target_path.is_dir():
            return {"success": False, "message": f"{target_name} is not available on disk anymore."}

        allowed_roots = [compat_dir.resolve() for compat_dir in self._compat_tools_dirs()]
        resolved_target = target_path.resolve()
        if not any(root == resolved_target.parent for root in allowed_roots):
            return {"success": False, "message": f"{target_name} is outside the managed compatibility tools directories."}

        try:
            shutil.rmtree(resolved_target)
            self._clear_proton_ge_latest_metadata(target_name)
            return {"success": True, "message": f"Removed {target_name}."}
        except Exception as err:
            decky.logger.error(f"Failed to remove compatibility tool {target_name}: {err}")
            return {"success": False, "message": f"Failed to remove {target_name}: {err}"}
