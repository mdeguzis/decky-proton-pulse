#!/usr/bin/env bash
# scripts/setup_remote_deps.sh
# Make sure the remote target has the python packages we ssh-pipe into it.
#
# Right now the only remote dep is aiohttp, used by
# scripts/take_cef_screenshot.py to talk to Chromium's CEF DevTools
# websocket. SteamOS holo ships aiohttp in its system python so the deck
# just works out of the box, but Bazzite (Fedora Atomic), ChimeraOS, and
# generic Linux usually dont, so probe and install on demand.
#
# pip --user lands stuff in ~/.local, which works on read-only ostree
# distros like Bazzite without rpm-ostree layering or a reboot.
#
# Usage:
#   DECK_IP=192.168.1.x DECK_USER=gamer bash scripts/setup_remote_deps.sh
set -euo pipefail

DECK_IP="${DECK_IP:-}"
DECK_USER="${DECK_USER:-deck}"

if [[ -z "${DECK_IP}" ]]; then
  echo "setup_remote_deps.sh requires DECK_IP."
  exit 1
fi

ssh_target="${DECK_USER}@${DECK_IP}"

# narrate what host this is so a multi-device dev (deck + bazzite + ...)
# can tell which one we're poking. ID and ID_LIKE come from os-release.
remote_os="$(ssh -o BatchMode=yes "${ssh_target}" '
  if [ -r /etc/os-release ]; then
    . /etc/os-release
    printf "%s (%s)" "${PRETTY_NAME:-${ID:-unknown}}" "${ID_LIKE:-no-id_like}"
  else
    printf "unknown (no /etc/os-release)"
  fi
' 2>/dev/null || echo "unknown (ssh probe failed)")"

echo "Remote target: ${ssh_target}"
echo "Remote OS:     ${remote_os}"

# Probe before installing. If aiohttp is already importable, don't touch
# the remote, saves a pointless pip run on the deck.
echo "Checking remote python deps ..."
ssh "${ssh_target}" 'bash -s' <<'REMOTE_EOF'
set -euo pipefail

if python3 -c "import aiohttp" 2>/dev/null; then
  ver="$(python3 -c 'import aiohttp; print(aiohttp.__version__)')"
  echo "  aiohttp already present (${ver}), skipping install"
  exit 0
fi

echo "  aiohttp missing, installing into ~/.local ..."

# ensurepip is a no-op on systems that already have pip, but on a fresh
# Bazzite gamer user pip itself may not be there yet
python3 -m ensurepip --user >/dev/null 2>&1 || true

# Fedora-derived distros enforce PEP 668 even for --user installs in some
# python builds, so retry with --break-system-packages. That flag only
# changes pip's willingness to install, not where files end up. Still
# ~/.local/lib/pythonX.Y/site-packages either way.
if ! python3 -m pip install --user --quiet aiohttp 2>/dev/null; then
  python3 -m pip install --user --quiet --break-system-packages aiohttp
fi

ver="$(python3 -c 'import aiohttp; print(aiohttp.__version__)')"
echo "  aiohttp installed (${ver})"
REMOTE_EOF

echo "Remote python deps ready on ${ssh_target}."
