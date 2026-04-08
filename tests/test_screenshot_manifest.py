"""Tests for the guided project screenshot manifest."""

import json

from lib.screenshot_manifest import filter_screenshot_manifest, load_screenshot_manifest


def test_load_screenshot_manifest_reads_entries(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            [
                {
                    "group": "manage-game",
                    "key": "default",
                    "title": "Manage Game Default",
                    "caption": "Default state",
                    "instructions": "Open manage game",
                }
            ]
        )
    )

    entries = load_screenshot_manifest(manifest)

    assert len(entries) == 1
    assert entries[0].group == "manage-game"
    assert entries[0].instructions == "Open manage game"


def test_filter_screenshot_manifest_matches_group_key_and_title(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            [
                {
                    "group": "manage-game",
                    "key": "default",
                    "title": "Manage Game Default",
                    "caption": "",
                    "instructions": "",
                },
                {
                    "group": "settings",
                    "key": "general",
                    "title": "General Settings",
                    "caption": "",
                    "instructions": "",
                },
            ]
        )
    )

    entries = load_screenshot_manifest(manifest)

    assert [entry.key for entry in filter_screenshot_manifest(entries, "manage")] == ["default"]
    assert [entry.key for entry in filter_screenshot_manifest(entries, "general")] == ["general"]
