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

import decky  # type: ignore[import-untyped]

from .compat_tools import (
    PROTON_GE_LATEST_SLOT_NAME,
    installed_tool_matches_version,
    list_installed_compatibility_tools,
    normalize_proton_ge_tag,
    simplify_release,
)
from .http_client import curl_download, curl_json
from .plugin_utils import extract_archive_safely
from .steam_paths import compat_tools_cache_dir, compat_tools_dir

PROTON_GE_REPO_API = (
    "https://api.github.com/repos/GloriousEggroll/proton-ge-custom"
    "/releases?per_page=30"
)
PROTON_GE_CACHE_TTL_SECONDS = 6 * 60 * 60
COMPAT_TOOL_RESTART_HINT = (
    " Steam may need a restart before the new"
    " compatibility tool appears everywhere."
)


# ── Metadata persistence ────────────────────────────────────────────

def _latest_metadata_path() -> Path:
    return compat_tools_cache_dir() / "proton-ge-latest.json"


def write_latest_metadata(tag_name: str, directory_name: str) -> None:
    path = _latest_metadata_path()
    path.write_text(
        json.dumps(
            {"tag_name": tag_name, "directory_name": directory_name, "updated_at": int(time.time())}
        )
    )


def clear_latest_metadata(directory_name: str | None = None) -> None:
    path = _latest_metadata_path()
    if not path.exists():
        return
    if directory_name is None:
        path.unlink(missing_ok=True)
        return
    try:
        payload: dict[str, Any] = json.loads(path.read_text())  # type: ignore[assignment]
    except (json.JSONDecodeError, OSError) as e:
        decky.logger.debug(f"Clearing Proton-GE-Latest meta data exception: {e}")
        path.unlink(missing_ok=True)
        return
    if payload.get("directory_name") == directory_name:
        path.unlink(missing_ok=True)


def read_latest_metadata() -> dict[str, Any] | None:
    path = _latest_metadata_path()
    if not path.exists():
        return None
    try:
        payload: dict[str, Any] = json.loads(path.read_text())  # type: ignore[assignment]
    except (json.JSONDecodeError, OSError):
        return None
    return payload


# ── Install-status tracking (thread-safe) ───────────────────────────

def make_initial_status() -> dict[str, Any]:
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


def set_install_status(
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
    with lock:
        cur_started = status.get("started_at")
        cur_stage = status.get("stage")
        cur_dl = status.get("downloaded_bytes")
        cur_total = status.get("total_bytes")
        cur_frac = status.get("progress_fraction")
        status.clear()
        status.update(
            {
                "state": state,
                "tag_name": tag_name,
                "message": message,
                "stage": stage if stage is not None else (cur_stage if state == "running" else None),
                "downloaded_bytes": downloaded_bytes if downloaded_bytes is not None else (cur_dl if state == "running" else None),
                "total_bytes": total_bytes if total_bytes is not None else (cur_total if state == "running" else None),
                "progress_fraction": progress_fraction if progress_fraction is not None else (cur_frac if state == "running" else None),
                "started_at": started_at if started_at is not None else (cur_started if state == "running" else None),
                "finished_at": finished_at,
                "install_as_latest": install_as_latest,
            }
        )


def get_install_status(status: dict[str, Any], lock: threading.Lock) -> dict[str, Any]:
    with lock:
        return dict(status)


# ── Release fetching & caching ──────────────────────────────────────

def _cache_path() -> Path:
    return compat_tools_cache_dir() / "proton-ge-releases-cache.json"


def fetch_releases() -> list[dict[str, Any]]:
    """Fetch GE-Proton releases from GitHub with a 6 h disk cache."""
    cache = _cache_path()
    now = int(time.time())
    if cache.exists():
        try:
            cached = json.loads(cache.read_text())
            if now - int(cached.get("fetched_at", 0)) < PROTON_GE_CACHE_TTL_SECONDS:
                return cached.get("releases", [])  # type: ignore[no-any-return]
        except (json.JSONDecodeError, OSError, ValueError) as err:
            decky.logger.warning(f"Failed to read Proton-GE cache: {err}")

    try:
        raw = curl_json(
            PROTON_GE_REPO_API,
            headers=["Accept: application/vnd.github+json", "User-Agent: decky-proton-pulse"],
            timeout=25,
        )
        releases = raw if isinstance(raw, list) else []
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as err:
        decky.logger.warning(f"curl fetch for Proton-GE releases failed, trying Python fallback: {err}")
        request = Request(
            PROTON_GE_REPO_API,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "decky-proton-pulse"},
        )
        with urlopen(request, timeout=20) as response:
            releases = json.loads(response.read().decode("utf-8"))  # type: ignore[assignment]

    simplified: list[dict[str, Any]] = [item for item in (simplify_release(r) for r in releases) if item]
    cache.write_text(json.dumps({"fetched_at": now, "releases": simplified}))
    return simplified


def get_releases_sync(force_refresh: bool = False) -> list[dict[str, Any]]:
    cache = _cache_path()
    if force_refresh and cache.exists():
        cache.unlink()
    try:
        return fetch_releases()
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, ValueError) as err:
        decky.logger.error(f"Failed to fetch Proton-GE releases: {err}")
        if cache.exists():
            try:
                return json.loads(cache.read_text()).get("releases", [])  # type: ignore[no-any-return]
            except (json.JSONDecodeError, OSError):
                pass
        return []


# ── Finalize extracted compat tool ──────────────────────────────────

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
            return {"success": True, "already_installed": True, "message": f"{destination.name} is already installed."}

    shutil.move(str(source_dir), str(destination))
    return {"success": True, "message": f"Installed {destination.name}.{COMPAT_TOOL_RESTART_HINT}"}


# ── Synchronous install pipeline (runs on background thread) ────────

def install_sync(
    version: str | None,
    install_as_latest: bool,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel_flag: threading.Event,
    process_ref: list[subprocess.Popen[str] | None],
) -> dict[str, Any]:
    """Download, extract, and finalize a Proton-GE release."""

    def _set(**kw: Any) -> None:
        set_install_status(status, lock, **kw)

    def _cancel() -> bool:
        return cancel_flag.is_set()

    def _set_process(p: subprocess.Popen[str] | None) -> None:
        with lock:
            process_ref[0] = p

    releases = get_releases_sync(False)
    release: dict[str, Any] | None = None

    if version:
        normalized = normalize_proton_ge_tag(version)
        release = next((i for i in releases if i.get("tag_name") == normalized), None)
        if not release:
            return {"success": False, "message": f"Could not find release for {version}.", "release": None}
    else:
        release = releases[0] if releases else None
        normalized = release.get("tag_name") if release else None

    if not release or not normalized:
        return {"success": False, "message": "No Proton-GE release is available right now.", "release": None}

    decky.logger.info(f"Starting Proton-GE install sync | version={normalized} install_as_latest={install_as_latest}")

    latest_meta = read_latest_metadata()
    installed = list_installed_compatibility_tools(latest_meta)
    existing_latest = next((t for t in installed if t.get("managed_slot") == "latest"), None)
    if install_as_latest and existing_latest and installed_tool_matches_version(existing_latest, normalized):
        return {"success": True, "already_installed": True, "message": f"{PROTON_GE_LATEST_SLOT_NAME} already points to {normalized}.", "release": release}
    if not install_as_latest and any(installed_tool_matches_version(t, normalized) for t in installed):
        return {"success": True, "already_installed": True, "message": f"{normalized} is already installed.", "release": release}

    download_url = release.get("download_url")
    if not download_url:
        return {"success": False, "message": f"{normalized} did not expose a downloadable archive.", "release": release}

    cd = compat_tools_dir()
    with tempfile.TemporaryDirectory(prefix="proton-pulse-install-") as tmp_dir:
        archive_path = Path(tmp_dir) / (release.get("asset_name") or f"{normalized}.tar.gz")
        try:
            # Download
            asset_size = release.get("asset_size")
            try:
                _set(state="running", tag_name=normalized, message=f"Downloading {normalized}…", install_as_latest=install_as_latest, stage="downloading", downloaded_bytes=0, total_bytes=asset_size, progress_fraction=0.0 if asset_size else None)

                def _dl_progress(downloaded: int, total: int | None, fraction: float | None) -> None:
                    _set(state="running", tag_name=normalized, message=f"Downloading {normalized}...", install_as_latest=install_as_latest, stage="downloading", downloaded_bytes=downloaded, total_bytes=total, progress_fraction=fraction)

                curl_download(download_url, archive_path, timeout=900, total_bytes=asset_size, progress_callback=_dl_progress, cancel_check=_cancel, install_process_setter=_set_process)
            except (subprocess.SubprocessError, OSError) as err:
                decky.logger.warning(f"curl download failed, trying Python fallback: {err}")
                _set(state="running", tag_name=normalized, message=f"Downloading {normalized}…", install_as_latest=install_as_latest, stage="downloading-python-fallback", downloaded_bytes=0, total_bytes=asset_size, progress_fraction=0.0 if asset_size else None)
                request = Request(download_url, headers={"User-Agent": "decky-proton-pulse"})
                with urlopen(request, timeout=180) as response, open(archive_path, "wb") as f:
                    shutil.copyfileobj(response, f)
                dl_size = archive_path.stat().st_size
                frac = max(0.0, min(1.0, dl_size / asset_size)) if asset_size and asset_size > 0 else None
                _set(state="running", tag_name=normalized, message=f"Downloading {normalized}…", install_as_latest=install_as_latest, stage="downloading-python-fallback", downloaded_bytes=dl_size, total_bytes=asset_size, progress_fraction=frac)

            # Extract
            extract_dir = Path(tmp_dir) / "extract"
            extract_dir.mkdir(parents=True, exist_ok=True)
            if _cancel():
                return {"success": False, "message": f"Install cancelled for {normalized}.", "release": release}
            _set(state="running", tag_name=normalized, message=f"Extracting {normalized}…", install_as_latest=install_as_latest, stage="extracting", downloaded_bytes=archive_path.stat().st_size if archive_path.exists() else None, total_bytes=asset_size, progress_fraction=1.0 if asset_size else None)
            extract_archive_safely(archive_path, extract_dir)
            if _cancel():
                return {"success": False, "message": f"Install cancelled for {normalized}.", "release": release}

            # Finalize
            _set(state="running", tag_name=normalized, message=f"Finalizing {normalized}…", install_as_latest=install_as_latest, stage="finalizing", downloaded_bytes=archive_path.stat().st_size if archive_path.exists() else None, total_bytes=asset_size, progress_fraction=1.0)
            result = finalize_extracted_compat_tool(
                normalized, extract_dir, cd,
                destination_name=PROTON_GE_LATEST_SLOT_NAME if install_as_latest else None,
                replace_existing=install_as_latest,
            )
            if result.get("success") and install_as_latest:
                write_latest_metadata(normalized, PROTON_GE_LATEST_SLOT_NAME)
            result["release"] = release
            return result
        except (OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile, ValueError) as err:
            decky.logger.error(f"Failed to install Proton-GE {normalized}: {err}")
            return {"success": False, "message": f"Install failed for {normalized}: {err}", "release": release}