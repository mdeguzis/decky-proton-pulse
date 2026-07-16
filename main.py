"""Proton Pulse -- Decky Loader plugin backend.

This is the file Decky's plugin loader picks up on startup.  It exposes
a ``Plugin`` class whose async methods become the callable API that the
React frontend talks to.

The heavy lifting lives in the helper modules (``proton_ge``,
``compat_tools``, ``system_info``, …).  ``Plugin`` itself is just a thin
orchestration layer that wires everything together.
"""

from __future__ import annotations

import logging
import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

# Decky's sandboxed loader doesn't always put the plugin directory on
# sys.path, so `from lib.xxx import ...` can blow up with
# ModuleNotFoundError.  Adding the plugin dir ourselves fixes that.
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

# pylint: disable=wrong-import-position
import decky  # type: ignore[import-untyped]  # pylint: disable=import-error
from lib.cdn_cache import is_fresh, read_cached, write_cached
from lib.compat_tools import (
    COMPAT_TOOL_CONFIGS,
    ensure_all_rolling_slots,
    ensure_rolling_slot,
    find_closest_installed_tool,
    installed_tool_matches_version,
    list_installed_compatibility_tools,
    matches_release_tag,
    normalize_proton_ge_tag,
    normalize_tag_for_tool,
)
from lib.plugin_logging import get_log_contents, log_frontend_event, sync_set_log_level
from lib.plugin_utils import extract_archive_safely
from lib.prefetch import prefetch_installed_games, get_installed_game_stats
from lib.proton_ge import (
    clear_latest_metadata,
    finalize_extracted_compat_tool,
    get_install_status,
    get_releases_sync,
    install_sync,
    make_initial_status,
    read_latest_metadata,
    set_install_status,
)
import lib.lsfg_vk as _lsfg_vk_mod
from lib.metrics_export import export_metrics_to_disk
from lib.protondb_systeminfo import generate_system_info
from lib.plugin_updater import (
    check_for_update as _updater_check,
    list_releases as _updater_list_releases,
    make_initial_status as _updater_make_status,
    start_apply_update as _updater_start,
)
from lib.steam_paths import compat_tools_dir, compat_tools_dirs
from lib.system_info import collect_system_info
# pylint: enable=wrong-import-position


class Plugin:  # pylint: disable=too-many-instance-attributes
    """Decky Loader plugin backend for Proton Pulse.

    Every async method here is callable from the frontend via Decky's
    bridge.  Synchronous helpers are prefixed with underscore so they
    stay private.
    """

    def __init__(self) -> None:
        # Declare everything up front so pylint doesn't complain about
        # attribute-defined-outside-init when _main() sets them for real.
        self._debug_handler: logging.Handler | None = None
        self._debug_handler_ref: list[logging.Handler | None] = [None]
        self._proton_ge_install_lock = threading.Lock()
        self._proton_ge_install_cancel = threading.Event()
        self._proton_ge_install_thread: threading.Thread | None = None
        self._proton_ge_install_process: subprocess.Popen[str] | None = None
        self._proton_ge_install_process_ref: list[subprocess.Popen[str] | None] = [None]
        self._proton_ge_install_status: dict[str, Any] = make_initial_status()
        self._update_status: dict[str, Any] = _updater_make_status()
        self._update_lock = threading.Lock()
        self._update_cancel = threading.Event()
        self._prefetch_cancel = threading.Event()
        self._prefetch_thread: threading.Thread | None = None
        self._lsfg_vk_install_lock = threading.Lock()
        self._lsfg_vk_install_cancel = threading.Event()
        self._lsfg_vk_install_thread: threading.Thread | None = None
        self._lsfg_vk_install_process_ref: list[subprocess.Popen[str] | None] = [None]
        self._lsfg_vk_install_status: dict[str, Any] = _lsfg_vk_mod.make_initial_status()

    ################################################################
    # Lifecycle
    ################################################################

    async def _main(self) -> None:
        """Called by Decky when the plugin loads - our starting line."""
        import traceback as _tb
        try:
            self._main_impl()
        except Exception as _exc:  # pylint: disable=broad-except
            decky.logger.error(
                "Proton Pulse backend crashed during startup:\n"
                + _tb.format_exc()
            )
            raise

    def _main_impl(self) -> None:
        decky.logger.info("Proton Pulse backend starting")
        self._debug_handler = None
        self._debug_handler_ref = [None]

        # Fresh install state on every reload
        self._proton_ge_install_lock = threading.Lock()
        self._proton_ge_install_cancel = threading.Event()
        self._proton_ge_install_thread = None
        self._proton_ge_install_process = None
        self._proton_ge_install_process_ref = [None]
        self._proton_ge_install_status = make_initial_status()
        self._lsfg_vk_install_lock = threading.Lock()
        self._lsfg_vk_install_cancel = threading.Event()
        self._lsfg_vk_install_thread = None
        self._lsfg_vk_install_process_ref = [None]
        self._lsfg_vk_install_status = _lsfg_vk_mod.make_initial_status()
        # #116: refresh rolling latest-slot symlinks on every startup so
        # Proton-GE-Latest and Proton-CachyOS-Latest always exist and always
        # point at the newest installed versioned build. Same behavior Steam
        # gives "Proton - Experimental" -- the slot is a stable label, the
        # underlying tool rolls forward automatically.
        try:
            slot_outcomes = ensure_all_rolling_slots()
            decky.logger.info(
                "Proton Pulse: rolling slots refreshed: "
                + ", ".join(f"{k}={v.get('reason') or ('changed' if v.get('changed') else 'ok')}"
                            for k, v in slot_outcomes.items())
            )
        except Exception as _slot_err:  # pylint: disable=broad-except
            decky.logger.warning(
                f"Proton Pulse: rolling slot refresh failed: {_slot_err}"
            )

        decky.logger.info("Proton Pulse backend ready")

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
        """Shut everything down gracefully - kill running threads, clean up."""
        decky.logger.info("Proton Pulse backend shutting down")
        self._prefetch_cancel.set()
        self._proton_ge_install_cancel.set()
        self._lsfg_vk_install_cancel.set()
        with self._proton_ge_install_lock:
            proc = self._proton_ge_install_process_ref[0]
            if proc and proc.poll() is None:
                proc.terminate()
        with self._lsfg_vk_install_lock:
            proc = self._lsfg_vk_install_process_ref[0]
            if proc and proc.poll() is None:
                proc.terminate()
        thread = self._proton_ge_install_thread
        if thread and thread.is_alive():
            thread.join(timeout=10)
        thread = self._lsfg_vk_install_thread
        if thread and thread.is_alive():
            thread.join(timeout=10)

    async def _migration(self) -> None:
        decky.logger.info("Proton Pulse migration hook (no-op)")

    ################################################################
    # Logging
    ################################################################

    async def set_log_level(self, level: str) -> bool:
        """Switch the plugin log level (DEBUG, INFO, WARNING, …)."""
        return sync_set_log_level(level, self._debug_handler_ref)

    async def get_log_contents(self) -> str:
        """Grab the last 200 lines of the plugin log."""
        return get_log_contents()

    async def log_frontend_event(
        self, level: str, message: str, context: dict[str, object] | None = None
    ) -> bool:
        """Forward a log message from the React frontend into the backend log."""
        return log_frontend_event(level, message, context)

    ################################################################
    # Developer tools
    ################################################################

    def _cef_debug_marker_path(self) -> Path:
        return Path(decky.DECKY_USER_HOME) / ".steam" / "steam" / ".cef-enable-remote-debugging"

    def _is_cef_debug_port_listening(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", 8081), timeout=0.25):
                return True
        except OSError:
            return False

    def _cef_debug_status(self) -> dict[str, Any]:
        marker = self._cef_debug_marker_path()
        return {
            "enabled": marker.exists(),
            "port_listening": self._is_cef_debug_port_listening(),
            "marker_path": str(marker),
        }

    async def get_cef_debugging_status(self) -> dict[str, Any]:
        """Return whether Steam CEF remote debugging is enabled/listening."""
        return self._cef_debug_status()

    async def set_cef_debugging_enabled(self, enabled: bool) -> dict[str, Any]:
        """Toggle Steam's CEF remote debugging marker file."""
        marker = self._cef_debug_marker_path()
        try:
            if enabled:
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.touch(exist_ok=True)
            else:
                marker.unlink(missing_ok=True)
        except OSError as exc:
            decky.logger.error(f"Failed to set CEF debugging marker {marker}: {exc}")
            return {
                "success": False,
                "message": str(exc),
                **self._cef_debug_status(),
            }

        status = self._cef_debug_status()
        decky.logger.info(
            "CEF debugging %s; port 8081 listening=%s",
            "enabled" if enabled else "disabled",
            status["port_listening"],
        )
        return {
            "success": True,
            "message": (
                "CEF debugging marker updated."
                if status["port_listening"] == enabled
                else "CEF debugging marker updated. Restart Steam for the port state to change."
            ),
            **status,
        }

    ################################################################
    # Metadata
    ################################################################

    async def get_plugin_version(self) -> str:
        """Hand back the plugin version string that Decky knows about."""
        return getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")

    async def get_build_commit(self) -> str:
        """Return the git commit SHA baked in at build time."""
        commit_file = Path(decky.DECKY_PLUGIN_DIR) / ".build-commit"
        try:
            return commit_file.read_text().strip() if commit_file.is_file() else "dev"
        except OSError:
            return "unknown"

    async def check_for_update(self, channel: str = "release") -> dict:
        """Compare the installed version against a GitHub release.

        channel: "release" (stable), "pre-release", or "latest" (main branch)
        """
        current = getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")
        return _updater_check(current, channel=channel)

    async def list_releases(
        self,
        limit: int = 10,
        include_prereleases: bool = True,
        channel: str = "release",
    ) -> dict:
        """Return releases + per-build dev tags for the release-notes carousel.

        channel: when "developer", merges in persistent dev tags (created by
        `make github-dev-release` as `dev-<version>-<sha>`) so the user sees
        the full rolling dev history. Other channels skip dev entries
        entirely so stable/pre-release users dont get dev clutter in their
        history view
        """
        return _updater_list_releases(
            limit=limit,
            include_prereleases=include_prereleases,
            channel=channel,
        )

    async def apply_update(self, zip_url: str, version: str) -> dict:
        """Start a background download+extract of the release ZIP.

        Returns immediately; poll get_update_status() for progress.
        """
        with self._update_lock:
            if self._update_status.get("state") == "running":
                return {"success": False, "error": "Update already in progress"}
        self._update_cancel.clear()
        _updater_start(
            zip_url,
            version,
            decky.DECKY_PLUGIN_DIR,
            self._update_status,
            self._update_lock,
            self._update_cancel,
        )
        return {"success": True}

    async def get_update_status(self) -> dict:
        """Return a snapshot of the current update download/extract progress."""
        with self._update_lock:
            return dict(self._update_status)

    async def cancel_update(self) -> dict:
        """Signal the in-progress update download to stop."""
        self._update_cancel.set()
        decky.logger.info("cancel_update: cancel signal sent")
        return {"success": True}

    async def restart_plugin_loader(self) -> dict:
        """Restart the plugin_loader systemd service after a short delay.

        Returns immediately so the frontend can show a spinner. The service
        restart kills and relaunches the Python backend, which picks up the
        newly installed plugin files. Requires the 'root' plugin flag.
        """
        def _do_restart() -> None:
            import time as _time
            _time.sleep(1.5)
            decky.logger.info("restart_plugin_loader: restarting plugin_loader service")
            try:
                subprocess.run(
                    ["sudo", "-n", "/usr/bin/systemctl", "restart", "plugin_loader"],
                    timeout=10,
                    check=True,
                )
            except Exception as exc:
                decky.logger.error(f"restart_plugin_loader: failed: {exc}")

        t = threading.Thread(target=_do_restart, daemon=True, name="pp-restart-loader")
        t.start()
        decky.logger.info("restart_plugin_loader: restart scheduled in 1.5s")
        return {"success": True}

    async def get_protondb_systeminfo(self) -> str:
        """Build the system-info blob that ProtonDB submissions need."""
        try:
            return generate_system_info(home=decky.DECKY_USER_HOME)
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            decky.logger.error(f"Failed to generate ProtonDB system info: {e}")
            return f"Error generating system info: {e}"

    async def copy_to_clipboard(self, text: str) -> bool:
        """Copy *text* to the system clipboard via wl-copy or xclip."""
        for cmd in (
            ["wl-copy", "--"],
            ["xclip", "-selection", "clipboard"],
        ):
            if shutil.which(cmd[0]):
                try:
                    subprocess.run(cmd, input=text, check=True, timeout=5)
                    return True
                except (subprocess.SubprocessError, OSError):
                    continue
        decky.logger.warning("No clipboard tool found (tried wl-copy, xclip)")
        return False

    async def export_metrics(self, data: str) -> bool:
        """Dump frontend metrics JSON to disk so you can poke at it offline."""
        return export_metrics_to_disk(data)

    async def export_local_data_backup(self, payload_json: str) -> dict[str, Any]:
        """Write a zip backup of the frontend's local Proton Pulse data."""
        try:
            payload = json.loads(payload_json)
        except json.JSONDecodeError as exc:
            return {"success": False, "message": f"Backup payload was invalid JSON: {exc}"}

        if payload.get("format") != "proton-pulse-local-backup":
            return {"success": False, "message": "Backup payload format is not supported."}

        downloads_dir = Path(decky.DECKY_USER_HOME) / "Downloads"
        downloads_dir.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y-%m-%d_%H-%M-%S")
        archive_path = downloads_dir / f"proton-pulse-local-backup-{timestamp}.zip"
        try:
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(
                    "proton-pulse-local-backup.json",
                    json.dumps(payload, indent=2, sort_keys=True),
                )
        except OSError as exc:
            decky.logger.error(f"Failed to export Proton Pulse local backup: {exc}")
            return {"success": False, "message": f"Could not write backup archive: {exc}"}

        return {
            "success": True,
            "message": f"Local backup exported to {archive_path}",
            "path": str(archive_path),
        }

    async def import_local_data_backup(self, archive_path: str) -> dict[str, Any]:
        """Read a Proton Pulse local data backup zip and return its JSON payload."""
        source = Path((archive_path or "").strip()).expanduser()
        if not source.is_file():
            return {"success": False, "message": f"Backup archive was not found: {archive_path}"}

        try:
            with zipfile.ZipFile(source, "r") as archive:
                try:
                    raw_payload = archive.read("proton-pulse-local-backup.json").decode("utf-8")
                except KeyError:
                    return {
                        "success": False,
                        "message": (
                            "Backup archive is missing "
                            "proton-pulse-local-backup.json."
                        ),
                    }
        except (OSError, zipfile.BadZipFile) as exc:
            decky.logger.error(f"Failed to read Proton Pulse local backup {archive_path}: {exc}")
            return {"success": False, "message": f"Could not read backup archive: {exc}"}

        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            return {"success": False, "message": f"Backup archive payload was invalid JSON: {exc}"}

        if payload.get("format") != "proton-pulse-local-backup":
            return {"success": False, "message": "Backup archive format is not supported."}

        return {
            "success": True,
            "message": f"Imported local backup from {source.name}",
            "payload": raw_payload,
        }

    async def is_game_running(self) -> bool:
        """Quick check: is a Steam game process alive right now?"""
        try:
            result = subprocess.run(
                ["pgrep", "-f", "SteamLaunch"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, OSError) as e:
            decky.logger.warning(f"is_game_running check failed: {e}")
            return False

    ################################################################
    # System Detection
    ################################################################

    async def get_system_info(self) -> dict[str, object]:
        """Gather CPU, GPU, kernel, distro info and send it to the frontend."""
        import asyncio
        return await asyncio.get_event_loop().run_in_executor(None, collect_system_info)

    async def get_game_requirements(self, app_id: str) -> dict[str, object]:
        """Fetch minimum system requirements from the Steam Store API."""
        from lib.game_requirements import get_game_requirements as _get_reqs
        return _get_reqs(app_id)

    async def get_game_platforms(self, app_id: str) -> dict[str, object]:
        """Fetch platform availability and release date from the Steam Store API."""
        from lib.game_platforms import get_game_platforms as _get_platforms
        return _get_platforms(app_id)

    async def get_game_source(self, app_id: str, title: str = "") -> dict[str, object]:
        """Return source info: is_steam, source label, and optional steam_app_id_match."""
        from lib.game_source import get_game_source as _get_source
        return _get_source(app_id, title)

    async def get_shortcut_name(self, app_id: str) -> str:
        """Return the display name of a non-Steam shortcut looked up via shortcuts.vdf."""
        from lib.game_source import find_shortcut_name_by_appid
        return find_shortcut_name_by_appid(app_id) or ""

    async def get_installed_game_stats(self) -> dict[str, Any]:
        """Return backend manifest-based installed Steam game stats."""
        return get_installed_game_stats()

    async def get_grid_artwork(self, app_id: int) -> dict[str, str | None]:
        """Return the Steam grid banner artwork for app_id as a base64 data-URL.

        Looks in every userdata profile's config/grid folder for a widescreen
        banner image (landscape, not portrait/capsule).  Returns
        ``{"dataUrl": "data:image/...;base64,..."}`` on success, or
        ``{"dataUrl": null}`` when nothing is found.
        """
        import base64
        import glob as _glob

        user_home = Path(decky.DECKY_USER_HOME)
        grid_dirs = _glob.glob(str(user_home / ".local" / "share" / "Steam" / "userdata" / "*" / "config" / "grid"))

        # Candidate filenames for the wide/landscape banner (excludes *p.* portrait)
        stems = [str(app_id), f"{app_id}_header"]
        exts = [".jpg", ".jpeg", ".png", ".webp"]

        for grid_dir in grid_dirs:
            for stem in stems:
                for ext in exts:
                    candidate = Path(grid_dir) / f"{stem}{ext}"
                    if candidate.is_file():
                        try:
                            data = candidate.read_bytes()
                            mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"
                            encoded = base64.b64encode(data).decode()
                            return {"dataUrl": f"data:{mime};base64,{encoded}"}
                        except OSError:
                            continue
        return {"dataUrl": None}

    ################################################################
    # CDN Cache
    ################################################################

    async def get_cached_cdn(self, app_id: str, filename: str) -> dict[str, Any]:
        """Return cached CDN data if it's still fresh, otherwise ``{"data": null}``."""
        # Rebuild the full CDN URL so we can check the freshness metadata
        url = f"https://www.proton-pulse.com/data/{app_id}/{filename}"
        if is_fresh(url):
            data = read_cached(app_id, filename)
            if data is not None:
                decky.logger.debug(f"get_cached_cdn: hit for {app_id}/{filename}")
                return {"data": data, "fresh": True}
        decky.logger.debug(f"get_cached_cdn: miss for {app_id}/{filename}")
        return {"data": None, "fresh": False}

    async def put_cached_cdn(self, app_id: str, filename: str, data: Any) -> bool:
        """Stash CDN data the frontend just fetched into the backend cache."""
        try:
            write_cached(app_id, filename, data)
            from lib.cdn_cache import set_meta  # pylint: disable=import-outside-toplevel
            url = f"https://www.proton-pulse.com/data/{app_id}/{filename}"
            # Bump the metadata timestamp so is_fresh() treats this entry as valid
            set_meta(url)
            decky.logger.debug(f"put_cached_cdn: stored {app_id}/{filename}")
            return True
        except OSError as exc:
            decky.logger.debug(f"put_cached_cdn: failed for {app_id}/{filename}: {exc}")
            return False

    ################################################################
    # Compatibility Tools / Proton-GE
    ################################################################

    async def list_installed_compatibility_tools(self) -> list[dict[str, Any]]:
        """List every compat tool we can find in Steam's compatibilitytools.d dirs."""
        return list_installed_compatibility_tools(
            all_latest_metadata={tid: read_latest_metadata(tid) for tid in COMPAT_TOOL_CONFIGS}
        )

    async def get_proton_ge_releases(
        self, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        """Grab the list of Proton-GE releases from GitHub."""
        return get_releases_sync(force_refresh)

    async def get_proton_ge_manager_state(
        self, force_refresh: bool = False
    ) -> dict[str, Any]:
        """Bundle up everything the frontend needs: releases, installed tools, install status."""
        releases = await self.get_proton_ge_releases(force_refresh)
        installed = list_installed_compatibility_tools(
            all_latest_metadata={tid: read_latest_metadata(tid) for tid in COMPAT_TOOL_CONFIGS}
        )
        current_release = releases[0] if releases else None
        current_installed = bool(
            current_release
            and any(
                installed_tool_matches_version(tool, current_release["tag_name"])
                for tool in installed
            )
        )
        current_latest_slot_installed = bool(
            current_release
            and any(
                tool.get("managed_slot") == "latest"
                and installed_tool_matches_version(tool, current_release["tag_name"])
                for tool in installed
            )
        )
        return {
            "current_release": current_release,
            "current_installed": current_installed,
            "current_latest_slot_installed": current_latest_slot_installed,
            "installed_tools": installed,
            "releases": releases,
            "install_status": get_install_status(
                self._proton_ge_install_status, self._proton_ge_install_lock
            ),
        }

    async def get_compat_manager_state(
        self, tool_id: str = "proton-ge", force_refresh: bool = False
    ) -> dict[str, Any]:
        """Bundle up releases, installed tools, and install status for any compat tool."""
        releases = get_releases_sync(force_refresh, tool_id)
        all_meta = {tid: read_latest_metadata(tid) for tid in COMPAT_TOOL_CONFIGS}
        installed = list_installed_compatibility_tools(all_latest_metadata=all_meta)
        current_release = releases[0] if releases else None
        config = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])

        def _matches(tool: dict[str, Any], tag: str) -> bool:
            if tool_id == "proton-ge":
                return installed_tool_matches_version(tool, tag)
            return matches_release_tag(tool, tag)

        current_installed = bool(
            current_release
            and any(_matches(t, current_release["tag_name"]) for t in installed)
        )
        current_latest_slot_installed = bool(
            current_release
            and any(
                t.get("managed_slot") == "latest"
                and t.get("tool_id") == tool_id
                and _matches(t, current_release["tag_name"])
                for t in installed
            )
        )
        decky.logger.debug(
            f"get_compat_manager_state: tool_id={tool_id}"
            f" releases={len(releases)} installed={len(installed)}"
            f" current={current_release.get('tag_name') if current_release else None}"
            f" current_installed={current_installed}"
            f" latest_slot_installed={current_latest_slot_installed}"
        )
        return {
            "current_release": current_release,
            "current_installed": current_installed,
            "current_latest_slot_installed": current_latest_slot_installed,
            "installed_tools": installed,
            "releases": releases,
            "install_status": get_install_status(
                self._proton_ge_install_status, self._proton_ge_install_lock
            ),
            "tool_id": tool_id,
            "tool_label": config["label"],
        }

    async def refresh_rolling_slots(self) -> dict[str, Any]:
        """Force a re-symlink of every rolling latest-slot (#116).

        Frontend can call this after a manual uninstall/install so the
        Steam Compat picker reflects the change without a plugin restart.
        Returns the per-tool outcome dict.
        """
        return {"slots": ensure_all_rolling_slots()}

    async def install_compat_tool(
        self,
        tool_id: str = "proton-ge",
        version: str | None = None,
        install_as_latest: bool = False,
        force_reinstall: bool = False,
    ) -> dict[str, Any]:
        """Kick off a background install for any compat tool."""
        config = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])
        label = config["label"]
        releases = get_releases_sync(False, tool_id)
        release: dict[str, Any] | None = None

        if version:
            normalized = normalize_tag_for_tool(tool_id, version)
            release = next(
                (i for i in releases if i.get("tag_name") == normalized), None
            )
            if not release:
                return {
                    "success": False,
                    "message": f"Could not find {label} release for {version}.",
                    "release": None,
                }
        else:
            release = releases[0] if releases else None
            normalized = release.get("tag_name") if release else None

        if not release or not normalized:
            return {
                "success": False,
                "message": f"No {label} release is available right now.",
                "release": None,
            }

        with self._proton_ge_install_lock:
            thread = self._proton_ge_install_thread
            if thread and thread.is_alive():
                existing = dict(self._proton_ge_install_status)
                return {
                    "success": False,
                    "message": existing.get("message")
                    or f"{existing.get('tag_name') or 'A release'} is already installing.",
                    "release": release,
                }
            self._proton_ge_install_cancel.clear()
            self._proton_ge_install_status.clear()
            self._proton_ge_install_status.update({
                "state": "running",
                "tag_name": normalized,
                "message": f"Installing {normalized}...",
                "stage": "queued",
                "downloaded_bytes": None,
                "total_bytes": release.get("asset_size"),
                "progress_fraction": None,
                "started_at": int(time.time()),
                "finished_at": None,
                "install_as_latest": install_as_latest,
            })

            status_ref = self._proton_ge_install_status
            lock_ref = self._proton_ge_install_lock
            cancel_ref = self._proton_ge_install_cancel
            process_ref = self._proton_ge_install_process_ref

            def _worker() -> None:
                try:
                    result = install_sync(
                        normalized,
                        install_as_latest,
                        force_reinstall,
                        status_ref,
                        lock_ref,
                        cancel_ref,
                        process_ref,
                        tool_id,
                    )
                    if cancel_ref.is_set() and not result.get("success"):
                        set_install_status(
                            status_ref, lock_ref,
                            state="error", tag_name=normalized,
                            message=result.get("message") or f"Install cancelled for {normalized}.",
                            install_as_latest=install_as_latest,
                            stage="cancelled",
                            finished_at=int(time.time()),
                        )
                        return
                    set_install_status(
                        status_ref, lock_ref,
                        state="success" if result.get("success") else "error",
                        tag_name=normalized,
                        message=result.get("message"),
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                except (OSError, subprocess.SubprocessError, Exception) as err:  # pylint: disable=broad-except
                    decky.logger.error(f"install_compat_tool worker failed: {err}")
                    set_install_status(
                        status_ref, lock_ref,
                        state="error", tag_name=normalized,
                        message=f"Install failed: {err}",
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )

            self._proton_ge_install_thread = threading.Thread(
                target=_worker, daemon=True, name=f"pp-install-{tool_id}"
            )
            self._proton_ge_install_thread.start()

        decky.logger.info(
            f"install_compat_tool queued"
            f" | tool_id={tool_id} version={normalized} install_as_latest={install_as_latest}"
        )
        return {"success": True, "message": f"Installing {normalized}...", "release": release}

    async def cancel_compat_tool_install(self, tool_id: str = "proton-ge") -> dict[str, Any]:
        """Cancel any running compat tool install."""
        self._proton_ge_install_cancel.set()
        with self._proton_ge_install_lock:
            proc = self._proton_ge_install_process_ref[0]
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass
        thread = self._proton_ge_install_thread
        if thread:
            thread.join(timeout=5)
        decky.logger.info(f"cancel_compat_tool_install: tool_id={tool_id}")
        return {"success": True, "message": "Install cancelled."}

    async def check_proton_version_availability(self, version: str) -> dict[str, Any]:
        """See if a specific Proton-GE version is installed, available, or unknown."""
        normalized = normalize_proton_ge_tag(version)
        installed = list_installed_compatibility_tools(
            all_latest_metadata={tid: read_latest_metadata(tid) for tid in COMPAT_TOOL_CONFIGS}
        )

        if not normalized:
            return {
                "managed": False,
                "installed": True,
                "normalized_version": None,
                "matched_tool_name": None,
                "closest_tool_name": None,
                "release": None,
                "message": "Version is not managed by Proton Pulse.",
            }

        matched_tool = next(
            (t for t in installed if installed_tool_matches_version(t, normalized)),
            None,
        )
        closest_tool = (
            find_closest_installed_tool(installed, normalized)
            if not matched_tool and installed
            else None
        )
        releases = await self.get_proton_ge_releases(False)
        release = next((i for i in releases if i.get("tag_name") == normalized), None)

        return {
            "managed": True,
            "installed": matched_tool is not None,
            "normalized_version": normalized,
            "matched_tool_name": (
                matched_tool["display_name"] if matched_tool else None
            ),
            "closest_tool_name": (
                closest_tool["display_name"] if closest_tool else None
            ),
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

    ################################################################
    # Install / Uninstall
    ################################################################

    async def install_proton_ge(
        self,
        version: str | None = None,
        install_as_latest: bool = False,
        force_reinstall: bool = False,
    ) -> dict[str, Any]:
        """Kick off a background Proton-GE install for the requested version."""
        releases = get_releases_sync(False)
        release: dict[str, Any] | None = None

        if version:
            normalized = normalize_proton_ge_tag(version)
            release = next(
                (i for i in releases if i.get("tag_name") == normalized), None
            )
            if not release:
                return {
                    "success": False,
                    "message": f"Could not find release for {version}.",
                    "release": None,
                }
        else:
            release = releases[0] if releases else None
            normalized = release.get("tag_name") if release else None

        if not release or not normalized:
            return {
                "success": False,
                "message": "No Proton-GE release is available right now.",
                "release": None,
            }

        with self._proton_ge_install_lock:
            thread = self._proton_ge_install_thread
            if thread and thread.is_alive():
                existing = dict(self._proton_ge_install_status)
                return {
                    "success": False,
                    "message": existing.get("message")
                    or (
                        f"{existing.get('tag_name') or 'A Proton-GE release'}"
                        " is already installing."
                    ),
                    "release": release,
                }
            self._proton_ge_install_cancel.clear()
            self._proton_ge_install_status.clear()
            self._proton_ge_install_status.update(
                {
                    "state": "running",
                    "tag_name": normalized,
                    "message": f"Installing {normalized}...",
                    "stage": "queued",
                    "downloaded_bytes": None,
                    "total_bytes": release.get("asset_size"),
                    "progress_fraction": None,
                    "started_at": int(time.time()),
                    "finished_at": None,
                    "install_as_latest": install_as_latest,
                }
            )

            status_ref = self._proton_ge_install_status
            lock_ref = self._proton_ge_install_lock
            cancel_ref = self._proton_ge_install_cancel
            process_ref = self._proton_ge_install_process_ref

            def _worker() -> None:
                try:
                    result = install_sync(
                        normalized,
                        install_as_latest,
                        force_reinstall,
                        status_ref,
                        lock_ref,
                        cancel_ref,
                        process_ref,
                    )
                    if cancel_ref.is_set() and not result.get("success"):
                        set_install_status(
                            status_ref,
                            lock_ref,
                            state="error",
                            tag_name=normalized,
                            message=result.get("message")
                            or f"Install cancelled for {normalized}.",
                            install_as_latest=install_as_latest,
                            stage="cancelled",
                            finished_at=int(time.time()),
                        )
                        return
                    set_install_status(
                        status_ref,
                        lock_ref,
                        state="success" if result.get("success") else "error",
                        tag_name=normalized,
                        message=result.get("message"),
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                except (
                    OSError,
                    subprocess.SubprocessError,
                    tarfile.TarError,
                    zipfile.BadZipFile,
                    ValueError,
                ) as err:
                    decky.logger.error(
                        f"Background Proton-GE install failed for {normalized}: {err}"
                    )
                    set_install_status(
                        status_ref,
                        lock_ref,
                        state="error",
                        tag_name=normalized,
                        message=f"Install failed for {normalized}: {err}",
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                finally:
                    with lock_ref:
                        self._proton_ge_install_thread = None
                        process_ref[0] = None

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

    async def cancel_proton_ge_install(self) -> dict[str, Any]:
        """Stop a running Proton-GE install if there is one."""
        with self._proton_ge_install_lock:
            thread = self._proton_ge_install_thread
            if not thread or not thread.is_alive():
                return {
                    "success": False,
                    "message": "No Proton-GE install is currently running.",
                }
            tag_name = self._proton_ge_install_status.get("tag_name")
            self._proton_ge_install_cancel.set()
            proc = self._proton_ge_install_process_ref[0]
            if proc and proc.poll() is None:
                proc.terminate()
            self._proton_ge_install_status.update(
                {
                    "message": f"Cancelling {tag_name or 'Proton-GE'}...",
                    "stage": "cancelling",
                }
            )
        return {"success": True, "message": f"Cancelling {tag_name or 'Proton-GE'}..."}

    async def install_compatibility_tool_archive(
        self, archive_path: str
    ) -> dict[str, Any]:
        """Install a compat tool from a local archive (zip or tar)."""
        archive_input = (archive_path or "").strip()
        if not archive_input:
            return {"success": False, "message": "No archive path was provided."}

        source_path = Path(archive_input).expanduser()
        if not source_path.is_file():
            return {
                "success": False,
                "message": f"Archive was not found: {archive_input}",
            }

        valid_suffixes = (".zip", ".tar", ".tar.gz", ".tar.xz", ".tar.bz2", ".tgz")
        if not any(source_path.name.endswith(s) for s in valid_suffixes):
            return {
                "success": False,
                "message": "Archive must be a .zip or tar-based file.",
            }

        cd = compat_tools_dir()
        with tempfile.TemporaryDirectory(
            prefix="proton-pulse-archive-install-"
        ) as tmp_dir:
            staged = Path(tmp_dir) / source_path.name
            extract_dir = Path(tmp_dir) / "extract"
            try:
                shutil.copy2(source_path, staged)
                extract_dir.mkdir(parents=True, exist_ok=True)
                extract_archive_safely(staged, extract_dir)
                return finalize_extracted_compat_tool(source_path.name, extract_dir, cd)
            except (
                OSError,
                tarfile.TarError,
                zipfile.BadZipFile,
                shutil.Error,
            ) as err:
                decky.logger.error(
                    f"Failed to install compatibility tool archive {archive_input}: {err}"
                )
                return {
                    "success": False,
                    "message": f"Install failed for {source_path.name}: {err}",
                }

    ################################################################
    # LSFG-VK Frame Generation
    ################################################################

    async def is_lsfg_vk_available(self) -> dict[str, Any]:
        """Check whether the lsfg-vk binary is reachable on disk."""
        path = _lsfg_vk_mod.get_binary_path()
        return {
            "available": path is not None,
            "path": str(path) if path else None,
        }

    async def get_lsfg_vk_manager_state(
        self, force_refresh: bool = False
    ) -> dict[str, Any]:
        """Bundle the LSFG-VK releases, installed versions, and install status."""
        releases = _lsfg_vk_mod.get_releases_sync(force_refresh)
        latest_meta = _lsfg_vk_mod.read_latest_metadata()
        installed = _lsfg_vk_mod.list_installed_lsfg_vk(latest_meta)
        current_release = releases[0] if releases else None
        current_tag = current_release.get("tag_name") if current_release else None
        current_installed = bool(
            current_tag and any(
                v.get("tag_name") == current_tag for v in installed
            )
        )
        current_latest_slot_installed = bool(
            current_tag and any(
                v.get("managed_slot") == "latest" and v.get("tag_name") == current_tag
                for v in installed
            )
        )
        return {
            "current_release": current_release,
            "current_installed": current_installed,
            "current_latest_slot_installed": current_latest_slot_installed,
            "installed_versions": installed,
            "releases": releases,
            "install_status": _lsfg_vk_mod.get_install_status(
                self._lsfg_vk_install_status, self._lsfg_vk_install_lock
            ),
            "binary_available": _lsfg_vk_mod.is_binary_available(),
            "binary_path": str(_lsfg_vk_mod.get_binary_path() or ""),
        }

    async def install_lsfg_vk(
        self,
        version: str | None = None,
        install_as_latest: bool = False,
        force_reinstall: bool = False,
    ) -> dict[str, Any]:
        """Kick off a background LSFG-VK install for the requested version."""
        releases = _lsfg_vk_mod.get_releases_sync(False)
        release: dict[str, Any] | None = None

        if version:
            release = next((r for r in releases if r.get("tag_name") == version), None)
            if not release:
                return {"success": False, "message": f"Could not find LSFG-VK release for {version}.", "release": None}
        else:
            release = releases[0] if releases else None

        if not release:
            return {"success": False, "message": "No LSFG-VK release is available right now.", "release": None}

        tag = release.get("tag_name") or ""

        with self._lsfg_vk_install_lock:
            thread = self._lsfg_vk_install_thread
            if thread and thread.is_alive():
                existing = dict(self._lsfg_vk_install_status)
                return {
                    "success": False,
                    "message": existing.get("message") or f"LSFG-VK {existing.get('tag_name') or tag} is already installing.",
                    "release": release,
                }
            self._lsfg_vk_install_cancel.clear()
            self._lsfg_vk_install_status.clear()
            self._lsfg_vk_install_status.update({
                "state": "running",
                "tag_name": tag,
                "message": f"Installing LSFG-VK {tag}...",
                "stage": "queued",
                "downloaded_bytes": None,
                "total_bytes": release.get("asset_size"),
                "progress_fraction": None,
                "started_at": int(time.time()),
                "finished_at": None,
                "install_as_latest": install_as_latest,
            })

            status_ref = self._lsfg_vk_install_status
            lock_ref = self._lsfg_vk_install_lock
            cancel_ref = self._lsfg_vk_install_cancel
            process_ref = self._lsfg_vk_install_process_ref

            def _worker() -> None:
                try:
                    result = _lsfg_vk_mod.install_sync(
                        tag, install_as_latest, force_reinstall,
                        status_ref, lock_ref, cancel_ref, process_ref,
                    )
                    if cancel_ref.is_set() and not result.get("success"):
                        _lsfg_vk_mod.set_install_status(
                            status_ref, lock_ref,
                            state="error", tag_name=tag,
                            message=result.get("message") or f"LSFG-VK install cancelled for {tag}.",
                            install_as_latest=install_as_latest,
                            stage="cancelled",
                            finished_at=int(time.time()),
                        )
                        return
                    _lsfg_vk_mod.set_install_status(
                        status_ref, lock_ref,
                        state="success" if result.get("success") else "error",
                        tag_name=tag,
                        message=result.get("message"),
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                except (OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile, ValueError) as err:
                    decky.logger.error(f"Background LSFG-VK install failed for {tag}: {err}")
                    _lsfg_vk_mod.set_install_status(
                        status_ref, lock_ref,
                        state="error", tag_name=tag,
                        message=f"LSFG-VK install failed for {tag}: {err}",
                        install_as_latest=install_as_latest,
                        finished_at=int(time.time()),
                    )
                finally:
                    with lock_ref:
                        self._lsfg_vk_install_thread = None
                        process_ref[0] = None

            self._lsfg_vk_install_thread = threading.Thread(
                target=_worker,
                name=f"lsfg-vk-install-{tag}",
                daemon=True,
            )
            self._lsfg_vk_install_thread.start()

        return {"success": True, "message": f"Started installing LSFG-VK {tag}.", "release": release}

    async def cancel_lsfg_vk_install(self) -> dict[str, Any]:
        """Stop a running LSFG-VK install if there is one."""
        with self._lsfg_vk_install_lock:
            thread = self._lsfg_vk_install_thread
            if not thread or not thread.is_alive():
                return {"success": False, "message": "No LSFG-VK install is currently running."}
            tag = self._lsfg_vk_install_status.get("tag_name")
            self._lsfg_vk_install_cancel.set()
            proc = self._lsfg_vk_install_process_ref[0]
            if proc and proc.poll() is None:
                proc.terminate()
            self._lsfg_vk_install_status.update({
                "message": f"Cancelling LSFG-VK {tag or ''}...",
                "stage": "cancelling",
            })
        return {"success": True, "message": f"Cancelling LSFG-VK {tag or ''}..."}

    async def uninstall_lsfg_vk(self, directory_name: str) -> dict[str, Any]:
        """Remove an installed LSFG-VK version by its directory name."""
        target_name = (directory_name or "").strip()
        if not target_name:
            return {"success": False, "message": "No LSFG-VK version was specified."}

        install_dir = _lsfg_vk_mod.lsfg_vk_install_dir()
        target_path = install_dir / target_name
        if not target_path.is_dir():
            return {"success": False, "message": f"LSFG-VK {target_name} is not installed."}

        try:
            shutil.rmtree(target_path)
            _lsfg_vk_mod.clear_latest_metadata(target_name)
            # If no versions remain, also remove the wrapper script and placed files
            remaining = _lsfg_vk_mod.list_installed_lsfg_vk(None)
            if not remaining:
                _lsfg_vk_mod._remove_installed_files()
            return {"success": True, "message": f"Removed LSFG-VK {target_name}."}
        except OSError as err:
            decky.logger.error(f"Failed to remove LSFG-VK {target_name}: {err}")
            return {"success": False, "message": f"Failed to remove LSFG-VK {target_name}: {err}"}

    async def uninstall_compatibility_tool(  # pylint: disable=too-many-return-statements
        self, directory_name: str
    ) -> dict[str, Any]:
        """Delete an installed compat tool by its directory name."""
        target_name = (directory_name or "").strip()
        if not target_name:
            return {
                "success": False,
                "message": "No compatibility tool was specified.",
            }

        installed = list_installed_compatibility_tools(
            all_latest_metadata={tid: read_latest_metadata(tid) for tid in COMPAT_TOOL_CONFIGS}
        )
        target = next(
            (t for t in installed if t.get("directory_name") == target_name), None
        )
        if not target:
            return {"success": False, "message": f"{target_name} is not installed."}

        if target.get("source") == "valve":
            return {
                "success": False,
                "message": f"{target_name} is a built-in Valve tool and cannot be removed.",
            }

        target_path = Path(target.get("path") or "")
        if not target_path.is_dir():
            return {
                "success": False,
                "message": f"{target_name} is not available on disk anymore.",
            }

        allowed = [d.resolve() for d in compat_tools_dirs()]
        resolved = target_path.resolve()
        if not any(root == resolved.parent for root in allowed):
            return {
                "success": False,
                "message": f"{target_name} is outside the managed compatibility tools directories.",
            }

        try:
            shutil.rmtree(resolved)
            tool_id_for_uninstall = target.get("tool_id") or "proton-ge"
            clear_latest_metadata(target_name, tool_id_for_uninstall)
            return {"success": True, "message": f"Removed {target_name}."}
        except OSError as err:
            decky.logger.error(
                f"Failed to remove compatibility tool {target_name}: {err}"
            )
            return {
                "success": False,
                "message": f"Failed to remove {target_name}: {err}",
            }
