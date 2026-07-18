"""Installed compatibility-tool discovery and classification.

Scans ``compatibilitytools.d`` and ``steamapps/common`` to build the
list of Proton builds the frontend can show to the user.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .steam_paths import compat_tools_dir, compat_tools_dirs, find_steam_root, read_vdf_value

PROTON_GE_LATEST_SLOT_NAME = "Proton-GE-Latest"
PROTON_CACHY_LATEST_SLOT_NAME = "Proton-CachyOS-Latest"

# Internal_name field written into the slot's compatibilitytool.vdf. Steam
# uses this as the tool's unique ID (the top-level key inside compat_tools).
# It MUST differ from any versioned build's internal_name so Steam does not
# conflate the two -- pick something no upstream tag would ever produce.
PROTON_GE_LATEST_INTERNAL_NAME = "proton_ge_latest"
PROTON_CACHY_LATEST_INTERNAL_NAME = "proton_cachyos_latest"

# Marker file we drop inside a rolling-slot directory so we can distinguish
# "a real user install that happens to be named Proton-GE-Latest" from "a
# rolling slot we manage". Content is the absolute path of the current
# target, so _slot_is_current is a one-line comparison rather than a
# symlink resolve dance.
_MANAGED_MARKER = ".proton-pulse-managed"

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
        "latest_slot_internal_name": PROTON_GE_LATEST_INTERNAL_NAME,
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
        "latest_slot_internal_name": PROTON_CACHY_LATEST_INTERNAL_NAME,
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


# Asset names we should NEVER pick on an x86_64 host, regardless of
# ordering in the assets array. GE-Proton started publishing aarch64
# builds; without this guard they'd shadow the x86_64 asset when they
# happen to be listed first (#117). Case-insensitive substring match.
_WRONG_ARCH_KEYWORDS_ON_X86 = ("aarch64", "arm64")


def _host_is_x86_64() -> bool:
    """Cached lookup so the check is not billed per-release-per-run.

    Steam Deck is always x86_64 so this returns True in practice; falls back
    to True on any exception so we never accidentally allow an aarch64 pick
    on a machine we could not identify.
    """
    try:
        import platform as _platform
        machine = _platform.machine().lower()
        return machine in {"x86_64", "amd64"}
    except Exception:  # pragma: no cover - defensive
        return True


def simplify_release(
    release: dict[str, Any],
    asset_prefix: str = "GE-Proton",
    asset_arch: str = "",
) -> dict[str, Any] | None:
    """Boil a GitHub release payload down to the fields the frontend needs.

    Skips drafts and prereleases. asset_arch filters by architecture suffix
    (e.g. "x86_64" matches "-x86_64.tar." but not "-x86_64_v3.tar.").

    On x86_64 hosts, aarch64 / arm64 assets are excluded from consideration
    even when asset_arch is unset -- see #117 for the Proton-GE bug where
    an aarch64 release asset was picked on a Steam Deck.
    """
    if release.get("draft") or release.get("prerelease"):
        return None
    host_is_x86 = _host_is_x86_64()
    asset = next(
        (
            c
            for c in release.get("assets", [])
            if isinstance(c.get("name"), str)
            and c["name"].lower().startswith(asset_prefix.lower())
            and (c["name"].endswith(".tar.gz") or c["name"].endswith(".tar.xz"))
            and (not asset_arch or f"-{asset_arch}.tar." in c["name"])
            and not (host_is_x86 and any(k in c["name"].lower() for k in _WRONG_ARCH_KEYWORDS_ON_X86))
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

            # For rolling slots (managed_slot='latest'), read the
            # .proton-pulse-managed marker to expose the underlying
            # versioned build as `current_target_name`. Frontend uses this
            # as the row subtitle so the user sees "Proton-GE-Latest"
            # (header) with "GE-Proton11-1" (currently active version)
            # underneath -- same shape Steam's own Proton Experimental UI
            # has when it shows the tool name plus a build subtitle.
            current_target_name: str | None = None
            if managed_slot == "latest":
                marker = entry / ".proton-pulse-managed"
                if marker.is_file():
                    try:
                        raw = marker.read_text(encoding="utf-8").strip()
                        if raw:
                            current_target_name = Path(raw).name
                    except OSError:
                        current_target_name = None

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
                    "current_target_name": current_target_name,
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


# ---------------------------------------------------------------------------
# Rolling latest-slot management (#116)
# ---------------------------------------------------------------------------
#
# The idea: mirror Steam's "Proton - Experimental" pattern where a stable
# label always points at the current build. For our tools that means a
# `Proton-GE-Latest/` directory (or symlink) inside compatibilitytools.d that
# Steam's compat picker sees as a first-class option regardless of which
# specific GE-Proton or CachyOS release is actually installed underneath.
#
# We prefer a symlink because it's zero-copy: pointing the label at the
# newest installed versioned tool means every install picks up automatically
# for free, no disk duplication. Steam follows symlinks in
# compatibilitytools.d so this works.


def _slot_marker_path(slot_path: Path) -> Path:
    return slot_path / _MANAGED_MARKER


def _slot_is_managed(slot_path: Path) -> bool:
    """Was this slot directory created by ensure_rolling_slot?

    Detected via the marker file we drop at write time. This is what lets us
    safely replace the slot's contents without wondering whether the user
    happened to name their own custom install "Proton-GE-Latest".
    """
    if not slot_path.is_dir() or slot_path.is_symlink():
        return False
    return _slot_marker_path(slot_path).is_file()


def _slot_current_target(slot_path: Path) -> Path | None:
    """Absolute target path the slot currently points at, or None if we cannot
    tell. Reads it from the marker file we wrote at last refresh -- avoids
    ambiguity from broken/dangling symlinks inside the slot.
    """
    marker = _slot_marker_path(slot_path)
    if not marker.is_file():
        return None
    try:
        raw = marker.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return Path(raw) if raw else None


def _slot_is_current(slot_path: Path, target_path: Path) -> bool:
    """Does the managed slot already have symlinks pointing at target?"""
    if not _slot_is_managed(slot_path):
        return False
    current = _slot_current_target(slot_path)
    if current is None:
        return False
    try:
        return current.resolve() == target_path.resolve()
    except OSError:
        return False


def _slot_vdf_content(display_name: str, internal_name: str) -> str:
    """VDF template matches GloriousEggroll/proton-ge-custom's
    compatibilitytool.vdf.template so Steam parses it the same way it parses
    every other GE install. `install_path "."` means "look for the tool
    binaries in this same directory" -- our per-file symlinks satisfy that.

    Fields:
      internal_name -- the top-level compat_tools key, Steam's tool id.
                       Must differ from any versioned build's internal_name
                       so Steam does not conflate the two.
      display_name  -- the label Steam shows in the compat properties picker.
    """
    return (
        '"compatibilitytools"\n'
        '{\n'
        '  "compat_tools"\n'
        '  {\n'
        f'    "{internal_name}"\n'
        '    {\n'
        '      "install_path" "."\n'
        f'      "display_name" "{display_name}"\n'
        '      "from_oslist"  "windows"\n'
        '      "to_oslist"    "linux"\n'
        '    }\n'
        '  }\n'
        '}\n'
    )


def _clear_slot_contents(slot_path: Path) -> None:
    """Remove every entry in the slot dir except the marker. Called before
    populating with a fresh set of symlinks so a target rename cannot leave
    stale symlinks hanging around.
    """
    marker_name = _MANAGED_MARKER
    for child in slot_path.iterdir():
        if child.name == marker_name:
            continue
        try:
            if child.is_symlink() or child.is_file():
                child.unlink()
            elif child.is_dir():
                # Anything at slot-level that is a real dir is unexpected
                # in a managed slot (we only ever create symlinks). Skip
                # rather than recursively delete -- refuse to nuke unknown
                # user data even if the marker file is present.
                decky.logger.warning(
                    f"_clear_slot_contents: unexpected real dir at {child},"
                    " leaving untouched"
                )
        except OSError as err:
            decky.logger.warning(f"_clear_slot_contents: could not remove {child}: {err}")


def _populate_slot_symlinks(slot_path: Path, target_path: Path) -> None:
    """Symlink every top-level entry of target_path into slot_path, except the
    compatibilitytool.vdf (we own that file's contents).

    Uses absolute-path symlinks so a later `mv` of the target directory does
    not silently break the slot. Steam follows these symlinks transparently.
    """
    for child in target_path.iterdir():
        if child.name == "compatibilitytool.vdf":
            continue
        link_path = slot_path / child.name
        try:
            link_path.symlink_to(child.resolve())
        except OSError as err:
            decky.logger.warning(
                f"_populate_slot_symlinks: could not symlink {child.name}: {err}"
            )


def _migrate_slot_dir_to_versioned_name(slot_path: Path, slot_name: str) -> Path | None:
    """If slot_path is an unmanaged real directory that contains a full versioned
    Proton install (a compatibilitytool.vdf with display_name != slot_name),
    rename the slot directory to that versioned display_name so a proper
    managed slot can be built on top.

    Why this exists: older plugin versions (and a few manual installs) ran the
    Proton tarball extract with `install_as_latest=True` + `destination_name=
    <slot>`, which dropped the whole versioned tool INSIDE the slot directory
    itself. Steam then read the versioned compatibilitytool.vdf and labelled
    the slot with the version tag (e.g. "proton-cachyos-11.0-20260702-slr-x86_64")
    instead of the friendly "Proton-CachyOS-Latest". _versioned_tools_for
    filters out directories that share a slot name, so the tool ended up
    invisible to ensure_rolling_slot -> "no-source" -> no slot ever got built.

    Renaming the directory to its VDF's display_name unhides it (now a normal
    versioned tool the plugin can see) and frees the slot name for the
    managed-slot rebuild below to claim.

    Returns the new (versioned) path on successful migration, or None if
    migration did not apply (caller should proceed with the normal
    refuse-if-unmanaged path).
    """
    vdf_path = slot_path / "compatibilitytool.vdf"
    if not vdf_path.is_file():
        return None
    try:
        vdf_text = vdf_path.read_text(encoding="utf-8")
    except OSError:
        return None
    versioned_name = (read_vdf_value(vdf_text, "display_name") or "").strip()
    # No display_name, or it already matches the slot: refuse migration
    # (the second case would be a previously-managed slot whose marker got
    # deleted -- normal ensure code handles that).
    if not versioned_name or versioned_name == slot_name:
        return None
    # Sanitize: refuse anything that could escape compatibilitytools.d.
    if ("/" in versioned_name or "\\" in versioned_name
            or ".." in versioned_name or versioned_name.startswith(".")):
        decky.logger.warning(
            f"_migrate_slot_dir_to_versioned_name: unsafe VDF display_name "
            f"{versioned_name!r} in {slot_path}; refusing to rename"
        )
        return None
    versioned_dir = slot_path.parent / versioned_name
    if versioned_dir.exists():
        decky.logger.warning(
            f"_migrate_slot_dir_to_versioned_name: {versioned_dir} already "
            f"exists; refusing to rename {slot_path} on top of it"
        )
        return None
    try:
        slot_path.rename(versioned_dir)
    except OSError as err:
        decky.logger.warning(
            f"_migrate_slot_dir_to_versioned_name: rename {slot_path} -> "
            f"{versioned_dir} failed: {err}"
        )
        return None
    decky.logger.info(
        f"Rolling slot migration: renamed unmanaged {slot_path.name} -> "
        f"{versioned_name}; rolling slot will now be rebuilt on top"
    )
    return versioned_dir


def _versioned_tools_for(tool_id: str) -> list[dict[str, Any]]:
    """Installed custom tools that belong to a specific slot family (proton-ge / cachyos)
    and are NOT themselves the rolling slot. Sorted newest-first by version tag.
    """
    all_tools = list_installed_compatibility_tools()
    slot_names = {cfg["latest_slot_name"] for cfg in COMPAT_TOOL_CONFIGS.values()}
    matching = []
    for tool in all_tools:
        if tool.get("tool_id") != tool_id:
            continue
        if tool.get("directory_name") in slot_names:
            continue
        matching.append(tool)

    def _rank(tool: dict[str, Any]) -> tuple[int, int, str]:
        parts = extract_version_parts(str(tool.get("directory_name") or ""))
        if parts:
            return (parts[0], parts[1], "")
        # Fall back to display name so at least alphabetical tie-breaks work.
        return (-1, -1, str(tool.get("display_name") or "").lower())

    matching.sort(key=_rank, reverse=True)
    return matching


def ensure_rolling_slot(tool_id: str) -> dict[str, Any]:
    """Point the tool's latest-slot at the newest installed versioned build.

    The slot is a REAL directory (not a whole-dir symlink) that contains:

      - a hand-written compatibilitytool.vdf whose display_name matches the
        slot name (e.g. "Proton-GE-Latest") and whose internal_name is a
        unique key Steam does not confuse with any versioned build,
      - a marker file recording the current target path (so is-current
        checks are trivial and safe across restarts),
      - one symlink per top-level entry of the target dir (proton, dist,
        files, toolmanifest.vdf, ...), pointing at the absolute target path.

    Why not just a whole-dir symlink to the versioned build? Steam reads the
    versioned build's compatibilitytool.vdf through the symlink and sees
    display_name="GE-Proton10-19", so the compat picker labels our slot
    with the version tag instead of the friendly "Proton-GE-Latest". This
    layout matches how Valve's Proton Experimental is structured: a real
    dir with its own VDF whose display_name is the stable label.

    Behavior:
      - No versioned build installed: no-op, returns {ok: False, reason: "no-source"}.
      - Slot exists as a symlink (legacy layout): migrate to new layout.
      - Slot exists as a real dir with the managed marker: refresh symlinks + marker.
      - Slot exists as a real dir WITHOUT the managed marker AND contains a
        full versioned Proton install (older install_as_latest=True pattern):
        auto-rename the slot dir to its VDF display_name so the tool becomes
        visible as a normal versioned candidate, then rebuild a managed slot
        on top.
      - Slot exists as a real dir WITHOUT the managed marker AND does NOT
        look like a full Proton install: refuse -- it belongs to the user.
      - Slot already points at target with the managed marker present:
        {ok: True, changed: False}.
      - Otherwise: rebuild slot contents, return {ok: True, changed: True}.

    Returns a dict so callers can log the outcome per tool.
    """
    config = COMPAT_TOOL_CONFIGS.get(tool_id)
    if not config:
        return {"ok": False, "reason": "unknown-tool"}
    slot_name = config["latest_slot_name"]
    internal_name = config.get("latest_slot_internal_name", slot_name.lower().replace("-", "_"))
    slot_path = compat_tools_dir() / slot_name

    # Auto-migration for a slot that holds a versioned Proton install directly
    # (older install_as_latest=True + destination_name=<slot> pattern).
    # Renaming it to its VDF display_name unhides the tool for
    # _versioned_tools_for below and lets ensure_rolling_slot rebuild a
    # proper managed slot on top. Migration is a no-op when the slot is a
    # symlink, managed, or absent -- normal control flow handles those.
    if (slot_path.is_dir() and not slot_path.is_symlink()
            and not _slot_is_managed(slot_path)):
        _migrate_slot_dir_to_versioned_name(slot_path, slot_name)

    candidates = _versioned_tools_for(tool_id)
    if not candidates:
        return {"ok": False, "reason": "no-source"}
    target_path = Path(str(candidates[0]["path"])).resolve()

    # Verify the target tool actually has the files Steam needs, BEFORE we
    # touch anything on disk. Steam looks for compatibilitytool.vdf (or the
    # runtime-only toolmanifest.vdf) to boot the tool. A missing manifest
    # means the download or install got interrupted -- do not build a
    # rolling slot around a broken target.
    manifest = target_path / "compatibilitytool.vdf"
    tool_manifest = target_path / "toolmanifest.vdf"
    if not manifest.exists() and not tool_manifest.exists():
        return {
            "ok": False,
            "reason": "target-missing-manifest",
            "target": str(target_path),
        }

    # Legacy migration: an older plugin version created the slot as a
    # whole-dir symlink to the target. That produces the exact display-name
    # problem this refactor is fixing. Remove the symlink so the code below
    # can rebuild the slot as a proper managed directory.
    if slot_path.is_symlink():
        try:
            slot_path.unlink()
        except OSError as err:
            return {"ok": False, "reason": "symlink-remove-failed", "error": str(err)}

    # Real dir without our marker? The user (or an earlier install run with
    # install_as_latest=True + destination_name=<slot>) owns it. Refuse.
    if slot_path.exists() and not _slot_is_managed(slot_path):
        return {
            "ok": False,
            "reason": "slot-is-real-dir",
            "slot": str(slot_path),
        }

    if _slot_is_current(slot_path, target_path):
        return {"ok": True, "changed": False, "target": str(target_path), "slot": str(slot_path)}

    # Rebuild the slot contents to point at the new target.
    try:
        slot_path.mkdir(parents=True, exist_ok=True)
        _clear_slot_contents(slot_path)
        (slot_path / "compatibilitytool.vdf").write_text(
            _slot_vdf_content(slot_name, internal_name),
            encoding="utf-8",
        )
        _populate_slot_symlinks(slot_path, target_path)
        # Marker is written LAST so a mid-update crash leaves the slot in a
        # detectably-broken state (no marker => not-current on next run,
        # which triggers a full rebuild) rather than a stale-marker state
        # that would silently claim to be up to date.
        _slot_marker_path(slot_path).write_text(str(target_path), encoding="utf-8")
    except OSError as err:
        return {"ok": False, "reason": "rebuild-failed", "error": str(err)}

    return {"ok": True, "changed": True, "target": str(target_path), "slot": str(slot_path)}


def ensure_all_rolling_slots() -> dict[str, dict[str, Any]]:
    """Refresh every configured rolling slot. Returns the per-tool outcome dict.

    Safe to call on every plugin startup: no-op when nothing changed, no
    network work, cheap disk stat only.
    """
    out: dict[str, dict[str, Any]] = {}
    for tool_id in COMPAT_TOOL_CONFIGS.keys():
        try:
            out[tool_id] = ensure_rolling_slot(tool_id)
        except Exception as err:  # pylint: disable=broad-except
            out[tool_id] = {"ok": False, "reason": "exception", "error": str(err)}
    return out
