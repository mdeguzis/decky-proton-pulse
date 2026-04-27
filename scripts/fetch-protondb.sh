#!/usr/bin/env bash
set -euo pipefail

repo_url="${1:?repo url required}"
repo_dir="${2:?repo dir required}"

mkdir -p "$(dirname "$repo_dir")"

if [[ -d "$repo_dir/.git" ]] && git -C "$repo_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Updating $repo_dir..."
  git -C "$repo_dir" sparse-checkout set reports
  git -C "$repo_dir" pull --rebase
elif [[ -e "$repo_dir" ]]; then
  echo "Resetting incomplete checkout at $repo_dir..."
  rm -rf "$repo_dir"
  echo "Cloning $repo_url -> $repo_dir"
  git clone --depth=1 --filter=blob:none --sparse "$repo_url" "$repo_dir"
  git -C "$repo_dir" sparse-checkout set reports
else
  echo "Cloning $repo_url -> $repo_dir"
  git clone --depth=1 --filter=blob:none --sparse "$repo_url" "$repo_dir"
  git -C "$repo_dir" sparse-checkout set reports
fi
