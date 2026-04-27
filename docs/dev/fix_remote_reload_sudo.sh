#!/usr/bin/env bash
set -euo pipefail

# Corrective helper for Decky remote reloads.
# Run this on the Steam Deck as the normal `deck` user.
#
# It installs a narrowly scoped sudoers rule so `make reload` can run:
#   sudo -n /usr/bin/systemctl restart plugin_loader
#
# Why the `zz-` prefix?
# Some systems load later sudoers snippets that can override earlier rules.
# Keeping this file late in sort order makes the NOPASSWD rule more reliable.

if [[ "${USER:-}" != "deck" ]]; then
  echo "error: run this script on the Deck as the 'deck' user." >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "error: sudo is required." >&2
  exit 1
fi

SYSTEMCTL_PATH="$(command -v systemctl || true)"
if [[ -z "${SYSTEMCTL_PATH}" ]]; then
  echo "error: could not locate systemctl." >&2
  exit 1
fi

echo "Detected systemctl at: ${SYSTEMCTL_PATH}"

if ! systemctl list-unit-files plugin_loader.service >/dev/null 2>&1; then
  echo "warning: plugin_loader.service was not found in systemctl unit files." >&2
  echo "The sudoers rule can still be installed, but reload verification may fail." >&2
fi

SUDOERS_FILE="/etc/sudoers.d/zz-decky-plugin-loader"
SUDOERS_LINE="deck ALL=(root) NOPASSWD: ${SYSTEMCTL_PATH} restart plugin_loader, ${SYSTEMCTL_PATH} restart plugin_loader.service, ${SYSTEMCTL_PATH} status plugin_loader, ${SYSTEMCTL_PATH} status plugin_loader.service"

echo "Installing sudoers rule at ${SUDOERS_FILE}"
printf '%s\n' "${SUDOERS_LINE}" | sudo tee "${SUDOERS_FILE}" >/dev/null
sudo chmod 440 "${SUDOERS_FILE}"

echo "Validating sudoers file..."
sudo visudo -cf "${SUDOERS_FILE}"

echo "Clearing cached sudo timestamp to force a real NOPASSWD check..."
sudo -k

echo "Testing non-interactive status..."
if sudo -n "${SYSTEMCTL_PATH}" status plugin_loader >/dev/null; then
  echo "ok: passwordless status check works."
else
  echo "error: passwordless status check still failed." >&2
  echo "Run 'sudo -l' and inspect any later sudoers rules that may override this one." >&2
  exit 1
fi

echo "Testing non-interactive restart..."
if sudo -n "${SYSTEMCTL_PATH}" restart plugin_loader; then
  echo "ok: passwordless restart works."
else
  echo "error: passwordless restart still failed." >&2
  exit 1
fi

echo
echo "Deck-side setup complete."
echo "Remote verification from your dev machine:"
echo "  ssh deck@<deck-ip> \"sudo -n ${SYSTEMCTL_PATH} status plugin_loader >/dev/null && echo ok\""
echo "  ssh deck@<deck-ip> \"sudo -n ${SYSTEMCTL_PATH} restart plugin_loader && echo ok\""
