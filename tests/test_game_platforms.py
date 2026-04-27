import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from lib import game_platforms


def setup_function() -> None:
    game_platforms._cache.clear()


# ── _library_folders ──────────────────────────────────────────────────────────

def test_library_folders_returns_empty_when_no_steam_root() -> None:
    with patch("lib.game_platforms.find_steam_root", return_value=None):
        assert game_platforms._library_folders() == []


def test_library_folders_returns_empty_when_vdf_missing(tmp_path: Path) -> None:
    with patch("lib.game_platforms.find_steam_root", return_value=tmp_path):
        assert game_platforms._library_folders() == []


def test_library_folders_returns_empty_when_vdf_unreadable(tmp_path: Path) -> None:
    vdf = tmp_path / "config" / "libraryfolders.vdf"
    vdf.parent.mkdir()
    vdf.write_text("")
    with (
        patch("lib.game_platforms.find_steam_root", return_value=tmp_path),
        patch("pathlib.Path.read_text", side_effect=OSError("permission denied")),
    ):
        assert game_platforms._library_folders() == []


def test_library_folders_parses_extra_paths(tmp_path: Path) -> None:
    # The extra path does NOT need to exist on disk — we no longer gate on is_dir()
    # so that SD-card libraries are included even when not currently mounted.
    extra = tmp_path / "extra" / "steamapps"
    vdf = tmp_path / "config" / "libraryfolders.vdf"
    vdf.parent.mkdir()
    vdf.write_text(f'"path"\t\t"{tmp_path / "extra"}"')
    with patch("lib.game_platforms.find_steam_root", return_value=tmp_path):
        folders = game_platforms._library_folders()
    assert extra in folders


# ── _parse_acf ────────────────────────────────────────────────────────────────

def test_parse_acf_returns_key_value_pairs(tmp_path: Path) -> None:
    acf = tmp_path / "app.acf"
    acf.write_text('"LastUpdated"\t\t"1700000000"\n"name"\t\t"My Game"')
    result = game_platforms._parse_acf(acf)
    assert result["LastUpdated"] == "1700000000"
    assert result["name"] == "My Game"


def test_parse_acf_returns_empty_on_missing_file(tmp_path: Path) -> None:
    assert game_platforms._parse_acf(tmp_path / "nonexistent.acf") == {}


# ── _get_library_info ─────────────────────────────────────────────────────────

def test_get_library_info_returns_nones_when_no_libraries() -> None:
    with patch("lib.game_platforms._library_folders", return_value=[]):
        info = game_platforms._get_library_info("999")
    assert info == {"last_updated": None, "storage_free_gb": None}


def test_get_library_info_returns_nones_when_manifest_missing(tmp_path: Path) -> None:
    # When manifest is missing, falls back to primary library free space (not None)
    lib_dir = tmp_path / "steamapps"
    lib_dir.mkdir()
    with patch("lib.game_platforms._library_folders", return_value=[lib_dir]):
        info = game_platforms._get_library_info("12345")
    assert info["last_updated"] is None
    assert info["storage_free_gb"] is not None  # fallback to primary library free space


def test_get_library_info_parses_last_updated_and_free_space(tmp_path: Path) -> None:
    lib_dir = tmp_path / "steamapps"
    lib_dir.mkdir()
    manifest = lib_dir / "appmanifest_42.acf"
    manifest.write_text('"LastUpdated"\t\t"1700000000"')

    fake_usage = MagicMock()
    fake_usage.free = 50 * 1024 ** 3  # 50 GB

    with (
        patch("lib.game_platforms._library_folders", return_value=[lib_dir]),
        patch("shutil.disk_usage", return_value=fake_usage),
    ):
        info = game_platforms._get_library_info("42")

    assert info["last_updated"] is not None
    assert "2023" in info["last_updated"]  # epoch 1700000000 → Nov 2023
    assert info["storage_free_gb"] == 50.0


def test_get_library_info_handles_zero_epoch(tmp_path: Path) -> None:
    lib_dir = tmp_path / "steamapps"
    lib_dir.mkdir()
    manifest = lib_dir / "appmanifest_7.acf"
    manifest.write_text('"LastUpdated"\t\t"0"')

    fake_usage = MagicMock()
    fake_usage.free = 10 * 1024 ** 3

    with (
        patch("lib.game_platforms._library_folders", return_value=[lib_dir]),
        patch("shutil.disk_usage", return_value=fake_usage),
    ):
        info = game_platforms._get_library_info("7")

    assert info["last_updated"] is None
    assert info["storage_free_gb"] == 10.0


def test_get_library_info_handles_invalid_epoch(tmp_path: Path) -> None:
    lib_dir = tmp_path / "steamapps"
    lib_dir.mkdir()
    manifest = lib_dir / "appmanifest_9.acf"
    manifest.write_text('"LastUpdated"\t\t"not-a-number"')

    fake_usage = MagicMock()
    fake_usage.free = 5 * 1024 ** 3

    with (
        patch("lib.game_platforms._library_folders", return_value=[lib_dir]),
        patch("shutil.disk_usage", return_value=fake_usage),
    ):
        info = game_platforms._get_library_info("9")

    assert info["last_updated"] is None
    assert info["storage_free_gb"] == 5.0


def test_get_library_info_handles_disk_usage_oserror(tmp_path: Path) -> None:
    lib_dir = tmp_path / "steamapps"
    lib_dir.mkdir()
    manifest = lib_dir / "appmanifest_8.acf"
    manifest.write_text('"LastUpdated"\t\t"1700000000"')

    with (
        patch("lib.game_platforms._library_folders", return_value=[lib_dir]),
        patch("shutil.disk_usage", side_effect=OSError("no space")),
    ):
        info = game_platforms._get_library_info("8")

    assert info["last_updated"] is not None
    assert info["storage_free_gb"] is None


# ── get_game_platforms ────────────────────────────────────────────────────────

def test_get_game_platforms_success() -> None:
    app_id = "570"
    payload = {
        app_id: {
            "success": True,
            "data": {
                "platforms": {"windows": True, "mac": False, "linux": True},
                "release_date": {"date": "2 Jan, 2013"},
            },
        }
    }
    lib_info = {"last_updated": "Nov 15, 2023", "storage_free_gb": 42.5}

    with (
        patch("lib.game_platforms.curl_json", return_value=payload),
        patch("lib.game_platforms._get_library_info", return_value=lib_info),
    ):
        result = game_platforms.get_game_platforms(app_id)

    assert result["platforms"] == {"windows": True, "mac": False, "linux": True}
    assert result["release_date"] == "2 Jan, 2013"
    assert result["last_updated"] == "Nov 15, 2023"
    assert result["storage_free_gb"] == 42.5


def test_get_game_platforms_caches_result() -> None:
    app_id = "271590"
    payload = {
        app_id: {
            "success": True,
            "data": {
                "platforms": {"windows": True, "mac": False, "linux": False},
                "release_date": {"date": "17 Sep, 2013"},
            },
        }
    }
    lib_info = {"last_updated": None, "storage_free_gb": None}

    with (
        patch("lib.game_platforms.curl_json", return_value=payload) as mock_curl,
        patch("lib.game_platforms._get_library_info", return_value=lib_info),
    ):
        first = game_platforms.get_game_platforms(app_id)
        second = game_platforms.get_game_platforms(app_id)

    assert first == second
    mock_curl.assert_called_once()


def test_get_game_platforms_handles_api_failure() -> None:
    app_id = "999"
    lib_info = {"last_updated": None, "storage_free_gb": 20.0}

    with (
        patch("lib.game_platforms.curl_json", return_value={app_id: {"success": False}}),
        patch("lib.game_platforms._get_library_info", return_value=lib_info),
    ):
        result = game_platforms.get_game_platforms(app_id)

    assert result["platforms"] == {}
    assert result["release_date"] is None
    assert result["storage_free_gb"] == 20.0


def test_get_game_platforms_handles_exception() -> None:
    app_id = "111"
    lib_info = {"last_updated": None, "storage_free_gb": None}

    with (
        patch("lib.game_platforms.curl_json", side_effect=RuntimeError("boom")),
        patch("lib.game_platforms._get_library_info", return_value=lib_info),
    ):
        result = game_platforms.get_game_platforms(app_id)

    assert result["platforms"] == {}
    assert result["release_date"] is None
    assert result["storage_free_gb"] is None


def test_get_game_platforms_handles_empty_release_date() -> None:
    app_id = "222"
    payload = {
        app_id: {
            "success": True,
            "data": {
                "platforms": {"windows": True},
                "release_date": {"date": ""},
            },
        }
    }
    lib_info = {"last_updated": None, "storage_free_gb": None}

    with (
        patch("lib.game_platforms.curl_json", return_value=payload),
        patch("lib.game_platforms._get_library_info", return_value=lib_info),
    ):
        result = game_platforms.get_game_platforms(app_id)

    assert result["release_date"] is None
