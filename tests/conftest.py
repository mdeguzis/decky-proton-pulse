import logging
import sys
from unittest.mock import MagicMock

# Use a real Logger so setLevel() / .level assertions work in tests.
_test_logger = logging.getLogger("decky-proton-pulse-test")
_test_logger.addHandler(logging.NullHandler())

decky_mock = MagicMock()
decky_mock.DECKY_USER_HOME = "/home/testuser"
decky_mock.DECKY_HOME = "/home/testuser/homebrew"
decky_mock.DECKY_SETTINGS_DIR = "/home/testuser/homebrew/settings"
decky_mock.DECKY_RUNTIME_DIR = "/home/testuser/homebrew/runtime"
decky_mock.DECKY_PLUGIN_LOG = "/tmp/decky-proton-pulse-test.log"
decky_mock.logger = _test_logger

sys.modules['decky'] = decky_mock
