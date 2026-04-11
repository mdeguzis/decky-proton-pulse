"""Tests for exporting frontend metrics snapshots."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from lib.metrics_export import _prune_old_files, export_metrics_to_disk


def test_export_metrics_to_disk_writes_pretty_json(tmp_path: Path) -> None:
    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch("lib.metrics_export.time.strftime", return_value="20260410-230000"),
    ):
        assert export_metrics_to_disk('{"cacheHits":3}') is True

    output = tmp_path / ".config" / "decky-proton-pulse" / "metrics" / "metrics-20260410-230000.json"
    assert output.exists()
    assert output.read_text() == '{\n  "cacheHits": 3\n}\n'


def test_export_metrics_to_disk_rejects_invalid_json(tmp_path: Path) -> None:
    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        assert export_metrics_to_disk("{") is False


def test_prune_old_files_keeps_newest_entries(tmp_path: Path) -> None:
    files = []
    for idx in range(4):
        file_path = tmp_path / f"metrics-{idx}.json"
        file_path.write_text("{}")
        files.append(file_path)
        os.utime(file_path, (10 + idx, 10 + idx))

    removed = _prune_old_files(tmp_path, keep=2)

    assert removed == 2
    assert files[0].exists() is False
    assert files[1].exists() is False
    assert files[2].exists() is True
    assert files[3].exists() is True
