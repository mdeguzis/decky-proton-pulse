#!/usr/bin/env python3
"""Publish catalogued screenshots into a private GitHub gist for review."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib.screenshot_catalog import ScreenshotEntry, load_screenshot_catalog, normalize_language
from lib.screenshot_manifest import filter_screenshot_manifest, load_screenshot_manifest


def staged_filename(entry: ScreenshotEntry) -> str:
    language = normalize_language(entry.language).replace("/", "-")
    return f"{language}--{entry.group}--{entry.shot_key}.png"


def build_readme(entries: list[ScreenshotEntry], gist_url: str = "") -> str:
    lines = [
        "# Decky Proton Pulse Screenshot Review",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
    ]
    if gist_url:
        lines.extend([f"Gist: {gist_url}", ""])
    current_language = None
    for entry in entries:
        language = normalize_language(entry.language)
        if language != current_language:
            if current_language is not None:
                lines.append("")
            lines.append(f"## {language}")
            lines.append("")
            current_language = language
        lines.extend(
            [
                f"### {entry.group}/{entry.shot_key} - {entry.shot_title}",
                "",
                f"![{entry.shot_title}]({staged_filename(entry)})",
                "",
            ]
        )
        if entry.caption:
            lines.extend([entry.caption, ""])
    return "\n".join(lines).rstrip() + "\n"


def select_entries(
    screenshots_dir: Path,
    manifest_path: Path,
    match: str,
    language: str,
) -> list[ScreenshotEntry]:
    entries = load_screenshot_catalog(screenshots_dir)
    if not entries:
        raise ValueError(f"No catalogued screenshots found in {screenshots_dir}")
    manifest_entries = filter_screenshot_manifest(load_screenshot_manifest(manifest_path), match)
    allowed = {(item.group, item.key) for item in manifest_entries}
    requested_language = language.strip().lower()
    selected = [
        entry
        for entry in entries
        if (entry.group, entry.shot_key) in allowed
        and (requested_language == "all" or normalize_language(entry.language) == normalize_language(language))
    ]
    if not selected:
        raise ValueError("No screenshots matched the requested manifest filter and language.")
    return sorted(selected, key=lambda entry: (normalize_language(entry.language), entry.group, entry.shot_key))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publish the current screenshot catalog into a private GitHub gist."
    )
    parser.add_argument("--screenshots-dir", required=True, help="Screenshot directory with catalog.json")
    parser.add_argument("--manifest", required=True, help="Screenshot manifest JSON file")
    parser.add_argument("--match", default="", help="Optional manifest filter")
    parser.add_argument("--language", default="en", help="Language to publish, or all")
    args = parser.parse_args()

    screenshots_dir = Path(args.screenshots_dir).resolve()
    manifest_path = Path(args.manifest).resolve()
    entries = select_entries(screenshots_dir, manifest_path, args.match, args.language)

    if shutil.which("gh") is None:
        raise SystemExit("GitHub CLI is required for gist publishing. Install gh and authenticate first.")

    with tempfile.TemporaryDirectory(prefix="decky-proton-pulse-gist-", dir="/tmp") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        staged_files: list[Path] = []
        for entry in entries:
            source = screenshots_dir / entry.relative_path
            target = temp_dir / staged_filename(entry)
            shutil.copy2(source, target)
            staged_files.append(target)
        readme_path = temp_dir / "README.md"
        readme_path.write_text(build_readme(entries), encoding="utf-8")
        command = [
            "gh",
            "gist",
            "create",
            str(readme_path),
            *[str(path) for path in staged_files],
            "--desc",
            "Decky Proton Pulse screenshot review",
        ]
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        gist_url = result.stdout.strip()
        print(f"Created private gist: {gist_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
