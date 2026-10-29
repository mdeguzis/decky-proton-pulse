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


# --- #564: newest tag per tool ------------------------------------------------

def test_valve_stable_picks_the_highest_lettered_point_build() -> None:
    # Live 2026-10-29: "latest release" was proton-11.0-2; 2e is newer.
    tags = ["proton-11.0-1b", "proton-11.0-2", "proton-11.0-2b", "proton-11.0-2e", "proton-11.0-2c",
            "proton-11.0-1-beta5", "proton-sdk-4.0.20260714.251823-1", "proton-hotfix-31032023", "proton-9.0-4"]
    assert ext.newest_valve_stable(tags) == "proton-11.0-2e"
    assert ext.newest_valve_stable(["proton-sdk-x"]) is None


def test_valve_experimental_ignores_one_off_branches() -> None:
    tags = ["experimental-11.0-20261014", "experimental-11.0-20260901", "experimental-5.13-shmem-20201212",
            "experimental-6.3-touchtest-20211021", "experimental-10.0-20261101"]
    assert ext.newest_valve_experimental(tags) == "experimental-11.0-20261014"
    assert ext.newest_valve_experimental([]) is None


def _fake_api(calls: list[str]):
    def api(path: str):
        calls.append(path)
        if path.endswith("/releases/latest"):
            return {"tag_name": {"GloriousEggroll/proton-ge-custom": "GE-Proton11-12",
                                 "CachyOS/proton-cachyos": "cachyos-11.0-20261015-slr"}[path.split("/releases")[0][6:]]}
        if path.endswith("tags/proton-"):
            return [{"ref": "refs/tags/proton-11.0-2"}, {"ref": "refs/tags/proton-11.0-2e"}, "junk"]
        if path.endswith("tags/experimental-"):
            return [{"ref": "refs/tags/experimental-11.0-20261014"}]
        raise AssertionError(path)
    return api


def test_latest_tags_uses_releases_for_ge_and_cachyos_and_tags_for_valve() -> None:
    calls: list[str] = []
    got = ext.latest_tags({k: dict(v) for k, v in ext.DEFAULT_SOURCES.items()}, api=_fake_api(calls))
    assert got == {"ge": "GE-Proton11-12", "cachyos": "cachyos-11.0-20261015-slr",
                   "valve-experimental": "experimental-11.0-20261014", "valve-stable": "proton-11.0-2e"}
    assert "repos/ValveSoftware/Proton/git/matching-refs/tags/proton-" in calls


def test_latest_tags_fails_loudly_when_a_tool_has_no_tag() -> None:
    with pytest.raises(ValueError, match="valve-stable: no release tag"):
        ext.latest_tags({"valve-stable": dict(ext.DEFAULT_SOURCES["valve-stable"])}, api=lambda p: [])


def _write_sources(path: Path, tags: dict[str, str]) -> None:
    path.write_text(json.dumps({"tools": {
        k: {"source": {**{f: v for f, v in ext.DEFAULT_SOURCES[k].items()}, "tag": tags[k], "file": "proton"}}
        for k in tags}}))


def test_main_latest_leaves_the_file_alone_when_nothing_changed(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "env.json"
    _write_sources(out, {"valve-stable": "proton-11.0-2e"})
    before = out.read_text()
    monkeypatch.setattr(ext, "latest_tags", lambda sources: {"valve-stable": "proton-11.0-2e"})
    monkeypatch.setattr(ext, "build", lambda sources: (_ for _ in ()).throw(AssertionError("no rebuild")))
    assert ext.main(["--latest", "--out", str(out)]) == 0
    assert out.read_text() == before


def test_main_latest_rebuilds_with_the_new_tags(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "env.json"
    _write_sources(out, {"valve-stable": "proton-11.0-2c", "ge": "GE-Proton11-11"})
    monkeypatch.setattr(ext, "latest_tags", lambda sources: {"valve-stable": "proton-11.0-2e", "ge": "GE-Proton11-11"})
    seen = {}
    monkeypatch.setattr(ext, "build", lambda sources: seen.update(sources) or {"tools": {}})
    assert ext.main(["--latest", "--out", str(out)]) == 0
    assert seen["valve-stable"]["tag"] == "proton-11.0-2e" and seen["ge"]["tag"] == "GE-Proton11-11"


def test_github_api_sends_the_token_when_set(monkeypatch) -> None:
    seen = {}

    class R:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"tag_name": "x"}'

    def opener(req, timeout):
        seen["auth"] = req.get_header("Authorization")
        seen["url"] = req.full_url
        return R()

    monkeypatch.setattr(ext.urllib.request, "urlopen", opener)
    monkeypatch.setenv("GITHUB_TOKEN", "t0k")
    assert ext.github_api("repos/a/b/releases/latest") == {"tag_name": "x"}
    assert seen == {"auth": "Bearer t0k", "url": "https://api.github.com/repos/a/b/releases/latest"}
    monkeypatch.delenv("GITHUB_TOKEN")
    ext.github_api("repos/a/b/releases/latest")
    assert seen["auth"] is None
