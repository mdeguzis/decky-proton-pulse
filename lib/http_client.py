"""HTTP helpers that shell out to curl.

We use curl instead of urllib/requests because SteamOS has known SSL
cert issues with Python's bundled OpenSSL (see
:func:`plugin_utils.system_command_env`).  curl uses the system CA store
and just works.
"""

from __future__ import annotations

import json
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .plugin_utils import system_command_env


def curl_json(
    url: str, *, headers: list[str] | None = None, timeout: int = 25
) -> list[Any] | dict[str, Any]:
    """Fetch JSON from a URL by shelling out to curl."""
    command = [
        "curl",
        "-LfsS",
        "--http1.1",
        "--connect-timeout",
        "20",
        "--retry",
        "2",
        "--retry-delay",
        "2",
        "--max-time",
        str(timeout),
        url,
    ]
    for header in headers or []:
        command.extend(["-H", header])

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout + 10,
        env=system_command_env(),
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip() or f"curl failed with exit code {result.returncode}"
        )
    return json.loads(result.stdout)  # type: ignore[no-any-return]


ProgressCallback = Callable[[int, int | None, float | None], None]


def curl_download(  # pylint: disable=too-many-arguments,too-many-locals,too-many-branches
    url: str,
    destination: Path,
    *,
    timeout: int = 900,
    total_bytes: int | None = None,
    progress_callback: ProgressCallback | None = None,
    cancel_check: Callable[[], bool] | None = None,
    install_process_setter: (
        Callable[[subprocess.Popen[str] | None], None] | None
    ) = None,
) -> None:
    """Download a file with curl, polling for progress and watching for cancel.

    *cancel_check* is called every loop iteration so we can kill curl
    mid-download if the user changes their mind.
    """
    command = [
        "curl",
        "-LfsS",
        "--http1.1",
        "-4",
        "--connect-timeout",
        "20",
        "--retry",
        "2",
        "--retry-all-errors",
        "--retry-delay",
        "2",
        "--speed-time",
        "60",
        "--speed-limit",
        "1024",
        "--max-time",
        str(timeout),
        url,
        "-o",
        str(destination),
    ]

    # We manage the process lifecycle by hand (poll, terminate, kill)
    # so a context manager doesn't really fit here
    process = subprocess.Popen(  # pylint: disable=consider-using-with
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=system_command_env(),
    )

    if install_process_setter:
        install_process_setter(process)

    start_time = time.time()
    last_log_time = start_time
    last_size = -1

    try:
        while True:
            if cancel_check and cancel_check():
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate(timeout=5)
                msg = (stderr or stdout or "Install cancelled").strip()
                raise RuntimeError(msg or "Install cancelled")

            returncode = process.poll()
            now = time.time()

            if now - last_log_time >= 10:
                current_size = destination.stat().st_size if destination.exists() else 0
                growth = (
                    current_size - max(last_size, 0) if last_size >= 0 else current_size
                )
                decky.logger.info(
                    "curl download progress"
                    f" | destination={destination.name}"
                    f" bytes={current_size}"
                    f" growth_since_last={growth}"
                    f" elapsed={int(now - start_time)}s"
                )
                if progress_callback:
                    fraction = None
                    if total_bytes and total_bytes > 0:
                        fraction = max(0.0, min(1.0, current_size / total_bytes))
                    progress_callback(current_size, total_bytes, fraction)
                last_size = current_size
                last_log_time = now

            if returncode is not None:
                stdout, stderr = process.communicate(timeout=5)
                if (
                    returncode != 0
                    or not destination.exists()
                    or destination.stat().st_size <= 0
                ):
                    raise RuntimeError(
                        (
                            stderr
                            or stdout
                            or f"curl failed with exit code {returncode}"
                        ).strip()
                    )
                if progress_callback:
                    current_size = destination.stat().st_size
                    fraction = None
                    if total_bytes and total_bytes > 0:
                        fraction = max(0.0, min(1.0, current_size / total_bytes))
                    progress_callback(current_size, total_bytes, fraction)
                return

            if now - start_time > timeout + 30:
                process.kill()
                stdout, stderr = process.communicate(timeout=5)
                raise RuntimeError(
                    (
                        stderr
                        or stdout
                        or f"curl exceeded timeout after {timeout + 30}s"
                    ).strip()
                )

            time.sleep(1)
    finally:
        if install_process_setter:
            install_process_setter(None)
