"""Disk-backed CDN cache stored under DECKY_PLUGIN_RUNTIME_DIR.

Cache layout::

    <DECKY_PLUGIN_RUNTIME_DIR>/cdn_cache/
        <app_id>/
            index.json
            2024.json
            votes.json
        _meta/
            <url_hash>.json   # {etag, last_modified, fetched_at}

Each cached file has a companion metadata entry that remembers the ETag
(or Last-Modified) the CDN sent back, so the next fetch can use
``If-None-Match`` / ``If-Modified-Since`` and skip re-downloading data
that hasn't changed.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

DEFAULT_TTL = 3600  # 1 hour — anything older than this triggers a revalidation


def _cache_root() -> Path:
    root = Path(decky.DECKY_PLUGIN_RUNTIME_DIR) / "cdn_cache"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _meta_dir() -> Path:
    d = _cache_root() / "_meta"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _url_hash(url: str) -> str:
    # Truncated SHA-256 — just needs to be unique enough for filenames
    return hashlib.sha256(url.encode()).hexdigest()[:16]


# ── Public API ────────────────────────────────────────────────────────────────


def cache_path_for(app_id: str, filename: str) -> Path:
    """Where a cached CDN file lives on disk (creates the parent dir if needed)."""
    d = _cache_root() / app_id
    d.mkdir(parents=True, exist_ok=True)
    return d / filename


def read_cached(app_id: str, filename: str) -> Any | None:
    """Read a cached JSON file, or *None* if it's missing or corrupt."""
    p = cache_path_for(app_id, filename)
    if not p.exists():
        decky.logger.debug(f"Cache miss (not on disk): {app_id}/{filename}")
        return None
    try:
        data = json.loads(p.read_text())
        decky.logger.debug(f"Cache read OK: {app_id}/{filename} ({p})")
        return data
    except (json.JSONDecodeError, OSError) as exc:
        decky.logger.debug(f"Cache read failed (corrupt): {app_id}/{filename} -- {exc}")
        return None


def write_cached(app_id: str, filename: str, data: Any) -> None:
    """Stash JSON data into the cache."""
    p = cache_path_for(app_id, filename)
    p.write_text(json.dumps(data, separators=(",", ":")))
    decky.logger.debug(f"Cache write: {app_id}/{filename} ({p})")


def get_meta(url: str) -> dict[str, Any]:
    """Look up stored metadata (etag, fetched_at, …) for a URL."""
    # Meta files are keyed by URL hash, not app_id, so the same URL
    # always maps to the same metadata file no matter who's asking.
    p = _meta_dir() / f"{_url_hash(url)}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())  # type: ignore[no-any-return]
    except (json.JSONDecodeError, OSError):
        return {}


def set_meta(url: str, *, etag: str | None = None, last_modified: str | None = None) -> None:
    """Save cache metadata for a URL."""
    p = _meta_dir() / f"{_url_hash(url)}.json"
    # fetched_at is wall-clock time — is_fresh() uses it for TTL checks
    p.write_text(json.dumps({
        "etag": etag,
        "last_modified": last_modified,
        "fetched_at": time.time(),
    }, separators=(",", ":")))


def is_fresh(url: str, ttl: int = DEFAULT_TTL) -> bool:
    """Is the cached data for *url* younger than *ttl* seconds?"""
    meta = get_meta(url)
    fetched_at = meta.get("fetched_at")
    if fetched_at is None:
        decky.logger.debug(f"Cache freshness: no metadata for {url}")
        return False
    age = time.time() - fetched_at
    fresh = age < ttl
    decky.logger.debug(f"Cache freshness: {url} age={int(age)}s ttl={ttl}s fresh={fresh}")
    return bool(fresh)


def conditional_headers(url: str) -> list[str]:
    """Build curl ``-H`` flags for conditional requests (ETag / Last-Modified)."""
    meta = get_meta(url)
    headers: list[str] = []
    if meta.get("etag"):
        headers.append(f'If-None-Match: {meta["etag"]}')
    if meta.get("last_modified"):
        headers.append(f'If-Modified-Since: {meta["last_modified"]}')
    return headers
