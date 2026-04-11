#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:?repo dir required}"
output_prefix="${2:?output prefix required}"
uv_cache_dir="${3:?uv cache dir required}"
app_id="${4:-}"

mkdir -p "$output_prefix"
out_dir="$(mktemp -d "${output_prefix}.XXXXXX")"

echo "Using upstream repo: $repo_dir"
echo "Writing split output to $out_dir"
UV_CACHE_DIR="$uv_cache_dir" uv run --with ijson python ../proton-pulse-data/scripts/split_reports.py "$repo_dir/reports" "$out_dir"

if [[ -n "$app_id" ]]; then
  if [[ -f "$out_dir/data/$app_id/index.json" ]]; then
    echo "Found AppID $app_id in split output:"
    ls -1 "$out_dir/data/$app_id"
  else
    echo "AppID $app_id was not found in split output."
  fi
fi
