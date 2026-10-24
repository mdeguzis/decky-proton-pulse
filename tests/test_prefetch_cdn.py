# tests/test_prefetch_cdn.py
"""CDN host + response handling for the startup prefetch (#131)."""
import logging
from unittest.mock import patch

import pytest

from lib import prefetch


def test_cdn_base_is_the_r2_data_host() -> None:
    # www.proton-pulse.com/data/... is the Pages SPA fallback and serves HTML.
    assert prefetch.CDN_BASE == "https://data.proton-pulse.com/data"


def test_fetch_cdn_json_caches_a_json_200() -> None:
    url = f"{prefetch.CDN_BASE}/730/index.json"
    with (
        patch.object(prefetch, "is_fresh", return_value=False),
        patch.object(prefetch, "conditional_headers", return_value=[]),
        patch.object(prefetch, "_curl_fetch", return_value=(200, '["2024", "2025"]', {"etag": "abc"})),
        patch.object(prefetch, "write_cached") as write_mock,
        patch.object(prefetch, "set_meta") as meta_mock,
    ):
        assert prefetch._fetch_cdn_json(url, "730", "index.json") == ["2024", "2025"]
    write_mock.assert_called_once_with("730", "index.json", ["2024", "2025"])
    meta_mock.assert_called_once_with(url, etag="abc", last_modified=None)


def test_fetch_cdn_json_warns_on_an_html_200(caplog: pytest.LogCaptureFixture) -> None:
    url = f"{prefetch.CDN_BASE}/730/index.json"
    with (
        patch.object(prefetch, "is_fresh", return_value=False),
        patch.object(prefetch, "conditional_headers", return_value=[]),
        patch.object(prefetch, "_curl_fetch", return_value=(200, "\n<!DOCTYPE html><html>", {})),
        patch.object(prefetch, "write_cached") as write_mock,
        patch.object(prefetch.decky, "logger", logging.getLogger("prefetch-test")),
        caplog.at_level(logging.WARNING, logger="prefetch-test"),
    ):
        assert prefetch._fetch_cdn_json(url, "730", "index.json") is None
    write_mock.assert_not_called()
    assert "200 but not JSON for 730/index.json" in caplog.text
    assert f"url={url}" in caplog.text
    assert "looks_html=True" in caplog.text
