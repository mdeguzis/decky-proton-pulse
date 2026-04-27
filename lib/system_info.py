"""Hardware and OS detection helpers for Proton Pulse.

Each reader is its own function so one failing detector doesn't drag
down the rest.  The ``collect_system_info`` orchestrator runs them all
and hands back a single dict for the frontend.
"""

from __future__ import annotations

import glob
import os
import subprocess
import sys

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .compat_tools import extract_version_parts, list_installed_compatibility_tools
from .plugin_utils import system_command_env
from .proton_ge import read_latest_metadata


# ── Windows helpers ────────────────────────────────────────────────────────────

def _ps(expression: str) -> str | None:
    """Run a PowerShell expression and return stripped stdout, or None on error."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", expression],
            capture_output=True, text=True, timeout=10, check=False,
        )
        out = result.stdout.strip()
        return out if out else None
    except (FileNotFoundError, subprocess.SubprocessError):
        return None


def _wmic(path: str, get: str) -> str | None:
    """WMIC fallback — returns first non-empty value field."""
    try:
        result = subprocess.run(
            ["wmic", path, "get", get, "/value"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        for line in result.stdout.splitlines():
            if "=" in line:
                val = line.split("=", 1)[1].strip()
                if val:
                    return val
    except (FileNotFoundError, subprocess.SubprocessError):
        pass
    return None


def read_cpu_windows() -> str | None:
    return (
        _ps("(Get-CimInstance Win32_Processor | Select-Object -First 1).Name")
        or _wmic("cpu", "Name")
    )


def read_cpu_cores_windows() -> int | None:
    raw = (
        _ps("(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors")
        or _wmic("computersystem", "NumberOfLogicalProcessors")
    )
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def read_ram_gb_windows() -> int | None:
    raw = _ps(
        "((Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB)"
    )
    if raw:
        try:
            return round(float(raw))
        except ValueError:
            pass
    # WMIC fallback: sum capacity fields in bytes
    try:
        result = subprocess.run(
            ["wmic", "memorychip", "get", "Capacity", "/value"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        total = sum(
            int(line.split("=", 1)[1].strip())
            for line in result.stdout.splitlines()
            if "=" in line and line.split("=", 1)[1].strip().isdigit()
        )
        return round(total / 1024 ** 3) if total else None
    except (FileNotFoundError, subprocess.SubprocessError, ValueError):
        return None


def read_gpu_windows() -> tuple[str | None, str | None]:
    name = (
        _ps("(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name")
        or _wmic("path win32_VideoController", "Name")
    )
    if not name:
        return None, None
    return name, detect_gpu_vendor(name)


def read_vram_mb_windows() -> int | None:
    raw = _ps(
        "(Get-CimInstance Win32_VideoController | Select-Object -First 1).AdapterRAM"
    )
    if not raw:
        raw = _wmic("path win32_VideoController", "AdapterRAM")
    try:
        bytes_val = int(raw) if raw else 0
        return round(bytes_val / 1024 / 1024) if bytes_val > 0 else None
    except ValueError:
        return None


def read_driver_version_windows() -> str | None:
    return (
        _ps("(Get-CimInstance Win32_VideoController | Select-Object -First 1).DriverVersion")
        or _wmic("path win32_VideoController", "DriverVersion")
    )


def read_distro_windows() -> str | None:
    return (
        _ps("(Get-CimInstance Win32_OperatingSystem).Caption")
        or _wmic("os", "Caption")
    )


def read_kernel_windows() -> str | None:
    return (
        _ps("(Get-CimInstance Win32_OperatingSystem).Version")
        or _wmic("os", "Version")
    )


def read_cpu() -> str | None:
    """Grab the CPU model name from ``/proc/cpuinfo``."""
    with open("/proc/cpuinfo", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return None


def read_cpu_cores() -> int | None:
    """Return logical CPU core count via ``nproc``."""
    try:
        return int(subprocess.check_output(["nproc"], text=True).strip())
    except (subprocess.SubprocessError, ValueError):
        return None


def read_ram_gb() -> int | None:
    """Figure out total RAM in GB from ``/proc/meminfo``."""
    with open("/proc/meminfo", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("MemTotal"):
                kb = int(line.split()[1])
                return round(kb / 1024 / 1024)
    return None


import re as _re


def read_vram_mb() -> int | None:
    """Estimate GPU VRAM in MB from ``lspci -v`` memory region sizes."""
    result = subprocess.run(
        ["lspci", "-v"],
        capture_output=True, text=True, timeout=10, check=False,
        env=system_command_env(),
    )
    if result.returncode != 0:
        return None
    in_gpu = False
    best_mb = 0
    for line in result.stdout.splitlines():
        if not line.startswith("\t"):
            lower = line.lower()
            in_gpu = any(k in lower for k in ("vga", "3d controller", "display controller"))
            continue
        if in_gpu and "Memory" in line and "prefetchable" in line:
            m = _re.search(r"\[size=(\d+)(M|G)\]", line)
            if m:
                val = int(m.group(1))
                if m.group(2) == "G":
                    val *= 1024
                best_mb = max(best_mb, val)
    return best_mb if best_mb > 0 else None


def read_display_resolution() -> str | None:
    """Read the current display resolution from DRM sysfs."""
    modes = glob.glob("/sys/class/drm/card*-*/modes")
    for path in sorted(modes):
        try:
            with open(path, "r", encoding="utf-8") as f:
                first = f.readline().strip()
                if first:
                    return first
        except OSError:
            continue
    return None


def read_steam_deck_model() -> str | None:
    """Detect Steam Deck model from DMI product name."""
    try:
        with open("/sys/devices/virtual/dmi/id/product_name", "r", encoding="utf-8") as f:
            name = f.read().strip().lower()
        if "jupiter" in name:
            return "lcd"
        if "galileo" in name:
            return "oled"
    except OSError:
        pass
    return None


def read_gpu() -> tuple[str | None, str | None]:
    """Ask ``lspci`` for the graphics card name and vendor.

    Most GPUs show up as *VGA compatible controller*, but discrete cards
    sometimes appear as *3D controller* or *display controller* instead.
    """
    result = subprocess.run(
        ["lspci"],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
        env=system_command_env(),
    )
    if result.returncode != 0:
        return None, None
    for line in result.stdout.splitlines():
        lower = line.lower()
        if any(k in lower for k in ("vga", "3d controller", "display controller")):
            name = line.split(":", 2)[-1].strip()
            return name, detect_gpu_vendor(name)
    return None, None


def detect_gpu_vendor(gpu_string: str) -> str:
    """Turn a GPU name string into a short vendor tag."""
    lower = gpu_string.lower()
    if any(k in lower for k in ("nvidia", "geforce", "rtx", "gtx", "quadro")):
        return "nvidia"
    if any(k in lower for k in ("amd", "radeon", "rx ", "vega")):
        return "amd"
    if any(k in lower for k in ("intel", "arc", "iris", "uhd")):
        return "intel"
    return "other"


def read_driver_version() -> str | None:
    """Try nvidia-smi first, then vulkaninfo, then DRM sysfs as a last resort.

    AMD/Intel systems use Mesa, and nvidia-smi won't exist. The DRM sysfs
    version node also doesn't exist for amdgpu since the version is baked
    into the kernel. vulkaninfo is the most reliable cross-vendor fallback.
    """
    # nvidia proprietary driver
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            env=system_command_env(),
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except FileNotFoundError:
        pass

    # vulkaninfo gives us the Mesa version on AMD/Intel
    try:
        result = subprocess.run(
            ["vulkaninfo", "--summary"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            env=system_command_env(),
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                stripped = line.strip()
                # looks like: driverInfo         = Mesa 25.2.8-0ubuntu0.24.04.1
                if stripped.startswith("driverInfo"):
                    val = stripped.split("=", 1)[-1].strip()
                    if val:
                        return val
    except FileNotFoundError:
        pass

    # DRM sysfs fallback (some nvidia setups have this)
    try:
        for path in glob.glob("/sys/class/drm/card*/device/driver/module/version"):
            with open(path, encoding="utf-8") as f:
                return f.read().strip()
    except OSError as e:
        decky.logger.warning(f"DRM driver version read failed: {e}")
    return None


def read_kernel() -> str | None:
    """Get the running kernel version via ``uname -r``."""
    result = subprocess.run(
        ["uname", "-r"],
        capture_output=True,
        text=True,
        timeout=3,
        check=False,
        env=system_command_env(),
    )
    return result.stdout.strip() if result.returncode == 0 else None


def read_distro() -> str | None:
    """Grab the distro pretty-name from ``/etc/os-release``."""
    try:
        with open("/etc/os-release", encoding="utf-8") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError:
        pass
    return None


def read_custom_proton() -> str | None:
    """Return the best current custom Proton reference, never a smashed list.

    Prefer the managed ``Proton-GE-Latest`` slot resolved to its real tag.
    Otherwise pick the highest-version custom tool we can identify.
    """
    compat_dir = os.path.join(
        decky.DECKY_USER_HOME, ".steam", "root", "compatibilitytools.d"
    )
    if not os.path.isdir(compat_dir):
        return None

    tools = list_installed_compatibility_tools(read_latest_metadata())
    custom_tools = [tool for tool in tools if tool.get("source") == "custom"]
    if not custom_tools:
        return None

    latest_slot = next(
        (tool for tool in custom_tools if tool.get("managed_slot") == "latest"),
        None,
    )
    if latest_slot and latest_slot.get("latest_tag"):
        latest_tag = latest_slot.get("latest_tag")
        if isinstance(latest_tag, str) and latest_tag.strip():
            return latest_tag

    def _tool_label(tool: dict[str, object]) -> str:
        for field in ("display_name", "internal_name", "directory_name"):
            value = tool.get(field)
            if isinstance(value, str) and value.strip():
                return value
        return ""

    def _tool_rank(tool: dict[str, object]) -> tuple[int, int, str]:
        label = _tool_label(tool)
        parts = extract_version_parts(label)
        if parts:
            return (parts[0], parts[1], label.lower())
        return (-1, -1, label.lower())

    selected = max(custom_tools, key=_tool_rank)
    label = _tool_label(selected)
    return label or None


def collect_system_info() -> dict[str, object]:
    """Detect hardware and OS info for the frontend.

    Each field is read on its own so a single failing detector doesn't
    take the whole thing down.  Dispatches to Windows-specific readers
    when running on win32.
    """
    info: dict[str, object] = {
        "cpu": None,
        "ram_gb": None,
        "gpu": None,
        "gpu_vendor": None,
        "driver_version": None,
        "kernel": None,
        "distro": None,
        "proton_custom": None,
        "vram_mb": None,
        "cpu_cores": None,
        "display_resolution": None,
        "steam_deck_model": None,
    }

    is_windows = sys.platform == "win32"

    scalar_readers: list[tuple[str, object]] = (
        [
            ("cpu",            read_cpu_windows),
            ("ram_gb",         read_ram_gb_windows),
            ("kernel",         read_kernel_windows),
            ("distro",         read_distro_windows),
            ("driver_version", read_driver_version_windows),
            ("vram_mb",        read_vram_mb_windows),
            ("cpu_cores",      read_cpu_cores_windows),
        ]
        if is_windows else
        [
            ("cpu",            read_cpu),
            ("ram_gb",         read_ram_gb),
            ("kernel",         read_kernel),
            ("distro",         read_distro),
            ("driver_version", read_driver_version),
            ("proton_custom",  read_custom_proton),
            ("vram_mb",        read_vram_mb),
            ("cpu_cores",      read_cpu_cores),
            ("display_resolution", read_display_resolution),
            ("steam_deck_model",   read_steam_deck_model),
        ]
    )

    for field, fn in scalar_readers:
        try:
            info[field] = fn()  # type: ignore[operator]
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            decky.logger.warning(f"System detection failed for {field}: {e}")

    try:
        gpu, vendor = read_gpu_windows() if is_windows else read_gpu()
        info["gpu"] = gpu
        info["gpu_vendor"] = vendor
    except (OSError, subprocess.SubprocessError) as e:
        decky.logger.warning(f"GPU detection failed: {e}")

    return info
