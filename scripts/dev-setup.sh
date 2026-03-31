#!/usr/bin/env bash
# scripts/dev-setup.sh
# Quick dev environment setup for decky-proton-pulse
# Based on: https://github.com/SteamDeckHomebrew/decky-plugin-template

set -euo pipefail

REQUIRED_NODE_MAJOR=16
REQUIRED_PNPM_MAJOR=9

echo "=== Proton Pulse Dev Setup ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install v${REQUIRED_NODE_MAJOR}+ from https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "ERROR: Node.js v${NODE_MAJOR} found, need v${REQUIRED_NODE_MAJOR}+."
  exit 1
fi
echo "✓ Node.js $(node --version)"

# Check pnpm
if ! command -v pnpm &>/dev/null; then
  echo "pnpm not found — installing via npm..."
  npm i -g pnpm@9
fi
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [ "$PNPM_MAJOR" -lt "$REQUIRED_PNPM_MAJOR" ]; then
  echo "WARNING: pnpm v${PNPM_MAJOR} found, need v${REQUIRED_PNPM_MAJOR}. Run: npm i -g pnpm@9"
fi
echo "✓ pnpm $(pnpm --version)"

# Install dependencies
echo "Installing dependencies..."
pnpm i

# Build
echo "Building plugin..."
pnpm build

echo ""
echo "=== Build complete ==="
echo ""
echo "To deploy to your Steam Deck (set DECK_IP first):"
echo "  export DECK_IP=192.168.1.x"
echo "  bash scripts/deploy.sh --target stable"
