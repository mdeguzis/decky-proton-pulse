"""Self-update logic for the Proton Pulse plugin.

Checks GitHub Releases for a newer version and applies it by downloading
and extracting the release ZIP to the Decky plugins parent directory.
Progress is written to a shared status dict that the frontend polls via
get_update_status().
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

import decky  # type: ignore[import-untyped]

from .http_client import curl_download, curl_json

GITHUB_REPO = "mdeguzis/decky-proton-pulse"
_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
_ALL_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=10"
_LATEST_COMMIT_ZIP = f"https://github.com/{GITHUB_REPO}/archive/refs/heads/main.zip"


def _ver(v: str) -> tuple:
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except (ValueError, AttributeError):
        return (0,)


def make_initial_status() -> dict[str, Any]:
    return {
        "state": "idle",
        "stage": None,
        "downloaded_bytes": None,
        "total_bytes": None,
        "progress_fraction": None,
        "version": None,
        "error": None,
        "started_at": None,
        "finished_at": None,
    }


def check_for_update(current_version: str, channel: str = "release") -> dict[str, Any]:
    """Fetch an update based on the chosen channel and compare versions.

    channel values:
      "release"     - latest stable GitHub release (no prereleases)
      "pre-release" - latest GitHub release including prereleases
      "developer"   - rolling "developer" tag/release, always tracks origin/main.
                      Refreshed via `make github-dev-release` after every push
      "latest"      - latest main branch commit zip (kept for backwards compat,
                      not exposed in the UI dropdown anymore)
    """
    try:
        if channel == "latest":
            commit_sha = "HEAD"
            try:
                commit_data = curl_json(
                    f"https://api.github.com/repos/{GITHUB_REPO}/commits/main",
                    headers=["Accept: application/vnd.github.v3+json"],
                    timeout=10,
                )
                commit_sha = str(commit_data.get("sha", "HEAD"))[:7]
            except Exception:
                pass
            return {
                "success": True,
                "current_version": current_version,
                "latest_version": f"main ({commit_sha})",
                "has_update": True,
                "zip_url": _LATEST_COMMIT_ZIP,
                "asset_size": None,
                "release_url": f"https://github.com/{GITHUB_REPO}/tree/main",
                "release_notes": "",
                "published_at": "",
                "channel": channel,
            }

        if channel == "developer":
            # Rolling "developer" tag, refreshed via make github-dev-release.
            # Pull the release by tag so we always get the freshest zip attached
            # to that tag regardless of version semantics. has_update fires
            # whenever the commit-sha embedded in the version label differs
            # from what we have locally
            data = curl_json(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/developer",
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )
            latest = str(data.get("tag_name", "developer"))
            # Use the release "name" or body to surface the commit sha if present
            release_name = str(data.get("name", "") or "")
            zip_asset = next(
                (a for a in data.get("assets", []) if a["name"].endswith(".zip")),
                None,
            )
            zip_url = zip_asset["browser_download_url"] if zip_asset else None
            asset_size = zip_asset.get("size") if zip_asset else None
            # has_update: always treat as available when the release name (which
            # we set to "dev (sha)") differs from the local build commit. We
            # cant easily read the local .build-commit from here so just always
            # offer the update - it's a dev channel, low cost to re-install
            display_version = release_name or latest
            decky.logger.debug(
                f"check_for_update(developer): zip_url={zip_url} display={display_version}"
            )
            return {
                "success": True,
                "current_version": current_version,
                "latest_version": display_version,
                "has_update": bool(zip_url),
                "zip_url": zip_url,
                "asset_size": asset_size,
                "release_url": str(data.get("html_url", "")),
                "release_notes": str(data.get("body", "") or ""),
                "published_at": str(data.get("published_at", "") or ""),
                "channel": channel,
            }

        if channel == "pre-release":
            # Find the newest release that is actually marked as a pre-release.
            # Taking releases[0] would pick the newest overall (often a stable
            # release) and incorrectly suggest a downgrade when no newer
            # pre-release exists yet.
            releases = curl_json(
                _ALL_RELEASES_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )
            data = next((r for r in releases if r.get("prerelease")), releases[0] if releases else {})
        else:
            data = curl_json(
                _RELEASES_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )

        latest = str(data.get("tag_name", "")).lstrip("v")
        zip_asset = next(
            (a for a in data.get("assets", []) if a["name"].endswith(".zip")),
            None,
        )
        zip_url: str | None = zip_asset["browser_download_url"] if zip_asset else None
        asset_size: int | None = zip_asset.get("size") if zip_asset else None
        has_update = bool(latest and zip_url and _ver(latest) > _ver(current_version))
        decky.logger.debug(
            f"check_for_update({channel}): current={current_version} latest={latest}"
            f" has_update={has_update} zip_url={zip_url}"
        )
        return {
            "success": True,
            "current_version": current_version,
            "latest_version": latest,
            "has_update": has_update,
            "zip_url": zip_url,
            "asset_size": asset_size,
            "release_url": str(data.get("html_url", "")),
            "release_notes": str(data.get("body", "") or ""),
            "channel": channel,
        }
    except Exception as e:
        decky.logger.error(f"check_for_update({channel}): failed: {e}")
        return {"success": False, "error": str(e), "current_version": current_version}


def list_releases(limit: int = 10, include_prereleases: bool = True) -> dict[str, Any]:
    """Return the N most recent GitHub releases for browsing in the
    release-notes modal. Used by the modal's left/right navigation so the
    user can scroll back through past release history without bouncing to
    a browser.

    Each entry includes: version (display tag), name, body (markdown),
    published_at (ISO date), prerelease flag, developer flag, html_url.
    The rolling 'developer' release is INCLUDED with developer=True set
    so the modal can render it with the DEV channel pill and show the
    auto-generated commit summary as the first card when the user is on
    the developer channel
    """
    try:
        raw = curl_json(
            _ALL_RELEASES_URL,
            headers=["Accept: application/vnd.github.v3+json"],
            timeout=15,
        )
        out: list[dict[str, Any]] = []
        for r in raw:
            tag = str(r.get("tag_name", "") or "")
            is_pre = bool(r.get("prerelease"))
            is_dev = tag == "developer"
            if is_pre and not include_prereleases:
                continue
            # The dev rolling release uses the release "name" ("Developer
            # build (sha)") as the display version because the tag itself
            # is just "developer". For everything else, strip the leading v
            display_version = (str(r.get("name", "")).strip() if is_dev else tag.lstrip("v"))
            out.append(
                {
                    "version": display_version or tag,
                    "name": str(r.get("name", "") or tag),
                    "body": str(r.get("body", "") or ""),
                    "published_at": str(r.get("published_at", "") or ""),
                    "prerelease": is_pre,
                    "developer": is_dev,
                    "html_url": str(r.get("html_url", "") or ""),
                }
            )
            if len(out) >= limit:
                break
        return {"success": True, "releases": out}
    except Exception as e:
        decky.logger.error(f"list_releases: failed: {e}")
        return {"success": False, "error": str(e), "releases": []}


def start_apply_update(
    zip_url: str,
    version: str,
    plugin_dir: str,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel: threading.Event,
) -> None:
    """Kick off a daemon thread to download and extract the update ZIP."""
    thread = threading.Thread(
        target=_run,
        args=(zip_url, version, plugin_dir, status, lock, cancel),
        daemon=True,
        name=f"pp-update-{version}",
    )
    thread.start()


def _run(
    zip_url: str,
    version: str,
    plugin_dir: str,
    status: dict[str, Any],
    lock: threading.Lock,
    cancel: threading.Event,
) -> None:
    plugin_parent_dir = os.path.dirname(plugin_dir)
    tmp_path = Path(tempfile.gettempdir()) / f"pp-update-{version}.zip"

    def _set(**kwargs: Any) -> None:
        with lock:
            status.update(kwargs)

    _set(
        state="running",
        stage="downloading",
        version=version,
        started_at=int(time.time()),
        downloaded_bytes=0,
        total_bytes=None,
        progress_fraction=None,
        error=None,
        finished_at=None,
    )

    def _on_progress(downloaded: int, total: int | None, fraction: float | None) -> None:
        _set(downloaded_bytes=downloaded, total_bytes=total, progress_fraction=fraction)

    try:
        decky.logger.info(
            f"plugin_updater: downloading {version}"
            f" | url={zip_url} dest={tmp_path}"
        )
        curl_download(
            zip_url,
            tmp_path,
            timeout=120,
            progress_callback=_on_progress,
            cancel_check=cancel.is_set,
        )

        if cancel.is_set():
            raise RuntimeError("Cancelled")

        size = tmp_path.stat().st_size
        _set(stage="extracting", progress_fraction=1.0)

        # extract to a temp dir first so we can handle wrong dir names
        # (github archive zips use repo-branch/ not the plugin name)
        tmp_extract = Path(tempfile.gettempdir()) / f"pp-update-extract-{os.getpid()}"
        if tmp_extract.exists():
            shutil.rmtree(tmp_extract)
        tmp_extract.mkdir(parents=True)

        decky.logger.info(
            f"plugin_updater: extracting {size} bytes"
            f" to {tmp_extract} | version={version}"
        )
        with zipfile.ZipFile(tmp_path) as zf:
            zf.extractall(tmp_extract)

        # find the top-level dir inside the zip (could be anything)
        extracted_dirs = [d for d in tmp_extract.iterdir() if d.is_dir()]
        if len(extracted_dirs) != 1:
            raise RuntimeError(f"Expected 1 top-level dir in zip, found {len(extracted_dirs)}")

        extracted_dir = extracted_dirs[0]
        plugin_name = os.path.basename(plugin_dir)
        target_path = Path(plugin_parent_dir) / plugin_name

        # rename to match the expected plugin dir name
        final_staging = tmp_extract / plugin_name
        if extracted_dir.name != plugin_name:
            decky.logger.info(
                f"plugin_updater: renaming {extracted_dir.name} -> {plugin_name}"
            )
            extracted_dir.rename(final_staging)
        else:
            final_staging = extracted_dir

        # try to replace the plugin dir. plugins run as deck user but the
        # dir may be root-owned (make deploy uses sudo rsync). try direct
        # replacement first, fall back to sudo, and as a last resort just
        # leave the staging dir for manual swap
        decky.logger.info(
            f"plugin_updater: installing to {target_path}"
        )
        installed = False
        # attempt 1: direct python (works if dir is user-owned)
        try:
            if target_path.exists():
                shutil.rmtree(target_path)
            shutil.move(str(final_staging), str(target_path))
            installed = True
        except PermissionError:
            decky.logger.info("plugin_updater: direct replace failed (root-owned), trying sudo")

        # attempt 2: sudo (works if passwordless sudo is configured)
        if not installed:
            try:
                subprocess.run(["sudo", "-n", "rm", "-rf", str(target_path)], check=True, timeout=10)
                subprocess.run(["sudo", "-n", "mv", str(final_staging), str(target_path)], check=True, timeout=10)
                installed = True
            except (subprocess.CalledProcessError, FileNotFoundError):
                decky.logger.info("plugin_updater: sudo replace failed, trying rsync")

        # attempt 3: rsync over existing dir (preserves what we can)
        if not installed:
            try:
                subprocess.run(
                    ["rsync", "-a", "--delete", str(final_staging) + "/", str(target_path) + "/"],
                    check=True, timeout=30,
                )
                installed = True
            except (subprocess.CalledProcessError, FileNotFoundError):
                decky.logger.warning("plugin_updater: rsync failed too")

        if not installed:
            # last resort: leave the staging dir and give the user a one-liner
            # they can run from the Deck's desktop terminal
            staging_left = str(final_staging)
            decky.logger.error(
                f"plugin_updater: all install methods failed. staged at {staging_left}"
            )
            raise RuntimeError(
                f"Plugin dir is root-owned. Run this on the Deck terminal:\n"
                f"sudo rm -rf {target_path} && sudo mv {staging_left} {target_path} "
                f"&& sudo systemctl restart plugin_loader"
            )

        _set(state="success", stage=None, finished_at=int(time.time()))
        decky.logger.info(
            f"plugin_updater: done | version={version} dest={target_path}"
        )
    except Exception as e:
        _set(state="error", error=str(e), finished_at=int(time.time()))
        decky.logger.error(f"plugin_updater: failed | version={version} error={e}")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        try:
            if tmp_extract.exists():
                shutil.rmtree(tmp_extract, ignore_errors=True)
        except Exception:
            pass
