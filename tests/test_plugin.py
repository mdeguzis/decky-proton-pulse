# tests/test_plugin.py
# Tests for untested Plugin methods: debug log management, get_log_contents,
# and individual system-detection helpers.
import asyncio
import logging
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open, MagicMock
import pytest
import decky

from main import Plugin


@pytest.fixture(autouse=True)
def reset_debug_handler():
    """Ensure no debug handlers bleed between tests."""
    yield
    # Remove any handlers the test may have added to the shared logger.
    for h in list(decky.logger.handlers):
        if isinstance(h, logging.handlers.RotatingFileHandler):
            decky.logger.removeHandler(h)
            h.close()


@pytest.fixture
def plugin():
    p = Plugin()
    p._debug_handler = None
    return p


# ─── Debug log lifecycle ──────────────────────────────────────────────────────

import logging.handlers  # used in fixture above


def test_enable_debug_log_adds_handler(plugin):
    before = len(decky.logger.handlers)
    plugin._enable_debug_log()
    assert len(decky.logger.handlers) == before + 1
    assert plugin._debug_handler is not None


def test_enable_debug_log_idempotent(plugin):
    plugin._enable_debug_log()
    first_handler = plugin._debug_handler
    count_after_first = len(decky.logger.handlers)
    plugin._enable_debug_log()
    assert plugin._debug_handler is first_handler
    assert len(decky.logger.handlers) == count_after_first


def test_enable_debug_log_uses_log_dir(plugin):
    plugin._enable_debug_log()
    expected = os.path.join(decky.DECKY_PLUGIN_LOG_DIR, 'plugin-debug.log')
    assert plugin._debug_handler.baseFilename == expected


def test_disable_debug_log_removes_handler(plugin):
    plugin._enable_debug_log()
    before = len(decky.logger.handlers)
    plugin._disable_debug_log()
    assert len(decky.logger.handlers) == before - 1
    assert plugin._debug_handler is None


def test_disable_debug_log_when_not_enabled_is_safe(plugin):
    # Should not raise even if called with no handler set.
    plugin._disable_debug_log()
    assert plugin._debug_handler is None


def test_set_log_level_debug_enables_debug_log(plugin):
    result = plugin._sync_set_log_level("DEBUG")
    assert result is True
    assert plugin._debug_handler is not None


def test_set_log_level_info_disables_debug_log(plugin):
    plugin._sync_set_log_level("DEBUG")
    assert plugin._debug_handler is not None
    plugin._sync_set_log_level("INFO")
    assert plugin._debug_handler is None


def test_set_log_level_warning_disables_debug_log(plugin):
    plugin._sync_set_log_level("DEBUG")
    plugin._sync_set_log_level("WARNING")
    assert plugin._debug_handler is None


# ─── get_log_contents ─────────────────────────────────────────────────────────

def test_get_log_contents_returns_last_200_lines():
    lines = [f"line {i}\n" for i in range(300)]
    content = "".join(lines)
    with patch("builtins.open", mock_open(read_data=content)):
        result = asyncio.run(Plugin().get_log_contents())
    # Last 200 lines — should contain "line 100" through "line 299"
    assert "line 299" in result
    assert "line 100" in result
    assert "line 99\n" not in result


def test_get_log_contents_fewer_than_200_lines():
    content = "line A\nline B\nline C\n"
    with patch("builtins.open", mock_open(read_data=content)):
        result = asyncio.run(Plugin().get_log_contents())
    assert "line A" in result
    assert "line C" in result


def test_get_log_contents_missing_file_returns_empty():
    with patch("builtins.open", side_effect=FileNotFoundError):
        result = asyncio.run(Plugin().get_log_contents())
    assert result == ""


# ─── _read_cpu ────────────────────────────────────────────────────────────────

def test_read_cpu_parses_model_name():
    cpuinfo = (
        "processor\t: 0\n"
        "model name\t: AMD Ryzen 9 9950X3D\n"
        "cpu MHz\t\t: 3700.000\n"
    )
    with patch("builtins.open", mock_open(read_data=cpuinfo)):
        result = Plugin()._read_cpu()
    assert result == "AMD Ryzen 9 9950X3D"


def test_read_cpu_returns_none_when_no_model_name():
    cpuinfo = "processor\t: 0\ncpu MHz\t\t: 3700.000\n"
    with patch("builtins.open", mock_open(read_data=cpuinfo)):
        result = Plugin()._read_cpu()
    assert result is None


# ─── _read_gpu ────────────────────────────────────────────────────────────────

def test_read_gpu_parses_vga_line():
    lspci_output = (
        "00:02.0 VGA compatible controller: NVIDIA GeForce RTX 5080 [Blackwell] (rev a1)\n"
        "00:1f.3 Audio device: Intel Audio\n"
    )
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("subprocess.run", return_value=mock_result):
        gpu, vendor = Plugin()._read_gpu()
    assert "RTX 5080" in gpu
    assert vendor == "nvidia"


def test_read_gpu_parses_3d_controller():
    lspci_output = "00:00.0 3D controller: AMD Radeon RX 7900 XTX\n"
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("subprocess.run", return_value=mock_result):
        gpu, vendor = Plugin()._read_gpu()
    assert "7900 XTX" in gpu
    assert vendor == "amd"


def test_read_gpu_no_gpu_returns_none():
    lspci_output = "00:1f.3 Audio device: Intel Audio\n00:14.0 USB controller: Intel USB\n"
    mock_result = MagicMock(returncode=0, stdout=lspci_output)
    with patch("subprocess.run", return_value=mock_result):
        gpu, vendor = Plugin()._read_gpu()
    assert gpu is None
    assert vendor is None


def test_read_gpu_lspci_failure_returns_none():
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("subprocess.run", return_value=mock_result):
        gpu, vendor = Plugin()._read_gpu()
    assert gpu is None
    assert vendor is None


# ─── _read_driver_version ─────────────────────────────────────────────────────

def test_read_driver_version_nvidia_smi_success():
    mock_result = MagicMock(returncode=0, stdout="595.45.04\n")
    with patch("subprocess.run", return_value=mock_result):
        result = Plugin()._read_driver_version()
    assert result == "595.45.04"


def test_read_driver_version_fallback_drm(tmp_path):
    """nvidia-smi not found → reads DRM sysfs path."""
    version_file = tmp_path / "version"
    version_file.write_text("6.2.0\n")

    def fake_run(cmd, **kwargs):
        if cmd[0] == "nvidia-smi":
            raise FileNotFoundError("not installed")
        return MagicMock(returncode=0)

    with patch("subprocess.run", side_effect=fake_run), \
         patch("glob.glob", return_value=[str(version_file)]):
        result = Plugin()._read_driver_version()
    assert result == "6.2.0"


def test_read_driver_version_nvidia_smi_nonzero_and_no_drm():
    """nvidia-smi returns non-zero and no DRM path exists → None."""
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("subprocess.run", return_value=mock_result), \
         patch("glob.glob", return_value=[]):
        result = Plugin()._read_driver_version()
    assert result is None


# ─── _read_kernel ─────────────────────────────────────────────────────────────

def test_read_kernel_returns_version():
    mock_result = MagicMock(returncode=0, stdout="6.19.8-1-cachyos\n")
    with patch("subprocess.run", return_value=mock_result):
        result = Plugin()._read_kernel()
    assert result == "6.19.8-1-cachyos"


def test_read_kernel_failure_returns_none():
    mock_result = MagicMock(returncode=1, stdout="")
    with patch("subprocess.run", return_value=mock_result):
        result = Plugin()._read_kernel()
    assert result is None


# ─── _read_distro ─────────────────────────────────────────────────────────────

def test_read_distro_parses_pretty_name():
    os_release = 'NAME="CachyOS"\nPRETTY_NAME="CachyOS Linux"\nID=cachyos\n'
    with patch("builtins.open", mock_open(read_data=os_release)):
        result = Plugin()._read_distro()
    assert result == "CachyOS Linux"


def test_read_distro_strips_quotes():
    os_release = 'PRETTY_NAME="Arch Linux"\n'
    with patch("builtins.open", mock_open(read_data=os_release)):
        result = Plugin()._read_distro()
    assert result == "Arch Linux"


def test_read_distro_missing_file_returns_none():
    with patch("builtins.open", side_effect=FileNotFoundError):
        result = Plugin()._read_distro()
    assert result is None


# ─── _read_custom_proton ──────────────────────────────────────────────────────

def test_read_custom_proton_single_entry(tmp_path):
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()

    with patch.object(decky, 'DECKY_USER_HOME', str(tmp_path)):
        result = Plugin()._read_custom_proton()
    assert result == "GE-Proton10-1"


def test_read_custom_proton_multiple_entries(tmp_path):
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)
    (compat_dir / "GE-Proton10-1").mkdir()
    (compat_dir / "cachyos-10.0").mkdir()

    with patch.object(decky, 'DECKY_USER_HOME', str(tmp_path)):
        result = Plugin()._read_custom_proton()
    assert "GE-Proton10-1" in result
    assert "cachyos-10.0" in result


def test_read_custom_proton_empty_dir(tmp_path):
    compat_dir = tmp_path / ".steam" / "root" / "compatibilitytools.d"
    compat_dir.mkdir(parents=True)

    with patch.object(decky, 'DECKY_USER_HOME', str(tmp_path)):
        result = Plugin()._read_custom_proton()
    assert result is None


def test_read_custom_proton_no_dir(tmp_path):
    with patch.object(decky, 'DECKY_USER_HOME', str(tmp_path)):
        result = Plugin()._read_custom_proton()
    assert result is None
