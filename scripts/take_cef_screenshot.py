#!/usr/bin/env python3
"""Capture the Steam Big Picture CEF page on a Steam Deck and sync it locally."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REMOTE_PYTHON = r"""
import asyncio
import base64
import json
import time
from aiohttp import ClientSession

DEBUG_LIST_URL = "http://127.0.0.1:8080/json/list"
TITLE = "Steam Big Picture Mode"


async def main():
    async with ClientSession() as session:
        async with session.get(DEBUG_LIST_URL) as resp:
            pages = await resp.json()
        page = next(
            (p for p in pages if p.get("title") == TITLE and p.get("webSocketDebuggerUrl")),
            None,
        )
        if not page:
            raise SystemExit(
                "Could not find the Steam Big Picture Mode CEF page. "
                "Try: make cef-debug-enable"
            )

        out = f"/tmp/proton-pulse-screenshot-{time.strftime('%Y-%m-%d_%H-%M-%S')}.png"
        async with session.ws_connect(page["webSocketDebuggerUrl"]) as ws:
            await ws.send_str(json.dumps({"id": 1, "method": "Page.enable"}))
            await ws.send_str(
                json.dumps(
                    {
                        "id": 2,
                        "method": "Page.captureScreenshot",
                        "params": {"format": "png", "fromSurface": True},
                    }
                )
            )
            async for msg in ws:
                if msg.type.name != "TEXT":
                    continue
                data = json.loads(msg.data)
                if data.get("id") == 2:
                    with open(out, "wb") as handle:
                        handle.write(base64.b64decode(data["result"]["data"]))
                    print(out)
                    return

        raise SystemExit("CEF screenshot request did not return image data.")


asyncio.run(main())
""".strip()


def run(
    cmd: list[str],
    *,
    capture: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=True,
        text=True,
        capture_output=capture,
        input=input_text,
    )


def copy_to_clipboard(image_path: Path) -> str | None:
    commands: list[list[str]] = [
        ["wl-copy", "--type", "image/png"],
        ["xclip", "-selection", "clipboard", "-t", "image/png", "-i"],
        ["xsel", "--clipboard", "--input"],
    ]

    image_bytes = image_path.read_bytes()

    for cmd in commands:
        try:
            subprocess.run(
                cmd,
                check=True,
                input=image_bytes,
                capture_output=True,
            )
            return " ".join(cmd)
        except FileNotFoundError:
            continue
        except subprocess.CalledProcessError:
            continue

    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture the Steam Big Picture CEF page and sync it into a local folder."
    )
    parser.add_argument("--deck-ip", required=True, help="Steam Deck IP address")
    parser.add_argument(
        "--deck-user", default="deck", help="SSH user for the Steam Deck"
    )
    parser.add_argument(
        "--output-dir",
        default="../screenshots",
        help="Local directory to store the pulled screenshot",
    )
    parser.add_argument(
        "--filename-base",
        default="",
        help="Optional local filename base, e.g. manage-this-game",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    ssh_target = f"{args.deck_user}@{args.deck_ip}"

    try:
        remote = run(
            ["ssh", ssh_target, "python3", "-"],
            capture=True,
            input_text=REMOTE_PYTHON,
        )
    except subprocess.CalledProcessError as exc:
        if exc.stderr:
            print(exc.stderr.strip(), file=sys.stderr)
        return exc.returncode or 1
    remote_path = remote.stdout.strip()
    if not remote_path:
        print("Remote screenshot command did not return a file path.", file=sys.stderr)
        return 1

    remote_name = Path(remote_path).name
    local_name = remote_name
    if args.filename_base:
        suffix = remote_name.removeprefix("proton-pulse-screenshot-")
        local_name = f"{args.filename_base}-{suffix}"

    run(["rsync", "-av", f"{ssh_target}:{remote_path}", str(output_dir / local_name)])
    run(["ssh", ssh_target, "rm", "-f", remote_path])

    local_path = output_dir / local_name
    clipboard_command = copy_to_clipboard(local_path)
    if clipboard_command:
        print(f"Copied screenshot to clipboard via: {clipboard_command}")
    else:
        print(
            "Saved screenshot, but did not copy to clipboard "
            "(no supported clipboard tool was available)."
        )

    screenshots = sorted(
        output_dir.glob("*.png"), key=lambda path: path.stat().st_mtime, reverse=True
    )
    for old_file in screenshots[20:]:
        old_file.unlink(missing_ok=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
