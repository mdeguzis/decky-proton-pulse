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
DEFAULT_SCREENSHOT_LANGUAGE = "en"
SCREENSHOT_LANGUAGE_ALIASES = {
    "cn": "zh-CN",
    "zh": "zh-CN",
    "jp": "ja",
    "br": "pt-BR",
}
SCREENSHOT_LANGUAGE_DISPLAY_CODES = {
    "en": "en",
    "cs": "cs",
    "de": "de",
    "es": "es",
    "fr": "fr",
    "it": "it",
    "ja": "jp",
    "ko": "ko",
    "nl": "nl",
    "pl": "pl",
    "pt-BR": "br",
    "ru": "ru",
    "sv": "sv",
    "th": "th",
    "tr": "tr",
    "uk": "uk",
    "vi": "vi",
    "zh-CN": "cn",
    "zh-TW": "tw",
}
SUPPORTED_SCREENSHOT_LANGUAGES = tuple(SCREENSHOT_LANGUAGE_DISPLAY_CODES.keys())


@dataclass(frozen=True)
class ScreenshotEntry:
    """Metadata describing one captured screenshot."""

    caption: str
    group: str
    language: str
    relative_path: str
    shot_key: str
    shot_title: str
    timestamp: str


class ScreenshotEntryPayload(TypedDict):
    """Serialized catalog entry loaded from JSON."""

    caption: str
    group: str
    language: str
    relative_path: str
    shot_key: str
    shot_title: str
    timestamp: str


def slugify(value: str) -> str:
    """Convert free-form labels into stable filesystem and URL slugs."""
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return normalized.strip("-") or "untitled"


def normalize_language(value: str) -> str:
    """Normalize a screenshot language code for stable paths and pages."""
    normalized = value.strip()
    if not normalized:
        return DEFAULT_SCREENSHOT_LANGUAGE
    return SCREENSHOT_LANGUAGE_ALIASES.get(normalized.lower(), normalized)


def gallery_page_name(language: str) -> str:
    """Return the wiki page filename for a screenshot language."""
    normalized = normalize_language(language)
    if normalized == DEFAULT_SCREENSHOT_LANGUAGE:
        return WIKI_GALLERY_PAGE
    return f"UI-Screenshot-Gallery-{slugify(normalized)}.md"


def gallery_page_link(language: str) -> str:
    """Return the wiki page link target for a screenshot language."""
    return gallery_page_name(language).removesuffix(".md")


def language_label(language: str) -> str:
    """Return a compact label for a screenshot language."""
    normalized = normalize_language(language)
    return SCREENSHOT_LANGUAGE_DISPLAY_CODES.get(normalized, normalized)


def titleize_slug(value: str) -> str:
    """Convert a slug like manage-game into a readable title."""
    return " ".join(
        part.capitalize() for part in value.replace("_", "-").split("-") if part
    )


def wiki_relative_path(entry: ScreenshotEntry) -> Path:
    """Return the stable wiki asset path for a screenshot entry."""
    if entry.language == DEFAULT_SCREENSHOT_LANGUAGE:
        return Path(entry.group) / f"{entry.shot_key}.png"
    return Path(slugify(entry.language)) / entry.group / f"{entry.shot_key}.png"


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
        payload_data = dict(cast(dict[str, object], item))
        payload_data.setdefault("language", DEFAULT_SCREENSHOT_LANGUAGE)
        payload = cast(ScreenshotEntryPayload, payload_data)
        entries.append(ScreenshotEntry(**payload))
    latest_by_key: dict[tuple[str, str, str], ScreenshotEntry] = {}
    for entry in sorted(entries, key=lambda item: item.timestamp, reverse=True):
        latest_by_key.setdefault((entry.language, entry.group, entry.shot_key), entry)
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
    language: str = DEFAULT_SCREENSHOT_LANGUAGE
    shot_title: str = ""
    caption: str = ""


def _upsert_entry(
    entries: list[ScreenshotEntry], new_entry: ScreenshotEntry
) -> list[ScreenshotEntry]:
    kept = [
        entry
        for entry in entries
        if not (
            entry.language == new_entry.language
            and entry.group == new_entry.group
            and entry.shot_key == new_entry.shot_key
        )
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
    language = normalize_language(spec.language)
    timestamp = captured_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    target_dir = screenshots_root / group_slug
    if language != DEFAULT_SCREENSHOT_LANGUAGE:
        target_dir = screenshots_root / slugify(language) / group_slug
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
        language=language,
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


def ordered_languages(available_languages: Sequence[str] | None) -> list[str]:
    """Return stable gallery language order with English first."""
    return sorted(
        {
            normalize_language(item)
            for item in (available_languages or [DEFAULT_SCREENSHOT_LANGUAGE])
        },
        key=lambda item: (item != DEFAULT_SCREENSHOT_LANGUAGE, item),
    )


def build_gallery_intro(
    normalized_language: str,
    available_languages: Sequence[str] | None,
) -> list[str]:
    """Build the shared wiki gallery intro block."""
    heading = (
        "# UI Screenshot Gallery"
        if normalized_language == DEFAULT_SCREENSHOT_LANGUAGE
        else f"# UI Screenshot Gallery ({language_label(normalized_language)})"
    )
    lines = [
        heading,
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
    languages = ordered_languages(available_languages or [normalized_language])
    if len(languages) > 1:
        links = [
            f"[{language_label(item)}]({gallery_page_link(item)})"
            for item in languages
        ]
        lines.extend(
            [
                f"Available languages: {' | '.join(links)}",
                "",
            ]
        )
    return lines


def group_entries_for_gallery(
    entries: list[ScreenshotEntry],
    ordered_keys: Sequence[tuple[str, str]] | None,
) -> tuple[dict[str, list[ScreenshotEntry]], list[str]]:
    """Group screenshot entries using manifest order when available."""
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
    return grouped, group_order


def append_gallery_group(
    lines: list[str],
    group_entries: list[ScreenshotEntry],
) -> None:
    """Append one grouped gallery section."""
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


def expected_wiki_asset_paths(
    wiki_asset_root: Path,
    entries: list[ScreenshotEntry],
) -> set[Path]:
    """Return the stable wiki asset paths for a set of screenshot entries."""
    return {
        (wiki_asset_root / wiki_relative_path(entry)).resolve()
        for entry in entries
    }


def copy_wiki_assets(
    screenshots_root: Path,
    wiki_asset_root: Path,
    entries: list[ScreenshotEntry],
) -> list[Path]:
    """Copy screenshot assets into the wiki checkout."""
    published_paths: list[Path] = []
    for entry in entries:
        source_path = screenshots_root / entry.relative_path
        target_path = wiki_asset_root / wiki_relative_path(entry)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)
        published_paths.append(target_path)
    return published_paths


def expected_gallery_paths(wiki_root: Path, languages: Sequence[str]) -> set[Path]:
    """Return the gallery markdown paths that should exist for the given languages."""
    return {
        (wiki_root / gallery_page_name(language)).resolve()
        for language in languages
    }


def group_entries_by_language(
    entries: list[ScreenshotEntry],
) -> dict[str, list[ScreenshotEntry]]:
    """Group screenshot entries by normalized language."""
    grouped: dict[str, list[ScreenshotEntry]] = {}
    for entry in entries:
        grouped.setdefault(normalize_language(entry.language), []).append(entry)
    return grouped


def build_wiki_gallery_markdown(
    entries: list[ScreenshotEntry],
    ordered_keys: Sequence[tuple[str, str]] | None = None,
    *,
    language: str = DEFAULT_SCREENSHOT_LANGUAGE,
    available_languages: Sequence[str] | None = None,
) -> str:
    """Render the grouped screenshot gallery page for the wiki."""
    normalized_language = normalize_language(language)
    lines = build_gallery_intro(normalized_language, available_languages)
    grouped, group_order = group_entries_for_gallery(entries, ordered_keys)
    for group in group_order:
        append_gallery_group(lines, grouped[group])

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
    languages = ordered_languages([entry.language for entry in entries])
    wiki_asset_root = wiki_root / WIKI_SCREENSHOT_ROOT
    wiki_asset_root.mkdir(parents=True, exist_ok=True)

    expected_paths = expected_wiki_asset_paths(wiki_asset_root, entries)
    for existing_path in wiki_asset_root.rglob("*.png"):
        if existing_path.resolve() not in expected_paths:
            existing_path.unlink()

    published_paths = copy_wiki_assets(screenshots_root, wiki_asset_root, entries)

    gallery_paths = expected_gallery_paths(wiki_root, languages)
    for existing_path in wiki_root.glob("UI-Screenshot-Gallery*.md"):
        if existing_path.resolve() not in gallery_paths:
            existing_path.unlink()

    entries_by_language = group_entries_by_language(entries)

    for language in languages:
        gallery_path = wiki_root / gallery_page_name(language)
        gallery_path.write_text(
            build_wiki_gallery_markdown(
                entries_by_language.get(language, []),
                ordered_keys,
                language=language,
                available_languages=languages,
            )
        )
        published_paths.append(gallery_path)
    return published_paths
