# tests/test_compat_pending.py
"""Pending-restart detection for compat tools (#137)."""
import os
from pathlib import Path

import pytest

from lib import compat_pending
from lib.compat_pending import annotate_pending_restart, steam_client_started_at

HZ = os.sysconf("SC_CLK_TCK")


def _proc(root: Path, pid: str, comm: str, start_ticks: int) -> None:
    d = root / pid
    d.mkdir()
    (d / "comm").write_text(comm + "\n")
    # Fields after ")": state is field 3, starttime field 22 -> index 19.
    rest = ["S"] + ["0"] * 18 + [str(start_ticks)] + ["0"] * 5
    (d / "stat").write_text(f"{pid} ({comm}) " + " ".join(rest) + "\n")


@pytest.fixture
def proc_root(tmp_path: Path) -> Path:
    root = tmp_path / "proc"
    root.mkdir()
    (root / "stat").write_text("cpu 1 2 3\nbtime 1000\n")
    (root / "self").mkdir()
    return root


def test_newest_steam_client_wins(proc_root: Path) -> None:
    _proc(proc_root, "11", "steam", 100 * HZ)
    _proc(proc_root, "22", "steam", 400 * HZ)
    _proc(proc_root, "33", "steamwebhelper", 900 * HZ)
    assert steam_client_started_at(proc_root) == pytest.approx(1400)


def test_no_steam_process(proc_root: Path) -> None:
    _proc(proc_root, "11", "bash", 5 * HZ)
    assert steam_client_started_at(proc_root) is None


def test_skips_unreadable_and_malformed_processes(proc_root: Path) -> None:
    _proc(proc_root, "11", "steam", 50 * HZ)
    bad = proc_root / "12"
    bad.mkdir()
    (bad / "comm").write_text("steam\n")
    (bad / "stat").write_text("12 (steam) S\n")
    gone = proc_root / "13"
    gone.mkdir()  # no comm file: process exited mid-scan
    assert steam_client_started_at(proc_root) == pytest.approx(1050)


def test_missing_boot_time(tmp_path: Path) -> None:
    root = tmp_path / "proc"
    root.mkdir()
    (root / "stat").write_text("cpu 1 2 3\n")
    assert steam_client_started_at(root) is None
    assert steam_client_started_at(tmp_path / "nope") is None


def _tool(path: Path, **extra: object) -> dict:
    path.mkdir(exist_ok=True)
    return {"directory_name": path.name, "path": str(path), "source": "custom", "managed_slot": "versioned", **extra}


def test_annotate_flags_builds_newer_than_steam(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    old = _tool(tmp_path / "GE-Proton11-1")
    new = _tool(tmp_path / "GE-Proton11-5")
    slot = _tool(tmp_path / "Proton-GE-Latest", managed_slot="latest")
    valve = {"directory_name": "Proton 9.0", "path": str(tmp_path / "x"), "source": "valve"}
    ctimes = {old["path"]: 500.0, new["path"]: 2000.0, slot["path"]: 3000.0}

    class _St:
        def __init__(self, c: float) -> None:
            self.st_ctime = c

    monkeypatch.setattr(compat_pending.os, "lstat", lambda p: _St(ctimes[str(p)]))
    tools = [old, new, slot, valve]
    annotate_pending_restart(tools, 1400.0)
    assert old["pending_restart"] is False
    assert new["pending_restart"] is True
    # A slot refresh bumps its ctime, but Steam already knows the name.
    assert slot["pending_restart"] is False
    assert valve["pending_restart"] is False


def test_annotate_unknown_when_steam_start_unknown(tmp_path: Path) -> None:
    tool = _tool(tmp_path / "GE-Proton11-5")
    annotate_pending_restart([tool], None)
    assert tool["pending_restart"] is None


def test_annotate_unknown_when_tool_vanished(tmp_path: Path) -> None:
    tool = {"directory_name": "gone", "path": str(tmp_path / "gone"), "source": "custom", "managed_slot": "versioned"}
    annotate_pending_restart([tool], 0.0)
    assert tool["pending_restart"] is None


def test_module_exposes_both_helpers() -> None:
    assert callable(compat_pending.steam_client_started_at)
