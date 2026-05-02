#!/usr/bin/env bash
set -euo pipefail

DECK_IP="${DECK_IP:-}"
DECK_USER="${DECK_USER:-deck}"
REMOTE_PLUGIN_DIR="${REMOTE_PLUGIN_DIR:-/home/${DECK_USER}/homebrew/plugins/decky-proton-pulse}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUDOERS_TEMPLATE="${REPO_ROOT}/config/remote-dev-sudoers.template"
REMOTE_SUDOERS_PATH="/etc/sudoers.d/zz-proton-pulse-remote-dev"
LEGACY_SUDOERS_PATH="/etc/sudoers.d/proton-pulse-remote-dev"

if [[ -z "${DECK_IP}" ]]; then
  echo "setup_remote_dev.sh requires DECK_IP."
  exit 1
fi

if [[ ! -f "${SUDOERS_TEMPLATE}" ]]; then
  echo "Missing sudoers template: ${SUDOERS_TEMPLATE}"
  exit 1
fi

sudoers_tmp="$(mktemp)"
trap 'rm -f "${sudoers_tmp}"' EXIT

sed \
  -e "s|@DECK_USER@|${DECK_USER}|g" \
  -e "s|@REMOTE_PLUGIN_DIR@|${REMOTE_PLUGIN_DIR}|g" \
  "${SUDOERS_TEMPLATE}" > "${sudoers_tmp}"

ssh "${DECK_USER}@${DECK_IP}" "mkdir -p /tmp/proton-pulse-remote-dev"
scp "${sudoers_tmp}" "${DECK_USER}@${DECK_IP}:/tmp/proton-pulse-remote-dev/remote-dev.sudoers" >/dev/null

ssh -tt "${DECK_USER}@${DECK_IP}" "\
  mkdir -p ~/.steam/steam && \
  touch ~/.steam/steam/.cef-enable-remote-debugging && \
  printf '[Service]\nEnvironment=LIVE_RELOAD=1\n' > /tmp/proton-pulse-live-reload.conf && \
  sudo rm -f ${LEGACY_SUDOERS_PATH} && \
  sudo install -m 440 /tmp/proton-pulse-remote-dev/remote-dev.sudoers ${REMOTE_SUDOERS_PATH} && \
  sudo visudo -cf ${REMOTE_SUDOERS_PATH} && \
  sudo mkdir -p /etc/systemd/system/plugin_loader.service.d && \
  sudo install -D -m 644 /tmp/proton-pulse-live-reload.conf /etc/systemd/system/plugin_loader.service.d/live-reload.conf && \
  sudo systemctl daemon-reload && \
  sudo systemctl restart plugin_loader"

echo "Remote Deck dev helpers configured on ${DECK_USER}@${DECK_IP}."
echo "Passwordless sudo should now work for deploy/reload helpers and cef-debug-enable."
