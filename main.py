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
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import decky


class Plugin:
    PROTON_GE_REPO_API = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases?per_page=30"
    PROTON_GE_CACHE_TTL_SECONDS = 6 * 60 * 60

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
        cleaned = version.strip()
        if not cleaned:
            return None

        cleaned = cleaned.replace("_", "-")
        cleaned = re.sub(r"\s+", "", cleaned)
        match = re.search(r"(?:GE-?)?Proton(\d+(?:-\d+)*)", cleaned, re.IGNORECASE)
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

        fields = [
            tool.get("directory_name") or "",
            tool.get("display_name") or "",
            tool.get("internal_name") or "",
        ]
        lowered = normalized.lower()
        return any(lowered in field.lower() for field in fields)

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

        request = Request(
            self.PROTON_GE_REPO_API,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "decky-proton-pulse",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                releases = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError) as err:
            decky.logger.warning(f"Python fetch for Proton-GE releases failed, trying curl fallback: {err}")
            curl_commands = [
                [
                    "curl",
                    "-LfsS",
                    self.PROTON_GE_REPO_API,
                    "-H",
                    "Accept: application/vnd.github+json",
                    "-H",
                    "User-Agent: decky-proton-pulse",
                ],
                [
                    "curl",
                    "-kLfsS",
                    self.PROTON_GE_REPO_API,
                    "-H",
                    "Accept: application/vnd.github+json",
                    "-H",
                    "User-Agent: decky-proton-pulse",
                ],
            ]
            releases = None
            curl_errors: list[str] = []
            for command in curl_commands:
                curl_result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=25,
                )
                if curl_result.returncode == 0:
                    if command[1].startswith("-k"):
                        decky.logger.warning("Proton-GE release fetch succeeded via insecure curl fallback (-k)")
                    releases = json.loads(curl_result.stdout)
                    break
                curl_errors.append(
                    f"{' '.join(command[:2])} -> code {curl_result.returncode}: {curl_result.stderr.strip()}"
                )
            if releases is None:
                raise RuntimeError(
                    "curl fallback failed: " + " | ".join(curl_errors)
                ) from err

        simplified = [item for item in (self._simplify_release(release) for release in releases) if item]
        cache_path.write_text(json.dumps({"fetched_at": now, "releases": simplified}))
        return simplified

    def _list_installed_compatibility_tools(self) -> list[dict]:
        tools: list[dict] = []
        seen_dirs: set[str] = set()
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

    async def get_proton_ge_releases(self, force_refresh: bool = False) -> list[dict]:
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

    async def get_proton_ge_manager_state(self, force_refresh: bool = False) -> dict:
        releases = await self.get_proton_ge_releases(force_refresh)
        installed = self._list_installed_compatibility_tools()
        current_release = releases[0] if releases else None
        current_installed = bool(
            current_release
            and any(self._installed_tool_matches_version(tool, current_release["tag_name"]) for tool in installed)
        )
        return {
            "current_release": current_release,
            "current_installed": current_installed,
            "installed_tools": installed,
            "releases": releases,
        }

    async def check_proton_version_availability(self, version: str) -> dict:
        normalized = self._normalize_proton_ge_tag(version)
        installed = self._list_installed_compatibility_tools()

        if not normalized:
            return {
                "managed": False,
                "installed": True,
                "normalized_version": None,
                "matched_tool_name": None,
                "release": None,
                "message": "Version is not managed by Proton Pulse.",
            }

        matched_tool = next((tool for tool in installed if self._installed_tool_matches_version(tool, normalized)), None)
        releases = await self.get_proton_ge_releases(False)
        release = next((item for item in releases if item.get("tag_name") == normalized), None)

        return {
            "managed": True,
            "installed": matched_tool is not None,
            "normalized_version": normalized,
            "matched_tool_name": matched_tool["display_name"] if matched_tool else None,
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

    async def install_proton_ge(self, version: str | None = None) -> dict:
        releases = await self.get_proton_ge_releases(False)
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

        installed = self._list_installed_compatibility_tools()
        if any(self._installed_tool_matches_version(tool, normalized) for tool in installed):
            return {"success": True, "already_installed": True, "message": f"{normalized} is already installed.", "release": release}

        download_url = release.get("download_url")
        if not download_url:
            return {"success": False, "message": f"{normalized} did not expose a downloadable archive.", "release": release}

        compat_dir = self._compat_tools_dir()
        with tempfile.TemporaryDirectory(prefix="proton-pulse-install-") as tmp_dir:
            archive_path = Path(tmp_dir) / (release.get("asset_name") or f"{normalized}.tar.gz")
            request = Request(download_url, headers={"User-Agent": "decky-proton-pulse"})

            try:
                with urlopen(request, timeout=60) as response, open(archive_path, "wb") as archive_file:
                    shutil.copyfileobj(response, archive_file)

                extract_dir = Path(tmp_dir) / "extract"
                extract_dir.mkdir(parents=True, exist_ok=True)
                with tarfile.open(archive_path, "r:*") as archive:
                    archive.extractall(extract_dir)

                extracted_entries = [entry for entry in extract_dir.iterdir()]
                source_dir = next((entry for entry in extracted_entries if entry.is_dir()), None)
                if source_dir is None:
                    source_dir = extract_dir / normalized
                    source_dir.mkdir(parents=True, exist_ok=True)
                    for entry in extracted_entries:
                        shutil.move(str(entry), source_dir / entry.name)

                destination = compat_dir / source_dir.name
                if destination.exists():
                    return {"success": True, "already_installed": True, "message": f"{destination.name} is already installed.", "release": release}

                shutil.move(str(source_dir), str(destination))
                return {"success": True, "message": f"Installed {destination.name}.", "release": release}
            except Exception as err:
                decky.logger.error(f"Failed to install Proton-GE {normalized}: {err}")
                return {"success": False, "message": f"Install failed for {normalized}: {err}", "release": release}
