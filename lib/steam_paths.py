"""Steam path discovery and VDF parsing helpers.

Finds the Steam installation, ``compatibilitytools.d`` directories, and
offers lightweight VDF value extraction.
"""

from __future__ import annotations

import re
from pathlib import Path

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error


def find_steam_root() -> Path | None:
    """Hunt down the real Steam install dir by looking for config files.

    Steam can live in a bunch of places depending on whether you're on
    SteamOS, a Flatpak install, or a regular desktop Linux setup.
    """
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
        if (config_dir / "config.vdf").exists() and (
            config_dir / "libraryfolders.vdf"
        ).exists():
            return candidate
    return None


def compat_tools_dirs() -> list[Path]:
    """All ``compatibilitytools.d`` dirs we know about, de-duplicated.

    Creates any that don't exist yet.  Checks the detected Steam root
    first, then falls back to other well-known paths.
    """
    detected_root = find_steam_root()
    candidates = [detected_root / "compatibilitytools.d"] if detected_root else []
    home = Path(decky.DECKY_USER_HOME)
    candidates.extend(
        [
            home / ".steam" / "root" / "compatibilitytools.d",
            home / ".steam" / "steam" / "compatibilitytools.d",
            home / ".local" / "share" / "Steam" / "compatibilitytools.d",
            home
            / ".var"
            / "app"
            / "com.valvesoftware.Steam"
            / "data"
            / "Steam"
            / "compatibilitytools.d",
        ]
    )
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


def compat_tools_dir() -> Path:
    """The primary ``compatibilitytools.d`` directory (first in the list)."""
    return compat_tools_dirs()[0]


def compat_tools_cache_dir() -> Path:
    """Our own cache directory (``~/.config/decky-proton-pulse``)."""
    cache_dir = Path(decky.DECKY_USER_HOME) / ".config" / "decky-proton-pulse"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def read_vdf_value(text: str, key: str) -> str | None:
    """Pluck a value out of Valve's VDF (KeyValues) format.

    VDF files look like ``"key"  "value"`` with optional whitespace.
    This is a quick regex grab - not a full parser, but good enough for
    the fields we care about.
    """
    match = re.search(rf'"{re.escape(key)}"\s+"([^"]+)"', text)
    return match.group(1).strip() if match else None
