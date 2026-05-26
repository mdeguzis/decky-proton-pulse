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
      "latest"      - latest main branch commit (always "has update")
    """
    try:
        if channel == "latest":
            # grab the latest commit SHA from the GitHub API
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
                "channel": channel,
            }

        if channel == "pre-release":
            # grab first release from the list (includes prereleases)
            releases = curl_json(
                _ALL_RELEASES_URL,
                headers=["Accept: application/vnd.github.v3+json"],
                timeout=15,
            )
            data = releases[0] if releases else {}
        else:
            # stable release only
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
            "channel": channel,
        }
    except Exception as e:
        decky.logger.error(f"check_for_update({channel}): failed: {e}")
        return {"success": False, "error": str(e), "current_version": current_version}


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
    tmp_path = Path(f"/tmp/pp-update-{version}.zip")

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
        tmp_extract = Path(f"/tmp/pp-update-extract-{os.getpid()}")
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

        # use sudo to replace the plugin dir (it's root-owned on SteamOS)
        decky.logger.info(
            f"plugin_updater: installing to {target_path} (sudo)"
        )
        subprocess.run(
            ["sudo", "rm", "-rf", str(target_path)],
            check=True, timeout=10,
        )
        subprocess.run(
            ["sudo", "mv", str(final_staging), str(target_path)],
            check=True, timeout=10,
        )
        subprocess.run(
            ["sudo", "chown", "-R", "root:root", str(target_path)],
            check=False, timeout=10,
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
