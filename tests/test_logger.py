"""Tests for log level management and game process detection."""

# pylint: disable=redefined-outer-name
import asyncio
import logging
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error,wrong-import-position
from lib.plugin_logging import (
    log_frontend_event,
    sync_set_log_level,
)  # pylint: disable=wrong-import-position
from main import Plugin  # pylint: disable=wrong-import-position


@pytest.fixture
def plugin() -> Plugin:  # type: ignore[no-any-unimported]
    """Fresh Plugin instance for each test"""
    p = Plugin()
    p._debug_handler_ref = [None]  # pylint: disable=protected-access
    return p


def test_set_log_level_debug(plugin: Any) -> None:
    """Setting DEBUG level works and sticks on the main logger."""
    decky.logger.setLevel(logging.INFO)
    result = sync_set_log_level(
        "DEBUG", plugin._debug_handler_ref  # pylint: disable=protected-access
    )
    assert result is True
    assert decky.logger.level == logging.DEBUG
    assert plugin._debug_handler_ref[0] is None  # pylint: disable=protected-access


def test_set_log_level_info(plugin: Any) -> None:
    """Setting INFO level works and sticks"""
    decky.logger.setLevel(logging.DEBUG)
    result = sync_set_log_level(
        "INFO", plugin._debug_handler_ref  # pylint: disable=protected-access
    )
    assert result is True
    assert decky.logger.level == logging.INFO


def test_set_log_level_skips_announce_when_unchanged(plugin: Any) -> None:
    """Re-applying the same level should not log a 'changed from X to X' line.

    Frontend re-applies the saved level on every panel mount, which used to
    spam the main log (issue #67).
    """
    decky.logger.setLevel(logging.INFO)
    # first call - real transition from whatever state, should log
    sync_set_log_level("INFO", plugin._debug_handler_ref)  # pylint: disable=protected-access

    with patch.object(decky.logger, "info") as info_mock:
        result = sync_set_log_level(
            "INFO", plugin._debug_handler_ref  # pylint: disable=protected-access
        )

    assert result is True
    assert decky.logger.level == logging.INFO
    info_mock.assert_not_called()


def test_set_log_level_invalid(plugin: Any) -> None:
    """Invalid log level returns False"""
    result = sync_set_log_level(
        "INVALID", plugin._debug_handler_ref  # pylint: disable=protected-access
    )
    assert result is False


def test_plugin_set_log_level_wrapper(plugin: Any) -> None:
    result = asyncio.run(plugin.set_log_level("ERROR"))
    assert result is True
    assert decky.logger.level == logging.ERROR


def test_log_frontend_event_rejects_invalid_level() -> None:
    assert log_frontend_event("TRACE", "ignored") is False


def test_log_frontend_event_stringifies_unserializable_context() -> None:
    class _Unserializable:
        def __repr__(self) -> str:
            return "<ctx>"

    with patch.object(decky.logger, "log") as log_mock:
        assert log_frontend_event("INFO", "hello", {"bad": _Unserializable()}) is True

    logged_message = log_mock.call_args.args[1]
    assert "[frontend] hello | context={'bad': <ctx>}" == logged_message


def test_is_game_running_true_when_pgrep_finds_process(plugin: Any) -> None:
    """Returns True when pgrep finds SteamLaunch."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = asyncio.run(plugin.is_game_running())
    assert result is True


def test_is_game_running_false_when_no_process(plugin: Any) -> None:
    """Returns False when pgrep finds nothing."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1)
        result = asyncio.run(plugin.is_game_running())
    assert result is False
