"""Detect whether a game is a native Steam title or a non-Steam shortcut.

For non-Steam shortcuts the source launcher (Heroic, Epic, GOG, Lutris, …) is
inferred from the executable path or launch options stored in shortcuts.vdf.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .steam_paths import find_steam_root
from .game_platforms import _library_folders, _parse_acf


# ── ACF-based Steam game lookup ───────────────────────────────────────────────

_NON_STEAM_ID_THRESHOLD = 2_000_000_000  # shortcut IDs are CRC32 with high bit set (≥ 2^31)


def is_steam_app(app_id: str) -> bool:
    """Return True if app_id is a native Steam game (not a non-Steam shortcut).

    Non-Steam shortcut IDs are generated as CRC32-based values with the high bit
    set, making them always >= 2^31 (~2.1 billion). Real Steam app IDs are
    currently in the low millions, so comparing against 2 billion reliably
    separates the two without reading any files.
    """
    try:
        return int(app_id) < _NON_STEAM_ID_THRESHOLD
    except ValueError:
        return False


def find_steam_appid_by_title(title: str) -> str | None:
    """Search all steamapps ACFs for a game whose name exactly matches title.

    Returns the app_id string (e.g. "1234") or None.
    """
    title_lower = title.strip().lower()
    for lib in _library_folders():
        try:
            for acf in lib.glob("appmanifest_*.acf"):
                kv = _parse_acf(acf)
                name = kv.get("name", "")
                if name.strip().lower() == title_lower:
                    m = re.search(r"appmanifest_(\d+)\.acf$", acf.name)
                    if m:
                        return m.group(1)
        except OSError:
            continue
    return None


# ── Binary VDF shortcuts.vdf parser ──────────────────────────────────────────
# shortcuts.vdf uses a simplified binary VDF (not the text VDF used by .acf).
# Format: sequence of entries, each entry is a set of typed key-value pairs.
# Type bytes: 0x00 = nested map start, 0x01 = string, 0x02 = int32, 0x08 = end.

def _read_bvdf_string(data: bytes, pos: int) -> tuple[str, int]:
    """Read a null-terminated string starting at pos. Returns (value, new_pos)."""
    end = data.index(b"\x00", pos)
    return data[pos:end].decode("utf-8", errors="replace"), end + 1


def _parse_shortcuts_vdf(path: Path) -> list[dict[str, Any]]:
    """Parse a binary shortcuts.vdf and return a list of shortcut dicts."""
    try:
        data = path.read_bytes()
    except OSError:
        return []

    shortcuts: list[dict[str, Any]] = []
    pos = 0
    # Skip the outer "shortcuts" map header (type 0x00, key "shortcuts\x00")
    if data[pos:pos+1] == b"\x00":
        pos += 1
        _, pos = _read_bvdf_string(data, pos)  # skip "shortcuts"

    while pos < len(data):
        if data[pos:pos+1] in (b"\x08", b""):
            break
        if data[pos:pos+1] != b"\x00":
            pos += 1
            continue
        pos += 1  # consume map-start byte
        _, pos = _read_bvdf_string(data, pos)  # shortcut index key e.g. "0"

        entry: dict[str, Any] = {}
        while pos < len(data):
            if pos >= len(data):
                break
            type_byte = data[pos:pos+1]
            pos += 1
            if type_byte == b"\x08":  # end of map
                break
            if type_byte not in (b"\x00", b"\x01", b"\x02"):
                # unknown type — skip to next null-terminated key safely
                continue
            key, pos = _read_bvdf_string(data, pos)
            if type_byte == b"\x01":  # string
                val, pos = _read_bvdf_string(data, pos)
                entry[key.lower()] = val
            elif type_byte == b"\x02":  # int32
                if pos + 4 <= len(data):
                    val_int = struct.unpack_from("<I", data, pos)[0]
                    entry[key.lower()] = val_int
                    pos += 4
            # nested maps (type 0x00) skipped — we only need flat string fields

        if entry:
            shortcuts.append(entry)

    return shortcuts


def _find_shortcuts_vdf() -> list[Path]:
    root = find_steam_root()
    if not root:
        return []
    # userdata/<userid>/config/shortcuts.vdf
    userdata = root / "userdata"
    if not userdata.is_dir():
        return []
    return list(userdata.glob("*/config/shortcuts.vdf"))


def _infer_source_from_shortcut(entry: dict[str, Any]) -> str:
    """Infer the launcher source from a shortcut entry's exe/launch options."""
    exe = str(entry.get("exe", "")).lower()
    opts = str(entry.get("launchoptions", "")).lower()
    combined = exe + " " + opts

    if "heroic" in combined:
        return "Heroic"
    if "lutris" in combined:
        return "Lutris"
    if "bottles" in combined:
        return "Bottles"
    if "com.epicgames" in combined or "epic games" in combined:
        return "Epic"
    if "gog" in combined and "galaxy" in combined:
        return "GOG"
    if "itch.io" in combined or "itch-setup" in combined:
        return "itch.io"
    return "Non-Steam"


# ── Public callable ───────────────────────────────────────────────────────────

_source_cache: dict[str, dict[str, Any]] = {}


def get_game_source(app_id: str, title: str = "") -> dict[str, Any]:
    """Return source information for a game.

    Returns:
        {
          "is_steam": bool,           # True if this is a native Steam game
          "source": str,              # "Steam", "Heroic", "Epic", "Non-Steam", …
          "steam_app_id_match": str | None,  # Steam app_id if title matched a Steam game
        }
    """
    cache_key = f"{app_id}:{title}"
    if cache_key in _source_cache:
        return _source_cache[cache_key]

    if is_steam_app(app_id):
        result: dict[str, Any] = {
            "is_steam": True,
            "source": "Steam",
            "steam_app_id_match": None,
        }
        _source_cache[cache_key] = result
        return result

    # Non-Steam — try to find the shortcut entry by app name
    source = "Non-Steam"
    steam_match: str | None = None

    try:
        for vdf_path in _find_shortcuts_vdf():
            entries = _parse_shortcuts_vdf(vdf_path)
            for entry in entries:
                app_name = str(entry.get("appname", "")).strip()
                if app_name.lower() == title.strip().lower() or not title:
                    source = _infer_source_from_shortcut(entry)
                    break
            else:
                continue
            break
    except Exception as exc:
        decky.logger.warning("get_game_source: shortcuts parse failed: %s", exc)

    # Try to find a matching Steam game by title
    if title:
        try:
            steam_match = find_steam_appid_by_title(title)
        except Exception as exc:
            decky.logger.warning("get_game_source: title match failed: %s", exc)

    result = {
        "is_steam": False,
        "source": source,
        "steam_app_id_match": steam_match,
    }
    _source_cache[cache_key] = result
    return result
