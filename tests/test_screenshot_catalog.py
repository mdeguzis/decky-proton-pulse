"""Tests for grouped screenshot catalog and wiki publishing helpers."""

import json

from lib.screenshot_catalog import (
    ScreenshotSpec,
    WIKI_GALLERY_PAGE,
    WIKI_SCREENSHOT_ROOT,
    load_screenshot_catalog,
    publish_screenshots_to_wiki,
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
