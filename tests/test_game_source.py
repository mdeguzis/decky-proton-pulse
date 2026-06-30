import struct
import sys
import os
from pathlib import Path
from typing import Any
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from lib import game_source


def setup_function() -> None:
    game_source._source_cache.clear()


# --- is_steam_app ---

def test_find_heroic_native_id_from_gog_url() -> None:
    entry = {"launchoptions": "heroic://launch/gog/1207658924"}
    assert game_source._find_heroic_native_id(entry) == ("1207658924", None)


def test_find_heroic_native_id_from_epic_url() -> None:
    entry = {"exe": "heroic://launch/legendary/Fortnite_Live"}
    assert game_source._find_heroic_native_id(entry) == (None, "Fortnite_Live")


def test_find_heroic_native_id_from_library_json(tmp_path: Path) -> None:
    import json

    lib_file = tmp_path / "gog_library.json"
    lib_file.write_text(json.dumps({
        "games": [
            {"title": "The Witcher 3", "app_name": "1207664663"},
            {"title": "Other Game", "app_name": "not-a-number"},
        ]
    }))
    entry = {"appname": "the witcher 3"}
    with patch.object(game_source, "_HEROIC_LIBRARY_CANDIDATES", [lib_file]):
        assert game_source._find_heroic_native_id(entry) == ("1207664663", None)


def test_find_heroic_native_id_no_match(tmp_path: Path) -> None:
    missing = tmp_path / "nope.json"
    entry = {"appname": "unknown game", "launchoptions": "", "exe": ""}
    with patch.object(game_source, "_HEROIC_LIBRARY_CANDIDATES", [missing]):
        assert game_source._find_heroic_native_id(entry) == (None, None)


def test_find_heroic_native_id_corrupt_library_json(tmp_path: Path) -> None:
    bad = tmp_path / "gog_library.json"
    bad.write_text("{not valid json")
    entry = {"appname": "anything", "launchoptions": "", "exe": ""}
    with patch.object(game_source, "_HEROIC_LIBRARY_CANDIDATES", [bad]):
        assert game_source._find_heroic_native_id(entry) == (None, None)


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


# --- find_steam_appid_by_title ---

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


# --- _parse_shortcuts_vdf ---

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


# --- _infer_source_from_shortcut ---

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


# --- _find_shortcuts_vdf ---

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


# --- get_game_source ---

def test_get_game_source_returns_steam_for_installed_game() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=True),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source("570", "Dota 2")
    assert result["is_steam"] is True
    assert result["source"] == "Steam"
    assert result["steam_app_id_match"] is None
    assert result["full_game_app_id"] is None


def test_get_game_source_non_steam_with_heroic(tmp_path: Path) -> None:
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_shortcut_vdf("Dredge", "/home/deck/.config/heroic/heroic"))

    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[vdf]),
        patch("lib.game_source.find_steam_appid_by_title", return_value="1234"),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source("9999999", "Dredge")

    assert result["is_steam"] is False
    assert result["source"] == "Heroic"
    assert result["steam_app_id_match"] == "1234"
    assert result["full_game_app_id"] is None


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
    assert result["full_game_app_id"] is None


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


# --- find_steam_appid_by_title OSError ---

def test_find_steam_appid_by_title_oserror() -> None:
    mock_lib = MagicMock()
    mock_lib.glob.side_effect = OSError("permission denied")
    with patch("lib.game_source._library_folders", return_value=[mock_lib]):
        assert game_source.find_steam_appid_by_title("Dredge") is None


# --- find_steam_appid_from_store ---

import json


def _mock_urlopen(items: list) -> MagicMock:
    resp_data = json.dumps({"items": items}).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = resp_data
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def test_find_steam_appid_from_store_exact_match() -> None:
    items = [{"type": "app", "name": "Dredge", "id": 1562430}]
    with patch("urllib.request.urlopen", return_value=_mock_urlopen(items)):
        result = game_source.find_steam_appid_from_store("Dredge")
    assert result == "1562430"


def test_find_steam_appid_from_store_no_exact_match() -> None:
    items = [{"type": "app", "name": "Dredge 2", "id": 999}]
    with patch("urllib.request.urlopen", return_value=_mock_urlopen(items)):
        result = game_source.find_steam_appid_from_store("Dredge")
    assert result is None


def test_find_steam_appid_from_store_exception() -> None:
    with patch("urllib.request.urlopen", side_effect=Exception("network error")):
        result = game_source.find_steam_appid_from_store("Dredge")
    assert result is None


# --- _skip_bvdf_map ---

def _null_str(s: str) -> bytes:
    return s.encode() + b"\x00"


def _make_shortcut_vdf_with_nested_map(app_name: str, exe: str, appid_val: int) -> bytes:
    """Build a VDF with a nested 'tags' map (Heroic pattern) before the appid field."""
    tags_map = (
        b"\x00" + _null_str("tags")
        + b"\x01" + _null_str("0") + _null_str("action")
        + b"\x02" + _null_str("1") + struct.pack("<I", 99)
        + b"\x08"
    )
    entry = (
        b"\x01" + _null_str("AppName") + _null_str(app_name)
        + b"\x01" + _null_str("exe") + _null_str(exe)
        + tags_map
        + b"\x02" + _null_str("appid") + struct.pack("<I", appid_val)
        + b"\x08"
    )
    return (
        b"\x00" + _null_str("shortcuts")
        + b"\x00" + _null_str("0")
        + entry
        + b"\x08\x08"
    )


def test_parse_shortcuts_vdf_with_nested_tags_map(tmp_path: Path) -> None:
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_shortcut_vdf_with_nested_map("Dredge", "/usr/bin/heroic", 12345))
    result = game_source._parse_shortcuts_vdf(vdf)
    assert len(result) == 1
    assert result[0]["appname"] == "Dredge"
    assert result[0]["appid"] == 12345


def test_skip_bvdf_map_deeply_nested() -> None:
    inner = b"\x01" + _null_str("k") + _null_str("v") + b"\x08"
    outer = b"\x00" + _null_str("inner") + inner + b"\x08"
    pos = game_source._skip_bvdf_map(outer, 0)
    assert pos == len(outer)


def test_skip_bvdf_map_truncated_returns_gracefully() -> None:
    data = b"\x01" + _null_str("key") + _null_str("value")  # no 0x08 terminator
    pos = game_source._skip_bvdf_map(data, 0)
    assert pos == len(data)


def test_parse_shortcuts_vdf_unknown_type_byte_is_skipped(tmp_path: Path) -> None:
    entry = (
        b"\x05"  # unknown type byte -- should be skipped
        + b"\x01" + _null_str("AppName") + _null_str("TestGame")
        + b"\x08"
    )
    data = b"\x00" + _null_str("shortcuts") + b"\x00" + _null_str("0") + entry + b"\x08\x08"
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(data)
    result = game_source._parse_shortcuts_vdf(vdf)
    assert isinstance(result, list)


def test_parse_shortcuts_vdf_skips_garbage_outer_bytes(tmp_path: Path) -> None:
    entry = b"\x01" + _null_str("AppName") + _null_str("TestGame") + b"\x08"
    data = (
        b"\x00" + _null_str("shortcuts")
        + b"\x05"  # garbage byte in outer sequence
        + b"\x00" + _null_str("0")
        + entry
        + b"\x08\x08"
    )
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(data)
    result = game_source._parse_shortcuts_vdf(vdf)
    assert len(result) == 1
    assert result[0]["appname"] == "TestGame"


# --- find_shortcut_name_by_appid ---

def _make_vdf_with_appid(app_name: str, exe: str, appid_val: int) -> bytes:
    entry = (
        b"\x01" + _null_str("AppName") + _null_str(app_name)
        + b"\x01" + _null_str("exe") + _null_str(exe)
        + b"\x02" + _null_str("appid") + struct.pack("<I", appid_val)
        + b"\x08"
    )
    return (
        b"\x00" + _null_str("shortcuts")
        + b"\x00" + _null_str("0")
        + entry
        + b"\x08\x08"
    )


def test_find_shortcut_name_by_appid_found(tmp_path: Path) -> None:
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_vdf_with_appid("Dredge", "/usr/bin/heroic", 12345))
    with patch("lib.game_source._find_shortcuts_vdf", return_value=[vdf]):
        assert game_source.find_shortcut_name_by_appid("12345") == "Dredge"


def test_find_shortcut_name_by_appid_not_found() -> None:
    with patch("lib.game_source._find_shortcuts_vdf", return_value=[]):
        assert game_source.find_shortcut_name_by_appid("99999") is None


def test_find_shortcut_name_by_appid_exception() -> None:
    with patch("lib.game_source._find_shortcuts_vdf", side_effect=RuntimeError("boom")):
        assert game_source.find_shortcut_name_by_appid("99999") is None


# --- get_game_source -- appid match + no-title paths ---

def test_get_game_source_matched_by_appid_field(tmp_path: Path) -> None:
    appid_val = 9999999
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_vdf_with_appid("Dredge", "/home/deck/.config/heroic/heroic", appid_val))
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[vdf]),
        patch("lib.game_source.find_steam_appid_by_title", return_value="1562430"),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source(str(appid_val), "Dredge")
    assert result["source"] == "Heroic"
    assert result["steam_app_id_match"] == "1562430"
    assert result["full_game_app_id"] is None


def test_get_game_source_resolves_title_from_matched_entry(tmp_path: Path) -> None:
    appid_val = 9999999
    vdf = tmp_path / "shortcuts.vdf"
    vdf.write_bytes(_make_vdf_with_appid("Dredge", "/home/deck/.config/heroic/heroic", appid_val))
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[vdf]),
        patch("lib.game_source.find_steam_appid_by_title", return_value="1562430"),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source(str(appid_val))  # no title
    assert result["source"] == "Heroic"
    assert result["steam_app_id_match"] == "1562430"


def test_get_game_source_resolves_title_via_shortcut_name_lookup() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[]),
        patch("lib.game_source.find_shortcut_name_by_appid", return_value="Dredge"),
        patch("lib.game_source.find_steam_appid_by_title", return_value="1562430"),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source("9999999")  # no title
    assert result["steam_app_id_match"] == "1562430"


def test_get_game_source_local_acf_exception_is_caught() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[]),
        patch("lib.game_source.find_steam_appid_by_title", side_effect=RuntimeError("acf error")),
        patch("lib.game_source.find_steam_appid_from_store", return_value=None),
    ):
        result = game_source.get_game_source("9999999", "Dredge")
    assert result["steam_app_id_match"] is None


def test_get_game_source_store_exception_is_caught() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=False),
        patch("lib.game_source._find_shortcuts_vdf", return_value=[]),
        patch("lib.game_source.find_steam_appid_by_title", return_value=None),
        patch("lib.game_source.find_steam_appid_from_store", side_effect=RuntimeError("store error")),
    ):
        result = game_source.get_game_source("9999999", "Dredge")
    assert result["steam_app_id_match"] is None


# --- _resolve_demo_full_game ---

def _mock_appdetails(app_id: str, app_type: str, full_appid: str | None = None) -> MagicMock:
    detail: dict[str, Any] = {"type": app_type}
    if full_appid:
        detail["fullgame"] = {"appid": full_appid, "name": "Full Game"}
    resp_data = json.dumps({app_id: {"success": True, "data": detail}}).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = resp_data
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def test_resolve_demo_full_game_returns_full_appid_and_name() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_appdetails("12345", "demo", "99999")):
        result = game_source._resolve_demo_full_game("12345")
    assert result == ("99999", "Full Game")


def test_resolve_demo_full_game_returns_none_for_game_type() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_appdetails("12345", "game")):
        result = game_source._resolve_demo_full_game("12345")
    assert result is None


def test_resolve_demo_full_game_returns_none_on_success_false() -> None:
    resp_data = json.dumps({"12345": {"success": False}}).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = resp_data
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    with patch("urllib.request.urlopen", return_value=mock_resp):
        result = game_source._resolve_demo_full_game("12345")
    assert result is None


def test_resolve_demo_full_game_returns_none_on_exception() -> None:
    with patch("urllib.request.urlopen", side_effect=Exception("network error")):
        result = game_source._resolve_demo_full_game("12345")
    assert result is None


# --- get_game_source -- Steam demo paths ---

def test_get_game_source_steam_demo_returns_full_game_app_id() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=True),
        patch("lib.game_source._resolve_demo_full_game", return_value=("99999", "Full Game")),
    ):
        result = game_source.get_game_source("12345", "Some Demo")
    assert result["is_steam"] is True
    assert result["full_game_app_id"] == "99999"
    assert result["full_game_name"] == "Full Game"
    assert result["steam_app_id_match"] is None


def test_get_game_source_steam_non_demo_full_game_app_id_is_none() -> None:
    with (
        patch("lib.game_source.is_steam_app", return_value=True),
        patch("lib.game_source._resolve_demo_full_game", return_value=None),
    ):
        result = game_source.get_game_source("570", "Dota 2")
    assert result["is_steam"] is True
    assert result["full_game_app_id"] is None
