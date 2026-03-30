# tests/test_system_info.py
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, mock_open
import pytest
from main import Plugin


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def plugin():
    p = Plugin()
    p._setup_logger()
    return p


def test_system_info_keys(plugin):
    with patch.object(plugin, '_read_cpu', return_value="AMD Ryzen 9 9950X3D"), \
         patch.object(plugin, '_read_ram_gb', return_value=64), \
         patch.object(plugin, '_read_gpu', return_value=("NVIDIA GeForce RTX 5080", "nvidia")), \
         patch.object(plugin, '_read_driver_version', return_value="595.45.04"), \
         patch.object(plugin, '_read_kernel', return_value="6.19.8-1-cachyos"), \
         patch.object(plugin, '_read_distro', return_value="CachyOS Linux"), \
         patch.object(plugin, '_read_custom_proton', return_value="cachyos-10.0"):
        info = run(plugin.get_system_info())

    assert set(info.keys()) == {
        'cpu', 'ram_gb', 'gpu', 'gpu_vendor',
        'driver_version', 'kernel', 'distro', 'proton_custom'
    }
    assert info['gpu_vendor'] == 'nvidia'
    assert info['ram_gb'] == 64


def test_system_info_field_failure_returns_none(plugin):
    """Any field that fails detection returns None, never raises."""
    with patch.object(plugin, '_read_cpu', side_effect=Exception("oops")), \
         patch.object(plugin, '_read_ram_gb', return_value=64), \
         patch.object(plugin, '_read_gpu', return_value=(None, None)), \
         patch.object(plugin, '_read_driver_version', return_value=None), \
         patch.object(plugin, '_read_kernel', return_value="6.19.8"), \
         patch.object(plugin, '_read_distro', return_value="CachyOS Linux"), \
         patch.object(plugin, '_read_custom_proton', return_value=None):
        info = run(plugin.get_system_info())

    assert info['cpu'] is None
    assert info['gpu'] is None
    assert info['gpu_vendor'] is None
    assert info['proton_custom'] is None


def test_read_ram_gb(plugin):
    meminfo = "MemTotal:       67108864 kB\nMemFree: 1000 kB\n"
    with patch("builtins.open", mock_open(read_data=meminfo)):
        result = plugin._read_ram_gb()
    assert result == 64


def test_detect_gpu_vendor_nvidia(plugin):
    assert plugin._detect_gpu_vendor("NVIDIA GeForce RTX 5080") == "nvidia"


def test_detect_gpu_vendor_amd(plugin):
    assert plugin._detect_gpu_vendor("AMD Radeon RX 7900 XTX") == "amd"


def test_detect_gpu_vendor_intel(plugin):
    assert plugin._detect_gpu_vendor("Intel Arc A770") == "intel"


def test_detect_gpu_vendor_other(plugin):
    assert plugin._detect_gpu_vendor("Some Unknown GPU") == "other"
