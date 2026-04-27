import struct
import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from lib import game_source


def setup_function() -> None:
    game_source._source_cache.clear()


# ── is_steam_app ──────────────────────────────────────────────────────────────

def test_is_steam_app_true_for_small_id() -> None:
    assert game_source.is_steam_app("570") is True
    assert game_source.is_steam_app("2561580") is True
    assert game_source.is_steam_app("1999999999") is True


def test_is_steam_app_false_for_large_shortcut_id() -> None:
    assert game_source.is_steam_app("3069549564") is False
    assert game_source.is_steam_app("2147483648") is False
    assert game_source.is_steam_app("4000000000") is False


def test_is_steam_app_false_for_invalid_id() -> None:
    assert game_source.is_steam_app("not-a-number") is False


# ── find_steam_appid_by_title ─────────────────────────────────────────────────

def test_find_steam_appid_by_title_exact_match(tmp_path: Path) -> None:
    lib = tmp_path / "steamapps"
    lib.mkdir()
    (lib / "appmanifest_1234.acf").write_text('"name"\t\t"Dredge"')
    with patch("lib.game_source._library_folders", return_value=[lib]):
        assert game_source.find_steam_appid_by_title("Dredge") == "1234"


def test_find_steam_appid_by_title_case_insensitive(tmp_path: Path) -> None:
    lib = tmp_path / "steamapps"
    lib.mkdir()
    (lib / "appmanifest_5678.acf").write_text('"name"\t\t"DREDGE"')
    with patch("lib.game_source._library_folders", return_value=[lib]):
        assert game_source.find_steam_appid_by_title("dredge") == "5678"


def test_find_steam_appid_by_title_no_match(tmp_path: Path) -> None:
    lib = tmp_path / "steamapps"
    lib.mkdir()
    (lib / "appmanifest_999.acf").write_text('"name"\t\t"Other Game"')
    with patch("lib.game_source._library_folders", return_value=[lib]):
        assert game_source.find_steam_appid_by_title("Dredge") is None


def test_find_steam_appid_by_title_no_libraries() -> None:
    with patch("lib.game_source._library_folders", return_value=[]):
        assert game_source.find_steam_appid_by_title("Anything") is None


# ── _parse_shortcuts_vdf ──────────────────────────────────────────────────────

def _make_shortcut_vdf(app_name: str, exe: str, launch_opts: str = "") -> bytes:
    """Build a minimal valid binary shortcuts.vdf for one shortcut entry."""
    def null_str(s: str) -> bytes:
        return s.encode("utf-8") + b"\x00"

    def string_field(key: str, val: str) -> bytes:
        return b"\x01" + null_str(key) + null_str(val)

    def int_field(key: str, val: int) -> bytes:
        return b"\x02" + null_str(key) + struct.pack("<I", val)

    entry = (
        string_field("AppName", app_name)
        + string_field("exe", exe)
        + string_field("LaunchOptions", launch_opts)
        + int_field("hidden", 0)
        + b"\x08"  # end of entry map
    )

    return (
        b"\x00" + null_str("shortcuts")  # outer map header
        + b"\x00" + null_str("0")        # entry index
        + entry
        + b"\x08\x08"                    # end outer map + file end
    )


def test_parse_shortcuts_vdf_reads_app_name_and_exe(tmp_path: Path) -> None:
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_shortcut_vdf("Dredge", "/usr/bin/heroic", ""))
    result = game_source._parse_shortcuts_vdf(vdf)
    assert len(result) == 1
    assert result[0]["appname"] == "Dredge"
    assert result[0]["exe"] == "/usr/bin/heroic"


def test_parse_shortcuts_vdf_missing_file(tmp_path: Path) -> None:
    assert game_source._parse_shortcuts_vdf(tmp_path / "nonexistent.vdf") == []


# ── _infer_source_from_shortcut ───────────────────────────────────────────────

def test_infer_source_heroic() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "/home/deck/.config/heroic/heroic"}) == "Heroic"

def test_infer_source_lutris() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "/usr/bin/lutris", "launchoptions": ""}) == "Lutris"

def test_infer_source_bottles() -> None:
    assert game_source._infer_source_from_shortcut({"launchoptions": "bottles-cli run"}) == "Bottles"

def test_infer_source_epic() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "com.epicgames.launcher"}) == "Epic"

def test_infer_source_gog() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "/gog/galaxy/start"}) == "GOG"

def test_infer_source_itchio() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "/itch-setup"}) == "itch.io"

def test_infer_source_unknown_defaults_to_non_steam() -> None:
    assert game_source._infer_source_from_shortcut({"exe": "/home/deck/games/mygame"}) == "Non-Steam"


# ── _find_shortcuts_vdf ───────────────────────────────────────────────────────

def test_find_shortcuts_vdf_returns_empty_without_steam_root() -> None:
    with patch("lib.game_source.find_steam_root", return_value=None):
        assert game_source._find_shortcuts_vdf() == []


def test_find_shortcuts_vdf_returns_empty_without_userdata(tmp_path: Path) -> None:
    with patch("lib.game_source.find_steam_root", return_value=tmp_path):
        assert game_source._find_shortcuts_vdf() == []


def test_find_shortcuts_vdf_finds_files(tmp_path: Path) -> None:
    vdf = tmp_path / "userdata" / "12345" / "config" / "shortcuts.vdf"
    vdf.parent.mkdir(parents=True)
    vdf.write_bytes(b"")
    with patch("lib.game_source.find_steam_root", return_value=tmp_path):
        found = game_source._find_shortcuts_vdf()
    assert vdf in found


# ── get_game_source ───────────────────────────────────────────────────────────

def test_get_game_source_returns_steam_for_installed_game() -> None:
    with patch("lib.game_source.is_steam_app", return_value=True):
        result = game_source.get_game_source("570", "Dota 2")
    assert result["is_steam"] is True
    assert result["source"] == "Steam"
    assert result["steam_app_id_match"] is None


def test_get_game_source_non_steam_with_heroic(tmp_path: Path) -> None:
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_shortcut_vdf("Dredge", "/home/deck/.config/heroic/heroic"))

    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[vdf]),
        patch("lib.game_source.find_steam_appid_by_title", return_value="1234"),
    ):
        result = game_source.get_game_source("9999999", "Dredge")

    assert result["is_steam"] is False
    assert result["source"] == "Heroic"
    assert result["steam_app_id_match"] == "1234"


def test_get_game_source_non_steam_no_shortcut_match() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[]),
        patch("lib.game_source.find_steam_appid_by_title", return_value=None),
    ):
        result = game_source.get_game_source("8888888", "Some Game")

    assert result["is_steam"] is False
    assert result["source"] == "Non-Steam"
    assert result["steam_app_id_match"] is None


def test_get_game_source_caches_result() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=True) as mock_check,
    ):
        game_source.get_game_source("570", "Dota 2")
        game_source.get_game_source("570", "Dota 2")

    mock_check.assert_called_once()


def test_get_game_source_handles_shortcuts_parse_exception() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", side_effect=RuntimeError("boom")),
        patch("lib.game_source.find_steam_appid_by_title", return_value=None),
    ):
        result = game_source.get_game_source("7777777", "Boom Game")

    assert result["source"] == "Non-Steam"
