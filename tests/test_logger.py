# tests/test_logger.py
import asyncio
import logging
import pytest
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import Plugin


@pytest.fixture
def plugin():
    return Plugin()


def test_set_log_level_debug(plugin):
    import decky
    decky.logger.setLevel(logging.INFO)
    result = plugin._sync_set_log_level("DEBUG")
    assert result is True
    assert decky.logger.level == logging.DEBUG


def test_set_log_level_info(plugin):
    import decky
    decky.logger.setLevel(logging.DEBUG)
    result = plugin._sync_set_log_level("INFO")
    assert result is True
    assert decky.logger.level == logging.INFO


def test_set_log_level_invalid(plugin):
    result = plugin._sync_set_log_level("INVALID")
    assert result is False


def test_is_game_running_true_when_pgrep_finds_process(plugin):
    """Returns True when pgrep finds SteamLaunch."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        result = asyncio.run(plugin.is_game_running())
    assert result is True


def test_is_game_running_false_when_no_process(plugin):
    """Returns False when pgrep finds nothing."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1)
        result = asyncio.run(plugin.is_game_running())
    assert result is False
