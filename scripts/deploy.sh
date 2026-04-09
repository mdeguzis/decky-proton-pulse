#!/usr/bin/env bash
# scripts/deploy.sh
# Packages and deploys decky-proton-pulse.
# Handles: local packaging, Deck deployment, GitHub releases, and store submissions.
#
# Usage: bash scripts/deploy.sh [options]
#
# Options:
#   -t, --target   stable|beta|autobuild  (default: stable)
#   -i, --deck-ip  IP address of the Steam Deck
#   -u, --deck-user  SSH user on the Deck  (default: deck)
#   --skip-build   Reuse an existing dist/ build instead of rebuilding
#   --release      Create a GitHub release and prep a store submission
#   --prerelease   Create a GitHub pre-release and prep a store submission
#   --store-submit          Prep store submission for latest release tag
#   --store-submit-prerelease  Prep store submission for latest commit
#   -h, --help     Show this help message

set -euo pipefail

PLUGIN_NAME="decky-proton-pulse"
TARGET="stable"
DECK_IP=""
DECK_USER="deck"
DECK_PLUGIN_DIR="/home/deck/homebrew/plugins"
SKIP_BUILD=0
GH_RELEASE=""
STORE_MODE=""

# ─── Helpers ───────────────────────────────────────────────────────────────────

banner() {
  echo ""
  echo "========================================================================"
  echo "  $1"
  echo "========================================================================"
  echo ""
}

usage() {
  grep '^#' "$0" | grep -v '#!/' | sed 's/^# \{0,1\}//'
  exit 0
}

# ─── Args ──────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    -t|--target)    TARGET="$2";    shift 2 ;;
    -i|--deck-ip)   DECK_IP="$2";   shift 2 ;;
    -u|--deck-user) DECK_USER="$2"; shift 2 ;;
    --skip-build)   SKIP_BUILD=1;   shift ;;
    --release)      GH_RELEASE="release"; STORE_MODE="release"; shift ;;
    --prerelease)   GH_RELEASE="prerelease"; STORE_MODE="prerelease"; shift ;;
    --store-submit) STORE_MODE="release"; shift ;;
    --store-submit-prerelease) STORE_MODE="prerelease"; shift ;;
    -h|--help)      usage ;;
    *) echo "Unknown arg: $1  (use -h for help)"; exit 1 ;;
  esac
done

if [[ ! "$TARGET" =~ ^(stable|beta|autobuild)$ ]]; then
  echo "ERROR: --target must be stable, beta, or autobuild"
  exit 1
fi

VERSION=$(tr -d '[:space:]' < VERSION)
RELEASE_TAG="v${VERSION}"
ZIP_NAME="${PLUGIN_NAME}-v${VERSION}.zip"

# ─── Build ─────────────────────────────────────────────────────────────────────

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  echo "Skipping build (reusing existing dist/)"
else
  banner "Building"
  pnpm build
fi

# ─── Package ───────────────────────────────────────────────────────────────────

banner "Packaging ${ZIP_NAME}"

STAGING_DIR="/tmp/${PLUGIN_NAME}"
rm -rf "$STAGING_DIR"
mkdir -p "${STAGING_DIR}/${PLUGIN_NAME}/dist"

cp dist/index.js             "${STAGING_DIR}/${PLUGIN_NAME}/dist/"
cp main.py plugin.json LICENSE package.json README.md \
   "${STAGING_DIR}/${PLUGIN_NAME}/"

if [[ -d lib ]]; then
  rsync -a --exclude='__pycache__' lib/ "${STAGING_DIR}/${PLUGIN_NAME}/lib/"
fi

(cd "$STAGING_DIR" && zip -r "$ZIP_NAME" "$PLUGIN_NAME")
mv "${STAGING_DIR}/${ZIP_NAME}" .

echo "Done: ${ZIP_NAME}"

# ─── Deploy to Deck ───────────────────────────────────────────────────────────

if [[ -n "$DECK_IP" ]]; then
  banner "Deploying to Steam Deck ($DECK_IP)"

  REMOTE_PLUGIN_DIR="${DECK_PLUGIN_DIR}/${PLUGIN_NAME}"
  if ssh "${DECK_USER}@${DECK_IP}" "sudo -n mkdir -p ${REMOTE_PLUGIN_DIR}"; then
    rsync -rlptz --delete --omit-dir-times --chown=root:root \
      --rsync-path="sudo -n rsync" \
      "${STAGING_DIR}/${PLUGIN_NAME}/" \
      "${DECK_USER}@${DECK_IP}:${REMOTE_PLUGIN_DIR}/"
    echo "Done: deployed with root-owned files."
  else
    echo "WARNING: remote sudo mkdir failed, falling back to user-owned deploy."
    echo "For root-owned files, run this once on the Deck:"
    echo "  echo 'deck ALL=(root) NOPASSWD: /usr/bin/mkdir -p ${REMOTE_PLUGIN_DIR}, /usr/bin/rsync' | sudo tee /etc/sudoers.d/plugin-deploy"
    ssh "${DECK_USER}@${DECK_IP}" "mkdir -p ${REMOTE_PLUGIN_DIR}"
    rsync -rlptz --delete --omit-dir-times \
      "${STAGING_DIR}/${PLUGIN_NAME}/" \
      "${DECK_USER}@${DECK_IP}:${REMOTE_PLUGIN_DIR}/"
    echo "Done: deployed with user-owned files."
  fi
  echo "Restart Decky Loader on your Deck to reload the plugin."
fi

# ─── GitHub Release ────────────────────────────────────────────────────────────

if [[ -n "$GH_RELEASE" ]]; then
  banner "GitHub Release (${GH_RELEASE})"

  NOTES_FILE="/tmp/decky-proton-pulse-release-notes-${VERSION}.md"
  node scripts/release-notes.mjs > "$NOTES_FILE"

  GH_ARGS=(
    gh release create "$RELEASE_TAG" "./${ZIP_NAME}"
    --repo mdeguzis/decky-proton-pulse
    --title "Proton Pulse ${RELEASE_TAG}"
    --notes-file "$NOTES_FILE"
  )
  [[ "$GH_RELEASE" == "prerelease" ]] && GH_ARGS+=(--prerelease)

  # If the tag already exists, skip creating and just upload the asset
  if gh release view "$RELEASE_TAG" --repo mdeguzis/decky-proton-pulse &>/dev/null; then
    echo "Release $RELEASE_TAG already exists -- uploading asset only."
    gh release upload "$RELEASE_TAG" "./${ZIP_NAME}" --repo mdeguzis/decky-proton-pulse --clobber
  else
    "${GH_ARGS[@]}"
  fi

  echo "Done: https://github.com/mdeguzis/decky-proton-pulse/releases/tag/${RELEASE_TAG}"
fi

# ─── Store Submission ──────────────────────────────────────────────────────────

if [[ -n "$STORE_MODE" ]]; then
  banner "Decky Plugin Database (${STORE_MODE})"

  PLUGIN_DB_DIR="$HOME/decky-plugin-database-plugin-mdg"
  PLUGIN_DB_ORIGIN="git@github.com:mdeguzis/decky-plugin-database.git"
  PLUGIN_DB_UPSTREAM="https://github.com/SteamDeckHomebrew/decky-plugin-database.git"
  SUBMODULE="plugins/decky-proton-pulse"

  # Clone if needed
  if [[ ! -d "$PLUGIN_DB_DIR/.git" ]]; then
    echo "Cloning plugin database fork..."
    git clone "$PLUGIN_DB_ORIGIN" "$PLUGIN_DB_DIR"
  fi
  git -C "$PLUGIN_DB_DIR" remote add upstream "$PLUGIN_DB_UPSTREAM" 2>/dev/null || true

  # Sync fork with upstream
  echo "Syncing fork with upstream..."
  git -C "$PLUGIN_DB_DIR" fetch upstream
  git -C "$PLUGIN_DB_DIR" checkout main
  git -C "$PLUGIN_DB_DIR" reset --hard upstream/main
  git -C "$PLUGIN_DB_DIR" push origin main --force

  # Determine target commit and branch name
  if [[ "$STORE_MODE" == "release" ]]; then
    TAG=$(git -P tag -l 'v*' --sort=-v:refname | head -1)
    if [[ -z "$TAG" ]]; then
      echo "ERROR: No release tags found."
      exit 1
    fi
    COMMIT=$(git rev-parse "$TAG")
    BRANCH="update/decky-proton-pulse-${TAG}"
    MSG="Update decky-proton-pulse to ${TAG}"
    echo "Target: release tag $TAG ($COMMIT)"
  else
    COMMIT=$(git rev-parse HEAD)
    SHORT=$(git rev-parse --short HEAD)
    BRANCH="update/decky-proton-pulse-pre-${SHORT}"
    MSG="Update decky-proton-pulse to pre-release ${SHORT}"
    echo "Target: latest commit $SHORT ($COMMIT)"
  fi

  # Create branch and update submodule
  cd "$PLUGIN_DB_DIR"
  git checkout -B "$BRANCH"
  if [[ ! -d "$SUBMODULE" ]]; then
    git submodule add git@github.com:mdeguzis/decky-proton-pulse.git "$SUBMODULE"
  fi
  git -C "$SUBMODULE" fetch origin
  git -C "$SUBMODULE" checkout "$COMMIT"
  git add "$SUBMODULE"
  git commit -m "$MSG"

  echo ""
  echo "Done: branch '$BRANCH' ready at $PLUGIN_DB_DIR"
  echo ""
  echo "Next steps:"
  echo "  cd $PLUGIN_DB_DIR && git push origin $BRANCH"
  echo "  Open PR: https://github.com/SteamDeckHomebrew/decky-plugin-database/pulls"
fi

# ─── Cleanup ───────────────────────────────────────────────────────────────────

rm -rf "$STAGING_DIR"
