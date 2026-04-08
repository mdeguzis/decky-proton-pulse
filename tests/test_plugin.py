# tests/test_plugin.py
# Tests for debug log management, get_log_contents,
# and individual system-detection helpers (now in lib.system_info / lib.plugin_logging).
import asyncio
import logging
import logging.handlers
import os
import pathlib
import sys
from typing import Any, Generator, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open, MagicMock
import pytest
import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from main import Plugin
from lib.plugin_logging import sync_set_log_level, _enable_debug_log, _disable_debug_log
from lib.compat_tools import list_installed_compatibility_tools
from lib.system_info import (
    read_cpu,
    read_gpu,
    read_driver_version,
    read_kernel,
    read_distro,
    read_custom_proton,
)


@pytest.fixture(autouse=True)
def reset_debug_handler() -> Generator[None, None, None]:
    """Ensure no debug handlers bleed between tests."""
    yield
    for h in list(decky.logger.handlers):
        if isinstance(h, logging.handlers.RotatingFileHandler):
            decky.logger.removeHandler(h)
            h.close()


@pytest.fixture
def debug_handler_ref() -> list[Optional[logging.Handler]]:
    """Mutable single-element list used by the logging helpers."""
    return [None]


# ─── Debug log lifecycle ──────────────────────────────────────────────────────


def test_enable_debug_log_adds_handler(debug_handler_ref: Any) -> None:
    before = len(decky.logger.handlers)
    _enable_debug_log(debug_handler_ref)
    assert len(decky.logger.handlers) == before + 1
    assert debug_handler_ref[0] is not None


def test_enable_debug_log_idempotent(debug_handler_ref: Any) -> None:
    _enable_debug_log(debug_handler_ref)
    first_handler = debug_handler_ref[0]
    count_after_first = len(decky.logger.handlers)
    _enable_debug_log(debug_handler_ref)
    assert debug_handler_ref[0] is first_handler
    assert len(decky.logger.handlers) == count_after_first


def test_enable_debug_log_uses_log_dir(debug_handler_ref: Any) -> None:
    _enable_debug_log(debug_handler_ref)
    handler = debug_handler_ref[0]
    expected = os.path.join(decky.DECKY_PLUGIN_LOG_DIR, "plugin-debug.log")
    assert hasattr(handler, "baseFilename")
    assert handler.baseFilename == expected


def test_disable_debug_log_removes_handler(debug_handler_ref: Any) -> None:
    _enable_debug_log(debug_handler_ref)
    before = len(decky.logger.handlers)
    _disable_debug_log(debug_handler_ref)
    assert len(decky.logger.handlers) == before - 1
    assert debug_handler_ref[0] is None


def test_disable_debug_log_when_not_enabled_is_safe(debug_handler_ref: Any) -> None:
    _disable_debug_log(debug_handler_ref)
    assert debug_handler_ref[0] is None


def test_set_log_level_debug_enables_debug_log(debug_handler_ref: Any) -> None:
    result = sync_set_log_level("DEBUG", debug_handler_ref)
    assert result is True
    assert debug_handler_ref[0] is not None


def test_set_log_level_info_disables_debug_log(debug_handler_ref: Any) -> None:
    sync_set_log_level("DEBUG", debug_handler_ref)
    assert debug_handler_ref[0] is not None
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


def test_get_log_contents_includes_debug_log_when_present() -> None:
    def fake_open(path: str, *_args: Any, **_kwargs: Any) -> Any:
        handle = mock_open(
            read_data={
                decky.DECKY_PLUGIN_LOG: "info line\n",
                os.path.join(
                    decky.DECKY_PLUGIN_LOG_DIR, "plugin-debug.log"
                ): "debug line\n",
            }[path]
        ).return_value
        return handle

    with patch("builtins.open", side_effect=fake_open):
        result = asyncio.run(Plugin().get_log_contents())

    assert f"===== {os.path.basename(decky.DECKY_PLUGIN_LOG)} =====" in result
    assert "===== plugin-debug.log =====" in result
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
    lspci_output = "00:1f.3 Audio device: Intel Audio\n00:14.0 USB controller: Intel USB\n"
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

    def fake_run(cmd: Any, **kwargs: Any) -> MagicMock:
        if cmd[0] == "nvidia-smi":
            raise FileNotFoundError("not installed")
        return MagicMock(returncode=0)

    with patch("lib.system_info.subprocess.run", side_effect=fake_run), \
         patch("lib.system_info.glob.glob", return_value=[str(version_file)]):
        result = read_driver_version()
    assert result == "6.2.0"


def test_read_driver_version_nvidia_smi_nonzero_and_no_drm() -> None:
    """nvidia-smi returns non-zero and no DRM path exists --> None."""
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("lib.system_info.subprocess.run", return_value=mock_result), \
         patch("lib.system_info.glob.glob", return_value=[]):
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
