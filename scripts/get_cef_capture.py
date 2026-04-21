#!/usr/bin/env python3
"""Capture a small Steam Deck CEF debug snapshot into a local pack directory."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_OUTPUT_DIR = PROJECT_ROOT.parent / "cef-captures"


def fetch_json(url: str) -> object:
    request = Request(url, headers={"User-Agent": "proton-pulse-cef-capture/1"})
    with urlopen(request, timeout=10) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_summary(base_url: str, version: object, targets: object) -> str:
    lines = [f"Captured from: {base_url}", ""]
    if isinstance(version, dict):
        lines.extend(
            [
                f"Browser: {version.get('Browser', 'unknown')}",
                f"Protocol-Version: {version.get('Protocol-Version', 'unknown')}",
                f"WebSocket: {version.get('webSocketDebuggerUrl', 'unknown')}",
                "",
            ]
        )
    else:
        lines.extend(["Browser metadata unavailable", ""])

    target_list = targets if isinstance(targets, list) else []
    lines.append(f"Targets: {len(target_list)}")
    lines.append("")
    for index, target in enumerate(target_list, start=1):
        if not isinstance(target, dict):
            continue
        lines.extend(
            [
                f"[{index}] {target.get('title') or '(untitled)'}",
                f"  type: {target.get('type', 'unknown')}",
                f"  url: {target.get('url', '')}",
                f"  webSocketDebuggerUrl: {target.get('webSocketDebuggerUrl', '')}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Save a local CEF debug snapshot from a Steam Deck or local Steam session."
    )
    parser.add_argument(
        "--deck-ip",
        default="",
        help="Steam Deck IP address; omit to capture from localhost:8081",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory that will receive timestamped capture packs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    host = args.deck_ip.strip() or "127.0.0.1"
    base_url = f"http://{host}:8081"
    output_dir = Path(args.output_dir).expanduser().resolve()
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    pack_dir = output_dir / timestamp
    pack_dir.mkdir(parents=True, exist_ok=True)

    try:
        version = fetch_json(f"{base_url}/json/version")
        targets = fetch_json(f"{base_url}/json/list")
    except HTTPError as exc:
        error_text = f"HTTP error while fetching CEF capture from {base_url}: {exc.code} {exc.reason}\n"
        (pack_dir / "error.txt").write_text(error_text, encoding="utf-8")
        print(error_text.rstrip(), file=sys.stderr)
        return 1
    except URLError as exc:
        error_text = f"Network error while fetching CEF capture from {base_url}: {exc.reason}\n"
        (pack_dir / "error.txt").write_text(error_text, encoding="utf-8")
        print(error_text.rstrip(), file=sys.stderr)
        return 1

    metadata = {
        "capturedAt": datetime.now().isoformat(),
        "baseUrl": base_url,
        "host": host,
        "targetsCount": len(targets) if isinstance(targets, list) else None,
    }

    write_json(pack_dir / "capture.json", metadata)
    write_json(pack_dir / "version.json", version)
    write_json(pack_dir / "targets.json", targets)
    (pack_dir / "summary.txt").write_text(build_summary(base_url, version, targets), encoding="utf-8")
    (output_dir / "latest").write_text(str(pack_dir) + "\n", encoding="utf-8")

    print(f"Saved CEF capture pack to: {pack_dir}")
    print(f"Latest capture pointer: {output_dir / 'latest'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
