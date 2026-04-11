#!/usr/bin/env python3
"""Capture the Steam Big Picture CEF page on a Steam Deck and sync it locally."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib.screenshot_catalog import (
    SUPPORTED_SCREENSHOT_LANGUAGES,
    ScreenshotSpec,
    normalize_language,
    register_screenshot,
)

REMOTE_PYTHON = r"""
import asyncio
import base64
import json
import sys
import time
from aiohttp import ClientSession

DEBUG_LIST_URL = "http://127.0.0.1:8080/json/list"
PREPARE_ACTION_JSON = __PREPARE_ACTION_JSON__
LANGUAGE = __LANGUAGE__
DEBUG_ENABLED = __DEBUG_ENABLED__
PLUGIN_ROUTE = "/proton-pulse"


def debug_log(message):
    if DEBUG_ENABLED:
        print(message, file=sys.stderr)


async def evaluate_page(ws, next_id_ref, expression):
    message_id = next_id_ref[0]
    next_id_ref[0] += 1
    payload = {
        "id": message_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
        },
    }
    await ws.send_str(json.dumps(payload))
    async for msg in ws:
        if msg.type.name != "TEXT":
            continue
        data = json.loads(msg.data)
        if data.get("id") != message_id:
            continue
        if "error" in data:
            raise RuntimeError(
                f"CEF command failed for Runtime.evaluate: {data['error'].get('message', data['error'])}"
            )
        raw_result = data.get("result", {})
        if not isinstance(raw_result, dict):
            return raw_result
        inner = raw_result.get("result")
        if not isinstance(inner, dict):
            return raw_result
        value = inner.get("value")
        return value if isinstance(value, dict) else raw_result
    return None


async def inspect_page(session, page):
    debugger_url = page.get("webSocketDebuggerUrl")
    if not debugger_url:
        return None
    try:
        async with session.ws_connect(debugger_url) as ws:
            next_id_ref = [1]
            await ws.send_str(json.dumps({"id": next_id_ref[0], "method": "Page.enable"}))
            next_id_ref[0] += 1
            await ws.send_str(json.dumps({"id": next_id_ref[0], "method": "Runtime.enable"}))
            next_id_ref[0] += 1
            info = await evaluate_page(
                ws,
                next_id_ref,
                "({ pathname: location.pathname, href: location.href, title: document.title, bridge: !!window.__PROTON_PULSE_SCREENSHOT__ })",
            )
            if not isinstance(info, dict):
                return None
            return {
                "page": page,
                "info": info,
            }
    except Exception as exc:
        return {
            "page": page,
            "info": {
                "pathname": None,
                "href": page.get("url"),
                "title": page.get("title"),
                "bridge": False,
                "inspectError": str(exc),
            },
        }


def choose_control_target(page_states):
    for state in page_states:
        pathname = state["info"].get("pathname") or ""
        if PLUGIN_ROUTE in pathname and state["info"].get("bridge"):
            return state
    for state in page_states:
        if state["info"].get("bridge"):
            return state
    for state in page_states:
        pathname = state["info"].get("pathname") or ""
        if PLUGIN_ROUTE in pathname:
            return state
    for state in page_states:
        if state["page"].get("title") == "Steam Big Picture Mode":
            return state
    return page_states[0] if page_states else None


def choose_capture_target(page_states):
    for state in page_states:
        if state["page"].get("title") == "Steam Big Picture Mode":
            return state
    for state in page_states:
        pathname = state["info"].get("pathname") or ""
        if PLUGIN_ROUTE in pathname:
            return state
    for state in page_states:
        if state["info"].get("bridge"):
            return state
    return page_states[0] if page_states else None


async def inspect_all_pages(session):
    async with session.get(DEBUG_LIST_URL) as resp:
        pages = await resp.json()
    page_states = []
    for page in pages:
        state = await inspect_page(session, page)
        if state is not None:
            page_states.append(state)
    return page_states


async def dismiss_visible_overlay(session, page):
    debugger_url = page.get("webSocketDebuggerUrl")
    if not debugger_url:
        return
    try:
        async with session.ws_connect(debugger_url) as ws:
            next_id = 1

            async def send(method, params=None):
                nonlocal next_id
                message_id = next_id
                next_id += 1
                payload = {"id": message_id, "method": method}
                if params:
                    payload["params"] = params
                await ws.send_str(json.dumps(payload))
                async for msg in ws:
                    if msg.type.name != "TEXT":
                        continue
                    data = json.loads(msg.data)
                    if data.get("id") != message_id:
                        continue
                    return data.get("result")

            await send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27, "key": "Escape"})
            await send("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27, "key": "Escape"})
            await asyncio.sleep(0.2)
    except Exception:
        return


async def main():
    async with ClientSession() as session:
        page_states = await inspect_all_pages(session)
        control_state = choose_control_target(page_states)
        capture_state = choose_capture_target(page_states)
        if not control_state or not capture_state:
            raise SystemExit(
                "Could not find a usable Steam CEF debug target. "
                "Try: make cef-debug-enable"
            )
        control_page = control_state["page"]
        capture_page = capture_state["page"]
        if PREPARE_ACTION_JSON:
            await dismiss_visible_overlay(session, capture_page)

        out = f"/tmp/proton-pulse-screenshot-{time.strftime('%Y-%m-%d_%H-%M-%S')}.png"
        async with session.ws_connect(control_page["webSocketDebuggerUrl"]) as ws:
            next_id = 1

            async def call(method, params=None, await_promise=False, return_by_value=False):
                nonlocal next_id
                message_id = next_id
                next_id += 1
                payload = {"id": message_id, "method": method}
                if params:
                    payload["params"] = params
                await ws.send_str(json.dumps(payload))
                async for msg in ws:
                    if msg.type.name != "TEXT":
                        continue
                    data = json.loads(msg.data)
                    if data.get("id") != message_id:
                        continue
                    if "error" in data:
                        raise SystemExit(
                            f"CEF command failed for {method}: {data['error'].get('message', data['error'])}"
                        )
                    result = data.get("result")
                    if isinstance(result, dict) and "exceptionDetails" in result:
                        details = result.get("exceptionDetails", {})
                        exception = details.get("exception", {})
                        description = exception.get("description") or details.get("text") or result
                        raise SystemExit(f"CEF command failed for {method}: {description}")
                    return result

            await call("Page.enable")
            await call("Runtime.enable")

            next_id_ref = [next_id]
            location_result = await evaluate_page(
                ws,
                next_id_ref,
                "({ pathname: location.pathname, href: location.href, title: document.title, bridge: !!window.__PROTON_PULSE_SCREENSHOT__ })",
            )
            next_id = next_id_ref[0]
            debug_log(
                f"Using control target: {json.dumps({'title': control_page.get('title'), 'url': control_page.get('url'), 'info': location_result})}"
            )
            debug_log(
                f"Using capture target: {json.dumps({'title': capture_page.get('title'), 'url': capture_page.get('url'), 'info': capture_state['info']})}"
            )
            debug_log(
                f"Discovered debug targets: {json.dumps([{'title': state['page'].get('title'), 'url': state['page'].get('url'), 'info': state['info']} for state in page_states])}"
            )

            if PREPARE_ACTION_JSON or LANGUAGE:
                action_json = PREPARE_ACTION_JSON or "{}"
                escaped_action = json.dumps(action_json)
                escaped_language = json.dumps(LANGUAGE)
                expression = (
                    "(async () => {"
                    f"const raw = {escaped_action};"
                    "const action = JSON.parse(raw);"
                    f"const language = {escaped_language};"
                    "if (language) action.language = language;"
                    "const bridge = window.__PROTON_PULSE_SCREENSHOT__;"
                    "if (!bridge || typeof bridge.run !== 'function') {"
                    "throw new Error('Proton Pulse screenshot automation bridge is not available.');"
                    "}"
                    "return await bridge.run(action);"
                    "})()"
                )
                prep_result = await call(
                    "Runtime.evaluate",
                    {
                        "expression": expression,
                        "awaitPromise": True,
                        "returnByValue": True,
                    },
                )
                debug_log(f"Preparation result: {json.dumps(prep_result)}")
                next_id_ref = [next_id]
                location_after_prepare = await evaluate_page(
                    ws,
                    next_id_ref,
                    "({ pathname: location.pathname, href: location.href, title: document.title, bridge: !!window.__PROTON_PULSE_SCREENSHOT__ })",
                )
                next_id = next_id_ref[0]
                debug_log(f"Post-prepare page info: {json.dumps(location_after_prepare)}")

                page_states = await inspect_all_pages(session)
                capture_state = choose_capture_target(page_states)
                if not capture_state:
                    raise SystemExit(
                        "Lost the Steam CEF debug target after screenshot preparation."
                    )
                capture_page = capture_state["page"]
                debug_log(
                    "Refreshed capture target after prepare: "
                    f"{json.dumps({'title': capture_page.get('title'), 'url': capture_page.get('url'), 'info': capture_state['info']})}"
                )

        async with session.ws_connect(capture_page["webSocketDebuggerUrl"]) as ws:
            next_id = 1

            async def capture_call(method, params=None, msg_id=1):
                nonlocal next_id
                message_id = next_id
                next_id += 1
                payload = {"id": message_id, "method": method}
                if params:
                    payload["params"] = params
                await ws.send_str(json.dumps(payload))
                async for msg in ws:
                    if msg.type.name != "TEXT":
                        continue
                    data = json.loads(msg.data)
                    if data.get("id") != message_id:
                        continue
                    if "error" in data:
                        raise SystemExit(
                            f"CEF command failed for {method}: {data['error'].get('message', data['error'])}"
                        )
                    result = data.get("result")
                    if isinstance(result, dict) and "exceptionDetails" in result:
                        details = result.get("exceptionDetails", {})
                        exception = details.get("exception", {})
                        description = exception.get("description") or details.get("text") or result
                        raise SystemExit(f"CEF command failed for {method}: {description}")
                    return result

            await capture_call("Page.enable")
            capture_info = await capture_call(
                "Runtime.evaluate",
                {
                    "expression": "({ pathname: location.pathname, href: location.href, title: document.title })",
                    "returnByValue": True,
                },
            )
            debug_log(f"Capture target page info: {json.dumps(capture_info)}")
            result = await capture_call(
                "Page.captureScreenshot",
                {"format": "png", "fromSurface": True},
            )
            if result and "data" in result:
                with open(out, "wb") as handle:
                    handle.write(base64.b64decode(result["data"]))
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
    image_bytes = image_path.read_bytes()

    try:
        proc = subprocess.Popen(
            ["wl-copy", "--type", "image/png"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            proc.communicate(image_bytes, timeout=0.75)
        except subprocess.TimeoutExpired:
            if proc.stdin:
                proc.stdin.close()
            return "wl-copy --type image/png"

        if proc.returncode == 0:
            return "wl-copy --type image/png"
    except FileNotFoundError:
        pass

    commands: list[list[str]] = [
        ["xclip", "-selection", "clipboard", "-t", "image/png", "-i"],
        ["xsel", "--clipboard", "--input"],
    ]

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
    parser.add_argument(
        "--group",
        default="",
        help="Logical screenshot group, e.g. manage-game or settings",
    )
    parser.add_argument(
        "--shot-key",
        default="",
        help="Stable key within the group, e.g. default or loading",
    )
    parser.add_argument(
        "--title",
        default="",
        help="Optional human-readable title for the screenshot gallery",
    )
    parser.add_argument(
        "--caption",
        default="",
        help="Optional caption to include when publishing to the wiki",
    )
    parser.add_argument(
        "--language",
        default="",
        help="Screenshot language code used for language-specific galleries",
    )
    parser.add_argument(
        "--prepare-action-json",
        default="",
        help="Optional screenshot automation action JSON passed into the live plugin UI before capture.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print detailed CEF target/debug information during capture.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Run screenshot automation preparation without capturing or copying an image.",
    )
    args = parser.parse_args()

    normalized_language = normalize_language(args.language)
    if normalized_language not in SUPPORTED_SCREENSHOT_LANGUAGES:
        normalized_language = ""

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    ssh_target = f"{args.deck_user}@{args.deck_ip}"

    debug_enabled = args.debug or os.environ.get("DEBUG", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    try:
        remote_python = REMOTE_PYTHON.replace(
            "__PREPARE_ACTION_JSON__",
            json.dumps(args.prepare_action_json),
        ).replace(
            "__LANGUAGE__",
            json.dumps(normalized_language),
        ).replace(
            "__DEBUG_ENABLED__",
            "True" if debug_enabled else "False",
        )
        remote = run(
            ["ssh", ssh_target, "python3", "-"],
            capture=True,
            input_text=remote_python,
        )
    except subprocess.CalledProcessError as exc:
        if exc.stderr:
            print(exc.stderr.strip(), file=sys.stderr)
        return exc.returncode or 1
    remote_path = remote.stdout.strip()
    if remote.stderr:
        print(remote.stderr.strip(), file=sys.stderr)
    if args.prepare_only:
        if remote_path:
            print(remote_path)
        return 0
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
    if args.group and args.shot_key:
        entry = register_screenshot(
            output_dir,
            local_path,
            ScreenshotSpec(
                group=args.group,
                language=normalized_language,
                shot_key=args.shot_key,
                shot_title=args.title,
                caption=args.caption,
            ),
        )
        local_path = output_dir / entry.relative_path
        print(f"Registered screenshot as: {entry.group}/{entry.shot_key}")
    print(f"Saved screenshot locally to: {local_path}")
    print("Copying screenshot to clipboard...")
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
