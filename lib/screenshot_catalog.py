"""Helpers for organizing captured screenshots and publishing them to the wiki."""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence, TypedDict, cast

SCREENSHOT_CATALOG_FILENAME = "catalog.json"
WIKI_SCREENSHOT_ROOT = Path("assets") / "screenshots"
WIKI_GALLERY_PAGE = "UI-Screenshot-Gallery.md"


@dataclass(frozen=True)
class ScreenshotEntry:
    """Metadata describing one captured screenshot."""

    caption: str
    group: str
    relative_path: str
    shot_key: str
    shot_title: str
    timestamp: str


class ScreenshotEntryPayload(TypedDict):
    """Serialized catalog entry loaded from JSON."""

    caption: str
    group: str
    relative_path: str
    shot_key: str
    shot_title: str
    timestamp: str


def slugify(value: str) -> str:
    """Convert free-form labels into stable filesystem and URL slugs."""
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return normalized.strip("-") or "untitled"


def titleize_slug(value: str) -> str:
    """Convert a slug like manage-game into a readable title."""
    return " ".join(
        part.capitalize() for part in value.replace("_", "-").split("-") if part
    )


def wiki_relative_path(entry: ScreenshotEntry) -> Path:
    """Return the stable wiki asset path for a screenshot entry."""
    return Path(entry.group) / f"{entry.shot_key}.png"


def screenshot_catalog_path(root: Path) -> Path:
    """Return the catalog location under the screenshot root."""
    return root / SCREENSHOT_CATALOG_FILENAME


def load_screenshot_catalog(root: Path) -> list[ScreenshotEntry]:
    """Load the screenshot catalog if it exists."""
    catalog_path = screenshot_catalog_path(root)
    if not catalog_path.exists():
        return []

    raw_data: object = json.loads(catalog_path.read_text())
    if not isinstance(raw_data, list):
        raise ValueError(f"Screenshot catalog must be a JSON array: {catalog_path}")
    raw = cast(list[object], raw_data)

    entries: list[ScreenshotEntry] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"Screenshot catalog entries must be objects: {item!r}")
        payload = cast(ScreenshotEntryPayload, item)
        entries.append(ScreenshotEntry(**payload))
    latest_by_key: dict[tuple[str, str], ScreenshotEntry] = {}
    for entry in sorted(entries, key=lambda item: item.timestamp, reverse=True):
        latest_by_key.setdefault((entry.group, entry.shot_key), entry)
    return sorted(
        latest_by_key.values(), key=lambda entry: entry.timestamp, reverse=True
    )


def save_screenshot_catalog(root: Path, entries: list[ScreenshotEntry]) -> None:
    """Persist screenshot catalog entries in a stable order."""
    catalog_path = screenshot_catalog_path(root)
    payload = [
        asdict(entry)
        for entry in sorted(entries, key=lambda entry: entry.timestamp, reverse=True)
    ]
    catalog_path.write_text(json.dumps(payload, indent=2) + "\n")


@dataclass(frozen=True)
class ScreenshotSpec:
    """Logical metadata supplied when registering a screenshot."""

    group: str
    shot_key: str
    shot_title: str = ""
    caption: str = ""


def _upsert_entry(
    entries: list[ScreenshotEntry], new_entry: ScreenshotEntry
) -> list[ScreenshotEntry]:
    kept = [
        entry
        for entry in entries
        if not (entry.group == new_entry.group and entry.shot_key == new_entry.shot_key)
    ]
    kept.append(new_entry)
    return kept


def register_screenshot(
    screenshots_root: Path,
    image_path: Path,
    spec: ScreenshotSpec,
    *,
    captured_at: str | None = None,
) -> ScreenshotEntry:
    """Move a captured screenshot into a grouped folder and record catalog metadata."""
    group_slug = slugify(spec.group)
    shot_slug = slugify(spec.shot_key)
    timestamp = captured_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    target_dir = screenshots_root / group_slug
    target_dir.mkdir(parents=True, exist_ok=True)
    target_name = f"{shot_slug}.png"
    target_path = target_dir / target_name
    for old_path in target_dir.glob(f"{shot_slug}-*.png"):
        old_path.unlink(missing_ok=True)
    if target_path.exists() and image_path.resolve() != target_path.resolve():
        target_path.unlink()
    if image_path.resolve() != target_path.resolve():
        shutil.move(str(image_path), target_path)

    entry = ScreenshotEntry(
        caption=spec.caption.strip(),
        group=group_slug,
        relative_path=str(target_path.relative_to(screenshots_root)),
        shot_key=shot_slug,
        shot_title=spec.shot_title.strip() or titleize_slug(shot_slug),
        timestamp=timestamp,
    )
    save_screenshot_catalog(
        screenshots_root,
        _upsert_entry(load_screenshot_catalog(screenshots_root), entry),
    )
    return entry


def build_wiki_gallery_markdown(
    entries: list[ScreenshotEntry],
    ordered_keys: Sequence[tuple[str, str]] | None = None,
) -> str:
    """Render the grouped screenshot gallery page for the wiki."""
    lines = [
        "# UI Screenshot Gallery",
        "",
        (
            "Generated from the local screenshot catalog. "
            "Screenshots follow the plugin's primary navigation flow first, "
            "then deeper modal states within each area."
        ),
        "",
        (
            "Current walkthrough order: Manage Game -> Manage Configurations "
            "-> Compatibility Tools -> Logs -> Settings -> Issue Reporting "
            "-> About."
        ),
        "",
        (
            "For planned screenshot additions and capture workflow notes, "
            "see the Developer Guide and On-Device Test Plan."
        ),
        "",
    ]

    order_index = {key: index for index, key in enumerate(ordered_keys or [])}
    sorted_entries = sorted(
        entries,
        key=lambda entry: (
            order_index.get((entry.group, entry.shot_key), len(order_index)),
            entry.group,
            entry.shot_key,
        ),
    )

    grouped: dict[str, list[ScreenshotEntry]] = {}
    group_order: list[str] = []
    for entry in sorted_entries:
        if entry.group not in grouped:
            grouped[entry.group] = []
            group_order.append(entry.group)
        grouped[entry.group].append(entry)

    for group in group_order:
        group_entries = grouped[group]
        lines.extend(
            [
                f"## {titleize_slug(group_entries[0].group)}",
                "",
            ]
        )
        for entry in group_entries:
            image_path = (WIKI_SCREENSHOT_ROOT / wiki_relative_path(entry)).as_posix()
            lines.append(f"### {entry.shot_title}")
            lines.append("")
            if entry.caption:
                lines.append(entry.caption)
                lines.append("")
            lines.append(f"![{entry.shot_title}]({image_path})")
            lines.append("")
            lines.append(f"- Captured: `{entry.timestamp}`")
            lines.append(f"- Key: `{entry.group}/{entry.shot_key}`")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def publish_screenshots_to_wiki(screenshots_root: Path, wiki_root: Path) -> list[Path]:
    """Copy catalogued screenshots into the wiki and regenerate the gallery page."""
    return publish_screenshots_to_wiki_filtered(screenshots_root, wiki_root)


def filter_screenshot_entries(
    entries: list[ScreenshotEntry],
    allowed_keys: set[tuple[str, str]] | None = None,
) -> list[ScreenshotEntry]:
    """Filter entries down to the current logical screenshot set."""
    if not allowed_keys:
        return entries
    return [entry for entry in entries if (entry.group, entry.shot_key) in allowed_keys]


def publish_screenshots_to_wiki_filtered(
    screenshots_root: Path,
    wiki_root: Path,
    *,
    allowed_keys: set[tuple[str, str]] | None = None,
    ordered_keys: Sequence[tuple[str, str]] | None = None,
) -> list[Path]:
    """Copy only the allowed catalogued screenshots into the wiki."""
    entries = filter_screenshot_entries(
        load_screenshot_catalog(screenshots_root),
        allowed_keys,
    )
    wiki_asset_root = wiki_root / WIKI_SCREENSHOT_ROOT
    wiki_asset_root.mkdir(parents=True, exist_ok=True)

    expected_paths = {
        (wiki_asset_root / wiki_relative_path(entry)).resolve() for entry in entries
    }
    for existing_path in wiki_asset_root.rglob("*.png"):
        if existing_path.resolve() not in expected_paths:
            existing_path.unlink()

    published_paths: list[Path] = []
    for entry in entries:
        source_path = screenshots_root / entry.relative_path
        target_path = wiki_asset_root / wiki_relative_path(entry)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)
        published_paths.append(target_path)

    gallery_path = wiki_root / WIKI_GALLERY_PAGE
    gallery_path.write_text(build_wiki_gallery_markdown(entries, ordered_keys))
    published_paths.append(gallery_path)
    return published_paths
