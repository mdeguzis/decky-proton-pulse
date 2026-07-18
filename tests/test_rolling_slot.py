"""Tests for the rolling latest-slot machinery (#116).

The slot is a real directory (NOT a whole-dir symlink) that contains:
  - a custom compatibilitytool.vdf with display_name="Proton-GE-Latest"
    so Steam's compat picker shows the friendly label instead of the
    versioned tag (this was the bug that motivated the refactor: with a
    whole-dir symlink Steam read the target's VDF and showed
    "GE-Proton10-19" next to games instead of "Proton-GE-Latest"),
  - a marker file recording the current target path,
  - one symlink per top-level entry of the target dir.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from lib.compat_tools import (
    COMPAT_TOOL_CONFIGS,
    PROTON_GE_LATEST_INTERNAL_NAME,
    PROTON_CACHY_LATEST_INTERNAL_NAME,
    ensure_all_rolling_slots,
    ensure_rolling_slot,
)


def _mk_tool(base: Path, name: str, tool_id: str = "proton-ge") -> Path:
    """Create a fake installed compat tool directory with a valid manifest so
    ensure_rolling_slot's post-symlink verification passes. Also drops a
    couple of representative child entries (proton script + dist/) so the
    per-file symlink population has something to link against.
    """
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "' + name + '" { "display_name" "' + name + '" } } }',
        encoding="utf-8",
    )
    (d / "toolmanifest.vdf").write_text('"manifest" {}', encoding="utf-8")
    (d / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    (d / "dist").mkdir(exist_ok=True)
    (d / "dist" / "version").write_text(name, encoding="utf-8")
    return d


def _patch_dirs(tmp_path: Path):
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

    return patch.multiple(
        "lib.compat_tools",
        compat_tools_dir=lambda: tmp_path,
        list_installed_compatibility_tools=fake_list,
    )


# ---- happy path -------------------------------------------------------------


def test_no_source_no_op(tmp_path):
    """No versioned build installed -> no slot, no error."""
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result == {"ok": False, "reason": "no-source"}
    assert not (tmp_path / "Proton-GE-Latest").exists()


def test_creates_slot_dir_with_custom_vdf(tmp_path):
    """Slot is a real dir with our custom compatibilitytool.vdf and
    per-file symlinks -- NOT a whole-dir symlink to the target.
    """
    target = _mk_tool(tmp_path, "GE-Proton10-19")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    slot = tmp_path / "Proton-GE-Latest"
    assert result["ok"] is True
    assert result["changed"] is True
    assert slot.is_dir()
    # Critical: NOT a symlink -- the whole point of the refactor.
    assert not slot.is_symlink()
    # Our VDF is a real file, not a link into the target.
    vdf = slot / "compatibilitytool.vdf"
    assert vdf.is_file()
    assert not vdf.is_symlink()
    # display_name matches the friendly slot name, not the version tag.
    vdf_text = vdf.read_text()
    assert '"display_name" "Proton-GE-Latest"' in vdf_text
    # internal_name is the unique key so Steam does not merge the slot
    # with the underlying versioned build.
    assert f'"{PROTON_GE_LATEST_INTERNAL_NAME}"' in vdf_text
    assert '"install_path" "."' in vdf_text
    # Every other entry in target is symlinked into the slot.
    assert (slot / "proton").is_symlink()
    assert (slot / "proton").resolve() == (target / "proton").resolve()
    assert (slot / "dist").is_symlink()
    assert (slot / "dist").resolve() == (target / "dist").resolve()
    assert (slot / "toolmanifest.vdf").is_symlink()
    # Marker file records the current target so is-current checks are cheap.
    marker = slot / ".proton-pulse-managed"
    assert marker.is_file()
    assert marker.read_text(encoding="utf-8").strip() == str(target.resolve())


def test_cachyos_slot_uses_its_own_internal_name(tmp_path):
    target = _mk_tool(tmp_path, "proton-cachyos-10-2", tool_id="proton-cachyos")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-cachyos")
    assert result["ok"] is True
    vdf_text = (tmp_path / "Proton-CachyOS-Latest" / "compatibilitytool.vdf").read_text()
    assert '"display_name" "Proton-CachyOS-Latest"' in vdf_text
    assert f'"{PROTON_CACHY_LATEST_INTERNAL_NAME}"' in vdf_text
    assert PROTON_GE_LATEST_INTERNAL_NAME not in vdf_text
    # Marker points at the cachyos target, not GE.
    marker = tmp_path / "Proton-CachyOS-Latest" / ".proton-pulse-managed"
    assert marker.read_text(encoding="utf-8").strip() == str(target.resolve())


def test_no_op_when_slot_already_current(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-19")
    with _patch_dirs(tmp_path):
        first = ensure_rolling_slot("proton-ge")
        second = ensure_rolling_slot("proton-ge")
    assert first["ok"] is True and first["changed"] is True
    assert second["ok"] is True
    assert second["changed"] is False


def test_updates_symlinks_when_newer_installed(tmp_path):
    """A newer versioned build appearing triggers a rebuild that re-points
    the symlinks + updates the marker. VDF stays -- only its internal_name
    is fixed, display_name never changes.
    """
    _mk_tool(tmp_path, "GE-Proton10-18")
    with _patch_dirs(tmp_path):
        ensure_rolling_slot("proton-ge")
    slot = tmp_path / "Proton-GE-Latest"
    assert (slot / "dist").resolve() == (tmp_path / "GE-Proton10-18" / "dist").resolve()
    # Ship a newer build and refresh.
    new_target = _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True and result["changed"] is True
    assert (slot / "dist").resolve() == (new_target / "dist").resolve()
    marker = slot / ".proton-pulse-managed"
    assert marker.read_text(encoding="utf-8").strip() == str(new_target.resolve())


def test_migrates_legacy_symlink_slot(tmp_path):
    """Older plugin versions created the slot as a whole-dir symlink. On
    refresh, migrate to the new real-dir + custom VDF layout so the display
    name in Steam's picker corrects itself.
    """
    target = _mk_tool(tmp_path, "GE-Proton10-19")
    slot = tmp_path / "Proton-GE-Latest"
    slot.symlink_to(target, target_is_directory=True)
    assert slot.is_symlink()
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True and result["changed"] is True
    assert not slot.is_symlink()
    assert slot.is_dir()
    assert (slot / "compatibilitytool.vdf").is_file()
    assert (slot / ".proton-pulse-managed").is_file()


# ---- refusal paths ----------------------------------------------------------


def test_refuses_unmanaged_real_directory_slot(tmp_path):
    """If Proton-GE-Latest is a real dir with a valid VDF but no marker,
    the migration branch would normally rename it. But here the VDF is
    missing (just a bare proton script), so migration cannot apply and
    the slot must be refused as user-owned.
    """
    (tmp_path / "Proton-GE-Latest").mkdir()
    (tmp_path / "Proton-GE-Latest" / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is False
    assert result["reason"] == "slot-is-real-dir"
    # Slot must remain intact.
    slot = tmp_path / "Proton-GE-Latest"
    assert slot.is_dir()
    assert (slot / "proton").is_file()


def test_auto_migrates_versioned_install_inside_slot_dir(tmp_path):
    """The Deck-in-the-wild bug: an older plugin extracted the tarball
    contents directly INTO the slot dir with install_as_latest=True. The
    slot is a real dir owned by the user (no managed marker), containing
    a full versioned Proton install whose VDF says display_name="GE-Proton10-19".

    ensure_rolling_slot must:
      1. Detect the versioned VDF display_name inside the slot dir.
      2. Rename the slot dir to that display_name (freeing the slot name).
      3. Rebuild a proper managed slot symlinking to the renamed dir.

    Without this migration users are stuck: _versioned_tools_for hides
    tools whose directory_name matches a slot name, so the tool never
    becomes a candidate and the plugin returns no-source forever.
    """
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    # Full versioned Proton install layout, including a versioned VDF.
    (slot_path / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "GE-Proton10-19" { "display_name" "GE-Proton10-19" } } }',
        encoding="utf-8",
    )
    (slot_path / "toolmanifest.vdf").write_text('"manifest" {}', encoding="utf-8")
    (slot_path / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    (slot_path / "dist").mkdir()
    (slot_path / "dist" / "version").write_text("GE-Proton10-19", encoding="utf-8")

    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")

    # Migration happened: renamed dir exists, versioned tool is now visible.
    versioned_dir = tmp_path / "GE-Proton10-19"
    assert versioned_dir.is_dir()
    assert (versioned_dir / "proton").is_file()
    # Managed slot got built on top pointing at the renamed dir.
    assert result["ok"] is True
    assert result["changed"] is True
    assert slot_path.is_dir()
    assert not slot_path.is_symlink()
    assert (slot_path / ".proton-pulse-managed").is_file()
    vdf_text = (slot_path / "compatibilitytool.vdf").read_text()
    assert '"display_name" "Proton-GE-Latest"' in vdf_text
    assert (slot_path / "proton").is_symlink()
    assert (slot_path / "proton").resolve() == (versioned_dir / "proton").resolve()


def test_migration_refuses_unsafe_vdf_display_name(tmp_path):
    """A hostile VDF whose display_name contains a slash / .. / leading dot
    must not be used as a target directory name. Migration bails without
    renaming, and the outer flow refuses the slot as usual.
    """
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    (slot_path / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "x" { "display_name" "../etc/passwd" } } }',
        encoding="utf-8",
    )
    (slot_path / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    # Unsafe VDF => migration is a no-op; the outer refuse-if-unmanaged
    # branch fires as normal.
    assert result["ok"] is False
    assert result["reason"] == "slot-is-real-dir"
    assert slot_path.is_dir()
    assert not (tmp_path.parent / "etc").exists()  # nothing escaped


def test_migration_refuses_when_versioned_dir_already_exists(tmp_path):
    """If the target versioned dir name is already taken (e.g. a duplicate
    install), migration must NOT clobber it -- refuse instead.
    """
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    (slot_path / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "x" { "display_name" "GE-Proton10-19" } } }',
        encoding="utf-8",
    )
    (slot_path / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    # A separate versioned install already occupies the target name.
    existing = _mk_tool(tmp_path, "GE-Proton10-19")
    existing_proton = (existing / "proton").read_text()
    with _patch_dirs(tmp_path):
        ensure_rolling_slot("proton-ge")
    # Neither dir got clobbered; the pre-existing one is intact.
    assert existing.is_dir()
    assert (existing / "proton").read_text() == existing_proton
    # Slot is still the unmigrated real dir.
    assert slot_path.is_dir()


def test_refuses_when_target_missing_manifest(tmp_path):
    """Broken/aborted install -- target dir exists but has neither VDF
    that Steam parses. Do not build a slot around it.
    """
    (tmp_path / "GE-Proton10-19").mkdir()
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is False
    assert result["reason"] == "target-missing-manifest"
    assert not (tmp_path / "Proton-GE-Latest").exists()


# ---- ensure_all + unknown tool ---------------------------------------------


def test_ensure_all_returns_per_tool_outcome(tmp_path):
    _mk_tool(tmp_path, "GE-Proton10-20")
    with _patch_dirs(tmp_path):
        outcomes = ensure_all_rolling_slots()
    assert set(outcomes.keys()) == set(COMPAT_TOOL_CONFIGS.keys())
    assert outcomes["proton-ge"]["ok"] is True
    assert outcomes["proton-cachyos"]["ok"] is False
    assert outcomes["proton-cachyos"]["reason"] == "no-source"


def test_unknown_tool_id_returns_error(tmp_path):
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-nonexistent")
    assert result == {"ok": False, "reason": "unknown-tool"}
