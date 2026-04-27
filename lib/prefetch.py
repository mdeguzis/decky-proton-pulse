"""Startup prefetch -- warm the CDN cache for the user's installed games.

Runs in a background thread kicked off by ``Plugin._main()``.  Discovers
installed Steam games via ``appmanifest_*.acf`` files, sorts them by
playtime (most-played first), then fetches the CDN index + year files
for each one with exponential backoff on transient failures.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any, cast

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .cdn_cache import (
    conditional_headers,
    is_fresh,
    read_cached,
    set_meta,
    write_cached,
)
from .plugin_utils import system_command_env
from .steam_paths import find_steam_root

# GitHub Pages CDN that hosts the per-game ProtonDB report data
CDN_BASE = "https://www.proton-pulse.com/data"
MAX_RETRIES = 3
INITIAL_BACKOFF = 2  # seconds, doubles on each retry

# Steam appids for Valve's own tooling. None of these are games and they all
# 404 on the ProtonDB CDN, so don't waste fetches on them at startup.
# Mirrors KNOWN_NON_GAME_APP_IDS in src/lib/steamApps.ts -- keep in sync.
# Source: every Steam install drops these as appmanifest_*.acf alongside games.
KNOWN_NON_GAME_APP_IDS: frozenset[str] = frozenset({
    "228980",   # Steamworks Common Redistributables
    "1070560",  # Steam Linux Runtime 1.0 (scout)
    "1391110",  # Steam Linux Runtime 2.0 (soldier)
    "1493710",  # Proton Experimental
    "1628350",  # Steam Linux Runtime 3.0 (sniper)
    "1887720",  # Proton 7.0
    "2230260",  # Proton Hotfix
    "2348590",  # Proton 9.0
    "2805730",  # Steamworks Shared
})

# Name-prefix patterns that catch future Valve tooling we haven't seen yet
# (e.g. when Proton 10 or Steam Linux Runtime 4.0 ships). Anchored to the
# start of the name so a hypothetical game called "Proton: Hardcore" can
# still get through.
# "Proton 9.0", "Proton Experimental", "Proton Hotfix", "Proton EasyAntiCheat..."
_PROTON_TOOLS_RE = re.compile(
    r"^Proton(?:\s+(?:\d+(?:\.\d+)?|Experimental|Hotfix|EasyAntiCheat))\b",
    re.IGNORECASE,
)
_NON_GAME_NAME_PATTERNS: tuple[re.Pattern[str], ...] = (
    _PROTON_TOOLS_RE,
    re.compile(r"^Steam\s+Linux\s+Runtime\b", re.IGNORECASE),
    re.compile(r"^Steamworks\s+(?:Common\s+Redistributables|Shared)\b", re.IGNORECASE),
)


def _is_non_game_manifest(app_id: str, name: str) -> str | None:
    """Return a short reason string if this manifest is Valve tooling, None otherwise.

    The reason gets logged so a developer reading logs can see exactly why
    each entry was skipped.
    """
    if app_id in KNOWN_NON_GAME_APP_IDS:
        return "known-tool-id"
    for pattern in _NON_GAME_NAME_PATTERNS:
        if pattern.match(name):
            return f"name-pattern:{pattern.pattern}"
    return None


# ── Steam game discovery ─────────────────────────────────────────────────────


def _library_folders() -> list[Path]:
    """Discover all Steam library folder paths from libraryfolders.vdf."""
    root = find_steam_root()
    if not root:
        decky.logger.debug("Prefetch: no Steam root found")
        return []
    vdf = root / "config" / "libraryfolders.vdf"
    if not vdf.exists():
        decky.logger.debug(f"Prefetch: libraryfolders.vdf not found at {vdf}")
        return []
    try:
        text = vdf.read_text()
    except OSError as exc:
        decky.logger.debug(f"Prefetch: failed to read {vdf}: {exc}")
        return []
    paths: list[Path] = []
    for match in re.finditer(r'"path"\s+"([^"]+)"', text):
        p = Path(match.group(1))
        if p.is_dir():
            paths.append(p)
    decky.logger.info(
        "Prefetch: discovered %d library folder(s): %s",
        len(paths), [str(p) for p in paths],
    )
    return paths


def _parse_acf(path: Path) -> dict[str, str]:
    """Bare-bones ACF/VDF key-value parser — just grabs top-level string pairs."""
    result: dict[str, str] = {}
    try:
        # ACF files are Valve's KeyValues format; errors="replace" handles
        # the occasional non-UTF-8 byte that sneaks into game names
        text = path.read_text(errors="replace")
    except OSError:
        return result
    for m in re.finditer(r'"(\w+)"\s+"([^"]*)"', text):
        # Only grabs top-level "key" "value" pairs; nested sections
        # (like "UserConfig") are ignored — we only need appid/name/size
        result[m.group(1)] = m.group(2)
    return result


def discover_installed_games() -> list[dict[str, Any]]:
    """Find installed games and sort them by playtime (most-played first).

    Each entry: ``{"app_id": str, "name": str, "playtime": int}``.
    ``playtime`` is actually ``SizeOnDisk`` as a rough proxy -- real
    playtime lives in localconfig.vdf which needs per-user parsing.
    Size is always in the manifest and correlates well enough.

    Filters out Valve tooling (Proton, Steam Linux Runtime, Steamworks
    redistributables) since those 404 on the ProtonDB CDN. See
    KNOWN_NON_GAME_APP_IDS and _NON_GAME_NAME_PATTERNS at the top of this
    module.
    """
    games: dict[str, dict[str, Any]] = {}
    skipped: list[dict[str, str]] = []
    for lib in _library_folders():
        steamapps = lib / "steamapps"
        if not steamapps.is_dir():
            continue
        for manifest in steamapps.glob("appmanifest_*.acf"):
            kv = _parse_acf(manifest)
            app_id = kv.get("appid", "")
            if not app_id or not app_id.isdigit():
                continue
            name = kv.get("name", "")

            # Skip Proton, SLR, Steamworks redists, etc. before they hit the CDN
            reason = _is_non_game_manifest(app_id, name)
            if reason:
                skipped.append({"app_id": app_id, "name": name, "reason": reason})
                continue

            # SizeOnDisk is our rough proxy for playtime - real playtime lives
            # in localconfig.vdf which needs per-user parsing.  Size is always
            # present in the manifest and correlates well enough.
            size = int(kv.get("SizeOnDisk", "0") or "0")
            # LastUpdated is epoch seconds of the last Steam update/install
            last_updated = int(kv.get("LastUpdated", "0") or "0")
            games[app_id] = {
                "app_id": app_id,
                "name": name,
                "playtime": size,
                "last_updated": last_updated,
            }
    decky.logger.debug(
        f"Prefetch: found {len(games)} games across all library folders, "
        f"skipped {len(skipped)} non-game manifests"
    )
    if skipped:
        # Show the first few so a developer reading logs can verify the filter
        # caught the right things. Full list at debug level only.
        sample = skipped[:10]
        decky.logger.debug(f"Prefetch: skipped non-game manifests (sample): {sample}")
    # Sort: most recently updated first, size as tiebreaker
    return sorted(
        games.values(),
        key=lambda g: (g["last_updated"], g["playtime"]),
        reverse=True,
    )


def get_installed_game_stats() -> dict[str, Any]:
    """Return manifest-based installed Steam game stats for frontend diagnostics."""
    games = discover_installed_games()
    return {
        "installed_steam_games": len(games),
        "installed_steam_app_ids": [str(game["app_id"]) for game in games],
    }


# ── CDN fetch with backoff ───────────────────────────────────────────────────


def _parse_resp_headers(header_block: str) -> dict[str, str]:
    """Turn a raw HTTP header block into a lowercase-keyed dict."""
    headers: dict[str, str] = {}
    for line in header_block.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return headers


def _curl_fetch(
    url: str,
    extra_headers: list[str] | None = None,
    timeout: int = 20,
) -> tuple[int, str, dict[str, str]]:
    """Hit a URL via curl, returning (status_code, body, response_headers).

    Returns status 0 on network error so callers can retry.
    """
    cmd = [
        "curl", "-LsS", "--http1.1",
        "--connect-timeout", "10",
        "--max-time", str(timeout),
        "-w", "\n%{http_code}",  # append status code as last line of stdout
        "-D", "-",               # dump response headers to stdout before body
        url,
    ]
    for h in extra_headers or []:
        cmd.extend(["-H", h])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout + 10, env=system_command_env(), check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return 0, "", {}

    # curl -D - writes headers to stdout before the body, -w appends the
    # status code.  So stdout looks like: <headers>\r\n\r\n<body>\n<http_code>
    raw = result.stdout
    if result.returncode != 0 and not raw:
        return 0, "", {}

    # Split headers from body — headers end at the first blank line.
    # Try \r\n\r\n first (standard HTTP), fall back to \n\n (some curl builds)
    parts = raw.split("\r\n\r\n", 1)
    if len(parts) < 2:
        parts = raw.split("\n\n", 1)

    header_block = parts[0] if len(parts) == 2 else ""
    body_and_code = parts[1] if len(parts) == 2 else raw

    # -w "\n%{http_code}" puts the status code on the very last line of output
    lines = body_and_code.rsplit("\n", 1)
    body = lines[0] if len(lines) == 2 else ""
    status_str = lines[-1].strip()
    try:
        status = int(status_str)
    except ValueError:
        status = 0

    return status, body, _parse_resp_headers(header_block)


def _fetch_cdn_json(url: str, app_id: str, filename: str) -> Any | None:
    """Fetch a CDN JSON file with conditional requests + backoff retry.

    Returns parsed JSON on success, None on failure.  Writes to cache on
    200, keeps the existing cache on 304.
    """
    if is_fresh(url):
        cached = read_cached(app_id, filename)
        if cached is not None:
            decky.logger.debug(f"Prefetch: fresh cache hit for {app_id}/{filename}")
            return cached

    headers = conditional_headers(url)
    backoff = INITIAL_BACKOFF

    for attempt in range(MAX_RETRIES):
        status, body, resp_headers = _curl_fetch(url, headers)

        if status == 304:
            # Nothing changed — just refresh the timestamp so it stays fresh
            decky.logger.debug(f"Prefetch: 304 Not Modified for {app_id}/{filename}")
            set_meta(
                url,
                etag=resp_headers.get("etag"),
                last_modified=resp_headers.get("last-modified"),
            )
            return read_cached(app_id, filename)

        if status == 200:
            try:
                data = json.loads(body)
            except (json.JSONDecodeError, ValueError) as exc:
                decky.logger.debug(f"Prefetch: JSON parse error for {app_id}/{filename}: {exc}")
                return None
            write_cached(app_id, filename, data)
            set_meta(
                url,
                etag=resp_headers.get("etag"),
                last_modified=resp_headers.get("last-modified"),
            )
            decky.logger.debug(f"Prefetch: fetched and cached {app_id}/{filename} (200)")
            return data

        if status == 404:
            decky.logger.debug(f"Prefetch: 404 for {app_id}/{filename} — game not in CDN")
            return None  # not in the CDN, no point retrying

        # Transient error — back off and try again
        decky.logger.debug(
            f"Prefetch: transient error {status} for {app_id}/{filename}"
            f" (attempt {attempt + 1}/{MAX_RETRIES}, backoff {backoff}s)"
        )
        if attempt < MAX_RETRIES - 1:
            time.sleep(backoff)
            backoff *= 2

    decky.logger.debug(f"Prefetch: exhausted retries for {app_id}/{filename}")
    return None


# ── Main prefetch entry point ────────────────────────────────────────────────


def prefetch_installed_games(cancel_check: Any | None = None) -> dict[str, Any]:
    """Prefetch CDN data for all installed games.

    *cancel_check* is a ``threading.Event`` — if it gets set, we bail
    out early.  Returns a summary dict with counts.
    """
    games = discover_installed_games()
    decky.logger.info(f"CDN prefetch: found {len(games)} installed games")
    if games:
        # Surface the first handful in logs so a developer can sanity-check the list.
        sample = [(g["app_id"], g.get("name", "?")) for g in games[:10]]
        decky.logger.info(f"CDN prefetch: top {len(sample)} candidates: {sample}")

    fetched = 0
    skipped = 0
    failed: list[dict[str, str]] = []

    for game in games:
        if cancel_check and cancel_check.is_set():
            decky.logger.info("CDN prefetch: cancelled")
            break

        app_id = game["app_id"]
        name = game.get("name", "?")
        index_url = f"{CDN_BASE}/{app_id}/index.json"

        # Skip if index is still fresh
        if is_fresh(index_url):
            skipped += 1
            continue

        decky.logger.debug(f"CDN prefetch: fetching app_id={app_id} name={name!r}")
        index = _fetch_cdn_json(index_url, app_id, "index.json")
        if index is None:
            # Track which ones missed so the summary log can name them
            failed.append({"app_id": app_id, "name": name})
            continue

        # Fetch each year file listed in the index.
        # index.json is a JSON array of year strings, e.g. ["2023", "2024", "2025"]
        if isinstance(index, list):
            for year in cast(list[str], index):
                if cancel_check and cancel_check.is_set():
                    break
                year_url = f"{CDN_BASE}/{app_id}/{year}.json"
                _fetch_cdn_json(year_url, app_id, f"{year}.json")

        # Grab votes too while we're at it
        votes_url = f"{CDN_BASE}/{app_id}/votes.json"
        _fetch_cdn_json(votes_url, app_id, "votes.json")

        fetched += 1

    summary = {
        "fetched": fetched,
        "skipped": skipped,
        "failed": len(failed),
        "total": len(games),
    }
    decky.logger.info(f"CDN prefetch complete: {summary}")
    if failed:
        # Names + ids for any miss, so a future "why did 13 fetches fail" question
        # has answers in the logs without having to instrument anything else.
        decky.logger.info(f"CDN prefetch misses: {failed[:25]}")
    return summary
