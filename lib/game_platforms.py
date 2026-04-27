"""Fetch platform availability, release date, and last-updated time for a game."""

from __future__ import annotations

import datetime
import re
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .http_client import curl_json
from .steam_paths import find_steam_root

_cache: dict[str, dict[str, Any]] = {}


def _library_folders() -> list[Path]:
    root = find_steam_root()
    if not root:
        return []
    vdf = root / "config" / "libraryfolders.vdf"
    if not vdf.exists():
        return []
    try:
        text = vdf.read_text()
    except OSError:
        return []
    paths: list[Path] = [root / "steamapps"]
    for m in re.finditer(r'"path"\s+"([^"]+)"', text):
        p = Path(m.group(1)) / "steamapps"
        if p not in paths:
            paths.append(p)
    return paths


def _parse_acf(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return result
    for m in re.finditer(r'"(\w+)"\s+"([^"]*)"', text):
        result[m.group(1)] = m.group(2)
    return result


def _disk_free_gb(path: Path) -> float | None:
    """Free space on the partition that holds path, in GB. None if the
    syscall fails (path missing, permissions, etc.)."""
    import shutil

    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None
    return round(usage.free / (1024 ** 3), 1)


def _get_library_info(app_id: str) -> dict[str, object]:
    """Return last_updated date and free disk space for the library that holds app_id.

    When the game isn't installed in any known library, fall back to the
    primary Steam library so the Storage row in the UI still has a "right
    now" free-space number to compare against the requirement.
    """
    libs = _library_folders()
    for lib in libs:
        manifest = lib / f"appmanifest_{app_id}.acf"
        if manifest.exists():
            kv = _parse_acf(manifest)
            last_updated: str | None = None
            ts = kv.get("LastUpdated", "0")
            try:
                epoch = int(ts)
                if epoch > 0:
                    dt = datetime.datetime.fromtimestamp(epoch, tz=datetime.timezone.utc)
                    last_updated = dt.strftime("%b %d, %Y")
            except (ValueError, OSError, OverflowError):
                pass

            return {
                "last_updated": last_updated,
                "storage_free_gb": _disk_free_gb(lib),
            }

    # Game isn't installed in any Steam library. Fall back to the primary
    # library so the user can still see their available space.
    if libs:
        return {"last_updated": None, "storage_free_gb": _disk_free_gb(libs[0])}

    return {"last_updated": None, "storage_free_gb": None}


def get_game_platforms(app_id: str) -> dict[str, Any]:
    """Return platform flags, release date, last-updated date, and library free space for app_id.

    Returns:
        {
          "platforms": {"windows": bool, "mac": bool, "linux": bool},
          "release_date": str | None,
          "last_updated": str | None,      # from local ACF manifest if installed
          "storage_free_gb": float | None, # free GB on the drive where the game is installed
        }
    """
    if app_id in _cache:
        return _cache[app_id]

    lib_info = _get_library_info(app_id)
    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&filters=platforms,release_date"
    )
    try:
        data = curl_json(url)
        app_entry = data.get(str(app_id), {})
        if not app_entry.get("success"):
            result: dict[str, Any] = {
                "platforms": {},
                "release_date": None,
                **lib_info,
            }
        else:
            inner = app_entry.get("data", {})
            result = {
                "platforms": inner.get("platforms", {}),
                "release_date": inner.get("release_date", {}).get("date") or None,
                **lib_info,
            }
    except Exception as exc:
        decky.logger.error("get_game_platforms failed for %s: %s", app_id, exc)
        result = {
            "platforms": {},
            "release_date": None,
            **lib_info,
        }

    _cache[app_id] = result
    return result
