"""Hardware and OS detection helpers for Proton Pulse.

Each reader is its own function so one failing detector doesn't drag
down the rest.  The ``collect_system_info`` orchestrator runs them all
and hands back a single dict for the frontend.
"""

from __future__ import annotations

import glob
import os
import subprocess

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .plugin_utils import system_command_env


def read_cpu() -> str | None:
    """Grab the CPU model name from ``/proc/cpuinfo``."""
    with open("/proc/cpuinfo", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return None


def read_ram_gb() -> int | None:
    """Figure out total RAM in GB from ``/proc/meminfo``."""
    with open("/proc/meminfo", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("MemTotal"):
                kb = int(line.split()[1])
                return round(kb / 1024 / 1024)
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
    """See what custom Proton builds live in ``compatibilitytools.d``."""
    compat_dir = os.path.join(
        decky.DECKY_USER_HOME, ".steam", "root", "compatibilitytools.d"
    )
    if not os.path.isdir(compat_dir):
        return None
    entries = [
        d for d in os.listdir(compat_dir) if os.path.isdir(os.path.join(compat_dir, d))
    ]
    if not entries:
        return None
    return entries[0] if len(entries) == 1 else ", ".join(entries)


def collect_system_info() -> dict[str, object]:
    """Detect hardware and OS info for the frontend.

    Each field is read on its own so a single failing detector doesn't
    take the whole thing down.
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
    }
    for field, fn in (
        ("cpu", read_cpu),
        ("ram_gb", read_ram_gb),
        ("kernel", read_kernel),
        ("distro", read_distro),
        ("driver_version", read_driver_version),
        ("proton_custom", read_custom_proton),
    ):
        try:
            info[field] = fn()
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            decky.logger.warning(f"System detection failed for {field}: {e}")

    try:
        gpu, vendor = read_gpu()
        info["gpu"] = gpu
        info["gpu_vendor"] = vendor
    except (OSError, subprocess.SubprocessError) as e:
        decky.logger.warning(f"GPU detection failed: {e}")

    return info
