# tests/test_logger.py
import logging
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import Plugin


@pytest.fixture
def plugin():
    p = Plugin()
    p._setup_logger()
    return p


def test_set_log_level_debug(plugin):
    plugin._logger.setLevel(logging.INFO)
    result = plugin._sync_set_log_level("DEBUG")
    assert result is True
    assert plugin._logger.level == logging.DEBUG


def test_set_log_level_info(plugin):
    plugin._logger.setLevel(logging.DEBUG)
    result = plugin._sync_set_log_level("INFO")
    assert result is True
    assert plugin._logger.level == logging.INFO


def test_set_log_level_invalid(plugin):
    result = plugin._sync_set_log_level("INVALID")
    assert result is False


def test_is_game_running_returns_bool(plugin):
    import asyncio
    result = asyncio.run(plugin.is_game_running())
    assert isinstance(result, bool)
