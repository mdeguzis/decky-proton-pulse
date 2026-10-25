"""Tests for scripts/extract-proton-env-support.py (#92, #135)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "extract_proton_env_support",
    Path(__file__).resolve().parent.parent / "scripts" / "extract-proton-env-support.py",
)
assert _SPEC and _SPEC.loader
ext = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ext)

# Trimmed from a real GE-Proton proton script: both call forms appear.
GE_SCRIPT = '''
class Session:
    def check_environment(self, env_name, config_name):
        if env_name not in self.env:
            return False
    def init(self):
        self.check_environment("PROTON_USE_WOW64", "wow64")
        self.check_environment("PROTON_NO_ESYNC", "noesync")
        if "PROTON_LOG" in self.env:
            pass
        x = os.environ.get("WINE_DISABLE_FULLSCREEN_HACK")
g_session.check_environment("PROTON_FSR4_UPGRADE", "fsr4")
'''
VALVE_SCRIPT = '''
        self.check_environment("PROTON_NO_FSYNC", "nofsync")
        if env_nonzero("PROTON_LOG"):
            pass
'''


def test_extract_finds_self_and_module_level_switches() -> None:
    # The first hand-built matrix only matched self.check_environment and
    # missed the g_session.check_environment upscaler switches.
    data = ext.extract(GE_SCRIPT)
    assert data["switches"] == {
        "PROTON_FSR4_UPGRADE": "fsr4", "PROTON_NO_ESYNC": "noesync", "PROTON_USE_WOW64": "wow64",
    }
    assert data["env_reads"] == ["PROTON_LOG", "WINE_DISABLE_FULLSCREEN_HACK"]


def test_build_indexes_switches_by_tool_with_source_links() -> None:
    sources = {
        "ge": {"label": "GE-Proton", "repo": "GloriousEggroll/proton-ge-custom", "tag": "GE-Proton11-11"},
        "valve-stable": {"label": "Proton (stable)", "repo": "ValveSoftware/Proton", "tag": "proton-11.0-2c"},
    }
    fetched: list[str] = []

    def fake_fetch(url: str) -> str:
        fetched.append(url)
        return GE_SCRIPT if "proton-ge-custom" in url else VALVE_SCRIPT

    data = ext.build(sources, fetcher=fake_fetch)
    assert fetched == [
        "https://raw.githubusercontent.com/GloriousEggroll/proton-ge-custom/GE-Proton11-11/proton",
        "https://raw.githubusercontent.com/ValveSoftware/Proton/proton-11.0-2c/proton",
    ]
    ge_src = data["tools"]["ge"]["source"]
    assert ge_src["release_url"] == "https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-11"
    assert ge_src["file_url"] == "https://github.com/GloriousEggroll/proton-ge-custom/blob/GE-Proton11-11/proton"
    assert len(ge_src["sha256"]) == 64
    assert data["switches"]["PROTON_USE_WOW64"] == {"option": "wow64", "tools": ["ge"]}
    assert data["switches"]["PROTON_NO_FSYNC"] == {"option": "nofsync", "tools": ["valve-stable"]}
    assert "PROTON_VERSION" not in data["switches"]
    assert data["_meta"]["schema_version"] == 1


def test_build_fails_loudly_when_a_script_has_no_switches() -> None:
    # A moved file or changed format must not publish "this tool supports nothing".
    with pytest.raises(ValueError, match="no check_environment switches"):
        ext.build({"ge": {"label": "GE", "repo": "a/b", "tag": "t"}}, fetcher=lambda _u: "print('hi')")


def test_build_propagates_fetch_errors() -> None:
    def broken(url: str) -> str:
        raise HTTPError(url, 404, "Not Found", None, None)  # type: ignore[arg-type]

    with pytest.raises(HTTPError):
        ext.build({"ge": {"label": "GE", "repo": "a/b", "tag": "missing"}}, fetcher=broken)


def test_current_sources_reads_tags_back_from_the_json(tmp_path: Path) -> None:
    out = tmp_path / "proton-env-support.json"
    assert ext.current_sources(out)["ge"]["tag"] == ext.DEFAULT_SOURCES["ge"]["tag"]
    data = ext.build({"ge": {"label": "GE-Proton", "repo": "GloriousEggroll/proton-ge-custom", "tag": "GE-Proton11-12"}},
                     fetcher=lambda _u: GE_SCRIPT)
    out.write_text(json.dumps(data))
    assert ext.current_sources(out) == {
        "ge": {"label": "GE-Proton", "repo": "GloriousEggroll/proton-ge-custom", "tag": "GE-Proton11-12", "file": "proton"},
    }


def test_committed_json_matches_its_own_schema() -> None:
    data = json.loads(ext.DATA_PATH.read_text(encoding="utf-8"))
    assert set(data) == {"_meta", "tools", "switches"}
    for tool_id, tool in data["tools"].items():
        src = tool["source"]
        assert src["raw_url"] == f"https://raw.githubusercontent.com/{src['repo']}/{src['tag']}/{src['file']}", tool_id
        assert tool["switch_count"] == len(tool["switches"])
        for env in tool["switches"]:
            assert tool_id in data["switches"][env]["tools"]
    # Verified on a Deck and upstream: Valve Proton ignores these.
    assert data["switches"]["PROTON_USE_WOW64"]["tools"] == ["ge", "cachyos"]
    assert "PROTON_VERSION" not in data["switches"]
