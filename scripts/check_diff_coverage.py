#!/usr/bin/env python3
"""Enforce diff coverage for changed lines against a base git branch."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = "origin/main"
DEFAULT_MINIMUM = 95
REPORTS = [
    ROOT / "coverage" / "python" / "coverage.xml",
    ROOT / "coverage" / "ts" / "cobertura-coverage.xml",
]


def run(cmd: list[str], *, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=False,
        text=True,
        cwd=ROOT,
        capture_output=capture_output,
    )


def main() -> int:
    compare_branch = os.environ.get("DIFF_COVERAGE_BASE", DEFAULT_BASE).strip() or DEFAULT_BASE
    minimum = int(os.environ.get("DIFF_COVERAGE_MIN", str(DEFAULT_MINIMUM)))

    missing_reports = [str(path) for path in REPORTS if not path.exists()]
    if missing_reports:
        print("Diff coverage reports are missing:", file=sys.stderr)
        for path in missing_reports:
            print(f"  - {path}", file=sys.stderr)
        print("Run the normal coverage collection first.", file=sys.stderr)
        return 1

    base_check = run(["git", "rev-parse", "--verify", compare_branch], capture_output=True)
    if base_check.returncode != 0:
        if os.environ.get("CI"):
            print(
                f"Diff coverage base branch was not found: {compare_branch}",
                file=sys.stderr,
            )
            return 1
        print(
            f"Skipping diff coverage because base branch was not found locally: {compare_branch}",
            file=sys.stderr,
        )
        return 0

    diff_check = run(["git", "diff", "--quiet", f"{compare_branch}...HEAD", "--", "."])
    if diff_check.returncode == 0:
        print(f"No changed lines relative to {compare_branch}; diff coverage passes.")
        return 0

    command = [
        "diff-cover",
        *(str(path) for path in REPORTS),
        f"--compare-branch={compare_branch}",
        f"--fail-under={minimum}",
    ]
    result = run(command)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
