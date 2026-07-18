"""Tests for multi-tool compat tool support (Proton-GE + Proton-CachyOS)."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from lib.compat_tools import (
    COMPAT_TOOL_CONFIGS,
    PROTON_CACHY_LATEST_SLOT_NAME,
    PROTON_GE_LATEST_SLOT_NAME,
    _detect_tool_id_from_names,
    list_installed_compatibility_tools,
    matches_release_tag,
    normalize_tag_for_tool,
    simplify_release,
)


# ---------------------------------------------------------------------------
# COMPAT_TOOL_CONFIGS sanity checks
# ---------------------------------------------------------------------------

def test_configs_have_required_keys() -> None:
    required = {"id", "label", "api_url", "asset_prefix", "asset_arch", "latest_slot_name", "cache_file", "metadata_file"}
    for tool_id, config in COMPAT_TOOL_CONFIGS.items():
        missing = required - config.keys()
        assert not missing, f"{tool_id} config missing keys: {missing}"


def test_proton_ge_config_values() -> None:
    cfg = COMPAT_TOOL_CONFIGS["proton-ge"]
    assert cfg["latest_slot_name"] == PROTON_GE_LATEST_SLOT_NAME
    assert cfg["asset_prefix"] == "GE-Proton"
    assert cfg["asset_arch"] == ""
    assert "GloriousEggroll" in cfg["api_url"]


def test_proton_cachyos_config_values() -> None:
    cfg = COMPAT_TOOL_CONFIGS["proton-cachyos"]
    assert cfg["latest_slot_name"] == PROTON_CACHY_LATEST_SLOT_NAME
    assert cfg["asset_prefix"] == "proton-cachyos"
    assert cfg["asset_arch"] == "x86_64"
    assert "CachyOS" in cfg["api_url"]


# ---------------------------------------------------------------------------
# normalize_tag_for_tool
# ---------------------------------------------------------------------------

def test_normalize_tag_proton_ge_standard() -> None:
    assert normalize_tag_for_tool("proton-ge", "GE-Proton9-7") == "GE-Proton9-7"


def test_normalize_tag_proton_ge_needs_coercion() -> None:
    result = normalize_tag_for_tool("proton-ge", "ge-proton9-7")
    assert result == "GE-Proton9-7"


def test_normalize_tag_proton_ge_non_ge_returns_none() -> None:
    assert normalize_tag_for_tool("proton-ge", "9.0-1") is None


def test_normalize_tag_cachyos_passthrough() -> None:
    tag = "cachyos-11.0-20260521-slr"
    assert normalize_tag_for_tool("proton-cachyos", tag) == tag


def test_normalize_tag_cachyos_strips_whitespace() -> None:
    assert normalize_tag_for_tool("proton-cachyos", "  cachyos-11.0-20260521-slr  ") == "cachyos-11.0-20260521-slr"


def test_normalize_tag_cachyos_empty_returns_none() -> None:
    assert normalize_tag_for_tool("proton-cachyos", "   ") is None


# ---------------------------------------------------------------------------
# matches_release_tag
# ---------------------------------------------------------------------------

def test_matches_release_tag_by_directory_name() -> None:
    tool = {
        "directory_name": "proton-cachyos-11.0-20260521-slr",
        "display_name": "Proton-CachyOS",
        "internal_name": "proton-cachyos",
    }
    assert matches_release_tag(tool, "cachyos-11.0-20260521-slr")


def test_matches_release_tag_ge_by_directory() -> None:
    tool = {
        "directory_name": "GE-Proton9-7",
        "display_name": "GE-Proton",
        "internal_name": "GE-Proton9-7",
    }
    assert matches_release_tag(tool, "GE-Proton9-7")


def test_matches_release_tag_no_match() -> None:
    tool = {
        "directory_name": "GE-Proton9-7",
        "display_name": "GE-Proton",
        "internal_name": "GE-Proton9-7",
    }
    assert not matches_release_tag(tool, "cachyos-11.0-20260521-slr")


def test_matches_release_tag_case_insensitive() -> None:
    tool = {
        "directory_name": "ge-proton9-7",
        "display_name": "GE-Proton",
        "internal_name": "ge-proton9-7",
    }
    assert matches_release_tag(tool, "GE-Proton9-7")


# ---------------------------------------------------------------------------
# _detect_tool_id_from_names
# ---------------------------------------------------------------------------

def test_detect_proton_ge_latest_slot() -> None:
    assert _detect_tool_id_from_names(PROTON_GE_LATEST_SLOT_NAME, "", "") == "proton-ge"


def test_detect_cachyos_latest_slot() -> None:
    assert _detect_tool_id_from_names(PROTON_CACHY_LATEST_SLOT_NAME, "", "") == "proton-cachyos"


def test_detect_ge_proton_by_prefix() -> None:
    assert _detect_tool_id_from_names("GE-Proton9-7", "GE-Proton", "GE-Proton9-7") == "proton-ge"


def test_detect_cachyos_by_prefix() -> None:
    assert _detect_tool_id_from_names("proton-cachyos-11.0-slr", "Proton-CachyOS", "proton-cachyos") == "proton-cachyos"


def test_detect_valve_proton_returns_none() -> None:
    assert _detect_tool_id_from_names("Proton 9.0", "Proton 9.0", "proton") is None


def test_detect_unknown_tool_returns_none() -> None:
    assert _detect_tool_id_from_names("some-random-tool", "Some Tool", "some-tool") is None


# ---------------------------------------------------------------------------
# simplify_release with asset_prefix and asset_arch
# ---------------------------------------------------------------------------

def _make_release(tag: str, assets: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "tag_name": tag,
        "name": tag,
        "published_at": "2026-05-21T00:00:00Z",
        "draft": False,
        "prerelease": False,
        "assets": assets,
        "body": None,
    }


def _asset(name: str, size: int = 100) -> dict[str, Any]:
    return {"name": name, "browser_download_url": f"https://example.com/{name}", "size": size}


def test_simplify_ge_release_selects_tar_gz() -> None:
    release = _make_release("GE-Proton9-7", [_asset("GE-Proton9-7.tar.gz", 500)])
    result = simplify_release(release, "GE-Proton")
    assert result is not None
    assert result["tag_name"] == "GE-Proton9-7"
    assert result["asset_name"] == "GE-Proton9-7.tar.gz"


def test_simplify_ge_release_selects_tar_xz() -> None:
    release = _make_release("GE-Proton9-7", [_asset("GE-Proton9-7.tar.xz", 500)])
    result = simplify_release(release, "GE-Proton")
    assert result is not None
    assert result["asset_name"] == "GE-Proton9-7.tar.xz"


def test_simplify_cachyos_selects_x86_64_not_v3() -> None:
    tag = "cachyos-11.0-20260521-slr"
    release = _make_release(tag, [
        _asset("proton-cachyos-11.0-20260521-slr-arm64.tar.xz"),
        _asset("proton-cachyos-11.0-20260521-slr-x86_64.tar.xz", 300),
        _asset("proton-cachyos-11.0-20260521-slr-x86_64_v3.tar.xz"),
        _asset("proton-cachyos-11.0-20260521-slr-x86_64.sha512sum"),
    ])
    result = simplify_release(release, "proton-cachyos", "x86_64")
    assert result is not None
    assert result["asset_name"] == "proton-cachyos-11.0-20260521-slr-x86_64.tar.xz"
    assert result["asset_size"] == 300


def test_simplify_cachyos_no_x86_64_returns_none() -> None:
    tag = "cachyos-11.0-20260521-slr"
    release = _make_release(tag, [
        _asset("proton-cachyos-11.0-20260521-slr-arm64.tar.xz"),
        _asset("proton-cachyos-11.0-20260521-slr-x86_64_v3.tar.xz"),
    ])
    result = simplify_release(release, "proton-cachyos", "x86_64")
    assert result is None


def test_simplify_ge_release_skips_aarch64_asset_on_x86_host() -> None:
    """#117: GE-Proton started publishing aarch64 assets; on a Steam Deck
    (x86_64) the picker must not select the aarch64 variant even when it is
    listed before the x86_64 build in the assets array.
    """
    from unittest.mock import patch
    tag = "GE-Proton10-19"
    release = _make_release(tag, [
        _asset(f"{tag}-aarch64.tar.gz", 100),
        _asset(f"{tag}.tar.gz", 500),
    ])
    with patch("lib.compat_tools._host_is_x86_64", return_value=True):
        result = simplify_release(release, "GE-Proton")
    assert result is not None
    assert result["asset_name"] == f"{tag}.tar.gz"


def test_simplify_ge_release_arm64_keyword_also_blocked() -> None:
    from unittest.mock import patch
    tag = "GE-Proton10-19"
    release = _make_release(tag, [
        _asset(f"{tag}-arm64.tar.gz", 100),
        _asset(f"{tag}.tar.gz", 500),
    ])
    with patch("lib.compat_tools._host_is_x86_64", return_value=True):
        result = simplify_release(release, "GE-Proton")
    assert result is not None
    assert result["asset_name"] == f"{tag}.tar.gz"


def test_simplify_ge_release_aarch64_ok_on_aarch64_host() -> None:
    """On a real aarch64 host the picker should NOT reject the aarch64
    asset -- the x86 guard only fires when the host is x86_64.
    """
    from unittest.mock import patch
    tag = "GE-Proton10-19"
    release = _make_release(tag, [_asset(f"{tag}-aarch64.tar.gz", 100)])
    with patch("lib.compat_tools._host_is_x86_64", return_value=False):
        result = simplify_release(release, "GE-Proton")
    assert result is not None
    assert result["asset_name"] == f"{tag}-aarch64.tar.gz"


def test_simplify_skips_drafts() -> None:
    release = _make_release("GE-Proton9-7", [_asset("GE-Proton9-7.tar.gz")])
    release["draft"] = True
    assert simplify_release(release, "GE-Proton") is None


def test_simplify_skips_prereleases() -> None:
    release = _make_release("GE-Proton9-7", [_asset("GE-Proton9-7.tar.gz")])
    release["prerelease"] = True
    assert simplify_release(release, "GE-Proton") is None


# ---------------------------------------------------------------------------
# list_installed_compatibility_tools with all_latest_metadata
# ---------------------------------------------------------------------------

def _make_entry(name: str) -> MagicMock:
    entry = MagicMock()
    entry.name = name
    entry.is_dir.return_value = True
    vdf_path = MagicMock()
    vdf_path.exists.return_value = False
    entry.__truediv__ = lambda self, other: vdf_path
    entry.__str__ = lambda self: f"/home/deck/.steam/root/compatibilitytools.d/{name}"
    return entry


@pytest.fixture
def mock_compat_dirs(tmp_path: Path) -> Any:
    ge_dir = tmp_path / "GE-Proton9-7"
    ge_dir.mkdir()
    cachy_dir = tmp_path / "proton-cachyos-11.0-slr"
    cachy_dir.mkdir()
    return tmp_path


def test_list_installed_detects_tool_ids(mock_compat_dirs: Path) -> None:
    ge_meta = {"tag_name": "GE-Proton9-7", "directory_name": PROTON_GE_LATEST_SLOT_NAME, "updated_at": 0}
    cachy_meta = {"tag_name": "cachyos-11.0-slr", "directory_name": PROTON_CACHY_LATEST_SLOT_NAME, "updated_at": 0}

    with patch("lib.compat_tools.compat_tools_dirs", return_value=[mock_compat_dirs]), \
         patch("lib.compat_tools.find_steam_root", return_value=None), \
         patch("lib.compat_tools.decky") as mock_decky:
        mock_decky.DECKY_USER_HOME = str(mock_compat_dirs)
        mock_decky.logger = MagicMock()

        tools = list_installed_compatibility_tools(
            all_latest_metadata={"proton-ge": ge_meta, "proton-cachyos": cachy_meta}
        )

    tool_ids = {t["directory_name"]: t.get("tool_id") for t in tools}
    assert tool_ids.get("GE-Proton9-7") == "proton-ge"
    assert tool_ids.get("proton-cachyos-11.0-slr") == "proton-cachyos"


def test_list_installed_backward_compat_single_meta(mock_compat_dirs: Path) -> None:
    ge_meta = {"tag_name": "GE-Proton9-7", "directory_name": "GE-Proton9-7", "updated_at": 0}

    with patch("lib.compat_tools.compat_tools_dirs", return_value=[mock_compat_dirs]), \
         patch("lib.compat_tools.find_steam_root", return_value=None), \
         patch("lib.compat_tools.decky") as mock_decky:
        mock_decky.DECKY_USER_HOME = str(mock_compat_dirs)
        mock_decky.logger = MagicMock()

        tools = list_installed_compatibility_tools(latest_metadata=ge_meta)

    ge_tool = next((t for t in tools if t["directory_name"] == "GE-Proton9-7"), None)
    assert ge_tool is not None
    assert ge_tool["tool_id"] == "proton-ge"


def test_list_installed_populates_current_target_name_for_rolling_slot(
    tmp_path: Path,
) -> None:
    """A managed rolling-slot tool should expose the versioned build's
    basename as current_target_name so the Settings tab can render it as
    the row subtitle (header = friendly slot name, subtitle = active
    version). Reads the target path out of the .proton-pulse-managed
    marker file the slot builder writes.
    """
    versioned = tmp_path / "GE-Proton11-1"
    versioned.mkdir()
    slot = tmp_path / PROTON_GE_LATEST_SLOT_NAME
    slot.mkdir()
    (slot / ".proton-pulse-managed").write_text(str(versioned.resolve()), encoding="utf-8")

    with patch("lib.compat_tools.compat_tools_dirs", return_value=[tmp_path]), \
         patch("lib.compat_tools.find_steam_root", return_value=None), \
         patch("lib.compat_tools.decky") as mock_decky:
        mock_decky.DECKY_USER_HOME = str(tmp_path)
        mock_decky.logger = MagicMock()
        tools = list_installed_compatibility_tools()

    slot_tool = next((t for t in tools if t["directory_name"] == PROTON_GE_LATEST_SLOT_NAME), None)
    assert slot_tool is not None
    assert slot_tool["managed_slot"] == "latest"
    # Backend read the marker + reduced to basename so the frontend does
    # not have to know how to format an absolute path.
    assert slot_tool["current_target_name"] == "GE-Proton11-1"
    # Versioned build's row does not carry the field (only rolling slots).
    versioned_tool = next((t for t in tools if t["directory_name"] == "GE-Proton11-1"), None)
    assert versioned_tool is not None
    assert versioned_tool.get("current_target_name") is None


def test_list_installed_current_target_name_is_none_when_marker_missing(
    tmp_path: Path,
) -> None:
    """An unmanaged real-dir slot (or one whose marker hasn't been written
    yet) must return current_target_name=None so the frontend can fall
    back to its previous best-effort subtitle formatting without exploding.
    """
    slot = tmp_path / PROTON_GE_LATEST_SLOT_NAME
    slot.mkdir()
    # No marker file, no VDF -- just a bare dir named like a slot.

    with patch("lib.compat_tools.compat_tools_dirs", return_value=[tmp_path]), \
         patch("lib.compat_tools.find_steam_root", return_value=None), \
         patch("lib.compat_tools.decky") as mock_decky:
        mock_decky.DECKY_USER_HOME = str(tmp_path)
        mock_decky.logger = MagicMock()
        tools = list_installed_compatibility_tools()

    slot_tool = next((t for t in tools if t["directory_name"] == PROTON_GE_LATEST_SLOT_NAME), None)
    if slot_tool is not None:
        # Whether or not the entry passes _looks_like_proton_tool depends
        # on the slot name; if it did pass, current_target_name must be
        # None because no marker was written.
        assert slot_tool.get("current_target_name") is None
