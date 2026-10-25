"""Tests for compat tool usage + pruning of unused old builds (#133)."""
from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from lib import compat_usage
from lib.compat_usage import (
    annotate_tool_usage,
    parse_compat_tool_mapping,
    prune_unused_versions,
    select_prunable_versions,
    usage_for_tool,
    valve_mapping_name,
)

# Shape copied from a real SteamOS config.vdf (tabs, nested Software tree).
CONFIG_VDF = """
"InstallConfigStore"
{
\t"Software"
\t{
\t\t"Valve"
\t\t{
\t\t\t"Steam"
\t\t\t{
\t\t\t\t"CompatToolMapping"
\t\t\t\t{
\t\t\t\t\t"1684930"
\t\t\t\t\t{
\t\t\t\t\t\t"name"\t\t"proton_experimental"
\t\t\t\t\t\t"config"\t\t""
\t\t\t\t\t\t"priority"\t\t"250"
\t\t\t\t\t}
\t\t\t\t\t"257510"
\t\t\t\t\t{
\t\t\t\t\t\t"name"\t\t"GE-Proton11-5-x86_64"
\t\t\t\t\t\t"config"\t\t""
\t\t\t\t\t\t"priority"\t\t"250"
\t\t\t\t\t}
\t\t\t\t\t"4092442637"
\t\t\t\t\t{
\t\t\t\t\t\t"name"\t\t"proton_ge_latest"
\t\t\t\t\t\t"config"\t\t""
\t\t\t\t\t\t"priority"\t\t"250"
\t\t\t\t\t}
\t\t\t\t\t"32380"
\t\t\t\t\t{
\t\t\t\t\t\t"name"\t\t""
\t\t\t\t\t\t"config"\t\t""
\t\t\t\t\t\t"priority"\t\t"250"
\t\t\t\t\t}
\t\t\t\t\t"0"
\t\t\t\t\t{
\t\t\t\t\t\t"name"\t\t"proton_9"
\t\t\t\t\t\t"config"\t\t""
\t\t\t\t\t\t"priority"\t\t"75"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\t"SomethingElse"\t\t"1"
\t\t\t}
\t\t}
\t}
}
"""


def _tool(directory: str, *, internal: str | None = None, source: str = "custom",
          managed_slot: str | None = "versioned", tool_id: str | None = "proton-ge",
          path: str = "") -> dict[str, Any]:
    return {
        "directory_name": directory,
        "display_name": directory,
        "internal_name": internal or directory,
        "source": source,
        "managed_slot": managed_slot,
        "tool_id": tool_id,
        "path": path,
    }


# --- parse_compat_tool_mapping ---

def test_parse_real_config_shape() -> None:
    assert parse_compat_tool_mapping(CONFIG_VDF) == {
        "1684930": "proton_experimental",
        "257510": "GE-Proton11-5-x86_64",
        "4092442637": "proton_ge_latest",
        "0": "proton_9",
    }


def test_parse_skips_entries_with_empty_name() -> None:
    assert "32380" not in parse_compat_tool_mapping(CONFIG_VDF)


def test_parse_missing_block_is_empty_not_error() -> None:
    assert parse_compat_tool_mapping('"InstallConfigStore" { "Software" { } }') == {}


def test_parse_malformed_block_raises() -> None:
    with pytest.raises(ValueError):
        parse_compat_tool_mapping('"CompatToolMapping" { "257510" "oops" }')


# --- valve_mapping_name ---

@pytest.mark.parametrize("directory,expected", [
    ("Proton - Experimental", "proton_experimental"),
    ("Proton Hotfix", "proton_hotfix"),
    ("Proton 9.0 (Beta)", "proton_9"),
    ("Proton 8.0", "proton_8"),
    ("Proton 6.3", "proton_63"),
    ("Proton 5.13", "proton_513"),
    ("Proton EasyAntiCheat Runtime", None),
])
def test_valve_mapping_name(directory: str, expected: str | None) -> None:
    assert valve_mapping_name(directory) == expected


# --- usage_for_tool ---

def test_usage_matches_internal_name_case_insensitively() -> None:
    mapping = {"257510": "ge-proton11-5-x86_64", "601360": "GE-Proton11-5-x86_64"}
    usage = usage_for_tool(_tool("GE-Proton11-5-x86_64"), mapping)
    assert usage == {"used_by_app_ids": ["257510", "601360"], "is_steam_default": False}


def test_usage_excludes_default_key_but_flags_it() -> None:
    mapping = {"0": "GE-Proton11-3", "70": "GE-Proton11-3"}
    usage = usage_for_tool(_tool("GE-Proton11-3"), mapping)
    assert usage == {"used_by_app_ids": ["70"], "is_steam_default": True}


def test_usage_for_rolling_slot_uses_slot_internal_name() -> None:
    mapping = parse_compat_tool_mapping(CONFIG_VDF)
    slot = _tool("Proton-GE-Latest", internal="proton_ge_latest", managed_slot="latest")
    assert usage_for_tool(slot, mapping)["used_by_app_ids"] == ["4092442637"]


def test_usage_for_valve_tool_uses_short_name() -> None:
    mapping = parse_compat_tool_mapping(CONFIG_VDF)
    valve = _tool("Proton 9.0 (Beta)", source="valve", managed_slot=None, tool_id=None)
    assert usage_for_tool(valve, mapping) == {"used_by_app_ids": [], "is_steam_default": True}


def test_unused_tool_has_empty_list() -> None:
    assert usage_for_tool(_tool("GE-Proton11-6-x86_64"), {"1": "other"}) == {
        "used_by_app_ids": [], "is_steam_default": False,
    }


# --- annotate_tool_usage ---

def test_annotate_marks_usage_unknown_when_config_unreadable() -> None:
    tools = [_tool("GE-Proton11-6-x86_64")]
    with patch.object(compat_usage, "read_compat_tool_mapping", side_effect=OSError("gone")):
        assert annotate_tool_usage(tools) is False
    # None (unknown) must stay distinct from [] (unused) so the UI never
    # claims a tool is unused when we could not check.
    assert tools[0]["used_by_app_ids"] is None


def test_annotate_fills_usage() -> None:
    tools = [_tool("GE-Proton11-5-x86_64"), _tool("GE-Proton11-6-x86_64")]
    with patch.object(compat_usage, "read_compat_tool_mapping",
                      return_value=parse_compat_tool_mapping(CONFIG_VDF)):
        assert annotate_tool_usage(tools) is True
    assert tools[0]["used_by_app_ids"] == ["257510"]
    assert tools[1]["used_by_app_ids"] == []


def test_read_mapping_raises_without_steam_root() -> None:
    with patch.object(compat_usage, "find_steam_root", return_value=None):
        with pytest.raises(FileNotFoundError):
            compat_usage.read_compat_tool_mapping()


def _install_family(root: Path, marked: set[str] | None = None) -> list[dict[str, Any]]:
    """Create the family on disk; builds in `marked` (default: all) carry the
    latest-process marker."""
    family = []
    for t in _family():
        d = root / t["directory_name"]
        (d / "files").mkdir(parents=True)
        (d / "compatibilitytool.vdf").write_text("x")
        if marked is None or t["directory_name"] in marked:
            (d / compat_usage.LATEST_INSTALL_MARKER).write_text("{}")
        family.append({**t, "path": str(d)})
    return family


# --- select_prunable_versions ---

def _family() -> list[dict[str, Any]]:
    return [
        _tool("GE-Proton11-11-x86_64"),   # newest: slot target
        _tool("GE-Proton11-7-x86_64"),
        _tool("GE-Proton11-6-x86_64"),
        _tool("GE-Proton11-5-x86_64"),    # mapped by 257510
        _tool("GE-Proton11-3"),           # Steam default below
    ]


def test_select_prunes_only_unused_older_builds(tmp_path: Path) -> None:
    mapping = {"257510": "GE-Proton11-5-x86_64", "0": "GE-Proton11-3"}
    family = _install_family(tmp_path)
    names = [t["directory_name"] for t in select_prunable_versions(family, mapping, set())]
    assert names == ["GE-Proton11-7-x86_64", "GE-Proton11-6-x86_64"]


def test_select_skips_builds_not_installed_by_latest_process(tmp_path: Path) -> None:
    # Hand-installed builds (and ones from before the marker) never trim,
    # even when unused.
    family = _install_family(tmp_path, marked={"GE-Proton11-6-x86_64"})
    names = [t["directory_name"] for t in select_prunable_versions(family, {}, set())]
    assert names == ["GE-Proton11-6-x86_64"]


def test_select_never_prunes_newest_even_if_unmapped() -> None:
    names = [t["directory_name"] for t in select_prunable_versions(_family(), {}, set())]
    assert "GE-Proton11-11-x86_64" not in names


def test_select_respects_keep_dirs() -> None:
    names = [t["directory_name"] for t in
             select_prunable_versions(_family(), {}, {"GE-Proton11-7-x86_64"})]
    assert "GE-Proton11-7-x86_64" not in names


def test_select_skips_unmanaged_and_valve_tools() -> None:
    family = [
        _tool("GE-Proton11-11-x86_64"),
        _tool("GE-Proton-custom-build", managed_slot=None),
        _tool("Proton 9.0", source="valve"),
    ]
    assert select_prunable_versions(family, {}, set()) == []


# --- prune_unused_versions (real directories) ---

def test_prune_removes_unused_dirs_and_keeps_the_rest(tmp_path: Path) -> None:
    family = _install_family(tmp_path)
    mapping = {"257510": "GE-Proton11-5-x86_64", "0": "GE-Proton11-3"}
    with (
        patch.object(compat_usage, "read_compat_tool_mapping", return_value=mapping),
        patch.object(compat_usage, "compat_tools_dirs", return_value=[tmp_path]),
    ):
        outcome = prune_unused_versions("proton-ge", family, set())
    assert outcome == {"ok": True, "removed": ["GE-Proton11-7-x86_64", "GE-Proton11-6-x86_64"], "failed": {}}
    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == ["GE-Proton11-11-x86_64", "GE-Proton11-3", "GE-Proton11-5-x86_64"]


def test_prune_removes_nothing_when_usage_unreadable(tmp_path: Path) -> None:
    family = _install_family(tmp_path)
    with (
        patch.object(compat_usage, "read_compat_tool_mapping", side_effect=OSError("locked")),
        patch.object(compat_usage, "compat_tools_dirs", return_value=[tmp_path]),
    ):
        outcome = prune_unused_versions("proton-ge", family, set())
    assert outcome["ok"] is False
    assert outcome["reason"] == "usage-unavailable"
    assert len(list(tmp_path.iterdir())) == 5


def test_prune_refuses_dirs_outside_compat_root(tmp_path: Path) -> None:
    family = _install_family(tmp_path)
    with (
        patch.object(compat_usage, "read_compat_tool_mapping", return_value={}),
        patch.object(compat_usage, "compat_tools_dirs", return_value=[tmp_path / "elsewhere"]),
    ):
        outcome = prune_unused_versions("proton-ge", family, set())
    assert outcome["removed"] == []
    assert outcome["ok"] is False
    assert len(list(tmp_path.iterdir())) == 5


def test_prune_refuses_symlinked_tool_dir(tmp_path: Path) -> None:
    real = tmp_path / "real-build"
    real.mkdir()
    # Marked, so the build is a trim candidate and the symlink guard is what
    # has to stop it.
    (real / compat_usage.LATEST_INSTALL_MARKER).write_text("{}")
    link = tmp_path / "GE-Proton11-7-x86_64"
    link.symlink_to(real)
    family = [_tool("GE-Proton11-11-x86_64", path=str(tmp_path / "x")),
              _tool("GE-Proton11-7-x86_64", path=str(link))]
    with (
        patch.object(compat_usage, "read_compat_tool_mapping", return_value={}),
        patch.object(compat_usage, "compat_tools_dirs", return_value=[tmp_path]),
    ):
        outcome = prune_unused_versions("proton-ge", family, set())
    assert outcome["removed"] == []
    assert "GE-Proton11-7-x86_64" in outcome["failed"]
    assert real.is_dir() and link.is_symlink()


# --- internal name from the compat_tools block key ---

SLOT_VDF = '''"compatibilitytools"
{
  "compat_tools"
  {
    "proton_ge_latest"
    {
      "install_path" "."
      "display_name" "Proton-GE-Latest"
      "from_oslist" "windows"
      "to_oslist" "linux"
    }
  }
}
'''


def test_vdf_internal_name_is_the_block_key() -> None:
    assert compat_usage.vdf_internal_name(SLOT_VDF) == "proton_ge_latest"
    assert compat_usage.vdf_internal_name('"compatibilitytools" { }') is None


def test_rolling_slot_matches_games_through_vdf_internal_name(tmp_path: Path) -> None:
    # Regression: the slot directory is Proton-GE-Latest but Steam maps games
    # to proton_ge_latest, and the tool listing has no internal_name field to
    # read, so the slot showed "used by 0 games" on the Deck.
    slot_dir = tmp_path / "Proton-GE-Latest"
    slot_dir.mkdir()
    (slot_dir / "compatibilitytool.vdf").write_text(SLOT_VDF)
    slot = _tool("Proton-GE-Latest", internal="Proton-GE-Latest",
                 managed_slot="latest", path=str(slot_dir))
    mapping = {"21690": "proton_ge_latest", "1145350": "proton_ge_latest"}
    assert usage_for_tool(slot, mapping)["used_by_app_ids"] == ["21690", "1145350"]


def test_missing_vdf_falls_back_to_directory_name(tmp_path: Path) -> None:
    tool = _tool("GE-Proton11-7-x86_64", path=str(tmp_path / "nope"))
    assert usage_for_tool(tool, {"70": "GE-Proton11-7-x86_64"})["used_by_app_ids"] == ["70"]


def test_tool_vdf_internal_name_for_details(tmp_path: Path) -> None:
    slot_dir = tmp_path / "Proton-GE-Latest"
    slot_dir.mkdir()
    (slot_dir / "compatibilitytool.vdf").write_text(SLOT_VDF)
    assert compat_usage.tool_vdf_internal_name({"path": str(slot_dir), "source": "custom"}) == "proton_ge_latest"
    # Valve tools and tools without a manifest have no VDF name; the Info
    # modal then falls back to the listing's internal_name.
    assert compat_usage.tool_vdf_internal_name({"path": str(slot_dir), "source": "valve"}) is None
    assert compat_usage.tool_vdf_internal_name({"path": str(tmp_path / "nope"), "source": "custom"}) is None


# --- steam_tool_choices (#92) ---

def test_steam_tool_choices_use_names_specifycompattool_accepts(tmp_path: Path) -> None:
    slot_dir = tmp_path / "Proton-GE-Latest"
    slot_dir.mkdir()
    (slot_dir / "compatibilitytool.vdf").write_text(SLOT_VDF)
    tools = [
        _tool("Proton-GE-Latest", internal="Proton-GE-Latest", managed_slot="latest", path=str(slot_dir)),
        _tool("GE-Proton11-11-x86_64", path=str(tmp_path / "missing-vdf")),
        _tool("Proton 11.0", source="valve", managed_slot=None, tool_id=None),
        _tool("Proton - Experimental", source="valve", managed_slot=None, tool_id=None),
        _tool("Proton EasyAntiCheat Runtime", source="valve", managed_slot=None, tool_id=None),
    ]
    choices = {c["directory_name"]: c["tool_name"] for c in compat_usage.steam_tool_choices(tools)}
    # Verified on a Deck: the slot is proton_ge_latest, Valve 11.0 is proton_11.
    assert choices == {
        "Proton-GE-Latest": "proton_ge_latest",
        "GE-Proton11-11-x86_64": "GE-Proton11-11-x86_64",
        "Proton 11.0": "proton_11",
        "Proton - Experimental": "proton_experimental",
    }
