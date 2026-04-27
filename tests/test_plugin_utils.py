"""Tests for low-level plugin utility helpers."""

from __future__ import annotations

import os
import tarfile
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from lib.plugin_utils import extract_archive_safely, system_command_env


def test_system_command_env_strips_decky_specific_variables() -> None:
    with patch.dict(
        os.environ,
        {
            "LD_LIBRARY_PATH": "/decky",
            "SSL_CERT_FILE": "/decky/cert.pem",
            "PYTHONPATH": "/decky/python",
            "HOME": "/home/testuser",
        },
        clear=True,
    ):
        env = system_command_env()

    assert "LD_LIBRARY_PATH" not in env
    assert "SSL_CERT_FILE" not in env
    assert "PYTHONPATH" not in env
    assert env["HOME"] == "/home/testuser"


def test_extract_archive_safely_extracts_zip_and_tar(tmp_path: Path) -> None:
    zip_path = tmp_path / "archive.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("payload/file.txt", "hello")

    extract_archive_safely(zip_path, tmp_path / "zip-out")
    assert (tmp_path / "zip-out" / "payload" / "file.txt").read_text() == "hello"

    tar_path = tmp_path / "archive.tar"
    source = tmp_path / "tar-source.txt"
    source.write_text("world")
    with tarfile.open(tar_path, "w") as archive:
        archive.add(source, arcname="payload/file.txt")

    extract_archive_safely(tar_path, tmp_path / "tar-out")
    assert (tmp_path / "tar-out" / "payload" / "file.txt").read_text() == "world"


def test_extract_archive_safely_blocks_path_escape(tmp_path: Path) -> None:
    zip_path = tmp_path / "escape.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("../escape.txt", "nope")

    with pytest.raises(RuntimeError, match="escape extraction root"):
        extract_archive_safely(zip_path, tmp_path / "out")


def test_extract_archive_safely_falls_back_when_tar_filter_is_unsupported(
    tmp_path: Path,
) -> None:
    tar_path = tmp_path / "archive.tar"
    tar_path.write_text("placeholder")
    extract_dir = tmp_path / "out"

    class FakeTarArchive:
        def __init__(self) -> None:
            self.calls: list[tuple[Path, str | None]] = []

        def __enter__(self) -> "FakeTarArchive":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def getmembers(self) -> list[object]:
            return [type("TarMember", (), {"name": "payload/file.txt"})()]

        def extractall(self, path: Path, filter: str | None = None) -> None:
            self.calls.append((path, filter))
            if filter == "data":
                raise TypeError("filter unsupported")

    fake_archive = FakeTarArchive()

    with (
        patch("lib.plugin_utils.zipfile.is_zipfile", return_value=False),
        patch("lib.plugin_utils.tarfile.open", return_value=fake_archive),
    ):
        extract_archive_safely(tar_path, extract_dir)

    assert fake_archive.calls == [
        (extract_dir, "data"),
        (extract_dir, None),
    ]
