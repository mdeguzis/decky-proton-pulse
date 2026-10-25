"""Which installed compat tools Steam has not loaded yet (pending restart).

Steam reads compatibilitytools.d once, when the client starts (#137,
verified on the October 2026 client: a build extracted mid-session is
rejected by SpecifyCompatTool until Steam restarts). That client also no
longer exposes a tool listing to JS (Apps.GetAvailableCompatTools and
Settings.GetGlobalCompatTools are gone), so we infer it:

- Steam start: the newest process whose comm is ``steam`` (the client;
  steamwebhelper has its own comm). Newest, so a restart counts and we
  only flag tools that are certainly newer than the running client.
- Tool arrival: ctime of the tool's directory entry. tar extraction can
  restore mtime but never ctime, so ctime is when the build landed.

A versioned build that landed after the client started is pending
restart. Rolling ``-Latest`` slots are never flagged: Steam already knows
the slot name, and a refresh only swaps files Steam reads at launch, while
it also bumps the slot's ctime. Valve's own builds are managed by Steam.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error


def steam_client_started_at(proc_root: Path = Path("/proc")) -> float | None:
    """Epoch seconds the running Steam client started, or None if not found."""
    try:
        btime_line = next(
            line for line in (proc_root / "stat").read_text().splitlines()
            if line.startswith("btime ")
        )
        boot = int(btime_line.split()[1])
    except (OSError, StopIteration, ValueError, IndexError) as err:
        decky.logger.warning(f"steam_client_started_at: cannot read boot time: {err}")
        return None
    hz = os.sysconf("SC_CLK_TCK")
    newest: float | None = None
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / "comm").read_text().strip() != "steam":
                continue
            # Field 22 (starttime) counts from after the ")" that ends comm.
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            started = boot + int(fields[19]) / hz
        except (OSError, ValueError, IndexError):
            continue  # process exited mid-scan, or unreadable; skip it
        if newest is None or started > newest:
            newest = started
    return newest


def annotate_pending_restart(
    tools: list[dict[str, Any]], steam_started_at: float | None
) -> None:
    """Set ``pending_restart`` on each tool in place.

    None when the Steam start time is unknown (the UI then shows nothing
    rather than a guess), False for Valve builds and rolling slots.
    """
    pending: list[str] = []
    for tool in tools:
        if steam_started_at is None:
            tool["pending_restart"] = None
            continue
        if tool.get("source") != "custom" or tool.get("managed_slot") == "latest":
            tool["pending_restart"] = False
            continue
        try:
            landed = os.lstat(tool["path"]).st_ctime
        except (OSError, KeyError) as err:
            decky.logger.warning(
                f"annotate_pending_restart: cannot stat {tool.get('path')}: {err}"
            )
            tool["pending_restart"] = None
            continue
        tool["pending_restart"] = landed > steam_started_at
        if tool["pending_restart"]:
            pending.append(tool.get("directory_name", "?"))
    decky.logger.debug(
        f"annotate_pending_restart: steam_started_at={steam_started_at} pending={pending}"
    )
