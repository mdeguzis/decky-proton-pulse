#!/usr/bin/env python3
"""Run the project screenshot manifest — fully automated or guided."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib.screenshot_manifest import (
    DEFAULT_SCREENSHOT_MANIFEST,
    ScreenshotManifestEntry,
    filter_screenshot_manifest,
    load_screenshot_manifest,
)


def run_capture_command(
    entry: ScreenshotManifestEntry,
    *,
    deck_ip: str,
    deck_user: str,
    output_dir: Path,
) -> None:
    """Invoke the existing single-capture script for one manifest entry."""
    command = [
        sys.executable,
        str(SCRIPT_DIR / "take_cef_screenshot.py"),
        "--deck-ip",
        deck_ip,
        "--deck-user",
        deck_user,
        "--output-dir",
        str(output_dir),
        "--filename-base",
        entry.key,
        "--group",
        entry.group,
        "--shot-key",
        entry.key,
        "--title",
        entry.title,
        "--caption",
        entry.caption,
    ]
    if entry.automation:
        command.extend(["--prepare-action-json", json.dumps(entry.automation)])

    subprocess.run(command, check=True)


def publish_to_wiki(screenshots_dir: Path, wiki_dir: Path) -> None:
    """Publish the current screenshot catalog into the project wiki."""
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_DIR / "publish_screenshots_to_wiki.py"),
            "--screenshots-dir",
            str(screenshots_dir),
            "--wiki-dir",
            str(wiki_dir),
        ],
        check=True,
    )


def wait_for_readiness(entry: ScreenshotManifestEntry, *, deck_ip: str, deck_user: str) -> bool:
    """Wait until the Deck's CEF debug endpoint is reachable (readiness check)."""
    import time

    ssh_target = f"{deck_user}@{deck_ip}"
    check = 'python3 -c "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:8080/json/list\', timeout=3)"'
    for attempt in range(10):
        result = subprocess.run(
            ["ssh", ssh_target, check],
            capture_output=True,
        )
        if result.returncode == 0:
            return True
        print(f"  Waiting for CEF debug endpoint (attempt {attempt + 1}/10)...")
        time.sleep(2)
    return False


def prompt_for_step(index: int, total: int, entry: ScreenshotManifestEntry) -> str:
    """Show the guided capture prompt and return capture, skip, or quit."""
    print("")
    print(f"[{index}/{total}] {entry.group}/{entry.key} - {entry.title}")
    if entry.instructions:
        print(entry.instructions)
    print("Press Enter to capture, type 'skip' to skip, or 'q' to stop.")
    response = input("> ").strip().lower()
    if response in {"q", "quit"}:
        return "quit"
    if response == "skip":
        return "skip"
    return "capture"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guided capture run for the project screenshot manifest."
    )
    parser.add_argument("--deck-ip", required=True, help="Steam Deck IP address")
    parser.add_argument(
        "--deck-user", default="deck", help="SSH user for the Steam Deck"
    )
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_SCREENSHOT_MANIFEST),
        help="Screenshot manifest JSON file",
    )
    parser.add_argument(
        "--match",
        default="",
        help="Optional filter applied to group, key, or title",
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Run all manifest entries without prompting (zero-interaction mode)",
    )
    parser.add_argument(
        "--output-dir",
        default="../screenshots",
        help="Local screenshot directory",
    )
    parser.add_argument(
        "--wiki-dir",
        default="../decky-proton-pulse.wiki",
        help="Local wiki checkout",
    )
    args = parser.parse_args()

    manifest_entries = filter_screenshot_manifest(
        load_screenshot_manifest(Path(args.manifest).resolve()),
        args.match,
    )
    if not manifest_entries:
        print("No screenshot manifest entries matched the requested filter.", file=sys.stderr)
        return 1

    screenshots_dir = Path(args.output_dir).resolve()
    wiki_dir = Path(args.wiki_dir).resolve()
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    captured_count = 0
    total = len(manifest_entries)
    for index, entry in enumerate(manifest_entries, start=1):
        print("")
        print("=" * 80)
        if args.auto:
            print(f"[{index}/{total}] {entry.group}/{entry.key} - {entry.title}")
            if not wait_for_readiness(entry, deck_ip=args.deck_ip, deck_user=args.deck_user):
                print(f"  Skipping {entry.key}: CEF endpoint not reachable", file=sys.stderr)
                continue
            action = "capture"
        else:
            action = prompt_for_step(index, total, entry)
        if action == "quit":
            break
        if action == "skip":
            continue
        run_capture_command(
            entry,
            deck_ip=args.deck_ip,
            deck_user=args.deck_user,
            output_dir=screenshots_dir,
        )
        captured_count += 1

    publish_to_wiki(screenshots_dir, wiki_dir)
    print("")
    print(f"Captured {captured_count} screenshot(s) and refreshed the wiki gallery.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
