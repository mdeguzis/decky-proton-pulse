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
    find_closest_installed_tool,
    installed_tool_matches_version,
    list_installed_compatibility_tools,
    normalize_proton_ge_tag,
)
from lib.plugin_logging import get_log_contents, log_frontend_event, sync_set_log_level
from lib.plugin_utils import extract_archive_safely
from lib.prefetch import prefetch_installed_games
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
from lib.metrics_export import export_metrics_to_disk
from lib.protondb_systeminfo import generate_system_info
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
        self._prefetch_cancel = threading.Event()
        self._prefetch_thread: threading.Thread | None = None

    ################################################################
    # Lifecycle
    ################################################################

    async def _main(self) -> None:
        """Called by Decky when the plugin loads — our starting line."""
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
        """Shut everything down gracefully — kill running threads, clean up."""
        decky.logger.info("Proton Pulse backend shutting down")
        # Tell both background threads to wrap it up
        self._prefetch_cancel.set()
        self._proton_ge_install_cancel.set()
        with self._proton_ge_install_lock:
            proc = self._proton_ge_install_process_ref[0]
            if proc and proc.poll() is None:
                proc.terminate()
        thread = self._proton_ge_install_thread
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
    # Metadata
    ################################################################

    async def get_plugin_version(self) -> str:
        """Hand back the plugin version string that Decky knows about."""
        return getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")

    async def get_protondb_systeminfo(self) -> str:
        """Build the system-info blob that ProtonDB submissions need."""
        try:
            return generate_system_info(home=decky.DECKY_USER_HOME)
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            decky.logger.error(f"Failed to generate ProtonDB system info: {e}")
            return f"Error generating system info: {e}"

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

    ################################################################
    # CDN Cache
    ################################################################

    async def get_cached_cdn(self, app_id: str, filename: str) -> dict[str, Any]:
        """Return cached CDN data if it's still fresh, otherwise ``{"data": null}``."""
        # Rebuild the full CDN URL so we can check the freshness metadata
        url = f"https://mdeguzis.github.io/proton-pulse-data/data/{app_id}/{filename}"
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
            url = f"https://mdeguzis.github.io/proton-pulse-data/data/{app_id}/{filename}"
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
        return list_installed_compatibility_tools(read_latest_metadata())

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
        installed = list_installed_compatibility_tools(read_latest_metadata())
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

    async def check_proton_version_availability(self, version: str) -> dict[str, Any]:
        """See if a specific Proton-GE version is installed, available, or unknown."""
        normalized = normalize_proton_ge_tag(version)
        installed = list_installed_compatibility_tools(read_latest_metadata())

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

        installed = list_installed_compatibility_tools(read_latest_metadata())
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
            clear_latest_metadata(target_name)
            return {"success": True, "message": f"Removed {target_name}."}
        except OSError as err:
            decky.logger.error(
                f"Failed to remove compatibility tool {target_name}: {err}"
            )
            return {
                "success": False,
                "message": f"Failed to remove {target_name}: {err}",
            }
