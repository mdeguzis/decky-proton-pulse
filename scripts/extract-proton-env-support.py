#!/usr/bin/env python3
"""Regenerate src/data/proton-env-support.json from upstream Proton sources.

Which PROTON_* launch-option switches (and other env vars) each Proton build
actually reads, extracted from that build's `proton` script (#92, #135).
Each tool entry in the JSON carries a `source` block naming the upstream repo
and release tag it was extracted from. To update after a new release, bump
the tag and re-run:

    python3 scripts/extract-proton-env-support.py --tag ge=GE-Proton11-12
    python3 scripts/extract-proton-env-support.py            # re-extract current tags

Fetches raw.githubusercontent.com/<repo>/<tag>/<file>. Any fetch failure
raises: a partial file would silently tell the plugin a switch is unsupported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "proton-env-support.json"

# Starting point when the JSON does not exist yet. After that, the JSON's own
# source blocks are the source of truth.
DEFAULT_SOURCES: dict[str, dict[str, str]] = {
    "ge": {"label": "GE-Proton", "repo": "GloriousEggroll/proton-ge-custom", "tag": "GE-Proton11-11"},
    "cachyos": {"label": "Proton-CachyOS", "repo": "CachyOS/proton-cachyos", "tag": "cachyos-11.0-20260702-slr"},
    "valve-experimental": {"label": "Proton Experimental", "repo": "ValveSoftware/Proton", "tag": "experimental-11.0-20261014"},
    "valve-stable": {"label": "Proton (stable)", "repo": "ValveSoftware/Proton", "tag": "proton-11.0-2c"},
}

# check_environment("PROTON_NO_ESYNC", "noesync"): env var -> compat option.
SWITCH_RE = re.compile(r'''check_environment\(\s*["']([A-Z][A-Z0-9_]+)["']\s*,\s*["']([a-z0-9_]+)["']''')
# os.environ["X"], g_session.env.get("X"), env_nonzero("X"), getenv("X") ...
ENV_READ_RE = re.compile(
    r'''(?:environ|\.env|env_nonzero|env_is_set|env_set|getenv|setdefault)\s*(?:\.get\s*)?[\[(]\s*["']([A-Z][A-Z0-9_]{2,})["']'''
)
# "X" in os.environ / "X" not in self.env
ENV_IN_RE = re.compile(r'''["']([A-Z][A-Z0-9_]{2,})["']\s+(?:not\s+)?in\s+(?:os\.environ|self\.env|g_session\.env|env\b)''')


def extract(script: str) -> dict[str, Any]:
    """Switches (env -> option) and every other env var the script reads."""
    switches = dict(sorted(SWITCH_RE.findall(script)))
    env_reads = set(ENV_READ_RE.findall(script)) | set(ENV_IN_RE.findall(script))
    return {
        "switches": switches,
        "env_reads": sorted(env_reads - set(switches)),
    }


def source_urls(repo: str, tag: str, file: str = "proton") -> dict[str, str]:
    return {
        "repo_url": f"https://github.com/{repo}",
        "release_url": f"https://github.com/{repo}/releases/tag/{tag}",
        "file_url": f"https://github.com/{repo}/blob/{tag}/{file}",
        "raw_url": f"https://raw.githubusercontent.com/{repo}/{tag}/{file}",
    }


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "decky-proton-pulse/extract-proton-env-support"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # HTTPError / URLError propagate
        return resp.read().decode("utf-8")


def build(sources: dict[str, dict[str, str]], fetcher=fetch) -> dict[str, Any]:
    tools: dict[str, Any] = {}
    for tool_id, src in sources.items():
        file = src.get("file", "proton")
        urls = source_urls(src["repo"], src["tag"], file)
        script = fetcher(urls["raw_url"])
        data = extract(script)
        if not data["switches"]:
            # Every Proton since 2018 has check_environment calls; none means
            # the file moved or the format changed. Fail loudly.
            raise ValueError(f"{tool_id}: no check_environment switches found in {urls['raw_url']}")
        tools[tool_id] = {
            "source": {
                "label": src["label"],
                "repo": src["repo"],
                "tag": src["tag"],
                "file": file,
                **urls,
                "sha256": hashlib.sha256(script.encode("utf-8")).hexdigest(),
            },
            "switch_count": len(data["switches"]),
            "env_read_count": len(data["env_reads"]),
            **data,
        }
        print(f"{tool_id}: {src['repo']}@{src['tag']} switches={len(data['switches'])} env={len(data['env_reads'])}",
              file=sys.stderr)

    index: dict[str, Any] = {}
    for tool_id, tool in tools.items():
        for env, option in tool["switches"].items():
            entry = index.setdefault(env, {"option": option, "tools": []})
            entry["tools"].append(tool_id)
    return {
        "_meta": {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator": "python3 scripts/extract-proton-env-support.py [--tag <tool_id>=<tag>]",
            "how_to_update": (
                "Bump tools.<id>.source.tag (or pass --tag) and re-run the generator. It refetches "
                "each tool's proton script from source.raw_url and rewrites switches and env_reads."
            ),
            "method": (
                "switches = check_environment(\"PROTON_X\", \"option\") pairs in the proton script; "
                "env_reads = other environment variables the script reads (os.environ, g_session.env, "
                "env_nonzero). A switch a tool does not list is silently ignored by that tool."
            ),
            "notes": [
                "Setting a switch to 0 actively removes the option, even if the game's built-in fix enabled it.",
                "PROTON_VERSION is not read by any Proton build or the Steam Linux Runtime; only protontricks reads it.",
                "The compat tool itself can only be chosen with SteamClient.Apps.SpecifyCompatTool, never a launch option.",
            ],
            "issues": [
                "https://github.com/mdeguzis/decky-proton-pulse/issues/92",
                "https://github.com/mdeguzis/decky-proton-pulse/issues/135",
                "https://github.com/mdeguzis/proton-pulse-web/issues/564",
            ],
            "wiki": "https://github.com/mdeguzis/decky-proton-pulse/wiki/Compatibility-Tools",
        },
        "tools": tools,
        "switches": dict(sorted(index.items())),
    }


def current_sources(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {k: dict(v) for k, v in DEFAULT_SOURCES.items()}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        tool_id: {k: tool["source"][k] for k in ("label", "repo", "tag", "file")}
        for tool_id, tool in data["tools"].items()
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tag", action="append", default=[], metavar="TOOL=TAG",
                        help="override a tool's release tag, e.g. ge=GE-Proton11-12")
    parser.add_argument("--out", type=Path, default=DATA_PATH)
    args = parser.parse_args(argv)

    sources = current_sources(args.out)
    for override in args.tag:
        tool_id, _, tag = override.partition("=")
        if tool_id not in sources or not tag:
            parser.error(f"--tag {override!r}: expected one of {sorted(sources)}=<tag>")
        sources[tool_id]["tag"] = tag

    data = build(sources)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
