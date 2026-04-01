#!/usr/bin/env python3
"""
split_reports.py — split a bdefore/protondb-data monthly dump into
per-game JSON files suitable for GitHub Pages delivery.

Usage:
    python split_reports.py <dump.tar.gz> <output_dir>

Output:
    <output_dir>/data/<appId>.json   — one file per game, minified
    <output_dir>/index.json          — metadata (game count, last updated)

Field mapping (bdefore → output):
    responses.protonVersion  → pv
    responses.verdict        → v   (yes/no)
    systemInfo.gpu           → gpu
    systemInfo.gpuDriver     → drv
    systemInfo.os            → os
    timestamp                → ts
"""

import argparse
import gzip
import json
import os
import sys
import tarfile
from collections import defaultdict
from datetime import datetime, timezone


# Minimum number of reports a game must have to get its own file.
# Keeps the dataset focused on games with actionable community data.
MIN_REPORTS = 3


def strip_record(record: dict) -> dict | None:
    """Extract only the fields Proton Pulse needs from a raw bdefore record."""
    try:
        responses = record.get("responses", {})
        system    = record.get("systemInfo", {})
        ts        = record.get("timestamp")

        pv      = responses.get("protonVersion", "").strip()
        verdict = responses.get("verdict", "").strip()
        gpu     = system.get("gpu", "").strip()
        drv     = system.get("gpuDriver", "").strip()
        os_str  = system.get("os", "").strip()

        # Drop records with no usable proton version or verdict
        if not pv or not verdict or not ts:
            return None

        return {"pv": pv, "v": verdict, "gpu": gpu, "drv": drv, "os": os_str, "ts": int(ts)}
    except Exception:
        return None


def get_app_id(record: dict) -> str | None:
    """Extract Steam appId from a bdefore record (may be int or str)."""
    try:
        return str(record["app"]["steam"]["appId"])
    except (KeyError, TypeError):
        return None


def process_dump(dump_path: str, output_dir: str) -> None:
    data_dir = os.path.join(output_dir, "data")
    os.makedirs(data_dir, exist_ok=True)

    print(f"Opening dump: {dump_path}", flush=True)

    # ── stream-parse the dump ──────────────────────────────────────────────────
    # bdefore packs a single reports_piiremoved.json inside a .tar.gz.
    # The file is ~2 GB uncompressed so we stream-parse line-by-line rather
    # than loading it all into memory.
    games: dict[str, list[dict]] = defaultdict(list)
    total_raw = 0
    total_kept = 0

    opener = gzip.open if dump_path.endswith(".gz") else open

    # ijson would be ideal but isn't guaranteed in CI.  Instead we use the fact
    # that bdefore's JSON is pretty-printed with each record starting on a line
    # that begins with "  {" and ending on "  }".  We collect lines per record
    # and parse each one independently — tolerant and memory-efficient.
    with tarfile.open(dump_path, "r:gz") as tf:
        member = next((m for m in tf.getmembers() if m.name.endswith(".json")), None)
        if member is None:
            print("ERROR: no .json file found in tar archive", file=sys.stderr)
            sys.exit(1)

        print(f"Streaming: {member.name} ({member.size / 1e9:.2f} GB uncompressed)", flush=True)
        fobj = tf.extractfile(member)

        buf: list[bytes] = []
        depth = 0
        in_record = False

        for raw_line in fobj:
            line = raw_line.decode("utf-8", errors="replace")
            stripped = line.strip()

            if not in_record:
                if stripped == "{":
                    in_record = True
                    depth = 1
                    buf = [line]
                continue

            buf.append(line)
            depth += stripped.count("{") - stripped.count("}")

            if depth <= 0:
                in_record = False
                total_raw += 1
                try:
                    record = json.loads("".join(buf))
                except json.JSONDecodeError:
                    buf = []
                    continue

                buf = []
                app_id = get_app_id(record)
                if app_id is None:
                    continue

                stripped_rec = strip_record(record)
                if stripped_rec:
                    games[app_id].append(stripped_rec)
                    total_kept += 1

                if total_raw % 50000 == 0:
                    print(f"  processed {total_raw:,} records, kept {total_kept:,} …", flush=True)

    print(f"Done streaming: {total_raw:,} records, {total_kept:,} kept, {len(games):,} games", flush=True)

    # ── write per-game files ───────────────────────────────────────────────────
    written = 0
    skipped = 0
    for app_id, reports in games.items():
        if len(reports) < MIN_REPORTS:
            skipped += 1
            continue
        # Sort newest-first so callers can take [:N] for the most recent reports
        reports.sort(key=lambda r: r["ts"], reverse=True)
        path = os.path.join(data_dir, f"{app_id}.json")
        with open(path, "w") as f:
            json.dump(reports, f, separators=(",", ":"))
        written += 1

    print(f"Wrote {written:,} game files (skipped {skipped:,} with < {MIN_REPORTS} reports)", flush=True)

    # ── write index ────────────────────────────────────────────────────────────
    index = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":  "bdefore/protondb-data",
        "games":   written,
        "min_reports": MIN_REPORTS,
    }
    index_path = os.path.join(output_dir, "index.json")
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
    print(f"Index written: {index_path}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dump",       help="Path to the bdefore .tar.gz dump file")
    parser.add_argument("output_dir", help="Directory to write output files into")
    args = parser.parse_args()

    if not os.path.exists(args.dump):
        print(f"ERROR: dump not found: {args.dump}", file=sys.stderr)
        sys.exit(1)

    process_dump(args.dump, args.output_dir)


if __name__ == "__main__":
    main()
