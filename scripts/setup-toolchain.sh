#!/usr/bin/env bash
# scripts/setup-toolchain.sh
# Detects the host environment and installs the toolchain needed to build
# decky-proton-pulse (Node 24, Python 3.11, uv, pnpm).
#
# Supported environments:
#   - Termux (Android)  — uses pkg for base tools, pip for uv
#   - Modern Linux / Steam Deck    — uses mise
#   - Old glibc (< 2.28, e.g. AL2) — tries mise first, falls back to Linuxbrew
#
# Usage:
#   bash scripts/setup-toolchain.sh          # install toolchain
#   bash scripts/setup-toolchain.sh --env    # print PATH exports only (for eval)

set -euo pipefail

BREW_NODE_DIR="/home/linuxbrew/.linuxbrew/opt/node@24/bin"

# ─── Helpers ───────────────────────────────────────────────────────────────────

is_termux() { [[ "${PREFIX:-}" == *com.termux* ]]; }

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    echo "mise already installed: $(command -v mise)"
  else
    echo "Installing mise via https://mise.run ..."
    curl https://mise.run | sh
  fi
  local mise_bin
  mise_bin="$(command -v mise 2>/dev/null || echo "$HOME/.local/bin/mise")"
  "$mise_bin" --version
}

ensure_brew_node() {
  if [[ -x "$BREW_NODE_DIR/node" ]]; then
    echo "Linuxbrew node@24 already installed: $("$BREW_NODE_DIR/node" --version)"
    return
  fi
  if ! command -v /home/linuxbrew/.linuxbrew/bin/brew >/dev/null 2>&1; then
    echo "Installing Linuxbrew ..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  echo "Installing node@24 via brew ..."
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)" && brew install node@24
}

mise_install() {
  local mise_bin
  mise_bin="$(command -v mise 2>/dev/null || echo "$HOME/.local/bin/mise")"
  if [[ ! -f mise.toml ]]; then
    echo "No mise.toml found; skipping mise toolchain install."
    return
  fi
  "$mise_bin" trust --yes mise.toml >/dev/null 2>&1 || "$mise_bin" trust mise.toml

  # Try mise install for everything first
  if "$mise_bin" install 2>/dev/null; then
    return
  fi

  echo "mise install failed — checking if node 24 needs a brew fallback ..."

  # mise failed; install non-node tools individually
  "$mise_bin" install python 2>/dev/null || true
  "$mise_bin" install uv 2>/dev/null || true

  # Fall back to brew for node if mise couldn't provide it
  if ! "$mise_bin" where node >/dev/null 2>&1; then
    echo "mise could not install node 24. Falling back to Linuxbrew."
    ensure_brew_node
  fi
}

# ─── --env mode: just print PATH exports for Makefile eval ─────────────────────

if [[ "${1:-}" == "--env" ]]; then
  if [[ -x "$BREW_NODE_DIR/node" ]]; then
    echo "BREW_NODE_PATH=$BREW_NODE_DIR"
  fi
  exit 0
fi

# ─── Main ──────────────────────────────────────────────────────────────────────

echo "=== Proton Pulse Toolchain Setup ==="

if is_termux; then
  echo "Termux detected via PREFIX=$PREFIX"
  echo "Installing Termux base packages with pkg ..."
  pkg update -y && pkg install -y bash ca-certificates curl git make nodejs-lts python openssh rsync unzip xz-utils
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm
  echo "Termux: using pkg-installed Node/Python."
  echo "  node=$(node --version 2>/dev/null || echo missing)"
  echo "  python=$(python3 --version 2>/dev/null || echo missing)"
  if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv via pip ..."
    python -m pip install --user uv
  fi
  echo "  uv=$(uv --version 2>/dev/null || echo missing)"
  exit 0
fi

ensure_mise

mise_install

echo ""
echo "Toolchain ready."
echo "  node=$(node --version 2>/dev/null || echo missing)"
echo "  python=$(python3 --version 2>/dev/null || echo missing)"
echo "  uv=$(uv --version 2>/dev/null || echo missing)"
