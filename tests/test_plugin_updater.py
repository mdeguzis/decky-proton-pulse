"""Tests for lib/plugin_updater.py - version parsing, check_for_update, and _run."""

from __future__ import annotations

import os
import shutil
import threading
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from lib.plugin_updater import (
    _ver,
    check_for_update,
    make_initial_status,
    start_apply_update,
    _run,
)


# --- _ver ---

class TestVer:
    def test_simple_version(self):
        assert _ver("1.4.4") == (1, 4, 4)

    def test_v_prefix(self):
        assert _ver("v2.0.1") == (2, 0, 1)

    def test_comparison(self):
        assert _ver("1.5.0") > _ver("1.4.4")
        assert _ver("1.4.4") < _ver("1.5.0")
        assert _ver("1.4.4") == _ver("v1.4.4")

    def test_garbage_returns_zero(self):
        assert _ver("not-a-version") == (0,)
        assert _ver("") == (0,)

    def test_none_returns_zero(self):
        # _ver casts to str first, so None becomes "None"
        assert _ver(None) == (0,)  # type: ignore[arg-type]


# --- make_initial_status ---

class TestMakeInitialStatus:
    def test_idle_state(self):
        s = make_initial_status()
        assert s["state"] == "idle"
        assert s["version"] is None
        assert s["error"] is None


# --- check_for_update ---

MOCK_RELEASE = {
    "tag_name": "v1.5.0",
    "html_url": "https://github.com/mdeguzis/decky-proton-pulse/releases/tag/v1.5.0",
    "assets": [
        {
            "name": "decky-proton-pulse-v1.5.0.zip",
            "browser_download_url": "https://github.com/mdeguzis/decky-proton-pulse/releases/download/v1.5.0/decky-proton-pulse-v1.5.0.zip",
            "size": 500000,
        }
    ],
}

MOCK_PRERELEASE = {
    "tag_name": "v1.6.0-rc1",
    "html_url": "https://github.com/mdeguzis/decky-proton-pulse/releases/tag/v1.6.0-rc1",
    "assets": [
        {
            "name": "decky-proton-pulse-v1.6.0-rc1.zip",
            "browser_download_url": "https://github.com/example/v1.6.0-rc1.zip",
            "size": 600000,
        }
    ],
}


class TestCheckForUpdate:
    @patch("lib.plugin_updater.curl_json")
    def test_release_channel_has_update(self, mock_curl):
        mock_curl.return_value = MOCK_RELEASE
        result = check_for_update("1.4.4", channel="release")
        assert result["success"] is True
        assert result["has_update"] is True
        assert result["latest_version"] == "1.5.0"
        assert result["zip_url"] is not None

    @patch("lib.plugin_updater.curl_json")
    def test_release_channel_up_to_date(self, mock_curl):
        mock_curl.return_value = MOCK_RELEASE
        result = check_for_update("1.5.0", channel="release")
        assert result["success"] is True
        assert result["has_update"] is False

    @patch("lib.plugin_updater.curl_json")
    def test_release_channel_ahead(self, mock_curl):
        mock_curl.return_value = MOCK_RELEASE
        result = check_for_update("2.0.0", channel="release")
        assert result["success"] is True
        assert result["has_update"] is False
        assert result["latest_version"] == "1.5.0"

    @patch("lib.plugin_updater.curl_json")
    def test_prerelease_channel(self, mock_curl):
        mock_curl.return_value = [MOCK_PRERELEASE, MOCK_RELEASE]
        result = check_for_update("1.4.4", channel="pre-release")
        assert result["success"] is True
        assert result["channel"] == "pre-release"

    @patch("lib.plugin_updater.curl_json")
    def test_prerelease_empty_list(self, mock_curl):
        mock_curl.return_value = []
        result = check_for_update("1.4.4", channel="pre-release")
        assert result["success"] is True
        assert result["has_update"] is False

    @patch("lib.plugin_updater.curl_json")
    def test_developer_channel(self, mock_curl):
        # Rolling developer release: GitHub returns the release at /tags/developer
        # with the build sha in the title and the dev zip attached
        mock_curl.return_value = {
            "tag_name": "developer",
            "name": "Developer build (abc1234)",
            "html_url": "https://github.com/mdeguzis/decky-proton-pulse/releases/tag/developer",
            "assets": [{
                "name": "decky-proton-pulse-dev.zip",
                "browser_download_url": "https://example.com/dev.zip",
                "size": 1024,
            }],
        }
        result = check_for_update("1.6.8", channel="developer")
        assert result["success"] is True
        # Developer channel always reports has_update so dev rebuilds can be
        # reinstalled regardless of version semantics
        assert result["has_update"] is True
        assert result["zip_url"] == "https://example.com/dev.zip"
        assert "abc1234" in result["latest_version"]

    @patch("lib.plugin_updater.curl_json")
    def test_developer_channel_no_release(self, mock_curl):
        # First make github-dev-release hasn't run yet -- the tag doesnt exist
        mock_curl.side_effect = Exception("404")
        result = check_for_update("1.6.8", channel="developer")
        assert result["success"] is False
        assert "404" in result["error"]

    @patch("lib.plugin_updater.curl_json")
    def test_latest_channel(self, mock_curl):
        mock_curl.return_value = {"sha": "abc1234567890"}
        result = check_for_update("1.4.4", channel="latest")
        assert result["success"] is True
        assert result["has_update"] is True
        assert "abc1234" in result["latest_version"]

    @patch("lib.plugin_updater.curl_json")
    def test_latest_channel_api_failure(self, mock_curl):
        mock_curl.side_effect = Exception("network error")
        result = check_for_update("1.4.4", channel="latest")
        # latest channel catches the commit lookup error internally
        assert result["success"] is True
        assert "HEAD" in result["latest_version"]

    @patch("lib.plugin_updater.curl_json")
    def test_release_channel_network_error(self, mock_curl):
        mock_curl.side_effect = Exception("timeout")
        result = check_for_update("1.4.4", channel="release")
        assert result["success"] is False
        assert "timeout" in result["error"]

    @patch("lib.plugin_updater.curl_json")
    def test_no_zip_asset(self, mock_curl):
        no_zip = {**MOCK_RELEASE, "assets": [{"name": "notes.txt", "browser_download_url": "x"}]}
        mock_curl.return_value = no_zip
        result = check_for_update("1.4.4", channel="release")
        assert result["success"] is True
        assert result["has_update"] is False
        assert result["zip_url"] is None


# --- _run (the actual download+extract+install flow) ---

def _make_test_zip(zip_path: Path, inner_dir_name: str = "decky-proton-pulse") -> None:
    """Create a minimal zip with the expected plugin structure."""
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(f"{inner_dir_name}/plugin.json", '{"name":"test"}')
        zf.writestr(f"{inner_dir_name}/main.py", "# test")
        zf.writestr(f"{inner_dir_name}/dist/index.js", "// test")


class TestRun:
    def test_successful_install(self, tmp_path):
        """Happy path: download, extract, move into place."""
        plugin_dir = tmp_path / "plugins" / "decky-proton-pulse"
        plugin_dir.mkdir(parents=True)
        (plugin_dir / "old_file.txt").write_text("old")

        zip_path = tmp_path / "update.zip"
        _make_test_zip(zip_path)

        status: dict = {}
        lock = threading.Lock()
        cancel = threading.Event()

        with patch("lib.plugin_updater.curl_download") as mock_dl:
            # curl_download should copy our test zip to the expected path
            def fake_download(url, dest, **kwargs):
                shutil.copy(str(zip_path), str(dest))
            mock_dl.side_effect = fake_download

            _run("https://example.com/test.zip", "1.5.0", str(plugin_dir), status, lock, cancel)

        assert status["state"] == "success"
        assert (plugin_dir / "plugin.json").exists()
        assert not (plugin_dir / "old_file.txt").exists()  # old files removed

    def test_cancelled_download(self, tmp_path):
        """Cancel event set during download raises RuntimeError."""
        plugin_dir = tmp_path / "plugins" / "decky-proton-pulse"
        plugin_dir.mkdir(parents=True)

        status: dict = {}
        lock = threading.Lock()
        cancel = threading.Event()
        cancel.set()  # pre-cancelled

        with patch("lib.plugin_updater.curl_download"):
            _run("https://example.com/test.zip", "1.0.0", str(plugin_dir), status, lock, cancel)

        assert status["state"] == "error"
        assert "Cancelled" in status["error"]

    def test_wrong_dir_name_renamed(self, tmp_path):
        """Zip with repo-branch/ name gets renamed to plugin name."""
        plugin_dir = tmp_path / "plugins" / "decky-proton-pulse"
        plugin_dir.mkdir(parents=True)

        zip_path = tmp_path / "update.zip"
        _make_test_zip(zip_path, inner_dir_name="decky-proton-pulse-main")

        status: dict = {}
        lock = threading.Lock()
        cancel = threading.Event()

        with patch("lib.plugin_updater.curl_download") as mock_dl:
            def fake_download(url, dest, **kwargs):
                shutil.copy(str(zip_path), str(dest))
            mock_dl.side_effect = fake_download

            _run("https://example.com/test.zip", "1.5.0", str(plugin_dir), status, lock, cancel)

        assert status["state"] == "success"
        assert (plugin_dir / "plugin.json").exists()

    def test_permission_error_tries_sudo(self, tmp_path):
        """When direct shutil fails, tries sudo -n fallback."""
        plugin_dir = tmp_path / "plugins" / "decky-proton-pulse"
        plugin_dir.mkdir(parents=True)

        zip_path = tmp_path / "update.zip"
        _make_test_zip(zip_path)

        status: dict = {}
        lock = threading.Lock()
        cancel = threading.Event()

        with patch("lib.plugin_updater.curl_download") as mock_dl, \
             patch("shutil.rmtree", side_effect=[PermissionError("root-owned"), None]), \
             patch("shutil.move") as mock_move, \
             patch("subprocess.run") as mock_run:
            def fake_download(url, dest, **kwargs):
                shutil.copy(str(zip_path), str(dest))
            mock_dl.side_effect = fake_download
            mock_run.return_value = MagicMock(returncode=0)

            _run("https://example.com/test.zip", "1.5.0", str(plugin_dir), status, lock, cancel)

        # should have tried sudo after shutil failed
        assert any("sudo" in str(c) for c in mock_run.call_args_list)


class TestStartApplyUpdate:
    def test_starts_thread(self):
        """start_apply_update spawns a daemon thread."""
        status = make_initial_status()
        lock = threading.Lock()
        cancel = threading.Event()
        cancel.set()  # cancel immediately so thread exits fast

        with patch("lib.plugin_updater.curl_download"):
            start_apply_update("https://x", "1.0", "/tmp/fake", status, lock, cancel)
        # thread was spawned (it'll error but that's fine for this test)
