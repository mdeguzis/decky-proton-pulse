# tests/test_system_info.py
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open
import lib.system_info as system_info
from lib.system_info import (
    collect_system_info,
    read_ram_gb,
    detect_gpu_vendor,
    read_driver_version,
    read_custom_proton,
)


def test_system_info_keys() -> None:
    with patch("lib.system_info.read_cpu", return_value="AMD Ryzen 9 9950X3D"), \
         patch("lib.system_info.read_ram_gb", return_value=64), \
         patch("lib.system_info.read_gpu", return_value=("NVIDIA GeForce RTX 5080", "nvidia")), \
         patch("lib.system_info.read_driver_version", return_value="595.45.04"), \
         patch("lib.system_info.read_kernel", return_value="6.19.8-1-cachyos"), \
         patch("lib.system_info.read_distro", return_value="CachyOS Linux"), \
         patch("lib.system_info.read_custom_proton", return_value="cachyos-10.0"), \
         patch("lib.system_info.read_vram_mb", return_value=16384), \
         patch("lib.system_info.read_cpu_cores", return_value=32), \
         patch("lib.system_info.read_display_resolution", return_value="2560x1440"), \
         patch("lib.system_info.read_steam_deck_model", return_value=None):
        info = collect_system_info()

    assert set(info.keys()) == {
        'cpu', 'ram_gb', 'gpu', 'gpu_vendor',
        'driver_version', 'kernel', 'distro', 'proton_custom',
        'vram_mb', 'cpu_cores', 'display_resolution', 'steam_deck_model',
    }
    assert info['gpu_vendor'] == 'nvidia'
    assert info['ram_gb'] == 64
    assert info['vram_mb'] == 16384
    assert info['cpu_cores'] == 32


def test_system_info_field_failure_returns_none() -> None:
    """Any field that fails detection returns None, never raises."""
    with patch("lib.system_info.read_cpu", side_effect=OSError("oops")), \
         patch("lib.system_info.read_ram_gb", return_value=64), \
         patch("lib.system_info.read_gpu", return_value=(None, None)), \
         patch("lib.system_info.read_driver_version", return_value=None), \
         patch("lib.system_info.read_kernel", return_value="6.19.8"), \
         patch("lib.system_info.read_distro", return_value="CachyOS Linux"), \
         patch("lib.system_info.read_custom_proton", return_value=None):
        info = collect_system_info()

    assert info['cpu'] is None
    assert info['gpu'] is None
    assert info['gpu_vendor'] is None
    assert info['proton_custom'] is None


def test_read_ram_gb() -> None:
    meminfo = "MemTotal:       67108864 kB\nMemFree: 1000 kB\n"
    with patch("builtins.open", mock_open(read_data=meminfo)):
        result = read_ram_gb()
    assert result == 64


def test_read_ram_gb_returns_none_when_memtotal_missing() -> None:
    with patch("builtins.open", mock_open(read_data="MemFree: 1000 kB\n")):
        assert read_ram_gb() is None


def test_read_driver_version_logs_drm_errors() -> None:
    with (
        patch("lib.system_info.subprocess.run", side_effect=FileNotFoundError("missing")),
        patch("lib.system_info.glob.glob", return_value=["/sys/class/drm/card0/device/driver/module/version"]),
        patch("builtins.open", side_effect=OSError("no access")),
    ):
        assert read_driver_version() is None


def test_collect_system_info_handles_gpu_detection_errors() -> None:
    with patch("lib.system_info.read_gpu", side_effect=OSError("gpu broke")):
        info = collect_system_info()

    assert info["gpu"] is None
    assert info["gpu_vendor"] is None


def test_read_custom_proton_prefers_latest_slot_tag() -> None:
    tools = [
        {
            "source": "custom",
            "managed_slot": "latest",
            "latest_tag": "GE-Proton10-3",
            "display_name": "Proton-GE-Latest",
            "internal_name": "GE-Proton10-3",
            "directory_name": "Proton-GE-Latest",
        },
        {
            "source": "custom",
            "managed_slot": "versioned",
            "latest_tag": None,
            "display_name": "GE-Proton10-2",
            "internal_name": "GE-Proton10-2",
            "directory_name": "GE-Proton10-2",
        },
    ]
    with (
        patch("lib.system_info.os.path.isdir", return_value=True),
        patch("lib.system_info.read_latest_metadata", return_value={"tag_name": "GE-Proton10-3"}),
        patch("lib.system_info.list_installed_compatibility_tools", return_value=tools),
    ):
        assert read_custom_proton() == "GE-Proton10-3"


def test_read_custom_proton_picks_highest_versioned_custom_tool() -> None:
    tools = [
        {
            "source": "custom",
            "managed_slot": "versioned",
            "latest_tag": None,
            "display_name": "GE-Proton9-27",
            "internal_name": "GE-Proton9-27",
            "directory_name": "GE-Proton9-27",
        },
        {
            "source": "custom",
            "managed_slot": "versioned",
            "latest_tag": None,
            "display_name": "GE-Proton10-1",
            "internal_name": "GE-Proton10-1",
            "directory_name": "GE-Proton10-1",
        },
    ]
    with (
        patch("lib.system_info.os.path.isdir", return_value=True),
        patch("lib.system_info.read_latest_metadata", return_value=None),
        patch("lib.system_info.list_installed_compatibility_tools", return_value=tools),
    ):
        assert read_custom_proton() == "GE-Proton10-1"


def test_detect_gpu_vendor_nvidia() -> None:
    assert detect_gpu_vendor("NVIDIA GeForce RTX 5080") == "nvidia"


def test_detect_gpu_vendor_amd() -> None:
    assert detect_gpu_vendor("AMD Radeon RX 7900 XTX") == "amd"


def test_detect_gpu_vendor_intel() -> None:
    assert detect_gpu_vendor("Intel Arc A770") == "intel"


def test_detect_gpu_vendor_other() -> None:
    assert detect_gpu_vendor("Some Unknown GPU") == "other"


def test_ps_returns_trimmed_stdout() -> None:
    with patch(
        "lib.system_info.subprocess.run",
        return_value=type("Result", (), {"stdout": " Windows 11 \n"})(),
    ):
        assert system_info._ps("Get-Thing") == "Windows 11"


def test_ps_returns_none_on_missing_shell() -> None:
    with patch("lib.system_info.subprocess.run", side_effect=FileNotFoundError):
        assert system_info._ps("Get-Thing") is None


def test_wmic_returns_first_non_empty_value() -> None:
    result = type("Result", (), {"stdout": "Name=\nName=AMD Ryzen 7 7840U\n"})()
    with patch("lib.system_info.subprocess.run", return_value=result):
        assert system_info._wmic("cpu", "Name") == "AMD Ryzen 7 7840U"


def test_wmic_returns_none_on_subprocess_error() -> None:
    with patch("lib.system_info.subprocess.run", side_effect=system_info.subprocess.SubprocessError):
        assert system_info._wmic("cpu", "Name") is None


def test_read_cpu_windows_prefers_powershell_then_wmic() -> None:
    with patch("lib.system_info._ps", return_value="Intel Core Ultra 7"):
        assert system_info.read_cpu_windows() == "Intel Core Ultra 7"

    with patch("lib.system_info._ps", return_value=None), patch("lib.system_info._wmic", return_value="AMD Ryzen AI 9"):
        assert system_info.read_cpu_windows() == "AMD Ryzen AI 9"


def test_read_cpu_cores_windows_handles_valid_and_invalid_values() -> None:
    with patch("lib.system_info._ps", return_value="16"):
        assert system_info.read_cpu_cores_windows() == 16

    with patch("lib.system_info._ps", return_value="many"), patch("lib.system_info._wmic", return_value=None):
        assert system_info.read_cpu_cores_windows() is None


def test_read_ram_gb_windows_parses_powershell_output() -> None:
    with patch("lib.system_info._ps", return_value="31.6"):
        assert system_info.read_ram_gb_windows() == 32


def test_read_ram_gb_windows_falls_back_to_wmic_capacity_sum() -> None:
    result = type("Result", (), {"stdout": "Capacity=17179869184\nCapacity=17179869184\n"})()
    with patch("lib.system_info._ps", return_value=None), patch("lib.system_info.subprocess.run", return_value=result):
        assert system_info.read_ram_gb_windows() == 32


def test_read_ram_gb_windows_returns_none_on_invalid_wmic_output() -> None:
    result = type("Result", (), {"stdout": "Capacity=not-a-number\n"})()
    with patch("lib.system_info._ps", return_value=None), patch("lib.system_info.subprocess.run", return_value=result):
        assert system_info.read_ram_gb_windows() is None


def test_read_ram_gb_windows_handles_invalid_powershell_and_wmic_errors() -> None:
    with patch("lib.system_info._ps", return_value="not-a-number"), patch(
        "lib.system_info.subprocess.run", side_effect=FileNotFoundError
    ):
        assert system_info.read_ram_gb_windows() is None


def test_read_gpu_windows_detects_vendor_and_missing_gpu() -> None:
    with patch("lib.system_info._ps", return_value="Intel Arc A770"):
        assert system_info.read_gpu_windows() == ("Intel Arc A770", "intel")

    with patch("lib.system_info._ps", return_value=None), patch("lib.system_info._wmic", return_value=None):
        assert system_info.read_gpu_windows() == (None, None)


def test_read_vram_mb_windows_parses_and_rejects_invalid_values() -> None:
    with patch("lib.system_info._ps", return_value=str(8 * 1024 * 1024 * 1024)):
        assert system_info.read_vram_mb_windows() == 8192

    with patch("lib.system_info._ps", return_value="not-a-number"), patch("lib.system_info._wmic", return_value=None):
        assert system_info.read_vram_mb_windows() is None


def test_read_vram_mb_windows_uses_wmic_fallback() -> None:
    with patch("lib.system_info._ps", return_value=None), patch(
        "lib.system_info._wmic", return_value=str(4 * 1024 * 1024 * 1024)
    ):
        assert system_info.read_vram_mb_windows() == 4096


def test_read_windows_os_fields_use_wmic_fallbacks() -> None:
    with patch("lib.system_info._ps", return_value=None), patch("lib.system_info._wmic", side_effect=["31.0.22631", "Windows 11 Pro", "31.0.22631.4602"]):
        assert system_info.read_kernel_windows() == "31.0.22631"
        assert system_info.read_distro_windows() == "Windows 11 Pro"
        assert system_info.read_driver_version_windows() == "31.0.22631.4602"


def test_collect_system_info_uses_windows_readers() -> None:
    with (
        patch("lib.system_info.sys.platform", "win32"),
        patch("lib.system_info.read_cpu_windows", return_value="AMD Ryzen Z1 Extreme"),
        patch("lib.system_info.read_ram_gb_windows", return_value=16),
        patch("lib.system_info.read_kernel_windows", return_value="10.0.22631"),
        patch("lib.system_info.read_distro_windows", return_value="Windows 11"),
        patch("lib.system_info.read_driver_version_windows", return_value="32.0.15.6614"),
        patch("lib.system_info.read_vram_mb_windows", return_value=12288),
        patch("lib.system_info.read_cpu_cores_windows", return_value=16),
        patch("lib.system_info.read_gpu_windows", return_value=("NVIDIA GeForce RTX 4070", "nvidia")),
    ):
        info = collect_system_info()

    assert info["cpu"] == "AMD Ryzen Z1 Extreme"
    assert info["ram_gb"] == 16
    assert info["kernel"] == "10.0.22631"
    assert info["distro"] == "Windows 11"
    assert info["driver_version"] == "32.0.15.6614"
    assert info["vram_mb"] == 12288
    assert info["cpu_cores"] == 16
    assert info["gpu"] == "NVIDIA GeForce RTX 4070"
    assert info["gpu_vendor"] == "nvidia"


def test_read_vram_mb_parses_prefetchable_region_sizes() -> None:
    lspci_output = (
        "01:00.0 VGA compatible controller: NVIDIA Corporation Device\n"
        "\tMemory at 6000000000 (64-bit, prefetchable) [size=16G]\n"
        "\tMemory at 5000000000 (64-bit, prefetchable) [size=256M]\n"
    )
    result = type("Result", (), {"returncode": 0, "stdout": lspci_output})()
    with patch("lib.system_info.subprocess.run", return_value=result):
        assert system_info.read_vram_mb() == 16384


def test_read_vram_mb_and_cpu_cores_failure_paths() -> None:
    with patch(
        "lib.system_info.subprocess.run",
        return_value=type("Result", (), {"returncode": 1, "stdout": ""})(),
    ):
        assert system_info.read_vram_mb() is None

    with patch("lib.system_info.subprocess.check_output", side_effect=system_info.subprocess.SubprocessError):
        assert system_info.read_cpu_cores() is None


def test_read_display_resolution_and_steam_deck_model_fallbacks() -> None:
    with patch("lib.system_info.glob.glob", return_value=[]):
        assert system_info.read_display_resolution() is None

    with patch("builtins.open", side_effect=OSError):
        assert system_info.read_steam_deck_model() is None


def test_read_display_resolution_skips_unreadable_mode_files() -> None:
    files = ["/tmp/first-modes", "/tmp/second-modes"]

    def fake_open(path: str, *_args: object, **_kwargs: object):
        if path == files[0]:
            raise OSError("no access")
        return mock_open(read_data="1280x800\n").return_value

    with patch("lib.system_info.glob.glob", return_value=files), patch("builtins.open", side_effect=fake_open):
        assert system_info.read_display_resolution() == "1280x800"


def test_read_steam_deck_model_detects_lcd_and_oled() -> None:
    with patch("builtins.open", mock_open(read_data="Jupiter")):
        assert system_info.read_steam_deck_model() == "lcd"

    with patch("builtins.open", mock_open(read_data="Galileo")):
        assert system_info.read_steam_deck_model() == "oled"


def test_read_driver_version_uses_vulkaninfo_driver_info() -> None:
    def fake_run(cmd: list[str], **_kwargs: object):
        if cmd[0] == "nvidia-smi":
            raise FileNotFoundError("missing")
        return type(
            "Result",
            (),
            {"returncode": 0, "stdout": "driverInfo         = Mesa 25.2.8-0ubuntu0.24.04.1\n"},
        )()

    with patch("lib.system_info.subprocess.run", side_effect=fake_run):
        assert system_info.read_driver_version() == "Mesa 25.2.8-0ubuntu0.24.04.1"


def test_read_custom_proton_handles_unparseable_or_blank_labels() -> None:
    tools = [
        {
            "source": "custom",
            "managed_slot": "versioned",
            "display_name": "",
            "internal_name": "",
            "directory_name": "",
        },
        {
            "source": "custom",
            "managed_slot": "versioned",
            "display_name": "mystery-build",
            "internal_name": "mystery-build",
            "directory_name": "mystery-build",
        },
    ]
    with (
        patch("lib.system_info.os.path.isdir", return_value=True),
        patch("lib.system_info.read_latest_metadata", return_value=None),
        patch("lib.system_info.list_installed_compatibility_tools", return_value=tools),
    ):
        assert read_custom_proton() == "mystery-build"
