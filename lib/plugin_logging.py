"""Logging helpers for Proton Pulse."""

from __future__ import annotations

import json
import logging

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error


def sync_set_log_level(
    level: str, debug_handler_ref: list[logging.Handler | None]
) -> bool:
    """Adjust the log level on *decky.logger*.

    *debug_handler_ref* is still here for backward-compatible callers,
    but we no longer mirror DEBUG output into a separate file.
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

    # no-op guard: frontend re-applies the saved level on every panel mount,
    # which used to spam "Log level changed from INFO to INFO" (see #67).
    # NOTSET -> any real level still counts as a transition and gets logged.
    if previous_level == level:
        return True

    decky.logger.setLevel(numeric)

    if numeric == logging.DEBUG:
        decky.logger.info(
            f"Log level changed from {previous_level} to DEBUG;"
            " verbose frontend/backend logging enabled in the main plugin log"
        )
    else:
        decky.logger.info(
            f"Log level changed from {previous_level} to {level};"
            " verbose debug logging disabled"
        )
    _disable_debug_log(debug_handler_ref)
    return True


def _disable_debug_log(debug_handler_ref: list[logging.Handler | None]) -> None:
    """Clean up any leftover legacy debug handler if one somehow stuck around."""
    handler = debug_handler_ref[0]
    if handler is None:
        return
    decky.logger.removeHandler(handler)
    handler.close()
    debug_handler_ref[0] = None


def get_log_contents() -> str:
    """Grab the tail of the main plugin log.

    The frontend LogViewer polls this every few seconds.  We cap it at
    200 lines so we're not shoving a novel over the callable bridge.
    """
    chunks: list[str] = []

    try:
        with open(decky.DECKY_PLUGIN_LOG, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if lines:
            chunks.append(f"===== {decky.DECKY_PLUGIN_LOG.rsplit('/', 1)[-1]} =====\n")
            chunks.append("".join(lines[-200:]))
    except FileNotFoundError:
        pass

    return "\n".join(chunks)


def log_frontend_event(
    level: str, message: str, context: dict[str, object] | None = None
) -> bool:
    """Let the React frontend write into the backend log file.

    Called via ``@decky/api`` callable so frontend events end up in the
    same log stream as backend events - one place to look when debugging.
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
