"""Tests for plugin logging and system-info helpers."""

# pyright: reportMissingImports=false, reportMissingModuleSource=false
# pylint: disable=wrong-import-position,missing-function-docstring,redefined-outer-name,broad-exception-caught
import asyncio
import logging
import os
import pathlib
import subprocess
import sys
import threading
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


# --- Debug handler cleanup behavior ---


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


# --- CEF debugging toggle ---


def test_get_cef_debugging_status_reports_marker(tmp_path: pathlib.Path) -> None:
    marker = tmp_path / ".steam" / "steam" / ".cef-enable-remote-debugging"
    marker.parent.mkdir(parents=True)
    marker.touch()
    plugin = Plugin()

    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch.object(plugin, "_is_cef_debug_port_listening", return_value=True),
    ):
        status = asyncio.run(plugin.get_cef_debugging_status())

    assert status["enabled"] is True
    assert status["port_listening"] is True
    assert status["marker_path"] == str(marker)


def test_set_cef_debugging_enabled_creates_marker(tmp_path: pathlib.Path) -> None:
    plugin = Plugin()
    marker = tmp_path / ".steam" / "steam" / ".cef-enable-remote-debugging"

    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch.object(plugin, "_is_cef_debug_port_listening", return_value=False),
    ):
        status = asyncio.run(plugin.set_cef_debugging_enabled(True))

    assert marker.exists()
    assert status["success"] is True
    assert status["enabled"] is True
    assert "Restart Steam" in status["message"]


def test_set_cef_debugging_enabled_removes_marker(tmp_path: pathlib.Path) -> None:
    marker = tmp_path / ".steam" / "steam" / ".cef-enable-remote-debugging"
    marker.parent.mkdir(parents=True)
    marker.touch()
    plugin = Plugin()

    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch.object(plugin, "_is_cef_debug_port_listening", return_value=False),
    ):
        status = asyncio.run(plugin.set_cef_debugging_enabled(False))

    assert not marker.exists()
    assert status["success"] is True
    assert status["enabled"] is False


# --- get_log_contents ---


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


# --- read_cpu ---


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


# --- read_gpu ---


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


# --- read_driver_version ---


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


# --- read_kernel ---


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


# --- read_distro ---


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


# --- read_custom_proton ---


def test_read_custom_proton_single_entry(tmp_path: pathlib.Path) -> None:
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()

    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result == "GE-Proton10-1"


def test_read_custom_proton_multiple_entries_returns_single_best_match(
    tmp_path: pathlib.Path,
) -> None:
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()
    (compat_dir / "cachyos-10.0").mkdir()

    with patch.object(decky, "DECKY_USER_HOME", str(tmp_path)):
        result = read_custom_proton()
    assert result == "GE-Proton10-1"


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


def test_plugin_lifecycle_hooks_manage_background_threads(plugin: Plugin) -> None:
    fake_prefetch_thread = _FakeThread(alive=True)
    install_thread = _FakeThread(alive=True)
    proc = MagicMock()
    proc.poll.return_value = None
    plugin._proton_ge_install_thread = install_thread
    plugin._proton_ge_install_process_ref[0] = proc

    with patch("main.threading.Thread", return_value=fake_prefetch_thread):
        asyncio.run(plugin._main())

    assert fake_prefetch_thread.started is True
    assert isinstance(plugin._prefetch_cancel, threading.Event)
    assert plugin._proton_ge_install_status["state"] == "idle"

    plugin._proton_ge_install_thread = install_thread
    plugin._proton_ge_install_process_ref[0] = proc
    asyncio.run(plugin._unload())

    assert plugin._prefetch_cancel.is_set() is True
    assert plugin._proton_ge_install_cancel.is_set() is True
    proc.terminate.assert_called_once()
    assert install_thread.join_called_with == 10


def test_migration_hook_and_metadata_helpers(plugin: Plugin) -> None:
    class _ImmediateLoop:
        def run_in_executor(self, _executor: object, _fn: object) -> object:
            return asyncio.sleep(0, result={"gpu": "amd"})

    with (
        patch("main.generate_system_info", return_value="blob"),
        patch("main.export_metrics_to_disk", return_value=True),
        patch("main.get_installed_game_stats", return_value={"installed_steam_games": 25, "installed_steam_app_ids": ["570"]}),
        patch("main.log_frontend_event", return_value=True),
        patch("asyncio.get_event_loop", return_value=_ImmediateLoop()),
    ):
        assert asyncio.run(plugin._migration()) is None
        assert asyncio.run(plugin.get_plugin_version()) == "0.0.0-test"
        assert asyncio.run(plugin.get_protondb_systeminfo()) == "blob"
        assert asyncio.run(plugin.export_metrics("{}")) is True
        assert asyncio.run(plugin.get_system_info()) == {"gpu": "amd"}
        assert asyncio.run(plugin.get_installed_game_stats()) == {
            "installed_steam_games": 25,
            "installed_steam_app_ids": ["570"],
        }
        assert asyncio.run(plugin.log_frontend_event("info", "hello")) is True


def test_get_protondb_systeminfo_reports_errors(plugin: Plugin) -> None:
    with patch("main.generate_system_info", side_effect=ValueError("broken")):
        result = asyncio.run(plugin.get_protondb_systeminfo())
    assert result == "Error generating system info: broken"


def test_main_logs_and_reraises_startup_crashes(plugin: Plugin) -> None:
    with patch.object(plugin, "_main_impl", side_effect=RuntimeError("boom")), patch.object(
        decky.logger, "error"
    ) as error_mock:
        with pytest.raises(RuntimeError, match="boom"):
            asyncio.run(plugin._main())

    error_mock.assert_called_once()


def test_copy_to_clipboard_prefers_first_available_tool_and_falls_back(plugin: Plugin) -> None:
    with patch("main.shutil.which", side_effect=lambda cmd: "/usr/bin/wl-copy" if cmd == "wl-copy" else None), patch(
        "main.subprocess.run"
    ) as run_mock:
        assert asyncio.run(plugin.copy_to_clipboard("hello")) is True
    run_mock.assert_called_once_with(["wl-copy", "--"], input="hello", check=True, timeout=5)

    which_calls = []

    def fake_which(cmd: str) -> str | None:
        which_calls.append(cmd)
        return "/usr/bin/xclip" if cmd == "xclip" else "/usr/bin/wl-copy"

    with patch("main.shutil.which", side_effect=fake_which), patch(
        "main.subprocess.run",
        side_effect=[subprocess.SubprocessError("wl-copy failed"), None],
    ) as run_mock:
        assert asyncio.run(plugin.copy_to_clipboard("hello")) is True

    assert which_calls == ["wl-copy", "xclip"]
    assert run_mock.call_count == 2


def test_copy_to_clipboard_returns_false_when_no_tool_exists(plugin: Plugin) -> None:
    with patch("main.shutil.which", return_value=None):
        assert asyncio.run(plugin.copy_to_clipboard("hello")) is False


def test_get_game_requirements_wrapper(plugin: Plugin) -> None:
    with patch("lib.game_requirements.get_game_requirements", return_value={"min_ram_gb": 16}) as get_requirements:
        assert asyncio.run(plugin.get_game_requirements("730")) == {"min_ram_gb": 16}

    get_requirements.assert_called_once_with("730")


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


def test_export_local_data_backup_rejects_wrong_format(plugin: Plugin) -> None:
    result = asyncio.run(plugin.export_local_data_backup('{"format":"other"}'))
    assert result == {
        "success": False,
        "message": "Backup payload format is not supported.",
    }


def test_export_local_data_backup_reports_write_failures(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch("main.zipfile.ZipFile", side_effect=OSError("disk full")),
    ):
        result = asyncio.run(
            plugin.export_local_data_backup(
                '{"format":"proton-pulse-local-backup","version":1,"entries":{}}'
            )
        )

    assert result["success"] is False
    assert "Could not write backup archive: disk full" == result["message"]


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


def test_import_local_data_backup_handles_missing_archive_and_invalid_payloads(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    missing = asyncio.run(plugin.import_local_data_backup(str(tmp_path / "missing.zip")))
    assert missing["success"] is False
    assert "Backup archive was not found" in missing["message"]

    invalid_zip = tmp_path / "invalid.zip"
    invalid_zip.write_text("not a zip")
    invalid_result = asyncio.run(plugin.import_local_data_backup(str(invalid_zip)))
    assert invalid_result["success"] is False
    assert "Could not read backup archive" in invalid_result["message"]

    bad_json = tmp_path / "bad-json.zip"
    with zipfile.ZipFile(bad_json, "w") as archive:
        archive.writestr("proton-pulse-local-backup.json", "{")
    bad_json_result = asyncio.run(plugin.import_local_data_backup(str(bad_json)))
    assert bad_json_result["success"] is False
    assert "invalid JSON" in bad_json_result["message"]

    wrong_format = tmp_path / "wrong-format.zip"
    with zipfile.ZipFile(wrong_format, "w") as archive:
        archive.writestr("proton-pulse-local-backup.json", '{"format":"other"}')
    wrong_format_result = asyncio.run(plugin.import_local_data_backup(str(wrong_format)))
    assert wrong_format_result == {
        "success": False,
        "message": "Backup archive format is not supported.",
    }


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

    with (
        patch("main.is_fresh", return_value=True),
        patch("main.read_cached", return_value=None),
    ):
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
        "https://www.proton-pulse.com/data/730/index.json"
    )


def test_put_cached_cdn_handles_write_failures(plugin: Plugin) -> None:
    with patch("main.write_cached", side_effect=OSError("read only")):
        assert asyncio.run(plugin.put_cached_cdn("730", "index.json", {"reports": 3})) is False


def test_proton_ge_metadata_helpers(plugin: Plugin) -> None:
    install_status = {"state": "idle"}
    releases = [{"tag_name": "GE-Proton10-2"}, {"tag_name": "GE-Proton10-1"}]
    installed_tools = [
        {"display_name": "GE-Proton10-2", "directory_name": "GE-Proton10-2", "managed_slot": "latest"},
        {"display_name": "GE-Proton10-1", "directory_name": "GE-Proton10-1"},
    ]

    with (
        patch("main.read_latest_metadata", return_value={"latest": "GE-Proton10-2"}),
        patch("main.list_installed_compatibility_tools", return_value=installed_tools),
        patch("main.get_releases_sync", return_value=releases),
        patch("main.get_install_status", return_value=install_status),
        patch(
            "main.installed_tool_matches_version",
            side_effect=lambda tool, version: tool["display_name"] == version,
        ),
    ):
        assert asyncio.run(plugin.list_installed_compatibility_tools()) == installed_tools
        assert asyncio.run(plugin.get_proton_ge_releases(True)) == releases
        state = asyncio.run(plugin.get_proton_ge_manager_state(True))

    assert state["current_release"] == releases[0]
    assert state["current_installed"] is True
    assert state["current_latest_slot_installed"] is True
    assert state["install_status"] == install_status


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

    with (
        patch("main.normalize_proton_ge_tag", return_value="GE-Proton10-2"),
        patch("main.read_latest_metadata", return_value=None),
        patch("main.list_installed_compatibility_tools", return_value=[]),
        patch("main.installed_tool_matches_version", return_value=False),
        patch.object(plugin, "get_proton_ge_releases", return_value=releases),
    ):
        available = asyncio.run(plugin.check_proton_version_availability("GE-Proton10-2"))
    assert available["installed"] is False
    assert available["release"] == {"tag_name": "GE-Proton10-2"}
    assert available["message"] == "GE-Proton10-2 is available to install."


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


class _CapturedThread:
    def __init__(self, target: Any = None, **_kwargs: Any) -> None:
        self._target = target
        self.started = False
        self._alive = False

    def is_alive(self) -> bool:
        return self._alive

    def start(self) -> None:
        self.started = True

    def run_target(self) -> None:
        self._alive = True
        try:
            if self._target is not None:
                self._target()
        finally:
            self._alive = False


def test_install_proton_ge_rejects_missing_release(plugin: Plugin) -> None:
    with (
        patch("main.get_releases_sync", return_value=[{"tag_name": "GE-Proton10-1"}]),
        patch("main.normalize_proton_ge_tag", return_value="GE-Proton10-9"),
    ):
        result = asyncio.run(plugin.install_proton_ge("GE-Proton10-9"))

    assert result["success"] is False
    assert "Could not find release" in result["message"]


def test_install_proton_ge_rejects_empty_release_feed(plugin: Plugin) -> None:
    with patch("main.get_releases_sync", return_value=[]):
        result = asyncio.run(plugin.install_proton_ge())

    assert result == {
        "success": False,
        "message": "No Proton-GE release is available right now.",
        "release": None,
    }


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


def test_install_proton_ge_reports_existing_running_install(plugin: Plugin) -> None:
    plugin._proton_ge_install_thread = _FakeThread(alive=True)
    plugin._proton_ge_install_status.update({"message": "Already installing", "tag_name": "GE-Proton10-1"})
    release = {"tag_name": "GE-Proton10-2", "asset_size": 1234}

    with patch("main.get_releases_sync", return_value=[release]):
        result = asyncio.run(plugin.install_proton_ge())

    assert result == {
        "success": False,
        "message": "Already installing",
        "release": release,
    }


def test_install_proton_ge_runs_worker_success_path(plugin: Plugin) -> None:
    release = {"tag_name": "GE-Proton10-1", "asset_size": 1234}
    status_updates: list[dict[str, Any]] = []
    captured_thread: _CapturedThread | None = None

    def fake_set_install_status(status_ref: dict[str, Any], _lock_ref: Any, **kwargs: Any) -> None:
        status_ref.update(kwargs)
        status_updates.append(kwargs)

    def make_thread(**kwargs: Any) -> _CapturedThread:
        nonlocal captured_thread
        captured_thread = _CapturedThread(**kwargs)
        return captured_thread

    with (
        patch("main.get_releases_sync", return_value=[release]),
        patch("main.threading.Thread", side_effect=make_thread),
        patch("main.install_sync", return_value={"success": True, "message": "Installed"}),
        patch("main.set_install_status", side_effect=fake_set_install_status),
    ):
        result = asyncio.run(plugin.install_proton_ge())
        assert captured_thread is not None
        captured_thread.run_target()

    assert result == {
        "success": True,
        "message": "Started installing GE-Proton10-1.",
        "release": release,
    }
    assert any(update.get("state") == "success" for update in status_updates)
    assert plugin._proton_ge_install_thread is None
    assert plugin._proton_ge_install_process_ref[0] is None


def test_install_proton_ge_runs_worker_cancelled_path(plugin: Plugin) -> None:
    release = {"tag_name": "GE-Proton10-1", "asset_size": 1234}
    status_updates: list[dict[str, Any]] = []
    captured_thread: _CapturedThread | None = None

    def fake_install_sync(
        _normalized: str,
        _install_as_latest: bool,
        _force_reinstall: bool,
        _status_ref: dict[str, Any],
        _lock_ref: Any,
        cancel_ref: threading.Event,
        _process_ref: Any,
    ) -> dict[str, Any]:
        cancel_ref.set()
        return {"success": False, "message": "User cancelled"}

    def fake_set_install_status(status_ref: dict[str, Any], _lock_ref: Any, **kwargs: Any) -> None:
        status_ref.update(kwargs)
        status_updates.append(kwargs)

    def make_thread(**kwargs: Any) -> _CapturedThread:
        nonlocal captured_thread
        captured_thread = _CapturedThread(**kwargs)
        return captured_thread

    with (
        patch("main.get_releases_sync", return_value=[release]),
        patch("main.threading.Thread", side_effect=make_thread),
        patch("main.install_sync", side_effect=fake_install_sync),
        patch("main.set_install_status", side_effect=fake_set_install_status),
    ):
        asyncio.run(plugin.install_proton_ge())
        assert captured_thread is not None
        captured_thread.run_target()

    assert any(update.get("stage") == "cancelled" for update in status_updates)
    assert any(update.get("message") == "User cancelled" for update in status_updates)
    assert plugin._proton_ge_install_thread is None


def test_install_proton_ge_runs_worker_exception_path(plugin: Plugin) -> None:
    release = {"tag_name": "GE-Proton10-1", "asset_size": 1234}
    status_updates: list[dict[str, Any]] = []
    captured_thread: _CapturedThread | None = None

    def fake_set_install_status(status_ref: dict[str, Any], _lock_ref: Any, **kwargs: Any) -> None:
        status_ref.update(kwargs)
        status_updates.append(kwargs)

    def make_thread(**kwargs: Any) -> _CapturedThread:
        nonlocal captured_thread
        captured_thread = _CapturedThread(**kwargs)
        return captured_thread

    with (
        patch("main.get_releases_sync", return_value=[release]),
        patch("main.threading.Thread", side_effect=make_thread),
        patch("main.install_sync", side_effect=ValueError("boom")),
        patch("main.set_install_status", side_effect=fake_set_install_status),
    ):
        asyncio.run(plugin.install_proton_ge())
        assert captured_thread is not None
        captured_thread.run_target()

    assert any(update.get("state") == "error" for update in status_updates)
    assert any("Install failed for GE-Proton10-1: boom" == update.get("message") for update in status_updates)
    assert plugin._proton_ge_install_thread is None


def test_cancel_proton_ge_install_handles_idle_and_missing_proc(plugin: Plugin) -> None:
    assert asyncio.run(plugin.cancel_proton_ge_install()) == {
        "success": False,
        "message": "No Proton-GE install is currently running.",
    }

    plugin._proton_ge_install_thread = _FakeThread(alive=True)
    plugin._proton_ge_install_process_ref[0] = MagicMock(poll=MagicMock(return_value=0))
    result = asyncio.run(plugin.cancel_proton_ge_install())
    assert result == {
        "success": True,
        "message": "Cancelling Proton-GE...",
    }


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


def test_install_compatibility_tool_archive_reports_extraction_errors(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    archive_path = tmp_path / "GE-Proton10-1.zip"
    archive_path.write_text("placeholder")

    with (
        patch("main.compat_tools_dir", return_value=tmp_path / "compatibilitytools.d"),
        patch("main.shutil.copy2", side_effect=OSError("copy failed")),
    ):
        result = asyncio.run(plugin.install_compatibility_tool_archive(str(archive_path)))

    assert result == {
        "success": False,
        "message": "Install failed for GE-Proton10-1.zip: copy failed",
    }


def test_uninstall_compatibility_tool_validates_error_paths(
    plugin: Plugin, tmp_path: pathlib.Path
) -> None:
    assert asyncio.run(plugin.uninstall_compatibility_tool("")) == {
        "success": False,
        "message": "No compatibility tool was specified.",
    }

    with (
        patch("main.read_latest_metadata", return_value=None),
        patch("main.list_installed_compatibility_tools", return_value=[]),
    ):
        missing = asyncio.run(plugin.uninstall_compatibility_tool("GE-Proton10-1"))
    assert missing == {
        "success": False,
        "message": "GE-Proton10-1 is not installed.",
    }

    with (
        patch("main.read_latest_metadata", return_value=None),
        patch(
            "main.list_installed_compatibility_tools",
            return_value=[{"directory_name": "Proton 9", "path": "/tmp/valve", "source": "valve"}],
        ),
    ):
        valve = asyncio.run(plugin.uninstall_compatibility_tool("Proton 9"))
    assert valve == {
        "success": False,
        "message": "Proton 9 is a built-in Valve tool and cannot be removed.",
    }

    missing_disk = tmp_path / "missing-tool"
    with (
        patch("main.read_latest_metadata", return_value=None),
        patch(
            "main.list_installed_compatibility_tools",
            return_value=[{"directory_name": "GE-Proton10-1", "path": str(missing_disk), "source": "custom"}],
        ),
    ):
        missing_on_disk = asyncio.run(plugin.uninstall_compatibility_tool("GE-Proton10-1"))
    assert missing_on_disk == {
        "success": False,
        "message": "GE-Proton10-1 is not available on disk anymore.",
    }

    outside_dir = tmp_path / "outside" / "GE-Proton10-1"
    outside_dir.mkdir(parents=True)
    with (
        patch("main.read_latest_metadata", return_value=None),
        patch(
            "main.list_installed_compatibility_tools",
            return_value=[{"directory_name": "GE-Proton10-1", "path": str(outside_dir), "source": "custom"}],
        ),
        patch("main.compat_tools_dirs", return_value=[tmp_path / "compatibilitytools.d"]),
    ):
        outside = asyncio.run(plugin.uninstall_compatibility_tool("GE-Proton10-1"))
    assert outside == {
        "success": False,
        "message": "GE-Proton10-1 is outside the managed compatibility tools directories.",
    }


def test_uninstall_compatibility_tool_reports_remove_errors(
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
        patch("main.shutil.rmtree", side_effect=OSError("permission denied")),
    ):
        result = asyncio.run(plugin.uninstall_compatibility_tool("GE-Proton10-1"))

    assert result == {
        "success": False,
        "message": "Failed to remove GE-Proton10-1: permission denied",
    }


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


# --- CEF debug socket error path ---


def test_is_cef_debug_port_listening_returns_false_on_oserror() -> None:
    plugin = Plugin()
    with patch("main.socket.create_connection", side_effect=OSError("refused")):
        result = plugin._is_cef_debug_port_listening()
    assert result is False


def test_set_cef_debugging_enabled_returns_error_on_oserror(tmp_path: pathlib.Path) -> None:
    plugin = Plugin()
    with (
        patch.object(decky, "DECKY_USER_HOME", str(tmp_path)),
        patch.object(plugin, "_is_cef_debug_port_listening", return_value=False),
        patch("pathlib.Path.touch", side_effect=OSError("permission denied")),
    ):
        result = asyncio.run(plugin.set_cef_debugging_enabled(True))

    assert result["success"] is False
    assert "permission denied" in result["message"]


# --- cleanup thread join paths ---


def test_unload_joins_lsfg_vk_thread_when_alive(plugin: Plugin) -> None:
    fake = _FakeThread(alive=True)
    plugin._lsfg_vk_install_thread = fake  # type: ignore[assignment]
    asyncio.run(plugin._unload())
    assert fake.join_called_with == 10


# --- LSFG-VK availability ---


def test_is_lsfg_vk_available_when_present(plugin: Plugin) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_binary_path.return_value = pathlib.Path("/path/to/lsfg-vk")
        result = asyncio.run(plugin.is_lsfg_vk_available())
    assert result["available"] is True
    assert result["path"] == "/path/to/lsfg-vk"


def test_is_lsfg_vk_available_when_absent(plugin: Plugin) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_binary_path.return_value = None
        result = asyncio.run(plugin.is_lsfg_vk_available())
    assert result["available"] is False
    assert result["path"] is None


# --- LSFG-VK manager state ---


def test_get_lsfg_vk_manager_state_returns_bundled_info(plugin: Plugin) -> None:
    release = {"tag_name": "v1.0.0", "asset_size": 5000}
    installed = [{"tag_name": "v1.0.0", "managed_slot": "latest"}]
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_releases_sync.return_value = [release]
        mod.read_latest_metadata.return_value = None
        mod.list_installed_lsfg_vk.return_value = installed
        mod.get_install_status.return_value = {"state": "idle"}
        mod.is_binary_available.return_value = True
        mod.get_binary_path.return_value = pathlib.Path("/lsfg/lsfg-vk")
        result = asyncio.run(plugin.get_lsfg_vk_manager_state())

    assert result["current_release"] == release
    assert result["current_installed"] is True
    assert result["current_latest_slot_installed"] is True
    assert result["installed_versions"] == installed


def test_get_lsfg_vk_manager_state_no_releases(plugin: Plugin) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_releases_sync.return_value = []
        mod.read_latest_metadata.return_value = None
        mod.list_installed_lsfg_vk.return_value = []
        mod.get_install_status.return_value = {"state": "idle"}
        mod.is_binary_available.return_value = False
        mod.get_binary_path.return_value = None
        result = asyncio.run(plugin.get_lsfg_vk_manager_state())

    assert result["current_release"] is None
    assert result["current_installed"] is False


# --- LSFG-VK install ---


def test_install_lsfg_vk_rejects_missing_version(plugin: Plugin) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_releases_sync.return_value = [{"tag_name": "v1.0.0"}]
        result = asyncio.run(plugin.install_lsfg_vk(version="v9.9.9"))
    assert result["success"] is False
    assert "Could not find" in result["message"]


def test_install_lsfg_vk_rejects_empty_release_feed(plugin: Plugin) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_releases_sync.return_value = []
        mod.make_initial_status.return_value = {}
        result = asyncio.run(plugin.install_lsfg_vk())
    assert result["success"] is False
    assert "No LSFG-VK release" in result["message"]


def test_install_lsfg_vk_reports_already_running(plugin: Plugin) -> None:
    plugin._lsfg_vk_install_thread = _FakeThread(alive=True)  # type: ignore[assignment]
    plugin._lsfg_vk_install_status.update({"message": "busy", "tag_name": "v1.0.0"})
    with patch("main._lsfg_vk_mod") as mod:
        mod.get_releases_sync.return_value = [{"tag_name": "v1.0.0", "asset_size": 1}]
        result = asyncio.run(plugin.install_lsfg_vk())
    assert result["success"] is False
    assert result["message"] == "busy"


def test_install_lsfg_vk_starts_background_thread(plugin: Plugin) -> None:
    release = {"tag_name": "v1.0.0", "asset_size": 1234}
    fake_thread = _FakeThread()
    with (
        patch("main._lsfg_vk_mod") as mod,
        patch("main.threading.Thread", return_value=fake_thread),
    ):
        mod.get_releases_sync.return_value = [release]
        mod.make_initial_status.return_value = {}
        result = asyncio.run(plugin.install_lsfg_vk())
    assert result["success"] is True
    assert "v1.0.0" in result["message"]
    assert fake_thread.started is True


def test_install_lsfg_vk_worker_success_path(plugin: Plugin) -> None:
    release = {"tag_name": "v1.0.0", "asset_size": 1}
    captured: list[_CapturedThread] = []

    def make_thread(target: Any = None, **kw: Any) -> _CapturedThread:
        t = _CapturedThread(target=target)
        captured.append(t)
        return t

    with (
        patch("main._lsfg_vk_mod") as mod,
        patch("main.threading.Thread", side_effect=make_thread),
    ):
        mod.get_releases_sync.return_value = [release]
        mod.make_initial_status.return_value = {}
        mod.install_sync.return_value = {"success": True, "message": "done"}
        mod.set_install_status = MagicMock()
        asyncio.run(plugin.install_lsfg_vk())
        captured[0].run_target()

    mod.set_install_status.assert_called()
    call_kwargs = mod.set_install_status.call_args.kwargs
    assert call_kwargs.get("state") == "success"


def test_install_lsfg_vk_worker_cancelled_path(plugin: Plugin) -> None:
    release = {"tag_name": "v1.0.0", "asset_size": 1}
    captured: list[_CapturedThread] = []

    def make_thread(target: Any = None, **kw: Any) -> _CapturedThread:
        t = _CapturedThread(target=target)
        captured.append(t)
        return t

    with (
        patch("main._lsfg_vk_mod") as mod,
        patch("main.threading.Thread", side_effect=make_thread),
    ):
        mod.get_releases_sync.return_value = [release]
        mod.make_initial_status.return_value = {}
        mod.install_sync.return_value = {"success": False, "message": "cancelled"}
        mod.set_install_status = MagicMock()
        asyncio.run(plugin.install_lsfg_vk())
        plugin._lsfg_vk_install_cancel.set()
        captured[0].run_target()

    call_kwargs = mod.set_install_status.call_args.kwargs
    assert call_kwargs.get("state") == "error"
    assert call_kwargs.get("stage") == "cancelled"


def test_install_lsfg_vk_worker_exception_path(plugin: Plugin) -> None:
    release = {"tag_name": "v1.0.0", "asset_size": 1}
    captured: list[_CapturedThread] = []

    def make_thread(target: Any = None, **kw: Any) -> _CapturedThread:
        t = _CapturedThread(target=target)
        captured.append(t)
        return t

    with (
        patch("main._lsfg_vk_mod") as mod,
        patch("main.threading.Thread", side_effect=make_thread),
    ):
        mod.get_releases_sync.return_value = [release]
        mod.make_initial_status.return_value = {}
        mod.install_sync.side_effect = OSError("disk full")
        mod.set_install_status = MagicMock()
        asyncio.run(plugin.install_lsfg_vk())
        captured[0].run_target()

    call_kwargs = mod.set_install_status.call_args.kwargs
    assert call_kwargs.get("state") == "error"
    assert "disk full" in (call_kwargs.get("message") or "")


# --- LSFG-VK cancel ---


def test_cancel_lsfg_vk_install_returns_error_when_not_running(plugin: Plugin) -> None:
    result = asyncio.run(plugin.cancel_lsfg_vk_install())
    assert result["success"] is False
    assert "No LSFG-VK install" in result["message"]


def test_cancel_lsfg_vk_install_signals_running_thread(plugin: Plugin) -> None:
    plugin._lsfg_vk_install_thread = _FakeThread(alive=True)  # type: ignore[assignment]
    plugin._lsfg_vk_install_status.update({"tag_name": "v1.0.0"})
    result = asyncio.run(plugin.cancel_lsfg_vk_install())
    assert result["success"] is True
    assert plugin._lsfg_vk_install_cancel.is_set()


# --- LSFG-VK uninstall ---


def test_uninstall_lsfg_vk_rejects_empty_name(plugin: Plugin) -> None:
    result = asyncio.run(plugin.uninstall_lsfg_vk(""))
    assert result["success"] is False
    assert "No LSFG-VK version" in result["message"]


def test_uninstall_lsfg_vk_rejects_missing_dir(plugin: Plugin, tmp_path: pathlib.Path) -> None:
    with patch("main._lsfg_vk_mod") as mod:
        mod.lsfg_vk_install_dir.return_value = tmp_path
        result = asyncio.run(plugin.uninstall_lsfg_vk("v1.0.0"))
    assert result["success"] is False
    assert "not installed" in result["message"]


def test_uninstall_lsfg_vk_removes_directory(plugin: Plugin, tmp_path: pathlib.Path) -> None:
    target = tmp_path / "v1.0.0"
    target.mkdir()
    with patch("main._lsfg_vk_mod") as mod:
        mod.lsfg_vk_install_dir.return_value = tmp_path
        mod.clear_latest_metadata = MagicMock()
        mod.list_installed_lsfg_vk.return_value = [{"tag_name": "v1.0.0"}]
        result = asyncio.run(plugin.uninstall_lsfg_vk("v1.0.0"))
    assert result["success"] is True
    assert not target.exists()


def test_uninstall_lsfg_vk_removes_installed_files_when_last(plugin: Plugin, tmp_path: pathlib.Path) -> None:
    target = tmp_path / "v1.0.0"
    target.mkdir()
    with patch("main._lsfg_vk_mod") as mod:
        mod.lsfg_vk_install_dir.return_value = tmp_path
        mod.clear_latest_metadata = MagicMock()
        mod.list_installed_lsfg_vk.return_value = []
        mod._remove_installed_files = MagicMock()
        asyncio.run(plugin.uninstall_lsfg_vk("v1.0.0"))
    mod._remove_installed_files.assert_called_once()


def test_uninstall_lsfg_vk_reports_oserror(plugin: Plugin, tmp_path: pathlib.Path) -> None:
    target = tmp_path / "v1.0.0"
    target.mkdir()
    with (
        patch("main._lsfg_vk_mod") as mod,
        patch("main.shutil.rmtree", side_effect=OSError("perm denied")),
    ):
        mod.lsfg_vk_install_dir.return_value = tmp_path
        result = asyncio.run(plugin.uninstall_lsfg_vk("v1.0.0"))
    assert result["success"] is False
    assert "perm denied" in result["message"]
