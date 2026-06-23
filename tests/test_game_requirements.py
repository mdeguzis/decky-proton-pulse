import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch, MagicMock

from lib import game_requirements


def setup_function() -> None:
    game_requirements._cache.clear()


_EMPTY = {
    'min_ram_gb': None,
    'min_cpu': None,
    'min_gpu': None,
    'raw_minimum': None,
    'fields': None,
    'from_cache': False,
    'error': None,
}


def test_parse_min_ram_gb_handles_gb_and_mb() -> None:
    assert game_requirements._parse_min_ram_gb("Requires 8 GB RAM") == 8
    assert game_requirements._parse_min_ram_gb("Needs 4096 MB RAM") == 4
    assert game_requirements._parse_min_ram_gb("Needs 512 MB RAM") == 1
    assert game_requirements._parse_min_ram_gb("No RAM listed") is None


def test_strip_html_tags_and_parse_requirement_fields() -> None:
    html = (
        "<strong>Minimum:</strong><br>"
        "<strong>OS:</strong> Windows 10<br>"
        "<strong>Processor:</strong> Intel i5<br>"
        "<strong>Memory:</strong> 8 GB RAM<br>"
        "<strong>Recommended:</strong><br>"
        "<strong> </strong> "
    )
    fields = game_requirements._parse_requirements_fields(html)
    assert fields == [
        {"label": "OS", "value": "Windows 10"},
        {"label": "Processor", "value": "Intel i5"},
        {"label": "Memory", "value": "8 GB RAM"},
    ]
    assert game_requirements._strip_html_tags("<div>Hello <b>Deck</b></div>") == "Hello Deck"


def test_get_game_requirements_returns_disk_cache_without_network() -> None:
    cached = {**_EMPTY, 'min_ram_gb': 16, 'from_cache': True}
    with (
        patch("lib.game_requirements._load_disk_cache", return_value=cached),
        patch("lib.game_requirements.curl_json") as curl_json,
    ):
        result = game_requirements.get_game_requirements("123")

    assert result['min_ram_gb'] == 16
    curl_json.assert_not_called()


def test_get_game_requirements_parses_saves_disk_cache_and_memoizes() -> None:
    app_id = "123"
    html = (
        "<strong>OS:</strong> Windows 10<br>"
        "<strong>Memory:</strong> 8 GB RAM<br>"
    )
    payload = {app_id: {"success": True, "data": {"pc_requirements": {"minimum": html}}}}

    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._save_disk_cache") as save,
        patch("lib.game_requirements.curl_json", return_value=payload) as curl_json,
    ):
        first = game_requirements.get_game_requirements(app_id)
        second = game_requirements.get_game_requirements(app_id)

    assert first["min_ram_gb"] == 8
    assert first["raw_minimum"] == html
    assert first["fields"] == [
        {"label": "OS", "value": "Windows 10"},
        {"label": "Memory", "value": "8 GB RAM"},
    ]
    assert first["error"] is None
    assert second is first
    curl_json.assert_called_once()
    save.assert_called_once_with(app_id, first)


def test_get_game_requirements_handles_missing_or_list_requirements() -> None:
    app_id = "456"
    no_success = {app_id: {"success": False}}
    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._save_disk_cache"),
        patch("lib.game_requirements.curl_json", return_value=no_success),
    ):
        result = game_requirements.get_game_requirements(app_id)
    assert result["min_ram_gb"] is None
    assert result["error"] is None

    game_requirements._cache.clear()
    list_payload = {app_id: {"success": True, "data": {"pc_requirements": []}}}
    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._save_disk_cache"),
        patch("lib.game_requirements.curl_json", return_value=list_payload),
    ):
        result = game_requirements.get_game_requirements(app_id)
    assert result["min_ram_gb"] is None
    assert result["error"] is None


def test_get_game_requirements_uses_stale_cache_on_fetch_error() -> None:
    stale = {**_EMPTY, 'min_ram_gb': 8}
    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._load_stale_disk_cache", return_value=stale),
        patch("lib.game_requirements.curl_json", side_effect=RuntimeError("429")),
        patch.object(game_requirements.decky.logger, "warning"),
    ):
        result = game_requirements.get_game_requirements("789")

    assert result is stale
    assert result["min_ram_gb"] == 8


def test_get_game_requirements_returns_error_when_no_cache_on_failure() -> None:
    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._load_stale_disk_cache", return_value=None),
        patch("lib.game_requirements.curl_json", side_effect=RuntimeError("boom")),
        patch.object(game_requirements.decky.logger, "warning") as warning,
    ):
        result = game_requirements.get_game_requirements("789")

    assert result["error"] == "boom"
    assert result["min_ram_gb"] is None
    warning.assert_called_once()


def test_get_game_requirements_extracts_cpu_and_gpu() -> None:
    app_id = "1151640"
    html = (
        "<strong>Processor:</strong> Intel Core i5-2500K@3.3GHz or AMD FX 6300@3.5GHz<br>"
        "<strong>Memory:</strong> 8 GB RAM<br>"
        "<strong>Graphics:</strong> Nvidia GeForce GTX 780 (3 GB) or AMD Radeon R9 290 (4GB)<br>"
    )
    payload = {app_id: {"success": True, "data": {"pc_requirements": {"minimum": html}}}}

    with (
        patch("lib.game_requirements._load_disk_cache", return_value=None),
        patch("lib.game_requirements._save_disk_cache"),
        patch("lib.game_requirements.curl_json", return_value=payload),
    ):
        result = game_requirements.get_game_requirements(app_id)

    assert result["min_ram_gb"] == 8
    assert result["min_cpu"] == "Intel Core i5-2500K@3.3GHz or AMD FX 6300@3.5GHz"
    assert result["min_gpu"] == "Nvidia GeForce GTX 780 (3 GB) or AMD Radeon R9 290 (4GB)"
