"""Logging helpers for Proton Pulse.

Handles debug-log file rotation, log-level switching, and reading log
tails for the frontend LogViewer.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os

import decky  # type: ignore[import-untyped]


def sync_set_log_level(
    level: str, debug_handler_ref: list[logging.Handler | None]
) -> bool:
    """Set the log level on *decky.logger* and toggle the debug file handler.

    *debug_handler_ref* is a single-element list so the caller (Plugin)
    can share the mutable reference across calls.
    """
    valid = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
    }
    if level not in valid:
        return False

    numeric = valid[level]
    previous_level = logging.getLevelName(decky.logger.level)
    decky.logger.setLevel(numeric)

    if numeric == logging.DEBUG:
        _enable_debug_log(debug_handler_ref)
        decky.logger.info(
            f"Log level changed from {previous_level} to DEBUG;"
            " verbose frontend/backend logging enabled"
        )
    else:
        decky.logger.info(
            f"Log level changed from {previous_level} to {level};"
            " verbose debug logging disabled"
        )
        _disable_debug_log(debug_handler_ref)
    return True


def _enable_debug_log(debug_handler_ref: list[logging.Handler | None]) -> None:
    if debug_handler_ref[0] is not None:
        return

    debug_path = os.path.join(decky.DECKY_PLUGIN_LOG_DIR, "plugin-debug.log")
    handler = logging.handlers.RotatingFileHandler(
        debug_path, maxBytes=20 * 1024 * 1024, backupCount=3
    )
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(
        logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    decky.logger.addHandler(handler)
    debug_handler_ref[0] = handler
    decky.logger.debug("Debug log enabled")


def _disable_debug_log(debug_handler_ref: list[logging.Handler | None]) -> None:
    handler = debug_handler_ref[0]
    if handler is None:
        return
    decky.logger.removeHandler(handler)
    handler.close()
    debug_handler_ref[0] = None


def get_log_contents() -> str:
    """Grab the tail of each log file and stitch them together.

    The frontend LogViewer polls this every few seconds.  Cap at 200
    lines per file so it doesn't send a ton of text over the callable
    bridge.
    """
    log_paths = [
        decky.DECKY_PLUGIN_LOG,
        os.path.join(decky.DECKY_PLUGIN_LOG_DIR, "plugin-debug.log"),
    ]
    chunks: list[str] = []

    for path in log_paths:
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            if lines:
                chunks.append(f"===== {os.path.basename(path)} =====\n")
                chunks.append("".join(lines[-200:]))
        except FileNotFoundError:
            continue

    return "\n".join(chunks)


def log_frontend_event(
    level: str, message: str, context: dict[str, object] | None = None
) -> bool:
    """Let the frontend write to the backend log file.

    The React side calls this via ``@decky/api`` callable so frontend
    events show up in the same log stream as backend events.
    """
    valid = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
    }
    numeric = valid.get(level.upper())
    if numeric is None:
        return False

    suffix = ""
    if context:
        try:
            suffix = f" | context={json.dumps(context, sort_keys=True)}"
        except TypeError:
            suffix = f" | context={context!s}"

    decky.logger.log(numeric, f"[frontend] {message}{suffix}")
    return True
