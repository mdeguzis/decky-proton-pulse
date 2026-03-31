#!/usr/bin/env bash
# scripts/deploy.sh
# Packages and deploys decky-proton-pulse to a connected Steam Deck.
# Usage: bash scripts/deploy.sh [options]
#
# Options:
#   -t, --target   stable|beta|autobuild  (default: stable)
#   -i, --deck-ip  IP address of the Steam Deck
#   -u, --deck-user  SSH user on the Deck  (default: deck)
#   -h, --help     Show this help message

set -euo pipefail

PLUGIN_NAME="decky-proton-pulse"
TARGET="stable"
DECK_IP=""
DECK_USER="deck"
DECK_PLUGIN_DIR="/home/deck/homebrew/plugins"

usage() {
  grep '^#' "$0" | grep -v '#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

# ─── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -t|--target)    TARGET="$2";    shift 2 ;;
    -i|--deck-ip)   DECK_IP="$2";   shift 2 ;;
    -u|--deck-user) DECK_USER="$2"; shift 2 ;;
    -h|--help)      usage ;;
    *) echo "Unknown arg: $1  (use -h for help)"; exit 1 ;;
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
  echo "No --deck-ip provided — skipping SCP."
fi

rm -rf "$STAGING_DIR"
echo "=== Done ==="
