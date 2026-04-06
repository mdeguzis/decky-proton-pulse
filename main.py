"""Proton Pulse – Decky Loader plugin backend.

This file is the entry-point that Decky's plugin loader imports.  It
must expose a top-level ``Plugin`` class whose public ``async`` methods
become the callable API for the React frontend.

All heavy logic lives in the helper modules (``proton_ge``,
``compat_tools``, ``system_info``, etc.).  ``Plugin`` is a thin
orchestration façade that wires them together.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tarfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]

from lib.compat_tools import (
    find_closest_installed_tool,
    installed_tool_matches_version,
    list_installed_compatibility_tools,
    normalize_proton_ge_tag,
)
from lib.plugin_logging import get_log_contents, log_frontend_event, sync_set_log_level
from lib.plugin_utils import extract_archive_safely
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
from lib.protondb_systeminfo import generate_system_info
from lib.steam_paths import compat_tools_dir, compat_tools_dirs
from lib.system_info import collect_system_info


class Plugin:
    """Decky Loader plugin backend for Proton Pulse.

    Every ``async`` method here is exposed to the frontend via the Decky
    callable bridge.  Synchronous helpers are prefixed with ``_``.
    """

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def _main(self) -> None:
        """Plugin entry-point called by Decky on load."""
        decky.logger.info("Proton Pulse backend starting")
        self._debug_handler: logging.Handler | None = None
        self._debug_handler_ref: list[logging.Handler | None] = [None]

        # Proton-GE install state
        self._proton_ge_install_lock = threading.Lock()
        self._proton_ge_install_cancel = threading.Event()
        self._proton_ge_install_thread: threading.Thread | None = None
        self._proton_ge_install_process: subprocess.Popen[str] | None = None
        self._proton_ge_install_process_ref: list[subprocess.Popen[str] | None] = [None]
        self._proton_ge_install_status: dict[str, Any] = make_initial_status()
        decky.logger.info("Proton Pulse backend ready")

    async def _unload(self) -> None:
        """Cleanup on plugin unload."""
        decky.logger.info("Proton Pulse backend shutting down")
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

    # ─── Logging ──────────────────────────────────────────────────────

    async def set_log_level(self, level: str) -> bool:
        return sync_set_log_level(level, self._debug_handler_ref)

    async def get_log_contents(self) -> str:
        return get_log_contents()

    async def log_frontend_event(
        self, level: str, message: str, context: dict[str, object] | None = None
    ) -> bool:
        return log_frontend_event(level, message, context)

    # ─── Metadata ─────────────────────────────────────────────────────

    async def get_plugin_version(self) -> str:
        return getattr(decky, "DECKY_PLUGIN_VERSION", "unknown")

    async def get_protondb_systeminfo(self) -> str:
        try:
            return generate_system_info(home=decky.DECKY_USER_HOME)
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            decky.logger.error(f"Failed to generate ProtonDB system info: {e}")
            return f"Error generating system info: {e}"

    async def is_game_running(self) -> bool:
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

    # ─── System detection ─────────────────────────────────────────────

    async def get_system_info(self) -> dict[str, object]:
        return collect_system_info()

    # ─── Compatibility tools ──────────────────────────────────────────

    async def list_installed_compatibility_tools(self) -> list[dict[str, Any]]:
        return list_installed_compatibility_tools(read_latest_metadata())

    async def get_proton_ge_releases(
        self, force_refresh: bool = False
    ) -> list[dict[str, Any]]:
        return get_releases_sync(force_refresh)

    async def get_proton_ge_manager_state(
        self, force_refresh: bool = False
    ) -> dict[str, Any]:
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
        release = next(
            (i for i in releases if i.get("tag_name") == normalized), None
        )

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

    # ─── Install / uninstall ──────────────────────────────────────────

    async def install_proton_ge(
        self, version: str | None = None, install_as_latest: bool = False
    ) -> dict[str, Any]:
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
                    or f"{existing.get('tag_name') or 'A Proton-GE release'} is already installing.",
                    "release": release,
                }
            self._proton_ge_install_cancel.clear()
            self._proton_ge_install_status.clear()
            self._proton_ge_install_status.update(
                {
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
                    "message": f"Cancelling {tag_name or 'Proton-GE'}…",
                    "stage": "cancelling",
                }
            )
        return {"success": True, "message": f"Cancelling {tag_name or 'Proton-GE'}…"}

    async def install_compatibility_tool_archive(
        self, archive_path: str
    ) -> dict[str, Any]:
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
        import tempfile

        with tempfile.TemporaryDirectory(
            prefix="proton-pulse-archive-install-"
        ) as tmp_dir:
            staged = Path(tmp_dir) / source_path.name
            extract_dir = Path(tmp_dir) / "extract"
            try:
                shutil.copy2(source_path, staged)
                extract_dir.mkdir(parents=True, exist_ok=True)
                extract_archive_safely(staged, extract_dir)
                return finalize_extracted_compat_tool(
                    source_path.name, extract_dir, cd
                )
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

    async def uninstall_compatibility_tool(
        self, directory_name: str
    ) -> dict[str, Any]:
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