#!/usr/bin/env bash
# scripts/deploy.sh
# Packages and deploys decky-proton-pulse to a connected Steam Deck.
# Usage: bash scripts/deploy.sh --target stable|beta|autobuild [--deck-ip IP]

set -euo pipefail

PLUGIN_NAME="decky-proton-pulse"
TARGET="stable"
DECK_IP="${DECK_IP:-}"
DECK_USER="deck"
DECK_PLUGIN_DIR="/home/deck/homebrew/plugins"

# ─── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)   TARGET="$2";   shift 2 ;;
    --deck-ip)  DECK_IP="$2";  shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ ! "$TARGET" =~ ^(stable|beta|autobuild)$ ]]; then
  echo "ERROR: --target must be stable, beta, or autobuild"
  exit 1
fi

echo "=== Proton Pulse Deploy (target: $TARGET) ==="

# Build
pnpm build

# Package
VERSION=$(node -e "const p=require('./package.json'); process.stdout.write(p.version)")
ZIP_NAME="${PLUGIN_NAME}-v${VERSION}.zip"
STAGING_DIR="/tmp/${PLUGIN_NAME}"

rm -rf "$STAGING_DIR"
mkdir -p "${STAGING_DIR}/${PLUGIN_NAME}/dist"

cp dist/index.js             "${STAGING_DIR}/${PLUGIN_NAME}/dist/"
cp main.py plugin.json LICENSE package.json README.md \
   "${STAGING_DIR}/${PLUGIN_NAME}/"

(cd "$STAGING_DIR" && zip -r "$ZIP_NAME" "$PLUGIN_NAME")
mv "${STAGING_DIR}/${ZIP_NAME}" .

echo "✓ Packaged: ${ZIP_NAME}"

# Deploy via SCP if DECK_IP is set
if [[ -n "$DECK_IP" ]]; then
  echo "Deploying to Steam Deck at $DECK_IP..."
  ssh "${DECK_USER}@${DECK_IP}" "mkdir -p ${DECK_PLUGIN_DIR}/${PLUGIN_NAME}"
  scp -r "${STAGING_DIR}/${PLUGIN_NAME}/." \
    "${DECK_USER}@${DECK_IP}:${DECK_PLUGIN_DIR}/${PLUGIN_NAME}/"
  echo "✓ Deployed. Restart Decky Loader on your Deck to reload the plugin."
else
  echo "DECK_IP not set — skipping SCP. Set it with: export DECK_IP=192.168.x.x"
fi

rm -rf "$STAGING_DIR"
echo "=== Done ==="
