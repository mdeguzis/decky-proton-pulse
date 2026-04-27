"""Installed compatibility-tool discovery and classification.

Scans ``compatibilitytools.d`` and ``steamapps/common`` to build the
list of Proton builds the frontend can show to the user.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .steam_paths import compat_tools_dirs, find_steam_root, read_vdf_value

PROTON_GE_LATEST_SLOT_NAME = "Proton-GE-Latest"


def _looks_like_proton_tool(*values: str | None) -> bool:
    """Quick sniff test: does any of these values look Proton-family?"""
    return any("proton" in (value or "").lower() for value in values)


def normalize_proton_ge_tag(version: str) -> str | None:
    """Try to coerce a version string into a ``GE-ProtonX-Y`` tag name.

    Returns ``None`` if the string doesn't look like GE-Proton at all.
    """
    cleaned = version.strip()
    if not cleaned:
        return None
    cleaned = cleaned.replace("_", "-")
    cleaned = re.sub(r"\s+", "", cleaned)

    if "ge" not in cleaned.lower():
        decky.logger.debug(
            f"_normalize_proton_ge_tag: '{version}'"
            " has no GE indicator, treating as Valve Proton"
        )
        return None

    match = re.search(r"GE-?Proton(\d+(?:-\d+)*)", cleaned, re.IGNORECASE)
    if not match:
        return None
    return f"GE-Proton{match.group(1)}"


def extract_version_parts(version: str) -> tuple[int, int] | None:
    """Pull ``(major, minor)`` out of a Proton version string."""
    match = re.search(r"(?:GE-?)?Proton(\d+)-(\d+)", version, re.IGNORECASE)
    if not match:
        match = re.search(r"(\d+)\.0-(\d+)", version)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)))


def installed_tool_matches_version(tool: dict[str, Any], version: str) -> bool:
    """Does this installed tool dict match a normalised GE-Proton tag?"""
    normalized = normalize_proton_ge_tag(version)
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


def is_proton_ge_tool(tool: dict[str, Any]) -> bool:
    """Does this tool dict look like a GE-Proton build?"""
    if tool.get("managed_slot") == "latest":
        return True
    fields = [
        tool.get("directory_name") or "",
        tool.get("display_name") or "",
        tool.get("internal_name") or "",
    ]
    return any("ge-proton" in field.lower() for field in fields)


def simplify_release(release: dict[str, Any]) -> dict[str, Any] | None:
    """Boil a GitHub release payload down to the fields the frontend needs.

    Skips drafts and prereleases.
    """
    if release.get("draft") or release.get("prerelease"):
        return None
    asset = next(
        (
            c
            for c in release.get("assets", [])
            if isinstance(c.get("name"), str)
            and c["name"].startswith("GE-Proton")
            and (c["name"].endswith(".tar.gz") or c["name"].endswith(".tar.xz"))
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
        "body": release.get("body") or None,
    }


def find_closest_installed_tool(
    installed: list[dict[str, Any]], normalized: str
) -> dict[str, Any] | None:
    """No exact version match?  Find the closest installed build instead."""
    target = extract_version_parts(normalized)
    if not target:
        return None
    best_tool: dict[str, Any] | None = None
    best_distance = float("inf")
    for tool in installed:
        for field in ("internal_name", "directory_name", "display_name"):
            parts = extract_version_parts(tool.get(field) or "")
            if parts:
                distance = abs(parts[0] - target[0]) * 1000 + abs(parts[1] - target[1])
                if distance < best_distance:
                    best_distance = distance
                    best_tool = tool
                break
    return best_tool


def list_installed_compatibility_tools(  # pylint: disable=too-many-locals
    latest_metadata: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Find every installed Proton build on this system.

    Checks ``compatibilitytools.d`` (custom tools) and
    ``steamapps/common`` (Valve's official builds).
    """
    tools: list[dict[str, Any]] = []
    seen_dirs: set[str] = set()

    for cd in compat_tools_dirs():
        for entry in sorted(cd.iterdir(), key=lambda p: p.name.lower()):
            if not entry.is_dir() or entry.name in seen_dirs:
                continue
            seen_dirs.add(entry.name)

            vdf_path = entry / "compatibilitytool.vdf"
            display_name = entry.name
            internal_name = entry.name

            if vdf_path.exists():
                try:
                    vdf_text = vdf_path.read_text()
                    display_name = (
                        read_vdf_value(vdf_text, "display_name") or display_name
                    )
                    internal_name = (
                        read_vdf_value(vdf_text, "internal_name") or internal_name
                    )
                except OSError as err:
                    decky.logger.warning(
                        f"Failed to read compatibilitytool.vdf for {entry.name}: {err}"
                    )

            if not _looks_like_proton_tool(entry.name, display_name, internal_name):
                continue

            tools.append(
                {
                    "directory_name": entry.name,
                    "display_name": display_name,
                    "internal_name": internal_name,
                    "path": str(entry),
                    "source": "custom",
                    "managed_slot": (
                        "latest"
                        if entry.name == PROTON_GE_LATEST_SLOT_NAME
                        or (
                            latest_metadata
                            and latest_metadata.get("directory_name") == entry.name
                        )
                        else (
                            "versioned"
                            if "ge-proton"
                            in (display_name + internal_name + entry.name).lower()
                            else None
                        )
                    ),
                    "latest_tag": (
                        latest_metadata.get("tag_name")
                        if latest_metadata
                        and (
                            entry.name == PROTON_GE_LATEST_SLOT_NAME
                            or latest_metadata.get("directory_name") == entry.name
                        )
                        else None
                    ),
                }
            )

    # Valve's official Proton builds live in steamapps/common
    detected_root = find_steam_root()
    steam_common_dirs = (
        [detected_root / "steamapps" / "common"] if detected_root else []
    )
    home = Path(decky.DECKY_USER_HOME)
    steam_common_dirs.extend(
        [
            home / ".steam" / "root" / "steamapps" / "common",
            home / ".steam" / "steam" / "steamapps" / "common",
            home / ".local" / "share" / "Steam" / "steamapps" / "common",
            home
            / ".var"
            / "app"
            / "com.valvesoftware.Steam"
            / "data"
            / "Steam"
            / "steamapps"
            / "common",
        ]
    )
    for common_dir in steam_common_dirs:
        if not common_dir.is_dir():
            continue
        for entry in sorted(common_dir.iterdir(), key=lambda p: p.name.lower()):
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
