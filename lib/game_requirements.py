"""Fetch minimum system requirements from the Steam Store API.

Steam's appdetails endpoint returns system requirements as HTML blobs,
but the RAM requirement follows a consistent pattern we can regex out.
See: https://store.steampowered.com/api/appdetails?appids={appid}
"""

from __future__ import annotations

import re
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .http_client import curl_json

# simple in-memory cache so we don't hit Steam for the same game twice
_cache: dict[str, dict[str, Any]] = {}

# grabs "8 GB RAM" or "4096 MB RAM" from the HTML blob
_RAM_PATTERN = re.compile(r'(\d+)\s*(GB|MB)\s*RAM', re.IGNORECASE)

# pulls "<strong>Label:</strong> Value" pairs out of Steam's requirements HTML
_FIELD_PATTERN = re.compile(
    r'<strong>\s*([^<:]+?)\s*:?\s*</strong>\s*:?\s*(.*?)(?=<br|</li|$)',
    re.IGNORECASE | re.DOTALL,
)


def _parse_min_ram_gb(html: str) -> int | None:
    """Pull the RAM number from a requirements HTML string."""
    match = _RAM_PATTERN.search(html)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2).upper()
    if unit == 'MB':
        # round up: 4096 MB -> 4 GB, 512 MB -> 1 GB
        return max(1, (value + 1023) // 1024)
    return value


def _strip_html_tags(html: str) -> str:
    """Remove HTML tags from a string, keep the text content."""
    return re.sub(r'<[^>]+>', '', html).strip()


def _parse_requirements_fields(html: str) -> list[dict[str, str]]:
    """Parse Steam requirements HTML into a list of {label, value} pairs.

    Steam format is typically:
      <strong>OS:</strong> Windows 10<br>
      <strong>Processor:</strong> Intel i5<br>
    Returns [{"label": "OS", "value": "Windows 10"}, ...]
    """
    fields: list[dict[str, str]] = []
    for match in _FIELD_PATTERN.finditer(html):
        label = _strip_html_tags(match.group(1)).strip()
        value = _strip_html_tags(match.group(2)).strip()
        # skip the "Minimum" / "Recommended" header and empty values
        if label.lower() in ('minimum', 'recommended', '') or not value:
            continue
        fields.append({'label': label, 'value': value})
    return fields


def _find_field(fields: list[dict[str, str]], *labels: str) -> str | None:
    """Return the value of the first field whose label matches (case-insensitive)."""
    for f in fields:
        if f['label'].lower() in labels:
            return f['value']
    return None


def get_game_requirements(app_id: str) -> dict[str, Any]:
    """Fetch and cache minimum system requirements for a Steam game.

    Returns a dict with:
      min_ram_gb: int | None       -- minimum RAM in GB, or None if unparseable
      min_cpu: str | None          -- minimum CPU string, or None
      min_gpu: str | None          -- minimum GPU string, or None
      raw_minimum: str | None      -- the raw HTML minimum requirements string
      fields: list[dict] | None    -- parsed [{label, value}, ...] pairs
    """
    if app_id in _cache:
        return _cache[app_id]

    result: dict[str, Any] = {
        'min_ram_gb': None,
        'min_cpu': None,
        'min_gpu': None,
        'raw_minimum': None,
        'fields': None,
    }

    try:
        url = f'https://store.steampowered.com/api/appdetails?appids={app_id}&l=english'
        data = curl_json(url, timeout=10)

        app_data = data.get(str(app_id), {})  # type: ignore[union-attr]
        if not app_data.get('success'):
            decky.logger.debug(f'Steam Store API: no data for app {app_id}')
            _cache[app_id] = result
            return result

        pc_reqs = app_data.get('data', {}).get('pc_requirements', {})
        if isinstance(pc_reqs, list):
            # some games return an empty list instead of a dict
            _cache[app_id] = result
            return result

        minimum_html = pc_reqs.get('minimum', '')
        if minimum_html:
            result['raw_minimum'] = minimum_html
            result['min_ram_gb'] = _parse_min_ram_gb(minimum_html)
            fields = _parse_requirements_fields(minimum_html)
            result['fields'] = fields
            result['min_cpu'] = _find_field(fields, 'processor', 'cpu')
            result['min_gpu'] = _find_field(fields, 'graphics', 'gpu', 'video')

        decky.logger.debug(
            f'Game requirements for {app_id}: '
            f'min_ram={result["min_ram_gb"]}GB '
            f'min_cpu={result["min_cpu"]} '
            f'min_gpu={result["min_gpu"]}'
        )
    except Exception as exc:
        decky.logger.warning(f'Failed to fetch game requirements for {app_id}: {exc}')

    _cache[app_id] = result
    return result
