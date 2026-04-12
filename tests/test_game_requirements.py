import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import patch

from lib import game_requirements


def setup_function() -> None:
    game_requirements._cache.clear()


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


def test_get_game_requirements_parses_and_caches_result() -> None:
    app_id = "123"
    html = (
        "<strong>OS:</strong> Windows 10<br>"
        "<strong>Memory:</strong> 8 GB RAM<br>"
    )
    payload = {
        app_id: {
            "success": True,
            "data": {"pc_requirements": {"minimum": html}},
        }
    }

    with patch("lib.game_requirements.curl_json", return_value=payload) as curl_json:
        first = game_requirements.get_game_requirements(app_id)
        second = game_requirements.get_game_requirements(app_id)

    assert first["min_ram_gb"] == 8
    assert first["raw_minimum"] == html
    assert first["fields"] == [
        {"label": "OS", "value": "Windows 10"},
        {"label": "Memory", "value": "8 GB RAM"},
    ]
    assert second == first
    curl_json.assert_called_once()


def test_get_game_requirements_handles_missing_or_list_requirements() -> None:
    app_id = "456"
    no_success = {app_id: {"success": False}}
    with patch("lib.game_requirements.curl_json", return_value=no_success):
        result = game_requirements.get_game_requirements(app_id)
    assert result == {"min_ram_gb": None, "raw_minimum": None, "fields": None}

    game_requirements._cache.clear()
    list_payload = {app_id: {"success": True, "data": {"pc_requirements": []}}}
    with patch("lib.game_requirements.curl_json", return_value=list_payload):
        result = game_requirements.get_game_requirements(app_id)
    assert result == {"min_ram_gb": None, "raw_minimum": None, "fields": None}


def test_get_game_requirements_handles_exception_and_logs_warning() -> None:
    with (
        patch("lib.game_requirements.curl_json", side_effect=RuntimeError("boom")),
        patch.object(game_requirements.decky.logger, "warning") as warning,
    ):
        result = game_requirements.get_game_requirements("789")

    assert result == {"min_ram_gb": None, "raw_minimum": None, "fields": None}
    warning.assert_called_once()
