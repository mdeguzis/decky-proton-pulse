"""Which games use which compat tool, and pruning of unused old builds (#133).

Steam records each game's chosen compat tool in ``config/config.vdf`` under
``InstallConfigStore > Software > Valve > Steam > CompatToolMapping``:

    "CompatToolMapping"
    {
        "257510" { "name" "GE-Proton8-30"  "config" ""  "priority" "250" }
        "0"      { "name" "proton_experimental" ... }
    }

Keys are app ids (non-Steam shortcuts use their 32-bit shortcut id). The
value ``name`` is the tool's ``internal_name`` from its compatibilitytool.vdf
for custom tools, or Valve's short name (``proton_9``, ``proton_experimental``)
for official builds. App id ``"0"`` is the Steam Play default for every title
without its own mapping. Entries for uninstalled games and removed tools are
left behind by Steam, so the mapping is a superset of what is really in use;
that makes it safe (conservative) for deciding what NOT to delete.

Steam writes config.vdf when settings change, not on every in-memory change,
so a game switched to a tool moments ago may not be reflected yet.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .steam_paths import compat_tools_dirs, find_steam_root

STEAM_DEFAULT_APP_ID = "0"

_TOKEN_RE = re.compile(r'"((?:[^"\\]|\\.)*)"|([{}])')


def _tokenize(text: str) -> list[str]:
    """Split text VDF into quoted strings and brace tokens ("{" / "}")."""
    tokens: list[str] = []
    for m in _TOKEN_RE.finditer(text):
        if m.group(2):
            tokens.append(m.group(2))
        else:
            tokens.append(m.group(1).replace('\\"', '"').replace("\\\\", "\\"))
    return tokens


def parse_compat_tool_mapping(text: str) -> dict[str, str]:
    """Return {app_id: tool_name} from config.vdf text.

    An empty dict means config.vdf has no CompatToolMapping block (nobody has
    picked a tool yet), which is a real state, not an error.
    """
    tokens = _tokenize(text)
    try:
        start = next(
            i for i, tok in enumerate(tokens)
            if tok.lower() == "compattoolmapping" and i + 1 < len(tokens) and tokens[i + 1] == "{"
        )
    except StopIteration:
        return {}

    mapping: dict[str, str] = {}
    i = start + 2
    while i < len(tokens) and tokens[i] != "}":
        app_id = tokens[i]
        if i + 1 >= len(tokens) or tokens[i + 1] != "{":
            # Malformed: a bare value where an entry block was expected.
            raise ValueError(f"CompatToolMapping: expected block after {app_id!r}")
        i += 2
        name = ""
        while i < len(tokens) and tokens[i] != "}":
            key = tokens[i]
            if key == "{":
                raise ValueError(f"CompatToolMapping: unexpected nested block in {app_id!r}")
            value = tokens[i + 1] if i + 1 < len(tokens) else ""
            if key.lower() == "name":
                name = value
            i += 2
        i += 1  # closing brace of this entry
        if name:
            mapping[app_id] = name
    return mapping


def config_vdf_path() -> Path:
    """Path to Steam's config.vdf. Raises FileNotFoundError if Steam is not found."""
    root = find_steam_root()
    if root is None:
        raise FileNotFoundError("Steam root not found, cannot read config.vdf")
    return root / "config" / "config.vdf"


def read_compat_tool_mapping() -> dict[str, str]:
    """Read and parse CompatToolMapping. Raises OSError / ValueError on failure.

    Callers that delete anything must let these propagate (or treat them as
    "usage unknown"), never as "no game uses anything".
    """
    path = config_vdf_path()
    mapping = parse_compat_tool_mapping(path.read_text(encoding="utf-8", errors="replace"))
    decky.logger.debug(
        "read_compat_tool_mapping: %d mapped apps from %s (default=%r)",
        len(mapping), path, mapping.get(STEAM_DEFAULT_APP_ID),
    )
    return mapping


_VALVE_VERSION_RE = re.compile(r"^proton\s+(\d+)\.(\d+)")


def valve_mapping_name(directory_name: str) -> str | None:
    """Best-effort Valve short name for an official Proton directory.

    "Proton - Experimental" -> proton_experimental, "Proton Hotfix" ->
    proton_hotfix, "Proton 9.0 (Beta)" -> proton_9, "Proton 6.3" -> proton_63,
    "Proton 5.13" -> proton_513. These follow the names Steam writes into
    CompatToolMapping; returns None when the directory does not fit.
    """
    lower = directory_name.strip().lower()
    if "experimental" in lower:
        return "proton_experimental"
    if "hotfix" in lower:
        return "proton_hotfix"
    m = _VALVE_VERSION_RE.match(lower)
    if not m:
        return None
    major, minor = m.group(1), m.group(2)
    return f"proton_{major}" if minor == "0" else f"proton_{major}{minor}"


def tool_mapping_names(tool: dict[str, Any]) -> set[str]:
    """Every name a CompatToolMapping entry could use to refer to this tool."""
    names = {
        str(tool.get(field) or "").strip()
        for field in ("internal_name", "directory_name")
    }
    if tool.get("source") == "valve":
        valve_name = valve_mapping_name(str(tool.get("directory_name") or ""))
        if valve_name:
            names.add(valve_name)
    return {n for n in names if n}


def usage_for_tool(tool: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    """Return {"used_by_app_ids": [...], "is_steam_default": bool} for one tool."""
    names = {n.lower() for n in tool_mapping_names(tool)}
    app_ids = sorted(
        (app_id for app_id, name in mapping.items()
         if app_id != STEAM_DEFAULT_APP_ID and name.lower() in names),
        key=lambda a: (len(a), a),
    )
    default_name = mapping.get(STEAM_DEFAULT_APP_ID, "")
    return {
        "used_by_app_ids": app_ids,
        "is_steam_default": bool(default_name) and default_name.lower() in names,
    }


def annotate_tool_usage(tools: list[dict[str, Any]]) -> bool:
    """Add used_by_app_ids / is_steam_default to each tool in place.

    Returns True when usage was read. On failure every tool gets
    used_by_app_ids=None (unknown, distinct from [] = unused) and the
    failure is logged, so the UI can hide counts instead of showing zero.
    """
    try:
        mapping = read_compat_tool_mapping()
    except (OSError, ValueError) as err:
        decky.logger.warning(
            "annotate_tool_usage: compat usage unavailable | error=%s: %s",
            type(err).__name__, err,
        )
        for tool in tools:
            tool["used_by_app_ids"] = None
            tool["is_steam_default"] = False
        return False
    for tool in tools:
        tool.update(usage_for_tool(tool, mapping))
    decky.logger.debug(
        "annotate_tool_usage: %d tools, in use=%s",
        len(tools),
        {t.get("directory_name"): len(t["used_by_app_ids"]) for t in tools if t["used_by_app_ids"]},
    )
    return True


def select_prunable_versions(
    versioned_newest_first: list[dict[str, Any]],
    mapping: dict[str, str],
    keep_dirs: set[str],
) -> list[dict[str, Any]]:
    """Pick old versioned builds of one tool family that no game is mapped to.

    ``versioned_newest_first`` is _versioned_tools_for(tool_id): the family's
    builds without the rolling slot, newest first. The newest build is always
    kept (the rolling slot points at it, so every game mapped to the slot
    runs on it), as is anything in keep_dirs, anything not managed as a
    versioned build, anything a game maps to, and the Steam Play default.
    """
    prunable: list[dict[str, Any]] = []
    for index, tool in enumerate(versioned_newest_first):
        directory = str(tool.get("directory_name") or "")
        if index == 0 or directory in keep_dirs:
            continue
        if tool.get("source") != "custom" or tool.get("managed_slot") != "versioned":
            continue
        usage = usage_for_tool(tool, mapping)
        if usage["used_by_app_ids"] or usage["is_steam_default"]:
            continue
        prunable.append(tool)
    return prunable


def _remove_tool_dir(tool: dict[str, Any]) -> None:
    """Delete one custom tool directory. Raises OSError / ValueError.

    Same guards as the manual uninstall: must be a real directory sitting
    directly inside a compatibilitytools.d root, never a symlink.
    """
    path = Path(str(tool.get("path") or ""))
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"{path} is not a real directory")
    resolved = path.resolve()
    allowed = {d.resolve() for d in compat_tools_dirs()}
    if resolved.parent not in allowed:
        raise ValueError(f"{resolved} is outside compatibilitytools.d")
    shutil.rmtree(resolved)


def prune_unused_versions(
    tool_id: str,
    versioned_newest_first: list[dict[str, Any]],
    keep_dirs: set[str],
) -> dict[str, Any]:
    """Remove old builds of tool_id no game uses. Never raises on read failure.

    Returns {"ok": bool, "removed": [dir...], "failed": {dir: error},
    "reason"?: str}. When config.vdf cannot be read nothing is removed and
    ok is False with reason "usage-unavailable".
    """
    try:
        mapping = read_compat_tool_mapping()
    except (OSError, ValueError) as err:
        decky.logger.warning(
            "prune_unused_versions: skipped, usage unavailable | tool_id=%s error=%s: %s",
            tool_id, type(err).__name__, err,
        )
        return {"ok": False, "reason": "usage-unavailable", "removed": [], "failed": {}}

    candidates = select_prunable_versions(versioned_newest_first, mapping, keep_dirs)
    removed: list[str] = []
    failed: dict[str, str] = {}
    for tool in candidates:
        directory = str(tool.get("directory_name"))
        try:
            _remove_tool_dir(tool)
            removed.append(directory)
        except (OSError, ValueError) as err:
            failed[directory] = f"{type(err).__name__}: {err}"
    decky.logger.info(
        "prune_unused_versions | tool_id=%s kept_newest=%s removed=%s failed=%s",
        tool_id,
        versioned_newest_first[0].get("directory_name") if versioned_newest_first else None,
        removed, failed,
    )
    return {"ok": not failed, "removed": removed, "failed": failed}
