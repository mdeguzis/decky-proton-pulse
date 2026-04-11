#!/usr/bin/env python3
"""Run the project screenshot manifest — fully automated or guided."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
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
from lib.screenshot_catalog import (
    SUPPORTED_SCREENSHOT_LANGUAGES,
    normalize_language,
)

GIST_TARGET_ALIASES = {"gist", "github-gist", "github-glist"}


@dataclass(frozen=True)
class CaptureDestination:
    output_dir: Path
    publish_mode: str


def resolve_capture_destination(
    *,
    deck_ip: str,
    target: str,
    default_output_dir: str,
) -> CaptureDestination:
    """Resolve the requested review target into a concrete output directory."""
    normalized_target = target.strip()
    if normalized_target in GIST_TARGET_ALIASES:
        temp_root = Path(
            tempfile.mkdtemp(prefix="decky-proton-pulse-screenshots-", dir="/tmp")
        )
        return CaptureDestination(output_dir=temp_root, publish_mode="gist")
    if normalized_target:
        requested_dir = Path(normalized_target).expanduser()
        if requested_dir.exists() and not requested_dir.is_dir():
            raise ValueError(f"Screenshot target is not a directory: {requested_dir}")
        return CaptureDestination(output_dir=requested_dir.resolve(), publish_mode="dir")
    if deck_ip:
        return CaptureDestination(
            output_dir=Path(default_output_dir).resolve(),
            publish_mode="wiki",
        )
    return CaptureDestination(
        output_dir=Path("../screenshots/review").resolve(),
        publish_mode="dir",
    )


def run_capture_command(
    entry: ScreenshotManifestEntry,
    *,
    deck_ip: str,
    deck_user: str,
    output_dir: Path,
    language: str,
) -> None:
    """Invoke the existing single-capture script for one manifest entry."""
    command = [
        sys.executable,
        str(SCRIPT_DIR / "take_cef_screenshot.py"),
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
        "--language",
        language,
    ]
    if deck_ip:
        command.extend(["--deck-ip", deck_ip, "--deck-user", deck_user])
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


def publish_to_gist(screenshots_dir: Path, manifest: Path, match: str, language: str) -> None:
    """Publish the current screenshot catalog into a private GitHub gist."""
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_DIR / "publish_screenshots_to_gist.py"),
            "--screenshots-dir",
            str(screenshots_dir),
            "--manifest",
            str(manifest),
            "--match",
            match,
            "--language",
            language,
        ],
        check=True,
    )


def restore_capture_language(*, deck_ip: str, deck_user: str) -> None:
    """Switch the live plugin UI back to English after a capture run."""
    try:
        command = [
            sys.executable,
            str(SCRIPT_DIR / "take_cef_screenshot.py"),
            "--output-dir",
            str(Path("/tmp")),
            "--language",
            "en",
            "--prepare-only",
        ]
        if deck_ip:
            command.extend(["--deck-ip", deck_ip, "--deck-user", deck_user])
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=None,
        )
    except subprocess.CalledProcessError as exc:
        print(
            "Warning: could not restore the live plugin language to English: "
            f"{exc}",
            file=sys.stderr,
        )


def wait_for_readiness(entry: ScreenshotManifestEntry, *, deck_ip: str, deck_user: str) -> bool:
    """Wait until the Deck's CEF debug endpoint is reachable (readiness check)."""
    import time

    for attempt in range(10):
        if deck_ip:
            ssh_target = f"{deck_user}@{deck_ip}"
            check = 'python3 -c "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:8080/json/list\', timeout=3)"'
            result = subprocess.run(
                ["ssh", ssh_target, check],
                capture_output=True,
            )
            if result.returncode == 0:
                return True
        else:
            try:
                with urllib.request.urlopen("http://127.0.0.1:8080/json/list", timeout=3):
                    return True
            except Exception:
                pass
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
    parser.add_argument(
        "--deck-ip",
        default="",
        help="Steam Deck IP address; omit to capture from the local machine",
    )
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
    parser.add_argument(
        "--skip-publish",
        action="store_true",
        help="Skip publishing screenshots into the wiki after capture",
    )
    parser.add_argument(
        "--language",
        default="en",
        help="Screenshot language code used for catalog and wiki subpages",
    )
    parser.add_argument(
        "--target",
        default="",
        help="Directory path for local review output, or gist/github-gist to publish a private review gist",
    )
    args = parser.parse_args()
    requested_language = args.language.strip()
    languages = (
        list(SUPPORTED_SCREENSHOT_LANGUAGES)
        if requested_language.lower() == "all"
        else [normalize_language(requested_language)]
    )

    manifest_entries = filter_screenshot_manifest(
        load_screenshot_manifest(Path(args.manifest).resolve()),
        args.match,
    )
    if not manifest_entries:
        print("No screenshot manifest entries matched the requested filter.", file=sys.stderr)
        return 1

    destination = resolve_capture_destination(
        deck_ip=args.deck_ip.strip(),
        target=args.target,
        default_output_dir=args.output_dir,
    )
    screenshots_dir = destination.output_dir.resolve()
    wiki_dir = Path(args.wiki_dir).resolve()
    capture_locally = not args.deck_ip.strip()
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    captured_count = 0
    total = len(manifest_entries)
    quit_requested = False
    try:
        language_total = len(languages)
        for language_index, language in enumerate(languages, start=1):
            print("")
            print("#" * 80)
            print(f"Capturing language [{language_index}/{language_total}]: {language}")
            print("#" * 80)
            language_started = False
            try:
                for index, entry in enumerate(manifest_entries, start=1):
                    print("")
                    print("=" * 80)
                    if args.auto:
                        print(
                            f"[{language} {language_index}/{language_total}] "
                            f"[{index}/{total}] "
                            f"{entry.group}/{entry.key} - {entry.title}"
                        )
                        if not wait_for_readiness(
                            entry, deck_ip=args.deck_ip, deck_user=args.deck_user
                        ):
                            print(
                                f"  Skipping {entry.key}: CEF endpoint not reachable",
                                file=sys.stderr,
                            )
                            continue
                        action = "capture"
                    else:
                        print(f"Language: {language}")
                        action = prompt_for_step(index, total, entry)
                    if action == "quit":
                        quit_requested = True
                        break
                    if action == "skip":
                        continue
                    language_started = True
                    run_capture_command(
                        entry,
                        deck_ip=args.deck_ip,
                        deck_user=args.deck_user,
                        output_dir=screenshots_dir,
                        language=language,
                    )
                    captured_count += 1
            finally:
                if language_started:
                    if destination.publish_mode == "wiki" and not args.skip_publish:
                        publish_to_wiki(screenshots_dir, wiki_dir)
                        print(f"Published wiki gallery after language: {language}")
                    elif destination.publish_mode == "dir" and capture_locally:
                        print(f"Updated local review screenshots after language: {language}")
            if quit_requested:
                break
    finally:
        print("")
        print("Restoring live plugin language to English...")
        restore_capture_language(deck_ip=args.deck_ip, deck_user=args.deck_user)
    if destination.publish_mode == "gist":
        print("")
        print("Publishing captured screenshots to a private GitHub gist...")
        publish_to_gist(
            screenshots_dir,
            Path(args.manifest).resolve(),
            args.match,
            args.language,
        )
    print("")
    if destination.publish_mode == "gist":
        print(f"Captured {captured_count} screenshot(s) and published a private review gist.")
    elif args.skip_publish or destination.publish_mode == "dir":
        print(f"Captured {captured_count} screenshot(s) into: {screenshots_dir}")
    else:
        print(f"Captured {captured_count} screenshot(s) and refreshed the wiki gallery.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
