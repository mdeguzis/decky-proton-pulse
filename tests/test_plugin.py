"""Tests for plugin logging and system-info helpers."""

# pyright: reportMissingImports=false, reportMissingModuleSource=false
# pylint: disable=wrong-import-position,missing-function-docstring,redefined-outer-name,broad-exception-caught
import asyncio
import logging
import os
import pathlib
import sys
import zipfile
from typing import Any, Generator, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import MagicMock, mock_open, patch

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error
import pytest
from lib.compat_tools import list_installed_compatibility_tools
from lib.plugin_logging import _disable_debug_log, sync_set_log_level
from lib.system_info import (
    read_cpu,
    read_custom_proton,
    read_distro,
    read_driver_version,
    read_gpu,
    read_kernel,
)

from main import Plugin


@pytest.fixture(autouse=True)
def reset_debug_handler() -> Generator[None, None, None]:
    """Ensure no legacy debug handlers bleed between tests."""
    yield
    for h in list(decky.logger.handlers):
        if h not in logging.getLogger().handlers and h is not None:
            try:
                decky.logger.removeHandler(h)
                h.close()
            except Exception:  # pragma: no cover - test cleanup guard
                continue


@pytest.fixture
def debug_handler_ref() -> list[Optional[logging.Handler]]:
    """Mutable single-element list used by the logging helpers."""
    return [None]


# ─── Debug handler cleanup behavior ───────────────────────────────────────────


def test_disable_debug_log_removes_handler(debug_handler_ref: Any) -> None:
    handler = MagicMock()
    debug_handler_ref[0] = handler
    decky.logger.addHandler(handler)
    _disable_debug_log(debug_handler_ref)
    assert debug_handler_ref[0] is None


def test_disable_debug_log_when_not_enabled_is_safe(debug_handler_ref: Any) -> None:
    _disable_debug_log(debug_handler_ref)
    assert debug_handler_ref[0] is None


def test_set_log_level_debug_does_not_create_separate_debug_log(
    debug_handler_ref: Any,
) -> None:
    result = sync_set_log_level("DEBUG", debug_handler_ref)
    assert result is True
    assert debug_handler_ref[0] is None


def test_set_log_level_info_leaves_no_debug_handler(debug_handler_ref: Any) -> None:
    sync_set_log_level("INFO", debug_handler_ref)
    assert debug_handler_ref[0] is None


def test_set_log_level_warning_disables_debug_log(debug_handler_ref: Any) -> None:
    sync_set_log_level("DEBUG", debug_handler_ref)
    sync_set_log_level("WARNING", debug_handler_ref)
    assert debug_handler_ref[0] is None


# ─── get_log_contents ─────────────────────────────────────────────────────────


def test_get_log_contents_returns_last_200_lines() -> None:
    lines = [f"line {i}\n" for i in range(300)]
    content = "".join(lines)
    with patch("builtins.open", mock_open(read_data=content)):
        result = asyncio.run(Plugin().get_log_contents())
    assert "===== " in result
    assert "line 299" in result
    assert "line 100" in result
    assert "line 99\n" not in result


def test_get_log_contents_fewer_than_200_lines() -> None:
    content = "line A\nline B\nline C\n"
    with patch("builtins.open", mock_open(read_data=content)):
        result = asyncio.run(Plugin().get_log_contents())
    assert "===== " in result
    assert "line A" in result
    assert "line C" in result


def test_get_log_contents_missing_file_returns_empty() -> None:
    with patch("builtins.open", side_effect=FileNotFoundError):
        result = asyncio.run(Plugin().get_log_contents())
    assert result == ""


def test_get_log_contents_reads_main_log_only() -> None:
    with patch("builtins.open", mock_open(read_data="info line\ndebug line\n")):
        result = asyncio.run(Plugin().get_log_contents())

    assert f"===== {os.path.basename(decky.DECKY_PLUGIN_LOG)} =====" in result
    assert "info line" in result
    assert "debug line" in result


# ─── read_cpu ─────────────────────────────────────────────────────────────────


def test_read_cpu_parses_model_name() -> None:
    cpuinfo = (
        "processor\t: 0\n"
        "model name\t: AMD Ryzen 9 9950X3D\n"
        "cpu MHz\t\t: 3700.000\n"
    )
    with patch("builtins.open", mock_open(read_data=cpuinfo)):
        result = read_cpu()
    assert result == "AMD Ryzen 9 9950X3D"


def test_read_cpu_returns_none_when_no_model_name() -> None:
    cpuinfo = "processor\t: 0\ncpu MHz\t\t: 3700.000\n"
    with patch("builtins.open", mock_open(read_data=cpuinfo)):
        result = read_cpu()
    assert result is None


# ─── read_gpu ─────────────────────────────────────────────────────────────────


def test_read_gpu_parses_vga_line() -> None:
    lspci_output = (
        "00:02.0 VGA compatible controller: NVIDIA GeForce RTX 5080 [Blackwell] (rev a1)\n"
        "00:1f.3 Audio device: Intel Audio\n"
    )
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        gpu, vendor = read_gpu()
    assert gpu is not None
    assert "RTX 5080" in gpu
    assert vendor == "nvidia"


def test_read_gpu_parses_3d_controller() -> None:
    lspci_output = "00:00.0 3D controller: AMD Radeon RX 7900 XTX\n"
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        gpu, vendor = read_gpu()
    assert gpu is not None
    assert "7900 XTX" in gpu
    assert vendor == "amd"


def test_read_gpu_no_gpu_returns_none() -> None:
    lspci_output = (
        "00:1f.3 Audio device: Intel Audio\n00:14.0 USB controller: Intel USB\n"
    )
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        gpu, vendor = read_gpu()
    assert gpu is None
    assert vendor is None


def test_read_gpu_lspci_failure_returns_none() -> None:
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        gpu, vendor = read_gpu()
    assert gpu is None
    assert vendor is None


# ─── read_driver_version ──────────────────────────────────────────────────────


def test_read_driver_version_nvidia_smi_success() -> None:
    mock_result = MagicMock(returncode=0, stdout="595.45.04\n")
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        result = read_driver_version()
    assert result == "595.45.04"


def test_read_driver_version_fallback_drm(tmp_path: pathlib.Path) -> None:
    """nvidia-smi not found --> reads DRM sysfs path."""
    version_file = tmp_path / "version"
    version_file.write_text("6.2.0\n")

    def fake_run(cmd: Any, **_kwargs: Any) -> MagicMock:
        if cmd[0] == "nvidia-smi":
            raise FileNotFoundError("not installed")
        return MagicMock(returncode=0)

    with (
        patch("lib.system_info.subprocess.run", side_effect=fake_run),
        patch("lib.system_info.glob.glob", return_value=[str(version_file)]),
    ):
        result = read_driver_version()
    assert result == "6.2.0"


def test_read_driver_version_nvidia_smi_nonzero_and_no_drm() -> None:
    """nvidia-smi returns non-zero and no DRM path exists --> None."""
    mock_result = MagicMock(returncode=1, stdout="")
    with (
        patch("lib.system_info.subprocess.run", return_value=mock_result),
        patch("lib.system_info.glob.glob", return_value=[]),
    ):
        result = read_driver_version()
    assert result is None


# ─── read_kernel ──────────────────────────────────────────────────────────────


def test_read_kernel_returns_version() -> None:
    mock_result = MagicMock(returncode=0, stdout="6.19.8-1-cachyos\n")
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        result = read_kernel()
    assert result == "6.19.8-1-cachyos"


def test_read_kernel_failure_returns_none() -> None:
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("lib.system_info.subprocess.run", return_value=mock_result):
        result = read_kernel()
    assert result is None


# ─── read_distro ──────────────────────────────────────────────────────────────


def test_read_distro_parses_pretty_name() -> None:
    os_release = 'NAME="CachyOS"\nPRETTY_NAME="CachyOS Linux"\nID=cachyos\n'
    with patch("builtins.open", mock_open(read_data=os_release)):
        result = read_distro()
    assert result == "CachyOS Linux"


def test_read_distro_strips_quotes() -> None:
    os_release = 'PRETTY_NAME="Arch Linux"\n'
    with patch("builtins.open", mock_open(read_data=os_release)):
        result = read_distro()
    assert result == "Arch Linux"


def test_read_distro_missing_file_returns_none() -> None:
    with patch("builtins.open", side_effect=FileNotFoundError):
        result = read_distro()
    assert result is None


# ─── read_custom_proton ───────────────────────────────────────────────────────


def test_read_custom_proton_single_entry(tmp_path: pathlib.Path) -> None:
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()

    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result == "GE-Proton10-1"


def test_read_custom_proton_multiple_entries(tmp_path: pathlib.Path) -> None:
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()
    (compat_dir / "cachyos-10.0").mkdir()

    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result is not None
    assert "GE-Proton10-1" in result
    assert "cachyos-10.0" in result


def test_read_custom_proton_empty_dir(tmp_path: pathlib.Path) -> None:
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)

    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result is None


def test_read_custom_proton_no_dir(tmp_path: pathlib.Path) -> None:
    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result is None


def test_list_installed_compatibility_tools_filters_non_proton_custom_tools(
    tmp_path: pathlib.Path,
) -> None:
    compat_dir = tmp_path / "compatibilitytools.d"
    compat_dir.mkdir()
    (compat_dir / "GE-Proton10-1").mkdir()
    (compat_dir / "Luxtorpeda").mkdir()
    (compat_dir / "Steam Linux Runtime 3.0").mkdir()

    with (
        patch("lib.compat_tools.compat_tools_dirs", return_value=[compat_dir]),
        patch("lib.compat_tools.find_steam_root", return_value=None),
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
    ):
        tools = list_installed_compatibility_tools(None)

    names = {tool["directory_name"] for tool in tools}
    assert "GE-Proton10-1" in names
    assert "Luxtorpeda" not in names
    assert "Steam Linux Runtime 3.0" not in names


def test_export_local_data_backup_rejects_invalid_json(plugin: Plugin) -> None:
    result = asyncio.run(plugin.export_local_data_backup("{"))
    assert result["success"] is False
    assert "invalid JSON" in result["message"]


def test_export_local_data_backup_writes_zip_archive(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    downloads_dir = tmp_path / "Downloads"
    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch("main.time.strftime", return_value="2026-04-10_23-00-00"),
    ):
        result = asyncio.run(
            plugin.export_local_data_backup(
                '{"format":"proton-pulse-local-backup","version":1,"entries":{"language":"\\"de\\""}}'
            )
        )

    archive_path = downloads_dir / "proton-pulse-local-backup-2026-04-10_23-00-00.zip"
    assert result == {
        "success": True,
        "message": f"Local backup exported to {archive_path}",
        "path": str(archive_path),
    }
    with zipfile.ZipFile(archive_path, "r") as archive:
        payload = archive.read("proton-pulse-local-backup.json").decode("utf-8")
    assert '"format": "proton-pulse-local-backup"' in payload


def test_import_local_data_backup_round_trips_payload(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    archive_path = tmp_path / "backup.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "proton-pulse-local-backup.json",
            '{"format":"proton-pulse-local-backup","version":1,"entries":{"language":"\\"fr\\""}}',
        )

    result = asyncio.run(plugin.import_local_data_backup(str(archive_path)))

    assert result["success"] is True
    assert result["message"] == "Imported local backup from backup.zip"
    assert '"language":"\\"fr\\""' in result["payload"]


def test_import_local_data_backup_rejects_missing_payload_file(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    archive_path = tmp_path / "backup.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("other.json", "{}")

    result = asyncio.run(plugin.import_local_data_backup(str(archive_path)))

    assert result["success"] is False
    assert "missing proton-pulse-local-backup.json" in result["message"]


def test_is_game_running_handles_success_and_errors(plugin: Plugin) -> None:
    with patch("main.subprocess.run", return_value=MagicMock(returncode=0)):
        assert asyncio.run(plugin.is_game_running()) is True

    with patch("main.subprocess.run", side_effect=OSError("pgrep missing")):
        assert asyncio.run(plugin.is_game_running()) is False


def test_get_cached_cdn_reports_hit_and_miss(plugin: Plugin) -> None:
    with (
        patch("main.is_fresh", return_value=True),
        patch("main.read_cached", return_value={"reports": 3}),
    ):
        assert asyncio.run(plugin.get_cached_cdn("730", "index.json")) == {
            "data": {"reports": 3},
            "fresh": True,
        }

    with patch("main.is_fresh", return_value=False):
        assert asyncio.run(plugin.get_cached_cdn("730", "index.json")) == {
            "data": None,
            "fresh": False,
        }


def test_put_cached_cdn_updates_cache_metadata(plugin: Plugin) -> None:
    set_meta_mock = MagicMock()

    with (
        patch("main.write_cached"),
        patch("lib.cdn_cache.set_meta", set_meta_mock),
    ):
        assert asyncio.run(plugin.put_cached_cdn("730", "index.json", {"reports": 3})) is True

    set_meta_mock.assert_called_once_with(
        "https://mdeguzis.github.io/proton-pulse-data/data/730/index.json"
    )


def test_check_proton_version_availability_covers_unmanaged_installed_and_missing(
    plugin: Plugin,
) -> None:
    with (
        patch("main.normalize_proton_ge_tag", return_value=None),
        patch("main.read_latest_metadata", return_value=None),
        patch("main.list_installed_compatibility_tools", return_value=[]),
    ):
        unmanaged = asyncio.run(plugin.check_proton_version_availability("Experimental"))
    assert unmanaged["managed"] is False
    assert unmanaged["installed"] is True

    installed_tools = [
        {"display_name": "GE-Proton10-1", "directory_name": "GE-Proton10-1"},
    ]
    releases = [{"tag_name": "GE-Proton10-1"}, {"tag_name": "GE-Proton10-2"}]
    with (
        patch("main.normalize_proton_ge_tag", return_value="GE-Proton10-1"),
        patch("main.read_latest_metadata", return_value=None),
        patch("main.list_installed_compatibility_tools", return_value=installed_tools),
        patch("main.installed_tool_matches_version", side_effect=lambda tool, version: tool["display_name"] == version),
        patch.object(plugin, "get_proton_ge_releases", return_value=releases),
    ):
        installed = asyncio.run(plugin.check_proton_version_availability("GE-Proton10-1"))
    assert installed["installed"] is True
    assert installed["matched_tool_name"] == "GE-Proton10-1"
    assert installed["message"] == "GE-Proton10-1 is already installed."

    with (
        patch("main.normalize_proton_ge_tag", return_value="GE-Proton10-9"),
        patch("main.read_latest_metadata", return_value=None),
        patch("main.list_installed_compatibility_tools", return_value=installed_tools),
        patch("main.installed_tool_matches_version", return_value=False),
        patch("main.find_closest_installed_tool", return_value={"display_name": "GE-Proton10-1"}),
        patch.object(plugin, "get_proton_ge_releases", return_value=releases),
    ):
        missing = asyncio.run(plugin.check_proton_version_availability("GE-Proton10-9"))
    assert missing["installed"] is False
    assert missing["closest_tool_name"] == "GE-Proton10-1"
    assert "was not found in the Proton-GE release feed" in missing["message"]


class _FakeThread:
    def __init__(self, alive: bool = False) -> None:
        self._alive = alive
        self.started = False
        self.join_called_with: float | None = None

    def is_alive(self) -> bool:
        return self._alive

    def start(self) -> None:
        self.started = True

    def join(self, timeout: float | None = None) -> None:
        self.join_called_with = timeout


def test_install_proton_ge_rejects_missing_release(plugin: Plugin) -> None:
    with (
        patch("main.get_releases_sync", return_value=[{"tag_name": "GE-Proton10-1"}]),
        patch("main.normalize_proton_ge_tag", return_value="GE-Proton10-9"),
    ):
        result = asyncio.run(plugin.install_proton_ge("GE-Proton10-9"))

    assert result["success"] is False
    assert "Could not find release" in result["message"]


def test_install_proton_ge_starts_background_thread(plugin: Plugin) -> None:
    fake_thread = _FakeThread()
    release = {"tag_name": "GE-Proton10-1", "asset_size": 1234}

    with (
        patch("main.get_releases_sync", return_value=[release]),
        patch("main.threading.Thread", return_value=fake_thread),
    ):
        result = asyncio.run(plugin.install_proton_ge())

    assert result == {
        "success": True,
        "message": "Started installing GE-Proton10-1.",
        "release": release,
    }
    assert fake_thread.started is True
    assert plugin._proton_ge_install_status["state"] == "running"
    assert plugin._proton_ge_install_status["tag_name"] == "GE-Proton10-1"


def test_cancel_proton_ge_install_updates_status(plugin: Plugin) -> None:
    plugin._proton_ge_install_thread = _FakeThread(alive=True)
    plugin._proton_ge_install_status["tag_name"] = "GE-Proton10-1"
    proc = MagicMock()
    proc.poll.return_value = None
    plugin._proton_ge_install_process_ref[0] = proc

    result = asyncio.run(plugin.cancel_proton_ge_install())

    assert result == {
        "success": True,
        "message": "Cancelling GE-Proton10-1...",
    }
    assert plugin._proton_ge_install_status["stage"] == "cancelling"
    proc.terminate.assert_called_once()


def test_install_compatibility_tool_archive_validates_inputs(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    assert asyncio.run(plugin.install_compatibility_tool_archive("")) == {
        "success": False,
        "message": "No archive path was provided.",
    }

    missing = asyncio.run(plugin.install_compatibility_tool_archive(str(tmp_path / "missing.zip")))
    assert missing["success"] is False
    assert "Archive was not found" in missing["message"]

    bad_file = tmp_path / "notes.txt"
    bad_file.write_text("hello")
    invalid = asyncio.run(plugin.install_compatibility_tool_archive(str(bad_file)))
    assert invalid == {
        "success": False,
        "message": "Archive must be a .zip or tar-based file.",
    }


def test_install_compatibility_tool_archive_extracts_and_finalizes(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    archive_path = tmp_path / "GE-Proton10-1.zip"
    archive_path.write_text("placeholder")
    result_payload = {"success": True, "message": "Installed"}

    with (
        patch("main.compat_tools_dir", return_value=tmp_path / "compatibilitytools.d"),
        patch("main.shutil.copy2"),
        patch("main.extract_archive_safely"),
        patch("main.finalize_extracted_compat_tool", return_value=result_payload) as finalize_mock,
    ):
        result = asyncio.run(plugin.install_compatibility_tool_archive(str(archive_path)))

    assert result is result_payload
    finalize_mock.assert_called_once()


def test_uninstall_compatibility_tool_removes_managed_directory(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    compat_root = tmp_path / "compatibilitytools.d"
    compat_root.mkdir()
    tool_dir = compat_root / "GE-Proton10-1"
    tool_dir.mkdir()

    with (
        patch("main.read_latest_metadata", return_value=None),
        patch(
            "main.list_installed_compatibility_tools",
            return_value=[
                {
                    "directory_name": "GE-Proton10-1",
                    "path": str(tool_dir),
                    "source": "custom",
                }
            ],
        ),
        patch("main.compat_tools_dirs", return_value=[compat_root]),
        patch("main.clear_latest_metadata") as clear_mock,
    ):
        result = asyncio.run(plugin.uninstall_compatibility_tool("GE-Proton10-1"))

    assert result == {"success": True, "message": "Removed GE-Proton10-1."}
    clear_mock.assert_called_once_with("GE-Proton10-1")
    assert not tool_dir.exists()
