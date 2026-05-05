"""Detect whether a game is a native Steam title or a non-Steam shortcut.

For non-Steam shortcuts the source launcher (Heroic, Epic, GOG, Lutris, …) is
inferred from the executable path or launch options stored in shortcuts.vdf.
"""

from __future__ import annotations

import json
import re
import ssl
import struct
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

from .steam_paths import find_steam_root
from .game_platforms import _library_folders, _parse_acf


# --- ACF-based Steam game lookup ---

_NON_STEAM_ID_THRESHOLD = 2_000_000_000  # shortcut IDs are CRC32 with high bit set (>= 2^31)


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


def _resolve_demo_full_game(app_id: str) -> tuple[str, str] | None:
    """If app_id is a Steam demo, return (full_game_app_id, full_game_name); otherwise None."""
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&filters=basic"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
            data = json.loads(resp.read().decode())
        app_data = data.get(str(app_id), {})
        if not app_data.get("success"):
            return None
        detail = app_data.get("data", {})
        if detail.get("type") == "demo":
            fullgame = detail.get("fullgame", {})
            full_id = str(fullgame.get("appid", "")).strip()
            full_name = str(fullgame.get("name", "")).strip()
            if full_id:
                decky.logger.debug(
                    "_resolve_demo_full_game: %s is demo -> full game %s (%s)",
                    app_id, full_id, full_name,
                )
                return (full_id, full_name)
    except Exception as exc:
        decky.logger.warning("_resolve_demo_full_game: error for %s: %s", app_id, exc)
    return None


def find_steam_appid_from_store(title: str) -> str | None:
    """Search the Steam store API for a game whose name exactly matches title.

    Falls back to this when the game is not found in any local ACF manifest
    (e.g. Dredge added as a non-Steam shortcut from another store). Returns the
    app_id string (e.g. "1562430") or None.
    """
    try:
        encoded = urllib.parse.quote(title)
        url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={encoded}&l=english&cc=US&infinite=1"
        )
        decky.logger.debug("find_steam_appid_from_store: fetching %s", url)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        # SteamOS lacks a CA bundle accessible to Python; skip cert verification
        # since we're calling Steam's own API from Steam's own OS.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
            data = json.loads(resp.read().decode())
        title_lower = title.strip().lower()
        names_found = [item.get("name") for item in data.get("items", [])]
        decky.logger.debug(
            "find_steam_appid_from_store: title=%r items=%s", title, names_found
        )
        for item in data.get("items", []):
            if item.get("type") == "app" and item.get("name", "").strip().lower() == title_lower:
                decky.logger.debug(
                    "find_steam_appid_from_store: matched %r -> %s", title, item["id"]
                )
                return str(item["id"])
        decky.logger.debug("find_steam_appid_from_store: no exact match for %r", title)
    except Exception as exc:
        decky.logger.warning("find_steam_appid_from_store: error for %r: %s", title, exc)
    return None


# --- Binary VDF shortcuts.vdf parser ---
# shortcuts.vdf uses a simplified binary VDF (not the text VDF used by .acf).
# Format: sequence of entries, each entry is a set of typed key-value pairs.
# Type bytes: 0x00 = nested map start, 0x01 = string, 0x02 = int32, 0x08 = end.

def _read_bvdf_string(data: bytes, pos: int) -> tuple[str, int]:
    """Read a null-terminated string starting at pos. Returns (value, new_pos)."""
    end = data.index(b"\x00", pos)
    return data[pos:end].decode("utf-8", errors="replace"), end + 1


def _skip_bvdf_map(data: bytes, pos: int) -> int:
    """Skip a nested binary VDF map starting at pos (after the key has been read).

    Recurses into nested maps. Returns position after the 0x08 end marker.
    """
    while pos < len(data):
        type_byte = data[pos:pos+1]
        pos += 1
        if type_byte == b"\x08":
            return pos
        if type_byte not in (b"\x00", b"\x01", b"\x02"):
            continue
        _, pos = _read_bvdf_string(data, pos)
        if type_byte == b"\x01":
            _, pos = _read_bvdf_string(data, pos)
        elif type_byte == b"\x02":
            pos += 4
        elif type_byte == b"\x00":
            pos = _skip_bvdf_map(data, pos)
    return pos


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
            type_byte = data[pos:pos+1]
            pos += 1
            if type_byte == b"\x08":  # end of map
                break
            if type_byte not in (b"\x00", b"\x01", b"\x02"):
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
            elif type_byte == b"\x00":  # nested map (e.g. tags) -- skip entirely
                pos = _skip_bvdf_map(data, pos)

        if entry:
            shortcuts.append(entry)

    return shortcuts


def find_shortcut_name_by_appid(app_id: str) -> str | None:
    """Find the display name of a non-Steam shortcut by matching its app_id.

    The app_id in shortcuts.vdf is stored as uint32 and equals the shortcut
    app_id the Steam client exposes (CRC32 with high bit set).
    """
    try:
        numeric_id = int(app_id)
        for vdf_path in _find_shortcuts_vdf():
            for entry in _parse_shortcuts_vdf(vdf_path):
                vdf_id = int(entry.get("appid", 0))
                decky.logger.debug(
                    "find_shortcut_name_by_appid: checking vdf_id=%s vs numeric_id=%s appname=%r",
                    vdf_id, numeric_id, entry.get("appname"),
                )
                if vdf_id == numeric_id or (vdf_id | 0x80000000) == numeric_id:
                    name = str(entry.get("appname", "")).strip()
                    decky.logger.debug(
                        "find_shortcut_name_by_appid: %s -> %r (vdf_id=%s)", app_id, name, vdf_id
                    )
                    if name:
                        return name
    except Exception as exc:
        decky.logger.warning("find_shortcut_name_by_appid: error: %s", exc)
    return None


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
    """Infer the launcher source from all string fields in a shortcut entry."""
    # Include exe, launchoptions, startdir, and icon -- Heroic Flatpak installs
    # often have /usr/bin/flatpak as exe but heroic paths in startdir or opts.
    parts = [
        str(entry.get("exe", "")),
        str(entry.get("launchoptions", "")),
        str(entry.get("startdir", "")),
        str(entry.get("icon", "")),
    ]
    combined = " ".join(parts).lower()

    if "heroic" in combined or "com.heroicgameslauncher" in combined:
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


# --- Public callable ---

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
        demo = _resolve_demo_full_game(app_id)
        result: dict[str, Any] = {
            "is_steam": True,
            "source": "Steam",
            "steam_app_id_match": None,
            "full_game_app_id": demo[0] if demo else None,
            "full_game_name": demo[1] if demo else None,
        }
        _source_cache[cache_key] = result
        return result

    # Non-Steam -- find the shortcut entry.
    # Match by app_id first (unique, reliable), then fall back to name matching.
    source = "Non-Steam"
    steam_match: str | None = None

    matched_entry: dict[str, Any] | None = None
    try:
        numeric_id = int(app_id)
        for vdf_path in _find_shortcuts_vdf():
            entries = _parse_shortcuts_vdf(vdf_path)
            decky.logger.debug(
                "get_game_source: vdf=%s entries=%s",
                vdf_path.name,
                [(e.get("appname"), e.get("appid")) for e in entries],
            )
            for entry in entries:
                vdf_id = int(entry.get("appid", 0))
                if vdf_id == numeric_id or (vdf_id | 0x80000000) == numeric_id:
                    matched_entry = entry
                    break
            if matched_entry:
                break
    except Exception as exc:
        decky.logger.warning("get_game_source: app_id lookup failed: %s", exc)

    # Fall back to name match if app_id didn't resolve (e.g. appid field missing in VDF)
    if matched_entry is None and title:
        try:
            for vdf_path in _find_shortcuts_vdf():
                for entry in _parse_shortcuts_vdf(vdf_path):
                    app_name = str(entry.get("appname", "")).strip()
                    if app_name.lower() == title.strip().lower():
                        matched_entry = entry
                        break
                if matched_entry:
                    break
        except Exception as exc:
            decky.logger.warning("get_game_source: name lookup failed: %s", exc)

    if matched_entry is not None:
        source = _infer_source_from_shortcut(matched_entry)
        if not title:
            title = str(matched_entry.get("appname", "")).strip()

    decky.logger.debug("get_game_source: app_id=%s title=%r source=%s matched=%s",
                       app_id, title, source, matched_entry is not None)

    # Resolve title to a Steam store app_id for ProtonDB lookups.
    # If the frontend didn't supply a title, fall back to VDF name lookup.
    if not title:
        title = find_shortcut_name_by_appid(app_id) or ""
        decky.logger.debug("get_game_source: resolved title from vdf: %r", title)

    decky.logger.debug("get_game_source: non-steam app_id=%s title=%r source=%s", app_id, title, source)
    if title:
        try:
            steam_match = find_steam_appid_by_title(title)
            decky.logger.debug("get_game_source: local ACF match=%s for title=%r", steam_match, title)
        except Exception as exc:
            decky.logger.warning("get_game_source: title match (local) failed: %s", exc)
        if not steam_match:
            try:
                steam_match = find_steam_appid_from_store(title)
                decky.logger.debug("get_game_source: store match=%s for title=%r", steam_match, title)
            except Exception as exc:
                decky.logger.warning("get_game_source: title match (store) failed: %s", exc)

    demo: tuple[str, str] | None = None
    if steam_match:
        demo = _resolve_demo_full_game(steam_match)
        if demo:
            decky.logger.debug(
                "get_game_source: %r matched demo %s -> full game %s (%s)",
                title, steam_match, demo[0], demo[1],
            )

    result = {
        "is_steam": False,
        "source": source,
        "steam_app_id_match": steam_match,
        "full_game_app_id": demo[0] if demo else None,
        "full_game_name": demo[1] if demo else None,
    }
    decky.logger.debug("get_game_source: result=%s", result)
    _source_cache[cache_key] = result
    return result
