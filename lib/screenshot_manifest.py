"""Manifest helpers for guided screenshot capture runs."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import TypedDict, cast

DEFAULT_SCREENSHOT_MANIFEST = (
    Path(__file__).resolve().parents[1] / "config" / "ui_screenshot_manifest.json"
)


@dataclass(frozen=True)
class ScreenshotManifestEntry:
    """One guided screenshot step in the project capture manifest."""

    caption: str
    group: str
    instructions: str
    key: str
    title: str


class ScreenshotManifestEntryPayload(TypedDict, total=False):
    """Serialized manifest entry loaded from JSON."""

    caption: str
    group: str
    instructions: str
    key: str
    title: str


def load_screenshot_manifest(
    path: Path = DEFAULT_SCREENSHOT_MANIFEST,
) -> list[ScreenshotManifestEntry]:
    """Load the guided screenshot manifest from JSON."""
    raw_data: object = json.loads(path.read_text())
    if not isinstance(raw_data, list):
        raise ValueError(f"Screenshot manifest must be a JSON array: {path}")
    raw = cast(list[object], raw_data)

    entries: list[ScreenshotManifestEntry] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"Screenshot manifest entries must be objects: {item!r}")
        payload = cast(ScreenshotManifestEntryPayload, item)
        entries.append(
            ScreenshotManifestEntry(
                caption=str(payload.get("caption", "")).strip(),
                group=str(payload.get("group", "")).strip(),
                instructions=str(payload.get("instructions", "")).strip(),
                key=str(payload.get("key", "")).strip(),
                title=str(payload.get("title", "")).strip(),
            )
        )

    for entry in entries:
        if not entry.group or not entry.key or not entry.title:
            raise ValueError(f"Screenshot manifest entry is missing required fields: {entry!r}")
    return entries


def filter_screenshot_manifest(
    entries: list[ScreenshotManifestEntry], match: str = ""
) -> list[ScreenshotManifestEntry]:
    """Return only entries whose group, key, or title matches the filter."""
    needle = match.strip().lower()
    if not needle:
        return entries
    return [
        entry
        for entry in entries
        if needle in entry.group.lower()
        or needle in entry.key.lower()
        or needle in entry.title.lower()
    ]
