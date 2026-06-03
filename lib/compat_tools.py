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
PROTON_CACHY_LATEST_SLOT_NAME = "Proton-CachyOS-Latest"

COMPAT_TOOL_CONFIGS: dict[str, dict[str, str]] = {
    "proton-ge": {
        "id": "proton-ge",
        "label": "Proton-GE",
        "api_url": (
            "https://api.github.com/repos/GloriousEggroll/proton-ge-custom"
            "/releases?per_page=30"
        ),
        "asset_prefix": "GE-Proton",
        "asset_arch": "",
        "latest_slot_name": PROTON_GE_LATEST_SLOT_NAME,
        "cache_file": "proton-ge-releases-cache.json",
        "metadata_file": "proton-ge-latest.json",
    },
    "proton-cachyos": {
        "id": "proton-cachyos",
        "label": "Proton-CachyOS",
        "api_url": (
            "https://api.github.com/repos/CachyOS/proton-cachyos"
            "/releases?per_page=30"
        ),
        "asset_prefix": "proton-cachyos",
        "asset_arch": "x86_64",
        "latest_slot_name": PROTON_CACHY_LATEST_SLOT_NAME,
        "cache_file": "proton-cachyos-releases-cache.json",
        "metadata_file": "proton-cachyos-latest.json",
    },
}


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


def normalize_tag_for_tool(tool_id: str, version: str) -> str | None:
    """Normalize a version string for the given tool.

    For Proton-GE, coerces to the canonical GE-ProtonX-Y format.
    For other tools, returns the stripped version as-is.
    """
    if tool_id == "proton-ge":
        return normalize_proton_ge_tag(version)
    cleaned = version.strip()
    return cleaned if cleaned else None


def matches_release_tag(tool: dict[str, Any], tag: str) -> bool:
    """Does this installed tool appear to match the given release tag?"""
    tag_lower = tag.lower()
    return any(
        tag_lower in (tool.get(f) or "").lower()
        for f in ("directory_name", "display_name", "internal_name")
    )


def _detect_tool_id_from_names(
    entry_name: str, display_name: str, internal_name: str
) -> str | None:
    """Infer which compat tool config this installed directory belongs to."""
    for tid, config in COMPAT_TOOL_CONFIGS.items():
        if entry_name == config["latest_slot_name"]:
            return tid
    all_names = (entry_name + display_name + internal_name).lower()
    for tid, config in COMPAT_TOOL_CONFIGS.items():
        if config["asset_prefix"].lower() in all_names:
            return tid
    return None


def simplify_release(
    release: dict[str, Any],
    asset_prefix: str = "GE-Proton",
    asset_arch: str = "",
) -> dict[str, Any] | None:
    """Boil a GitHub release payload down to the fields the frontend needs.

    Skips drafts and prereleases. asset_arch filters by architecture suffix
    (e.g. "x86_64" matches "-x86_64.tar." but not "-x86_64_v3.tar.").
    """
    if release.get("draft") or release.get("prerelease"):
        return None
    asset = next(
        (
            c
            for c in release.get("assets", [])
            if isinstance(c.get("name"), str)
            and c["name"].lower().startswith(asset_prefix.lower())
            and (c["name"].endswith(".tar.gz") or c["name"].endswith(".tar.xz"))
            and (not asset_arch or f"-{asset_arch}.tar." in c["name"])
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


def list_installed_compatibility_tools(  # pylint: disable=too-many-locals,too-many-branches
    latest_metadata: dict[str, Any] | None = None,
    all_latest_metadata: dict[str, dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    """Find every installed Proton build on this system.

    Checks ``compatibilitytools.d`` (custom tools) and
    ``steamapps/common`` (Valve's official builds).
    """
    effective_meta: dict[str, dict[str, Any] | None] = (
        all_latest_metadata
        or ({"proton-ge": latest_metadata} if latest_metadata is not None else {})
    )
    known_latest_slots: dict[str, str] = {
        cfg["latest_slot_name"]: tid
        for tid, cfg in COMPAT_TOOL_CONFIGS.items()
    }

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

            detected_tool_id = _detect_tool_id_from_names(
                entry.name, display_name, internal_name
            )
            is_latest_slot = (
                entry.name in known_latest_slots
                or any(
                    meta is not None and meta.get("directory_name") == entry.name
                    for meta in effective_meta.values()
                )
            )
            managed_slot: str | None = (
                "latest" if is_latest_slot
                else "versioned" if detected_tool_id is not None
                else None
            )
            latest_tag: str | None = None
            for tid, meta in effective_meta.items():
                if meta and (
                    meta.get("directory_name") == entry.name
                    or entry.name == COMPAT_TOOL_CONFIGS.get(tid, {}).get("latest_slot_name")
                ):
                    latest_tag = meta.get("tag_name") or None
                    break

            tools.append(
                {
                    "directory_name": entry.name,
                    "display_name": display_name,
                    "internal_name": internal_name,
                    "path": str(entry),
                    "source": "custom",
                    "tool_id": detected_tool_id,
                    "managed_slot": managed_slot,
                    "latest_tag": latest_tag,
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
