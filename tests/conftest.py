import sys
from unittest.mock import MagicMock

# Mock the decky module before any plugin code imports it
decky_mock = MagicMock()
decky_mock.DECKY_USER_HOME = "/home/testuser"
decky_mock.DECKY_HOME = "/home/testuser/homebrew"
decky_mock.DECKY_SETTINGS_DIR = "/home/testuser/homebrew/settings"
decky_mock.DECKY_RUNTIME_DIR = "/home/testuser/homebrew/runtime"
decky_mock.logger = MagicMock()

sys.modules['decky'] = decky_mock
