"""Tests for grouped screenshot catalog and wiki publishing helpers."""

import json

from lib.screenshot_catalog import (
    ScreenshotEntry,
    ScreenshotSpec,
    WIKI_GALLERY_PAGE,
    WIKI_SCREENSHOT_ROOT,
    build_wiki_gallery_markdown,
    filter_screenshot_entries,
    load_screenshot_catalog,
    publish_screenshots_to_wiki,
    publish_screenshots_to_wiki_filtered,
    register_screenshot,
    slugify,
)


def test_slugify_normalizes_labels():
    assert slugify("Manage Game") == "manage-game"
    assert slugify(" Default / Loading ") == "default-loading"


def test_register_screenshot_moves_file_and_updates_catalog(tmp_path):
    screenshots_dir = tmp_path / "screenshots"
    screenshots_dir.mkdir()
    source = screenshots_dir / "raw.png"
    source.write_bytes(b"png")

    entry = register_screenshot(
        screenshots_dir,
        source,
        ScreenshotSpec(
            group="Manage Game",
            shot_key="Default State",
            shot_title="Manage Game Default",
            caption="Default loaded state.",
        ),
        captured_at="2026-04-07T21:30:00Z",
    )

    assert entry.group == "manage-game"
    assert entry.shot_key == "default-state"
    assert (screenshots_dir / entry.relative_path).exists()
    assert not source.exists()

    catalog = load_screenshot_catalog(screenshots_dir)
    assert len(catalog) == 1
    assert catalog[0].caption == "Default loaded state."

    raw_catalog = json.loads((screenshots_dir / "catalog.json").read_text())
    assert raw_catalog[0]["group"] == "manage-game"
    assert raw_catalog[0]["relative_path"] == "manage-game/default-state.png"


def test_register_screenshot_replaces_existing_key_asset(tmp_path):
    screenshots_dir = tmp_path / "screenshots"
    screenshots_dir.mkdir()

    first = screenshots_dir / "first.png"
    first.write_bytes(b"one")
    second = screenshots_dir / "second.png"
    second.write_bytes(b"two")

    first_entry = register_screenshot(
        screenshots_dir,
        first,
        ScreenshotSpec(
            group="Manage Game",
            shot_key="Default State",
            shot_title="Manage Game Default",
        ),
        captured_at="2026-04-07T21:30:00Z",
    )
    second_entry = register_screenshot(
        screenshots_dir,
        second,
        ScreenshotSpec(
            group="Manage Game",
            shot_key="Default State",
            shot_title="Manage Game Default",
        ),
        captured_at="2026-04-07T21:31:00Z",
    )

    assert first_entry.relative_path == "manage-game/default-state.png"
    assert second_entry.relative_path == "manage-game/default-state.png"
    assert (screenshots_dir / second_entry.relative_path).read_bytes() == b"two"
    assert load_screenshot_catalog(screenshots_dir)[0].timestamp == "2026-04-07T21:31:00Z"


def test_publish_screenshots_to_wiki_copies_assets_and_builds_gallery(tmp_path):
    screenshots_dir = tmp_path / "screenshots"
    wiki_dir = tmp_path / "wiki"
    screenshots_dir.mkdir()
    wiki_dir.mkdir()

    first = screenshots_dir / "capture-1.png"
    first.write_bytes(b"one")
    second = screenshots_dir / "capture-2.png"
    second.write_bytes(b"two")

    register_screenshot(
        screenshots_dir,
        first,
        ScreenshotSpec(
            group="Manage Game",
            shot_key="Default",
            shot_title="Default State",
            caption="Default loaded UI.",
        ),
        captured_at="2026-04-07T21:30:00Z",
    )
    register_screenshot(
        screenshots_dir,
        second,
        ScreenshotSpec(
            group="Settings",
            shot_key="General",
            shot_title="General Settings",
        ),
        captured_at="2026-04-07T21:31:00Z",
    )

    published = publish_screenshots_to_wiki(screenshots_dir, wiki_dir)

    gallery_path = wiki_dir / WIKI_GALLERY_PAGE
    assert gallery_path in published
    gallery = gallery_path.read_text()
    assert "## Manage Game" in gallery
    assert "## Settings" in gallery
    assert "Default loaded UI." in gallery
    assert (WIKI_SCREENSHOT_ROOT / "manage-game").as_posix() in gallery

    asset_files = sorted((wiki_dir / WIKI_SCREENSHOT_ROOT / "manage-game").glob("*.png"))
    assert len(asset_files) == 1


def test_filter_screenshot_entries_removes_retired_slots(tmp_path):
    screenshots_dir = tmp_path / "screenshots"
    screenshots_dir.mkdir()

    current_capture = screenshots_dir / "current.png"
    current_capture.write_bytes(b"current")
    retired_capture = screenshots_dir / "retired.png"
    retired_capture.write_bytes(b"retired")

    register_screenshot(
        screenshots_dir,
        current_capture,
        ScreenshotSpec(group="Manage Game", shot_key="Default"),
        captured_at="2026-04-07T21:30:00Z",
    )
    register_screenshot(
        screenshots_dir,
        retired_capture,
        ScreenshotSpec(group="Issue Reporting", shot_key="Category Menu"),
        captured_at="2026-04-07T21:31:00Z",
    )

    filtered = filter_screenshot_entries(
        load_screenshot_catalog(screenshots_dir),
        {("manage-game", "default")},
    )

    assert [(entry.group, entry.shot_key) for entry in filtered] == [("manage-game", "default")]


def test_publish_screenshots_to_wiki_filtered_prunes_stale_assets_and_gallery_entries(tmp_path):
    screenshots_dir = tmp_path / "screenshots"
    wiki_dir = tmp_path / "wiki"
    screenshots_dir.mkdir()
    wiki_dir.mkdir()

    current_capture = screenshots_dir / "current.png"
    current_capture.write_bytes(b"current")
    retired_capture = screenshots_dir / "retired.png"
    retired_capture.write_bytes(b"retired")

    register_screenshot(
        screenshots_dir,
        current_capture,
        ScreenshotSpec(
            group="Manage Game",
            shot_key="Default",
            shot_title="Manage Game Default",
        ),
        captured_at="2026-04-07T21:30:00Z",
    )
    register_screenshot(
        screenshots_dir,
        retired_capture,
        ScreenshotSpec(
            group="Issue Reporting",
            shot_key="Category Menu",
            shot_title="Issue Reporting Category Menu",
        ),
        captured_at="2026-04-07T21:31:00Z",
    )

    stale_asset = wiki_dir / WIKI_SCREENSHOT_ROOT / "issue-reporting" / "category-menu.png"
    stale_asset.parent.mkdir(parents=True, exist_ok=True)
    stale_asset.write_bytes(b"stale")

    publish_screenshots_to_wiki_filtered(
        screenshots_dir,
        wiki_dir,
        allowed_keys={("manage-game", "default")},
    )

    gallery = (wiki_dir / WIKI_GALLERY_PAGE).read_text()
    assert "manage-game/default" in gallery
    assert "issue-reporting/category-menu" not in gallery
    assert stale_asset.exists() is False


def test_build_wiki_gallery_markdown_follows_manifest_order():
    entries = [
        register_like_entry("about", "tab", "About Tab", "2026-04-07T21:33:00Z"),
        register_like_entry("manage-game", "default", "Manage Game Default", "2026-04-07T21:30:00Z"),
        register_like_entry("manage-game", "report-detail", "Manage Game Report Detail", "2026-04-07T21:31:00Z"),
        register_like_entry("manage-configurations", "default", "Manage Configurations Default", "2026-04-07T21:32:00Z"),
    ]

    gallery = build_wiki_gallery_markdown(
        entries,
        [
            ("manage-game", "default"),
            ("manage-game", "report-detail"),
            ("manage-configurations", "default"),
            ("about", "tab"),
        ],
    )

    assert gallery.index("## Manage Game") < gallery.index("## Manage Configurations")
    assert gallery.index("## Manage Configurations") < gallery.index("## About")
    assert gallery.index("### Manage Game Default") < gallery.index("### Manage Game Report Detail")


def register_like_entry(group: str, shot_key: str, title: str, timestamp: str):
    return ScreenshotEntry(
        caption="",
        group=group,
        relative_path=f"{group}/{shot_key}.png",
        shot_key=shot_key,
        shot_title=title,
        timestamp=timestamp,
    )
