"""Proton-GE release management: fetching, caching, metadata, installation.

This module owns the GitHub release cache, the "latest slot" metadata,
install-status tracking, and the synchronous download-extract-finalize
pipeline that runs on the background thread.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .compat_tools import (
    COMPAT_TOOL_CONFIGS,
    PROTON_GE_LATEST_SLOT_NAME,
    installed_tool_matches_version,
    list_installed_compatibility_tools,
    matches_release_tag,
    normalize_proton_ge_tag,
    normalize_tag_for_tool,
    simplify_release,
)
from .http_client import curl_download, curl_json
from .plugin_utils import extract_archive_safely
from .steam_paths import compat_tools_cache_dir, compat_tools_dir

PROTON_GE_REPO_API = COMPAT_TOOL_CONFIGS["proton-ge"]["api_url"]
PROTON_GE_CACHE_TTL_SECONDS = 6 * 60 * 60
COMPAT_TOOL_RESTART_HINT = (
    " Steam may need a restart before the new"
    " compatibility tool appears everywhere."
)


# --- Metadata persistence ---

def _latest_metadata_path(tool_id: str = "proton-ge") -> Path:
    filename = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])["metadata_file"]
    return compat_tools_cache_dir() / filename


def write_latest_metadata(tag_name: str, directory_name: str, tool_id: str = "proton-ge") -> None:
    """Persist the tag -> directory mapping for the 'latest' slot."""
    path = _latest_metadata_path(tool_id)
    payload = {
        "tag_name": tag_name,
        "directory_name": directory_name,
        "updated_at": int(time.time()),
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def clear_latest_metadata(directory_name: str | None = None, tool_id: str = "proton-ge") -> None:
    """Remove the 'latest' metadata file, optionally only if it matches."""
    path = _latest_metadata_path(tool_id)
    if not path.exists():
        return
    if directory_name is None:
        path.unlink(missing_ok=True)
        return
    try:
        raw = path.read_text(encoding="utf-8")
        payload: dict[str, Any] = json.loads(raw)  # type: ignore[assignment]
    except (json.JSONDecodeError, OSError) as e:
        decky.logger.debug(f"Clearing Proton-GE-Latest metadata: {e}")
        path.unlink(missing_ok=True)
        return
    if payload.get("directory_name") == directory_name:
        path.unlink(missing_ok=True)


def read_latest_metadata(tool_id: str = "proton-ge") -> dict[str, Any] | None:
    """Load the 'latest' slot metadata from disk, or None if missing."""
    path = _latest_metadata_path(tool_id)
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        payload: dict[str, Any] = json.loads(raw)  # type: ignore[assignment]
    except (json.JSONDecodeError, OSError):
        return None
    return payload


# --- Install-status tracking (thread-safe) ---

def make_initial_status() -> dict[str, Any]:
    """Return a blank install-status dict (state=idle)."""
    return {
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


def set_install_status(  # pylint: disable=too-many-arguments,too-many-locals
    status: dict[str, Any],
    lock: threading.Lock,
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
    """Thread-safe update of the shared install status dict."""
    running = state == "running"
    with lock:
        # preserve current values for fields not explicitly passed
        cur_started = status.get("started_at")
        cur_stage = status.get("stage")
        cur_dl = status.get("downloaded_bytes")
        cur_total = status.get("total_bytes")
        cur_frac = status.get("progress_fraction")
        status.clear()
        status.update({
            "state": state,
            "tag_name": tag_name,
            "message": message,
            "stage": (
                stage if stage is not None
                else (cur_stage if running else None)
            ),
            "downloaded_bytes": (
                downloaded_bytes if downloaded_bytes is not None
                else (cur_dl if running else None)
            ),
            "total_bytes": (
                total_bytes if total_bytes is not None
                else (cur_total if running else None)
            ),
            "progress_fraction": (
                progress_fraction if progress_fraction is not None
                else (cur_frac if running else None)
            ),
            "started_at": (
                started_at if started_at is not None
                else (cur_started if running else None)
            ),
            "finished_at": finished_at,
            "install_as_latest": install_as_latest,
        })


def get_install_status(
    status: dict[str, Any], lock: threading.Lock
) -> dict[str, Any]:
    """Return a snapshot of the install status dict."""
    with lock:
        return dict(status)


# --- Release fetching & caching ---

def _release_cache_path(tool_id: str = "proton-ge") -> Path:
    filename = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])["cache_file"]
    return compat_tools_cache_dir() / filename


def fetch_releases(tool_id: str = "proton-ge") -> list[dict[str, Any]]:
    """Fetch releases from GitHub with a 6 h disk cache."""
    config = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])
    api_url = config["api_url"]
    asset_prefix = config["asset_prefix"]
    asset_arch = config.get("asset_arch", "")
    cache = _release_cache_path(tool_id)
    now = int(time.time())
    if cache.exists():
        try:
            cached = json.loads(cache.read_text())
            if now - int(cached.get("fetched_at", 0)) < PROTON_GE_CACHE_TTL_SECONDS:
                return cached.get("releases", [])  # type: ignore[no-any-return]
        except (json.JSONDecodeError, OSError, ValueError) as err:
            decky.logger.warning(f"Failed to read {tool_id} release cache: {err}")

    try:
        raw = curl_json(
            api_url,
            headers=["Accept: application/vnd.github+json", "User-Agent: decky-proton-pulse"],
            timeout=25,
        )
        releases = raw if isinstance(raw, list) else []
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as err:
        decky.logger.warning(
            f"curl fetch for {tool_id} releases failed, "
            f"trying Python fallback: {err}"
        )
        request = Request(
            api_url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "decky-proton-pulse",
            },
        )
        with urlopen(request, timeout=20) as response:
            raw_bytes = response.read().decode("utf-8")
            releases = json.loads(raw_bytes)  # type: ignore[assignment]

    simplified: list[dict[str, Any]] = [
        item for item in (simplify_release(r, asset_prefix, asset_arch) for r in releases) if item
    ]
    cache.write_text(
        json.dumps({"fetched_at": now, "releases": simplified}),
        encoding="utf-8",
    )
    return simplified


def get_releases_sync(
    force_refresh: bool = False,
    tool_id: str = "proton-ge",
) -> list[dict[str, Any]]:
    """Fetch releases, optionally busting the cache. Falls back to stale cache on error."""
    cache = _release_cache_path(tool_id)
    if force_refresh and cache.exists():
        cache.unlink()
    try:
        return fetch_releases(tool_id)
    except (
        OSError, subprocess.SubprocessError, json.JSONDecodeError, ValueError
    ) as err:
        decky.logger.error(f"Failed to fetch {tool_id} releases: {err}")
        if cache.exists():
            try:
                raw = cache.read_text(encoding="utf-8")
                return json.loads(raw).get("releases", [])  # type: ignore[no-any-return]
            except (json.JSONDecodeError, OSError):
                pass
        return []


# --- Finalize extracted compat tool ---

def finalize_extracted_compat_tool(
    archive_label: str,
    extract_dir: Path,
    cd: Path,
    *,
    destination_name: str | None = None,
    replace_existing: bool = False,
) -> dict[str, Any]:
    """Move an extracted compat tool into ``compatibilitytools.d``."""
    extracted_entries = list(extract_dir.iterdir())
    source_dir = next((e for e in extracted_entries if e.is_dir()), None)
    if source_dir is None:
        inferred_name = Path(archive_label).name
        for suffix in (".tar.gz", ".tar.xz", ".tar.bz2", ".tgz", ".zip", ".tar"):
            if inferred_name.endswith(suffix):
                inferred_name = inferred_name[: -len(suffix)]
                break
        source_dir = extract_dir / inferred_name
        source_dir.mkdir(parents=True, exist_ok=True)
        for entry in extracted_entries:
            shutil.move(str(entry), source_dir / entry.name)

    destination = cd / (destination_name or source_dir.name)
    if destination.exists():
        if replace_existing:
            shutil.rmtree(destination)
        else:
            return {
                "success": True,
                "already_installed": True,
                "message": f"{destination.name} is already installed.",
            }

    shutil.move(str(source_dir), str(destination))
    return {
        "success": True,
        "message": f"Installed {destination.name}.{COMPAT_TOOL_RESTART_HINT}",
    }


# --- Synchronous install pipeline (runs on background thread) ---

def install_sync(  # pylint: disable=too-many-arguments,too-many-positional-arguments,too-many-locals,too-many-return-statements,too-many-statements
    version: str | None,
    install_as_latest: bool,
    force_reinstall: bool,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel_flag: threading.Event,
    process_ref: list[subprocess.Popen[str] | None],
    tool_id: str = "proton-ge",
) -> dict[str, Any]:
    """Download, extract, and finalize a compat tool release."""

    def _set(**kw: Any) -> None:
        set_install_status(status, lock, **kw)

    def _cancel() -> bool:
        return cancel_flag.is_set()

    def _set_process(p: subprocess.Popen[str] | None) -> None:
        with lock:
            process_ref[0] = p

    config = COMPAT_TOOL_CONFIGS.get(tool_id, COMPAT_TOOL_CONFIGS["proton-ge"])
    latest_slot_name = config["latest_slot_name"]
    label = config["label"]

    releases = get_releases_sync(False, tool_id)
    release: dict[str, Any] | None = None

    if version:
        normalized = normalize_tag_for_tool(tool_id, version)
        release = next(
            (i for i in releases if i.get("tag_name") == normalized),
            None,
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
            "message": f"No {label} release is available right now.",
            "release": None,
        }

    decky.logger.info(
        f"Starting {label} install sync"
        f" | version={normalized}"
        f" install_as_latest={install_as_latest}"
        f" tool_id={tool_id}"
    )

    latest_meta = read_latest_metadata(tool_id)
    all_meta = {tool_id: latest_meta}
    installed = list_installed_compatibility_tools(all_latest_metadata=all_meta)
    existing_latest = next(
        (t for t in installed if t.get("managed_slot") == "latest" and t.get("tool_id") == tool_id),
        None,
    )

    def _matches(t: dict[str, Any]) -> bool:
        if tool_id == "proton-ge":
            return installed_tool_matches_version(t, normalized)  # type: ignore[arg-type]
        return matches_release_tag(t, normalized)  # type: ignore[arg-type]

    # check if already installed before downloading
    if (
        not force_reinstall
        and install_as_latest
        and existing_latest
        and _matches(existing_latest)
    ):
        return {
            "success": True,
            "already_installed": True,
            "message": f"{latest_slot_name} already points to {normalized}.",
            "release": release,
        }
    if not force_reinstall and not install_as_latest and any(_matches(t) for t in installed):
        return {
            "success": True,
            "already_installed": True,
            "message": f"{normalized} is already installed.",
            "release": release,
        }

    download_url = release.get("download_url")
    if not download_url:
        return {
            "success": False,
            "message": f"{normalized} has no downloadable archive.",
            "release": release,
        }

    return _do_download_and_install(
        normalized, release, download_url, install_as_latest,
        force_reinstall,
        _set, _cancel, _set_process,
        latest_slot_name=latest_slot_name,
    )


def _do_download_and_install(  # pylint: disable=too-many-arguments,too-many-positional-arguments,too-many-locals
    normalized: str,
    release: dict[str, Any],
    download_url: str,
    install_as_latest: bool,
    force_reinstall: bool,
    _set: Any,
    _cancel: Any,
    _set_process: Any,
    latest_slot_name: str = PROTON_GE_LATEST_SLOT_NAME,
) -> dict[str, Any]:
    """Handle the download/extract/finalize pipeline in a temp dir."""
    asset_size = release.get("asset_size")
    asset_name = release.get("asset_name") or f"{normalized}.tar.gz"
    cd = compat_tools_dir()

    with tempfile.TemporaryDirectory(prefix="proton-pulse-install-") as tmp:
        archive_path = Path(tmp) / asset_name
        try:
            _download_release(
                normalized, download_url, archive_path,
                asset_size, install_as_latest,
                _set, _cancel, _set_process,
            )

            # Extract
            extract_dir = Path(tmp) / "extract"
            extract_dir.mkdir(parents=True, exist_ok=True)
            if _cancel():
                return _cancelled(normalized, release)
            dl_bytes = (
                archive_path.stat().st_size
                if archive_path.exists() else None
            )
            _set(
                state="running", tag_name=normalized,
                message=f"Extracting {normalized}...",
                install_as_latest=install_as_latest,
                stage="extracting",
                downloaded_bytes=dl_bytes,
                total_bytes=asset_size,
                progress_fraction=1.0 if asset_size else None,
            )
            extract_archive_safely(archive_path, extract_dir)
            if _cancel():
                return _cancelled(normalized, release)

            # Finalize
            dl_bytes = (
                archive_path.stat().st_size
                if archive_path.exists() else None
            )
            _set(
                state="running", tag_name=normalized,
                message=f"Finalizing {normalized}...",
                install_as_latest=install_as_latest,
                stage="finalizing",
                downloaded_bytes=dl_bytes,
                total_bytes=asset_size,
                progress_fraction=1.0,
            )
            dest_name = latest_slot_name if install_as_latest else None
            result = finalize_extracted_compat_tool(
                normalized, extract_dir, cd,
                destination_name=dest_name,
                replace_existing=install_as_latest or force_reinstall,
            )
            if result.get("success") and install_as_latest:
                write_latest_metadata(normalized, latest_slot_name)
            # #116: refresh the rolling latest-slot symlink after every
            # successful install so Proton-GE-Latest / Proton-CachyOS-Latest
            # always points at the newest versioned build even when the
            # caller passed install_as_latest=False. Same behavior Steam's
            # Proton Experimental gives. Import lazily to avoid a circular
            # dependency at module load time.
            if result.get("success"):
                try:
                    from .compat_tools import ensure_rolling_slot  # pylint: disable=import-outside-toplevel
                    slot_result = ensure_rolling_slot(tool_config["id"])
                    result["rolling_slot"] = slot_result
                    if not slot_result.get("ok") and slot_result.get("reason") not in {"no-source", "slot-is-real-dir"}:
                        # Structural failure -- the tool we just installed can't
                        # be reached via the Latest slot. User asked for this to
                        # fail loudly rather than silently succeeding.
                        result["success"] = False
                        result["message"] = (
                            f"Installed {normalized} but the Proton-Latest slot "
                            f"could not be created: {slot_result.get('reason')}"
                        )
                except Exception as _slot_err:  # pylint: disable=broad-except
                    decky.logger.warning(
                        f"Rolling slot refresh after install failed: {_slot_err}"
                    )
            result["release"] = release
            return result
        except (
            OSError, subprocess.SubprocessError,
            tarfile.TarError, zipfile.BadZipFile, ValueError,
        ) as err:
            decky.logger.error(
                f"Failed to install Proton-GE {normalized}: {err}"
            )
            return {
                "success": False,
                "message": f"Install failed for {normalized}: {err}",
                "release": release,
            }


def _download_release(  # pylint: disable=too-many-arguments,too-many-positional-arguments
    normalized: str,
    download_url: str,
    archive_path: Path,
    asset_size: int | None,
    install_as_latest: bool,
    _set: Any,
    _cancel: Any,
    _set_process: Any,
) -> None:
    """Try curl first, fall back to Python urllib."""
    try:
        _set(
            state="running", tag_name=normalized,
            message=f"Downloading {normalized}...",
            install_as_latest=install_as_latest,
            stage="downloading", downloaded_bytes=0,
            total_bytes=asset_size,
            progress_fraction=0.0 if asset_size else None,
        )

        def _dl_progress(
            downloaded: int, total: int | None, fraction: float | None
        ) -> None:
            _set(
                state="running", tag_name=normalized,
                message=f"Downloading {normalized}...",
                install_as_latest=install_as_latest,
                stage="downloading",
                downloaded_bytes=downloaded,
                total_bytes=total,
                progress_fraction=fraction,
            )

        curl_download(
            download_url, archive_path,
            timeout=900, total_bytes=asset_size,
            progress_callback=_dl_progress,
            cancel_check=_cancel,
            install_process_setter=_set_process,
        )
    except (subprocess.SubprocessError, OSError) as err:
        decky.logger.warning(
            f"curl download failed, trying Python fallback: {err}"
        )
        _set(
            state="running", tag_name=normalized,
            message=f"Downloading {normalized}...",
            install_as_latest=install_as_latest,
            stage="downloading-python-fallback",
            downloaded_bytes=0, total_bytes=asset_size,
            progress_fraction=0.0 if asset_size else None,
        )
        request = Request(
            download_url,
            headers={"User-Agent": "decky-proton-pulse"},
        )
        with (
            urlopen(request, timeout=180) as response,
            open(archive_path, "wb") as f,
        ):
            shutil.copyfileobj(response, f)
        dl_size = archive_path.stat().st_size
        frac = None
        if asset_size and asset_size > 0:
            frac = max(0.0, min(1.0, dl_size / asset_size))
        _set(
            state="running", tag_name=normalized,
            message=f"Downloading {normalized}...",
            install_as_latest=install_as_latest,
            stage="downloading-python-fallback",
            downloaded_bytes=dl_size, total_bytes=asset_size,
            progress_fraction=frac,
        )


def _cancelled(
    normalized: str, release: dict[str, Any]
) -> dict[str, Any]:
    """Shorthand for returning a cancellation result."""
    return {
        "success": False,
        "message": f"Install cancelled for {normalized}.",
        "release": release,
    }
