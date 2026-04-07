"""Backend helper for writing metrics JSON to disk.

The frontend collects perf metrics (fetch timings, cache hit rates, etc)
in-memory and periodically flushes them here via the export_metrics
callable. Files land in ~/.config/decky-proton-pulse/metrics/ with
timestamped filenames so you can graph them over time.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import decky  # type: ignore[import-untyped]  # pylint: disable=import-error

logger = logging.getLogger("proton-pulse")

METRICS_DIR_NAME = "metrics"
MAX_METRICS_FILES = 50  # keep the last N dumps, prune older ones


def _metrics_dir() -> Path:
    base = Path(decky.DECKY_USER_HOME) / ".config" / "decky-proton-pulse"
    metrics = base / METRICS_DIR_NAME
    metrics.mkdir(parents=True, exist_ok=True)
    return metrics


def _prune_old_files(directory: Path, keep: int = MAX_METRICS_FILES) -> int:
    """Remove oldest metric files if we have more than `keep`."""
    files = sorted(directory.glob("metrics-*.json"), key=lambda p: p.stat().st_mtime)
    if len(files) <= keep:
        return 0
    to_remove = files[: len(files) - keep]
    for f in to_remove:
        try:
            f.unlink()
        except OSError:
            pass
    return len(to_remove)


def export_metrics_to_disk(data: str) -> bool:
    """Write metrics JSON payload from the frontend to a timestamped file.

    Returns True on success, False on failure.
    """
    try:
        # validate that the data is actually JSON
        parsed = json.loads(data)

        out_dir = _metrics_dir()
        ts = time.strftime("%Y%m%d-%H%M%S")
        out_file = out_dir / f"metrics-{ts}.json"

        out_file.write_text(json.dumps(parsed, indent=2) + "\n")
        logger.info("Metrics exported to %s", out_file)

        pruned = _prune_old_files(out_dir)
        if pruned:
            logger.debug("Pruned %d old metrics files", pruned)

        return True
    except (json.JSONDecodeError, OSError, ValueError) as err:
        logger.error("Failed to export metrics: %s", err)
        return False
