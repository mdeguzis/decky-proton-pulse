"""Tests for the guided project screenshot manifest."""

import json
import pytest

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


def test_load_screenshot_manifest_validates_shape(tmp_path):
    not_list = tmp_path / "not-list.json"
    not_list.write_text(json.dumps({"group": "x"}))

    with pytest.raises(ValueError, match="JSON array"):
        load_screenshot_manifest(not_list)

    bad_entry = tmp_path / "bad-entry.json"
    bad_entry.write_text(json.dumps(["nope"]))
    with pytest.raises(ValueError, match="entries must be objects"):
        load_screenshot_manifest(bad_entry)

    missing_fields = tmp_path / "missing-fields.json"
    missing_fields.write_text(json.dumps([{"group": "manage-game", "key": "", "title": ""}]))
    with pytest.raises(ValueError, match="missing required fields"):
        load_screenshot_manifest(missing_fields)


def test_filter_screenshot_manifest_returns_original_entries_for_blank_match(tmp_path):
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
                }
            ]
        )
    )

    entries = load_screenshot_manifest(manifest)
    assert filter_screenshot_manifest(entries, "   ") == entries
