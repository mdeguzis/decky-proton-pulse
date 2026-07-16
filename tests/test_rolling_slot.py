"""Tests for the rolling latest-slot machinery (#116).

Covers ensure_rolling_slot's happy path (symlink created), the "already
current" no-op path, the "no source" no-op path, and the "slot exists as
a real directory" refusal (protects an existing user's install).
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from lib.compat_tools import (
    COMPAT_TOOL_CONFIGS,
    ensure_all_rolling_slots,
    ensure_rolling_slot,
)


def _mk_tool(base: Path, name: str, tool_id: str = "proton-ge") -> Path:
    """Create a fake installed compat tool directory with a valid manifest so
    ensure_rolling_slot's post-symlink verification passes.
    """
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "compatibilitytool.vdf").write_text('"compatibilitytools" {}', encoding="utf-8")
    return d


def _patch_dirs(tmp_path: Path):
    """Return a context manager that patches compat_tools_dir + list_installed
    to point at tmp_path with fabricated entries.
    """
    # Build a list_installed_compatibility_tools result that reflects the
    # tmp_path contents. We keep it simple: any entry not matching a slot
    # name is a versioned build; entries carry a directory_name.
    slot_names = {cfg["latest_slot_name"] for cfg in COMPAT_TOOL_CONFIGS.values()}

    def fake_list(*_a, **_kw):
        out = []
        for entry in sorted(tmp_path.iterdir()):
            if not entry.is_dir():
                continue
            tool_id = "proton-ge" if "GE-Proton" in entry.name else (
                "proton-cachyos" if "cachyos" in entry.name.lower() else None
            )
            out.append({
                "directory_name": entry.name,
                "display_name": entry.name,
                "path": str(entry),
                "source": "custom",
                "tool_id": tool_id,
                "managed_slot": "latest" if entry.name in slot_names else "versioned",
            })
        return out

    # compat_tools_dir is imported into lib.compat_tools from lib.steam_paths;
    # patch at the import site so ensure_rolling_slot's lookup lands in tmp_path.
    return patch.multiple(
        "lib.compat_tools",
        compat_tools_dir=lambda: tmp_path,
        list_installed_compatibility_tools=fake_list,
    )


def test_no_source_no_op(tmp_path):
    """No versioned build installed -> no symlink, no error."""
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result == {"ok": False, "reason": "no-source"}
    assert not (tmp_path / "Proton-GE-Latest").exists()


def test_creates_symlink_when_missing(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-19")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True
    assert result["changed"] is True
    slot = tmp_path / "Proton-GE-Latest"
    assert slot.is_symlink()
    assert slot.resolve() == (tmp_path / "GE-Proton10-19").resolve()


def test_no_op_when_slot_already_current(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-19")
    (tmp_path / "Proton-GE-Latest").symlink_to(tmp_path / "GE-Proton10-19", target_is_directory=True)
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True
    assert result["changed"] is False


def test_updates_symlink_when_newer_installed(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-18")
    _mk_tool(tmp_path, "GE-Proton10-20")  # newer
    # Stale symlink points at the older build.
    (tmp_path / "Proton-GE-Latest").symlink_to(tmp_path / "GE-Proton10-18", target_is_directory=True)
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True
    assert result["changed"] is True
    assert (tmp_path / "Proton-GE-Latest").resolve() == (tmp_path / "GE-Proton10-20").resolve()


def test_refuses_to_touch_real_directory_slot(tmp_path):
    """If Proton-GE-Latest is a real dir (an earlier install_as_latest=True run),
    refuse -- clobbering it would delete the user's install.
    """
    (tmp_path / "Proton-GE-Latest").mkdir()
    _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is False
    assert result["reason"] == "slot-is-real-dir"
    # Slot must remain intact.
    assert (tmp_path / "Proton-GE-Latest").is_dir()
    assert not (tmp_path / "Proton-GE-Latest").is_symlink()


def test_ensure_all_returns_per_tool_outcome(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        outcomes = ensure_all_rolling_slots()
    assert set(outcomes.keys()) == set(COMPAT_TOOL_CONFIGS.keys())
    assert outcomes["proton-ge"]["ok"] is True
    assert outcomes["proton-cachyos"]["ok"] is False  # no cachyos installed
    assert outcomes["proton-cachyos"]["reason"] == "no-source"


def test_unknown_tool_id_returns_error(tmp_path):
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-nonexistent")
    assert result == {"ok": False, "reason": "unknown-tool"}
