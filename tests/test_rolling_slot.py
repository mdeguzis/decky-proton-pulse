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


def test_duplicate_slot_copy_is_removed_and_slot_rebuilt(tmp_path):
    """The slot dir holds a full copy of a version that is also installed
    under its own name (an install as latest used to extract into the slot,
    #133). The plugin removes the duplicate copy, keeps the versioned
    install untouched, and rebuilds the managed slot on top of it.
    """
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    (slot_path / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "x" { "display_name" "GE-Proton10-19" } } }',
        encoding="utf-8",
    )
    (slot_path / "proton").write_text("#!/bin/sh\n# slot copy\n", encoding="utf-8")
    existing = _mk_tool(tmp_path, "GE-Proton10-19")
    existing_proton = (existing / "proton").read_text()
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is True
    assert existing.is_dir()
    assert (existing / "proton").read_text() == existing_proton
    # The slot is now a managed link farm pointing at the versioned build.
    assert (slot_path / ".proton-pulse-managed").read_text(encoding="utf-8") == str(existing.resolve())
    assert (slot_path / "proton").is_symlink()


def test_duplicate_slot_left_alone_when_existing_dir_is_a_different_tool(tmp_path):
    """Only an exact duplicate is removed. If the versioned name is taken by
    a dir whose VDF says something else, nothing is deleted."""
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    (slot_path / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "x" { "display_name" "GE-Proton10-19" } } }',
        encoding="utf-8",
    )
    other = tmp_path / "GE-Proton10-19"
    other.mkdir()
    (other / "compatibilitytool.vdf").write_text(
        '"compatibilitytools" { "compat_tools" { "y" { "display_name" "Something-Else" } } }',
        encoding="utf-8",
    )
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert slot_path.is_dir() and not (slot_path / ".proton-pulse-managed").exists()
    assert (other / "compatibilitytool.vdf").exists()
    assert result["ok"] is False


def test_slot_is_real_dir_without_duplicate_leaves_subreason_none(tmp_path):
    """A plain user-owned real dir slot (no VDF, no duplicate) still gets
    the slot-is-real-dir refusal but WITHOUT the duplicate-versioned-install
    subreason -- otherwise the frontend would mis-instruct the user to
    delete their real install.
    """
    slot_path = tmp_path / "Proton-GE-Latest"
    slot_path.mkdir()
    (slot_path / "proton").write_text("#!/bin/sh\n", encoding="utf-8")
    _mk_tool(tmp_path, "GE-Proton10-20")  # a real target so we get past no-source
    with _patch_dirs(tmp_path):
        result = ensure_rolling_slot("proton-ge")
    assert result["ok"] is False
    assert result["reason"] == "slot-is-real-dir"
    assert result["subreason"] is None
    assert result["fix_hint"] is None


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


# --- install pipeline refreshes the slot for the tool that was installed ---
# Regression: _do_download_and_install referenced an undefined tool_config,
# and a broad except turned the NameError into a warning, so the slot never
# refreshed after any install.

def _run_install(tmp_path: Path, tool_id: str, slot_result: dict, slot_side_effect=None):
    from lib import proton_ge  # pylint: disable=import-outside-toplevel

    release = {"tag_name": "v1", "asset_name": "v1.tar.gz", "asset_size": 1}
    with (
        patch.object(proton_ge, "compat_tools_dir", return_value=tmp_path),
        patch.object(proton_ge, "_download_release"),
        patch.object(proton_ge, "extract_archive_safely"),
        patch.object(proton_ge, "finalize_extracted_compat_tool",
                     return_value={"success": True, "message": "Installed v1"}),
        patch.object(proton_ge, "write_latest_metadata"),
        patch("lib.compat_tools.ensure_rolling_slot",
              return_value=slot_result, side_effect=slot_side_effect) as slot_mock,
    ):
        result = proton_ge._do_download_and_install(  # pylint: disable=protected-access
            "v1", release, "https://example.invalid/v1.tar.gz",
            install_as_latest=False, force_reinstall=False,
            _set=lambda **_kw: None, _cancel=lambda: False, _set_process=lambda _p: None,
            tool_id=tool_id,
        )
    return result, slot_mock


def test_install_refreshes_rolling_slot_for_installed_tool(tmp_path: Path) -> None:
    for tool_id in ("proton-ge", "proton-cachyos"):
        result, slot_mock = _run_install(tmp_path, tool_id, {"ok": True, "changed": True})
        slot_mock.assert_called_once_with(tool_id)
        assert result["success"] is True
        assert result["rolling_slot"] == {"ok": True, "changed": True}


def test_install_reports_structural_slot_failure(tmp_path: Path) -> None:
    result, _ = _run_install(tmp_path, "proton-ge", {"ok": False, "reason": "rebuild-failed"})
    assert result["success"] is False
    assert "rebuild-failed" in result["message"]


def test_install_survives_slot_oserror(tmp_path: Path) -> None:
    result, _ = _run_install(tmp_path, "proton-ge", {}, slot_side_effect=OSError("read-only"))
    assert result["success"] is True
    assert "rolling_slot" not in result


def _run_install_with_prune(tmp_path: Path, install_as_latest: bool, prune_unused: bool = True):
    from lib import proton_ge  # pylint: disable=import-outside-toplevel

    release = {"tag_name": "v1", "asset_name": "v1.tar.gz", "asset_size": 1}
    slot_ok = {"ok": True, "changed": True, "target": str(tmp_path / "GE-Proton11-11-x86_64")}
    with (
        patch.object(proton_ge, "compat_tools_dir", return_value=tmp_path),
        patch.object(proton_ge, "_download_release"),
        patch.object(proton_ge, "extract_archive_safely"),
        patch.object(proton_ge, "finalize_extracted_compat_tool",
                     return_value={"success": True, "message": "Installed v1"}),
        patch.object(proton_ge, "write_latest_metadata"),
        patch("lib.compat_tools.ensure_rolling_slot", return_value=slot_ok),
        patch("lib.compat_tools.versioned_tools_for", return_value=[]),
        patch("lib.compat_usage.prune_unused_versions",
              return_value={"ok": True, "removed": ["GE-Proton11-6-x86_64"], "failed": {}}) as prune_mock,
        patch.object(proton_ge, "clear_latest_metadata") as clear_mock,
    ):
        result = proton_ge._do_download_and_install(  # pylint: disable=protected-access
            "v1", release, "https://example.invalid/v1.tar.gz",
            install_as_latest=install_as_latest, force_reinstall=False,
            _set=lambda **_kw: None, _cancel=lambda: False, _set_process=lambda _p: None,
            tool_id="proton-ge", prune_unused=prune_unused,
        )
    return result, prune_mock, clear_mock


def test_latest_install_prunes_unused_versions_keeping_slot_target(tmp_path: Path) -> None:
    result, prune_mock, clear_mock = _run_install_with_prune(tmp_path, install_as_latest=True)
    prune_mock.assert_called_once_with("proton-ge", [], {"GE-Proton11-11-x86_64"})
    clear_mock.assert_called_once_with("GE-Proton11-6-x86_64", "proton-ge")
    assert result["pruned"]["removed"] == ["GE-Proton11-6-x86_64"]
    assert "Removed unused older versions: GE-Proton11-6-x86_64." in result["message"]


def test_versioned_install_does_not_prune(tmp_path: Path) -> None:
    result, prune_mock, _ = _run_install_with_prune(tmp_path, install_as_latest=False)
    prune_mock.assert_not_called()
    assert "pruned" not in result


def test_latest_install_does_not_prune_when_setting_off(tmp_path: Path) -> None:
    # Auto-trim is opt-in: with the setting off a latest install leaves every
    # old build in place.
    result, prune_mock, _ = _run_install_with_prune(tmp_path, install_as_latest=True, prune_unused=False)
    prune_mock.assert_not_called()
    assert "pruned" not in result


def _run_latest_install(tmp_path: Path, finalize_result: dict):
    from lib import proton_ge  # pylint: disable=import-outside-toplevel

    release = {"tag_name": "GE-Proton11-11", "asset_name": "a.tar.gz", "asset_size": 1}
    with (
        patch.object(proton_ge, "compat_tools_dir", return_value=tmp_path),
        patch.object(proton_ge, "_download_release"),
        patch.object(proton_ge, "extract_archive_safely"),
        patch.object(proton_ge, "finalize_extracted_compat_tool", return_value=finalize_result) as fin,
        patch.object(proton_ge, "write_latest_metadata"),
        patch.object(proton_ge, "mark_latest_install") as mark,
        patch("lib.compat_tools.ensure_rolling_slot", return_value={"ok": True}),
    ):
        proton_ge._do_download_and_install(  # pylint: disable=protected-access
            "GE-Proton11-11", release, "https://example.invalid/a.tar.gz",
            install_as_latest=True, force_reinstall=False,
            _set=lambda **_kw: None, _cancel=lambda: False, _set_process=lambda _p: None,
            tool_id="proton-ge",
        )
    return fin, mark


def test_latest_install_extracts_to_versioned_dir_and_marks_it(tmp_path: Path) -> None:
    # Regression: install_as_latest extracted INTO Proton-GE-Latest, leaving a
    # real-dir duplicate the slot refresh could not migrate.
    fin, mark = _run_latest_install(
        tmp_path, {"success": True, "directory_name": "GE-Proton11-11-x86_64", "message": "ok"})
    assert "destination_name" not in fin.call_args.kwargs
    mark.assert_called_once_with(tmp_path / "GE-Proton11-11-x86_64", "proton-ge", "GE-Proton11-11")


def test_latest_install_does_not_mark_a_build_that_was_already_there(tmp_path: Path) -> None:
    # A hand-installed build the latest process merely adopts keeps no marker,
    # so auto-trim will never delete it later.
    _, mark = _run_latest_install(tmp_path, {
        "success": True, "already_installed": True,
        "directory_name": "GE-Proton11-11-x86_64", "message": "already"})
    mark.assert_not_called()


def test_mark_latest_install_writes_marker(tmp_path: Path) -> None:
    from lib import proton_ge  # pylint: disable=import-outside-toplevel
    from lib.compat_usage import LATEST_INSTALL_MARKER, installed_by_latest_process  # pylint: disable=import-outside-toplevel

    proton_ge.mark_latest_install(tmp_path, "proton-ge", "GE-Proton11-11")
    assert (tmp_path / LATEST_INSTALL_MARKER).is_file()
    assert installed_by_latest_process({"path": str(tmp_path)}) is True


def test_trim_now_keeps_each_slot_target(tmp_path: Path) -> None:
    from lib import proton_ge  # pylint: disable=import-outside-toplevel

    slot = tmp_path / "Proton-GE-Latest"
    slot.mkdir()
    (slot / ".proton-pulse-managed").write_text(str(tmp_path / "GE-Proton11-11-x86_64"), encoding="utf-8")
    with (
        patch.object(proton_ge, "compat_tools_dir", return_value=tmp_path),
        patch.object(proton_ge, "_prune_after_latest_install",
                     return_value={"ok": True, "removed": [], "failed": {}}) as prune,
    ):
        outcomes = proton_ge.trim_unused_latest_installs()
    calls = {c.args[0]: c.args[1] for c in prune.call_args_list}
    assert calls["proton-ge"] == {"target": str(tmp_path / "GE-Proton11-11-x86_64")}
    # CachyOS slot has no marker here: target unknown, newest build still kept by the selector.
    assert calls["proton-cachyos"] == {"target": None}
    assert set(outcomes) == {"proton-ge", "proton-cachyos"}


def test_set_install_status_keeps_started_at_when_the_run_finishes() -> None:
    # Regression (#92): success/error cleared started_at, so the Configure
    # dialog could not tell this run had finished and sat on "Finalizing".
    import threading  # pylint: disable=import-outside-toplevel
    from lib import proton_ge  # pylint: disable=import-outside-toplevel

    status: dict = {}
    lock = threading.Lock()
    proton_ge.set_install_status(status, lock, state="running", tag_name="GE-Proton11-5", message="Installing",
                                 install_as_latest=False, stage="downloading", started_at=1_800_000_000)
    proton_ge.set_install_status(status, lock, state="success", tag_name="GE-Proton11-5", message="Installed",
                                 install_as_latest=False, finished_at=1_800_000_040)
    assert status["started_at"] == 1_800_000_000
    assert status["finished_at"] == 1_800_000_040
    assert status["stage"] is None  # progress fields still reset on completion
