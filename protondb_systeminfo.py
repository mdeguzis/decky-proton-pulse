# protondb_systeminfo.py
# Generates "Steam System Information" format text for ProtonDB report submissions.
# Ported from: https://github.com/mdeguzis/SteamOS-Tools/blob/master/utilities/protondb-systeminfo-tool.sh
# Adapted for headless use inside a Decky Loader plugin (no X11/DISPLAY dependency).

import os
import re
import subprocess
from pathlib import Path


def _read_file(path: str) -> str | None:
    try:
        return Path(path).read_text().strip()
    except (FileNotFoundError, PermissionError, OSError):
        return None


def _run(cmd: list[str], timeout: int = 5) -> str | None:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


# ─── Computer Information ─────────────────────────────────────────────────────

def _read_manufacturer() -> str:
    return _read_file("/sys/devices/virtual/dmi/id/board_vendor") or "Unknown"


def _read_model() -> str:
    return _read_file("/sys/devices/virtual/dmi/id/board_name") or "Unknown"


def _read_form_factor() -> str:
    result = _run(["hostnamectl", "--json=short"])
    if result:
        import json as _json
        try:
            return _json.loads(result).get("Chassis", "Unknown").capitalize()
        except (ValueError, AttributeError):
            pass
    result = _run(["hostnamectl", "chassis"])
    return (result or "Unknown").capitalize()


# ─── Processor Information ────────────────────────────────────────────────────

def _parse_cpuinfo() -> dict[str, str]:
    raw = _read_file("/proc/cpuinfo")
    if not raw:
        return {}
    info: dict[str, str] = {}
    flags_str = ""
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key, val = key.strip(), val.strip()
        if key == "vendor_id" and "vendor_id" not in info:
            info["vendor_id"] = val
        elif key == "model name" and "model_name" not in info:
            info["model_name"] = val
        elif key == "cpu family" and "cpu_family" not in info:
            info["cpu_family"] = val
        elif key == "model" and "model" not in info:
            info["model"] = val
        elif key == "stepping" and "stepping" not in info:
            info["stepping"] = val
        elif key == "cpu cores" and "cpu_cores" not in info:
            info["cpu_cores"] = val
        elif key == "flags" and not flags_str:
            flags_str = val
    info["flags"] = flags_str
    return info


def _cpu_flag_status(flags: str, flag: str, label: str) -> str:
    status = "Supported" if flag in flags.split() else "Unsupported"
    return f"    {label}:  {status}"


def _cpu_speed() -> str:
    result = _run(["lscpu"])
    if result:
        for line in result.splitlines():
            if "CPU max MHz" in line or "CPU MHz" in line:
                val = line.split(":", 1)[1].strip()
                return val.split(".")[0]
    return "Unknown"


def _logical_cpus() -> str:
    result = _run(["nproc", "--all"])
    return result or "Unknown"


# ─── Operating System ─────────────────────────────────────────────────────────

def _read_os() -> str:
    raw = _read_file("/etc/os-release")
    if raw:
        for line in raw.splitlines():
            if line.startswith("PRETTY_NAME="):
                name = line.split("=", 1)[1].strip().strip('"')
                bits = _run(["getconf", "LONG_BIT"]) or "64"
                return f"{name} ({bits} bit)"
    return "Unknown"


def _read_kernel_version() -> str:
    return _run(["uname", "-r"]) or "Unknown"


def _read_window_manager() -> str:
    if _run(["pgrep", "-x", "gamescope"]):
        return "Gamescope"
    if _run(["pgrep", "-x", "steamcompmgr"]):
        return "Steam"
    return "Unknown"


def _read_steam_runtime(home: str) -> str:
    common = Path(home) / ".local/share/Steam/steamapps/common"
    if not common.is_dir():
        return "None"
    for d in common.iterdir():
        if d.name.startswith("SteamLinuxRuntime"):
            for os_rel in d.rglob("usr/lib/os-release"):
                raw = _read_file(str(os_rel))
                if raw:
                    for line in raw.splitlines():
                        if line.startswith("BUILD_ID="):
                            bid = line.split("=", 1)[1].strip().strip('"')
                            return f"steam-runtime_{bid}"
    return "None"


# ─── Video Card ───────────────────────────────────────────────────────────────

def _read_glxinfo() -> dict[str, str]:
    """Try glxinfo; falls back gracefully if unavailable (headless/gamescope)."""
    info: dict[str, str] = {
        "renderer": "Unknown",
        "version_long": "Unknown",
        "version_short": "Unknown",
        "vram": "Unknown",
    }
    raw = _run(["glxinfo"], timeout=10)
    if not raw:
        return info
    for line in raw.splitlines():
        if "OpenGL renderer string:" in line:
            info["renderer"] = line.split(":", 1)[1].strip()
        elif "OpenGL version string" in line:
            ver = line.split(":", 1)[1].strip()
            info["version_long"] = ver
            info["version_short"] = ver[:3] if len(ver) >= 3 else ver
        elif "Dedicated video memory:" in line:
            info["vram"] = line.split(":", 1)[1].strip()
    return info


def _read_gpu_from_lspci() -> tuple[str, str]:
    """Returns (vendor_id, device_id) from lspci."""
    raw = _run(["lspci", "-nd::0300"])
    if raw:
        m = re.search(r"([0-9a-fA-F]{4}):([0-9a-fA-F]{4})", raw)
        if m:
            return f"0x{m.group(1)}", f"0x{m.group(2)}"
    return "Unknown", "Unknown"


def _read_display_info() -> dict[str, str]:
    """Gather display info; works with or without xrandr/xdpyinfo."""
    info = {
        "color_depth": "24",
        "desktop_resolution": "Unknown",
        "primary_resolution": "Unknown",
        "primary_size": "Unknown",
        "refresh_rate": "Unknown",
        "num_monitors": "1",
        "num_video_cards": "1",
    }

    # Try xrandr
    raw = _run(["xrandr", "--current"])
    if raw:
        # Refresh rate: look for the active mode marked with *
        m = re.search(r"(\d+\.\d+)\*", raw)
        if m:
            info["refresh_rate"] = m.group(1).split(".")[0]
        # Primary resolution
        m = re.search(r"(\d+)x(\d+)\+\d+\+\d+", raw)
        if m:
            info["primary_resolution"] = f"{m.group(1)} x {m.group(2)}"
            info["desktop_resolution"] = info["primary_resolution"]
        # Monitor count
        monitors = raw.count(" connected")
        if monitors > 0:
            info["num_monitors"] = str(monitors)
        # Primary display size
        m = re.search(r"connected primary \d+x\d+.*?(\d+)mm x (\d+)mm", raw)
        if m:
            w_mm, h_mm = float(m.group(1)), float(m.group(2))
            diag_in = ((w_mm**2 + h_mm**2) ** 0.5) / 25.4
            info["primary_size"] = f'{diag_in:.1f}" (diag)'

    # Number of VGA cards
    lspci = _run(["lspci"])
    if lspci:
        info["num_video_cards"] = str(sum(1 for line in lspci.splitlines() if " VGA " in line) or 1)

    return info


# ─── Sound ────────────────────────────────────────────────────────────────────

def _read_audio_device() -> str:
    # Try pactl (PipeWire / PulseAudio)
    raw = _run(["pactl", "get-default-sink"])
    if raw:
        return raw
    # Fallback: pulsemixer
    raw = _run(["pulsemixer", "--list-sinks"])
    if raw:
        for line in raw.splitlines():
            if "Default" in line:
                m = re.search(r"Name:\s*(.+?)(?:,|$)", line)
                if m:
                    return m.group(1).strip()
    return "Unknown"


# ─── Memory ───────────────────────────────────────────────────────────────────

def _read_ram_mb() -> str:
    raw = _read_file("/proc/meminfo")
    if raw:
        for line in raw.splitlines():
            if line.startswith("MemTotal"):
                kb = int(line.split()[1])
                return str(kb // 1024)
    return "Unknown"


# ─── Storage ──────────────────────────────────────────────────────────────────

def _read_disk_info() -> dict[str, str]:
    info = {"disk_size": "Unknown", "disk_avail": "Unknown", "ssd": "0", "hdd": "0"}
    raw = _run(["df", "--output=size,avail", "--block-size=M", "/home"])
    if raw:
        lines = raw.strip().splitlines()
        if len(lines) >= 2:
            parts = lines[-1].split()
            if len(parts) >= 2:
                info["disk_size"] = parts[0].rstrip("M")
                info["disk_avail"] = parts[1].rstrip("M")

    raw = _run(["lsblk", "--nodeps", "--output", "name,tran,rota", "--noheadings", "--exclude", "7"])
    if raw:
        ssd = hdd = 0
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) >= 3:
                transport = parts[1] if parts[1] != "" else ""
                if transport == "usb":
                    continue
                rotational = parts[-1]
                if rotational == "1":
                    hdd += 1
                else:
                    ssd += 1
        info["ssd"] = str(ssd)
        info["hdd"] = str(hdd)
    return info


# ─── Main Generator ──────────────────────────────────────────────────────────

def generate_system_info(home: str | None = None) -> str:
    """
    Generate a Steam System Information block matching the format expected by
    ProtonDB report submissions.

    Args:
        home: User home directory. Defaults to $HOME.
    """
    if home is None:
        home = os.environ.get("HOME", "/home/deck")

    cpu = _parse_cpuinfo()
    flags = cpu.get("flags", "")
    glx = _read_glxinfo()
    vga_vendor, vga_device = _read_gpu_from_lspci()
    display = _read_display_info()
    disk = _read_disk_info()

    cpu_family = cpu.get("cpu_family", "0")
    cpu_model = cpu.get("model", "0")
    cpu_stepping = cpu.get("stepping", "0")
    try:
        cpu_family_hex = f"0x{int(cpu_family):x}"
    except ValueError:
        cpu_family_hex = "0x0"
    try:
        cpu_model_hex = f"0x{int(cpu_model):x}"
    except ValueError:
        cpu_model_hex = "0x0"
    try:
        cpu_stepping_hex = f"0x{int(cpu_stepping):x}"
    except ValueError:
        cpu_stepping_hex = "0x0"

    flag_lines = "\n".join([
        _cpu_flag_status(flags, "ht", "HyperThreading"),
        _cpu_flag_status(flags, "cmov", "FCMOV"),
        _cpu_flag_status(flags, "sse2", "SSE2"),
        _cpu_flag_status(flags, "sse3", "SSE3"),
        _cpu_flag_status(flags, "sse4a", "SSE4a"),
        _cpu_flag_status(flags, "sse4_1", "SSE41"),
        _cpu_flag_status(flags, "sse4_2", "SSE42"),
        _cpu_flag_status(flags, "aes", "AES"),
        _cpu_flag_status(flags, "avx", "AVX"),
        _cpu_flag_status(flags, "avx2", "AVX2"),
        _cpu_flag_status(flags, "avx512f", "AVX512F"),
        _cpu_flag_status(flags, "avx512pf", "AVX512PF"),
        _cpu_flag_status(flags, "avx512er", "AVX512ER"),
        _cpu_flag_status(flags, "avx512cd", "AVX512CD"),
        _cpu_flag_status(flags, "avx512_vnni", "AVX512VNNI"),
        _cpu_flag_status(flags, "sha_ni", "SHA"),
        _cpu_flag_status(flags, "cx16", "CMPXCHG16B"),
        _cpu_flag_status(flags, "lahf_lm", "LAHF/SAHF"),
        _cpu_flag_status(flags, "prefetch", "PrefetchW"),
    ])

    return f"""
Computer Information:
    Manufacturer:  {_read_manufacturer()}
    Model:  {_read_model()}
    Form Factor: {_read_form_factor()}

Processor Information:
    CPU Vendor:  {cpu.get("vendor_id", "Unknown")}
    CPU Brand:  {cpu.get("model_name", "Unknown")}
    CPU Family:  {cpu_family_hex}
    CPU Model:  {cpu_model_hex}
    CPU Stepping  {cpu_stepping_hex}
    CPU Type:  0x0
    Speed:  {_cpu_speed()} Mhz
    {_logical_cpus()} logical processors
    {cpu.get("cpu_cores", "Unknown")} physical processors
{flag_lines}

Operating System Version:
    {_read_os()}
    Kernel Name:  Linux
    Kernel Version:  {_read_kernel_version()}
    X Server Vendor:  Unknown
    X Server Release:  Unknown
    X Window Manager:  {_read_window_manager()}
    Steam Runtime Version:  {_read_steam_runtime(home)}

Video Card:
    Driver:  {glx["renderer"]}
    Driver Version:  {glx["version_long"]}
    OpenGL Version: {glx["version_short"]}
    Desktop Color Depth: {display["color_depth"]} bits per pixel
    Monitor Refresh Rate: {display["refresh_rate"]} Hz
    VendorID:  {vga_vendor}
    DeviceID:  {vga_device}
    Revision Not Detected
    Number of Monitors:  {display["num_monitors"]}
    Number of Logical Video Cards:  {display["num_video_cards"]}
    Primary Display Resolution:  {display["primary_resolution"]}
    Desktop Resolution: {display["desktop_resolution"]}
    Primary Display Size: {display["primary_size"]}
    Primary VRAM: {glx["vram"]}

Sound card:
    Audio device: {_read_audio_device()}

Memory:
    RAM:  {_read_ram_mb()} MB

VR Hardware:
    VR Headset: None detected

Miscellaneous:
    UI Language:  English
    Total Hard Disk Space Available:  {disk["disk_size"]} MB
    Largest Free Hard Disk Block:  {disk["disk_avail"]} MB

Storage:
    Number of SSDs: {disk["ssd"]}
    Number of HDDs: {disk["hdd"]}
""".strip()
