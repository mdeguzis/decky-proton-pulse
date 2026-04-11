"""Tests for the disk-backed CDN cache helpers."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from lib import cdn_cache


def test_cache_round_trip_and_conditional_headers(tmp_path: Path) -> None:
    url = "https://example.test/data/730/index.json"
    with patch.object(decky, "DECKY_PLUGIN_RUNTIME_DIR", str(tmp_path)):
        cdn_cache.write_cached("730", "index.json", {"reports": 3})
        cdn_cache.set_meta(url, etag="abc", last_modified="yesterday")

        assert cdn_cache.read_cached("730", "index.json") == {"reports": 3}
        assert cdn_cache.get_meta(url)["etag"] == "abc"
        assert cdn_cache.conditional_headers(url) == [
            "If-None-Match: abc",
            "If-Modified-Since: yesterday",
        ]


def test_read_cached_and_get_meta_tolerate_corrupt_json(tmp_path: Path) -> None:
    with patch.object(decky, "DECKY_PLUGIN_RUNTIME_DIR", str(tmp_path)):
        cache_file = cdn_cache.cache_path_for("730", "index.json")
        cache_file.write_text("{")
        assert cdn_cache.read_cached("730", "index.json") is None

        meta_path = tmp_path / "cdn_cache" / "_meta" / f"{cdn_cache._url_hash('https://x')}.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text("{")
        assert cdn_cache.get_meta("https://x") == {}


def test_is_fresh_uses_fetched_at_timestamp(tmp_path: Path) -> None:
    url = "https://example.test/data/730/index.json"
    with patch.object(decky, "DECKY_PLUGIN_RUNTIME_DIR", str(tmp_path)):
        meta_path = tmp_path / "cdn_cache" / "_meta" / f"{cdn_cache._url_hash(url)}.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps({"fetched_at": 100}))

        with patch("lib.cdn_cache.time.time", return_value=150):
            assert cdn_cache.is_fresh(url, ttl=60) is True
        with patch("lib.cdn_cache.time.time", return_value=200):
            assert cdn_cache.is_fresh(url, ttl=60) is False


def test_read_cached_missing_file_and_meta_helpers_without_metadata(tmp_path: Path) -> None:
    url = "https://example.test/data/730/index.json"
    with patch.object(decky, "DECKY_PLUGIN_RUNTIME_DIR", str(tmp_path)):
        assert cdn_cache.read_cached("730", "missing.json") is None
        assert cdn_cache.get_meta(url) == {}
        assert cdn_cache.is_fresh(url, ttl=60) is False
        assert cdn_cache.conditional_headers(url) == []
