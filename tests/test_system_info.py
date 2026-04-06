# tests/test_system_info.py
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open
from lib.system_info import (
    collect_system_info,
    read_ram_gb,
    detect_gpu_vendor,
)


def test_system_info_keys() -> None:
    with patch("lib.system_info.read_cpu", return_value="AMD Ryzen 9 9950X3D"), \
         patch("lib.system_info.read_ram_gb", return_value=64), \
         patch("lib.system_info.read_gpu", return_value=("NVIDIA GeForce RTX 5080", "nvidia")), \
         patch("lib.system_info.read_driver_version", return_value="595.45.04"), \
         patch("lib.system_info.read_kernel", return_value="6.19.8-1-cachyos"), \
         patch("lib.system_info.read_distro", return_value="CachyOS Linux"), \
         patch("lib.system_info.read_custom_proton", return_value="cachyos-10.0"):
        info = collect_system_info()

    assert set(info.keys()) == {
        'cpu', 'ram_gb', 'gpu', 'gpu_vendor',
        'driver_version', 'kernel', 'distro', 'proton_custom'
    }
    assert info['gpu_vendor'] == 'nvidia'
    assert info['ram_gb'] == 64


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


def test_detect_gpu_vendor_nvidia() -> None:
    assert detect_gpu_vendor("NVIDIA GeForce RTX 5080") == "nvidia"


def test_detect_gpu_vendor_amd() -> None:
    assert detect_gpu_vendor("AMD Radeon RX 7900 XTX") == "amd"


def test_detect_gpu_vendor_intel() -> None:
    assert detect_gpu_vendor("Intel Arc A770") == "intel"


def test_detect_gpu_vendor_other() -> None:
    assert detect_gpu_vendor("Some Unknown GPU") == "other"