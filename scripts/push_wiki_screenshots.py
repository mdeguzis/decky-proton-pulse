#!/usr/bin/env python3
"""Commit and push screenshot changes in the wiki repo after user confirmation."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from git import GitCommandError, InvalidGitRepositoryError, Repo


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Commit and push wiki screenshot changes (prompts for confirmation)."
    )
    parser.add_argument(
        "--wiki-dir",
        default="../decky-proton-pulse.wiki",
        help="Path to the wiki git repo",
    )
    parser.add_argument(
        "--message",
        default="chore: update screenshots",
        help="Commit message",
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Skip confirmation prompt",
    )
    args = parser.parse_args()

    wiki_path = Path(args.wiki_dir).resolve()
    if not wiki_path.is_dir():
        print(f"ERROR: wiki dir not found: {wiki_path}", file=sys.stderr)
        return 1

    try:
        repo = Repo(wiki_path)
    except InvalidGitRepositoryError:
        print(f"ERROR: not a git repo: {wiki_path}", file=sys.stderr)
        return 1

    # Configure identity
    with repo.config_writer() as cfg:
        cfg.set_value("user", "name", "mdeguzis")
        cfg.set_value("user", "email", "mdeguzis@gmail.com")

    # Fetch and rebase onto remote to ensure we're up to date
    print("Fetching remote...")
    try:
        origin = repo.remotes.origin
        origin.fetch()
        active = repo.active_branch
        tracking = active.tracking_branch()
        if tracking:
            print(f"Rebasing {active.name} onto {tracking}...")
            repo.git.rebase(str(tracking))
    except GitCommandError as exc:
        print(f"ERROR: fetch/rebase failed: {exc}", file=sys.stderr)
        return 1

    # Check for dirty working tree (untracked or modified)
    if repo.is_dirty(untracked_files=True):
        changed_files = [item.a_path for item in repo.index.diff(None)]
        untracked = repo.untracked_files
        all_changed = changed_files + list(untracked)
        print("Changes to be committed in wiki repo:")
        for f in all_changed:
            print(f"  {f}")
        print()
    else:
        print("Wiki repo has no changes — nothing to push.")
        return 0

    if not args.yes:
        answer = input("Push these changes to the wiki? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Aborted.")
            return 0

    try:
        repo.git.add(A=True)
        repo.index.commit(args.message)
        origin.push()
    except GitCommandError as exc:
        print(f"ERROR: commit/push failed: {exc}", file=sys.stderr)
        return 1

    print("Wiki screenshots pushed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
