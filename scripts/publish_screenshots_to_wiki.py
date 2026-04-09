#!/usr/bin/env python3
"""Publish catalogued screenshots into the project wiki."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib.screenshot_catalog import publish_screenshots_to_wiki_filtered, slugify
from lib.screenshot_manifest import DEFAULT_SCREENSHOT_MANIFEST, load_screenshot_manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy catalogued screenshots into the wiki and regenerate the gallery page."
    )
    parser.add_argument(
        "--screenshots-dir",
        default="../screenshots",
        help="Local screenshot directory that contains catalog.json",
    )
    parser.add_argument(
        "--wiki-dir",
        default="../decky-proton-pulse.wiki",
        help="Local wiki checkout to publish screenshots into",
    )
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_SCREENSHOT_MANIFEST),
        help="Screenshot manifest JSON file used to define the live gallery set",
    )
    args = parser.parse_args()

    screenshots_dir = Path(args.screenshots_dir).resolve()
    wiki_dir = Path(args.wiki_dir).resolve()
    manifest_entries = load_screenshot_manifest(Path(args.manifest).resolve())
    allowed_keys = {
        (slugify(entry.group), slugify(entry.key))
        for entry in manifest_entries
    }
    ordered_keys = [
        (slugify(entry.group), slugify(entry.key))
        for entry in manifest_entries
    ]

    published = publish_screenshots_to_wiki_filtered(
        screenshots_dir,
        wiki_dir,
        allowed_keys=allowed_keys,
        ordered_keys=ordered_keys,
    )
    print(f"Published {len(published):,} wiki artifact(s)")
    for path in published:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
