# tests/conftest.py
"""Shared test fixtures and sys.path bootstrap for the test suite."""
import logging
import sys
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock

import pytest

# ── Make the project root importable ──────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ── Mock the decky module BEFORE any project imports ──────────────────────────
# decky is provided by the Decky Loader runtime and is not available in the
# test environment.  We install a lightweight mock into sys.modules so that
# ``import decky`` inside main.py / lib/ succeeds.

_test_logger = logging.getLogger("decky-proton-pulse-test")
_test_logger.addHandler(logging.NullHandler())

_decky_mock = MagicMock()
_decky_mock.DECKY_USER_HOME = "/home/testuser"
_decky_mock.DECKY_HOME = "/home/testuser/homebrew"
_decky_mock.DECKY_SETTINGS_DIR = "/home/testuser/homebrew/settings"
_decky_mock.DECKY_RUNTIME_DIR = "/home/testuser/homebrew/runtime"
_decky_mock.DECKY_PLUGIN_DIR = "/tmp/test_plugin"
_decky_mock.DECKY_PLUGIN_LOG_DIR = "/tmp"
_decky_mock.DECKY_PLUGIN_LOG = "/tmp/decky-proton-pulse-test.log"
_decky_mock.DECKY_PLUGIN_VERSION = "0.0.0-test"
_decky_mock.logger = _test_logger

sys.modules["decky"] = _decky_mock

# NOW it's safe to import project modules
from main import Plugin  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def plugin() -> Plugin:
    """Return a fresh Plugin instance for each test."""
    p = Plugin()
    p._debug_handler_ref = [None]
    return p


@pytest.fixture(autouse=True)
def _reset_log_level() -> Generator[None, None, None]:  # pyright: ignore[reportUnusedFunction]
    """Reset the decky logger to INFO between tests so state doesn't leak."""
    import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

    yield
    decky.logger.setLevel(logging.INFO)