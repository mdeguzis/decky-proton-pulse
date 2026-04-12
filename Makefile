# Decky Proton Pulse — Makefile
#
# Remote vs local mode:
#   When DECK_IP is set, device targets (deploy, logs, get-logs, etc.) run
#   against the remote Deck over SSH. When unset, they run locally.
#
# Setting DECK_IP (pick one):
#   DECK_IP=192.168.1.x make deploy      (one-off)
#   echo '192.168.1.x' > ~/.deckip       (persistent via file)
#   export DECK_IP=192.168.1.x           (persistent via shell env)
#
# Switching back to local mode:
#   unset DECK_IP                         (current shell)
#   rm ~/.deckip                          (remove persistent file)
#   DECK_IP=local make <target>           (force local for one command)

ifneq ($(wildcard $(HOME)/.deckip),)
  DECK_IP ?= $(shell cat $(HOME)/.deckip)
endif

DECK_IP   ?=
DECK_USER ?= deck

# DECK_IP=local is a shortcut to force local mode
ifeq ($(DECK_IP),local)
  override DECK_IP :=
endif

DECK_HOST ?= $(if $(DECK_IP),$(DECK_IP),steamdeck)
TARGET    ?= stable
DRY_RUN ?= true
IS_TERMUX := $(if $(findstring com.termux,$(PREFIX)),1,)
ifeq ($(IS_TERMUX),1)
UV_CACHE_DIR ?= $(if $(TMPDIR),$(TMPDIR)/uv-cache,$(HOME)/.cache/uv)
else
UV_CACHE_DIR ?= /tmp/uv-cache
endif
export UV_CACHE_DIR
PROTONDB_REPO_URL ?= https://github.com/bdefore/protondb-data
PROTONDB_PROJECT_REPO_DIR := $(abspath ../protondb-data)
PROTONDB_REPO_DIR ?= $(if $(wildcard $(PROTONDB_PROJECT_REPO_DIR)/.git),$(PROTONDB_PROJECT_REPO_DIR),$(HOME)/src/protondb-data)
PROTONDB_LOCAL_OUTPUT ?= /tmp/proton-pulse-protondb-data
APP_ID ?=
SCREENSHOT_BASE ?=
SCREENSHOT_GROUP ?=
SCREENSHOT_KEY ?=
SCREENSHOT_TITLE ?=
SCREENSHOT_CAPTION ?=
SCREENSHOT_MATCH ?=
SCREENSHOT_MANIFEST ?= config/ui_screenshot_manifest.json
SCREENSHOT_TARGET ?=
PNPM := $(shell command -v pnpm 2>/dev/null || echo "npx --yes pnpm")

.PHONY: default help build install watch test coverage coverage-diff test-ts test-py typecheck check-translations check-ui-strings translate setup setup-termux-ssh ensure-mise deploy deploy-reload build-and-deploy clean \
        logs get-logs take-screenshot take-video publish-screenshots-wiki take-screenshot-wiki \
        package release pre-release github-release github-pre-release \
        capture-project-screenshots \
        fetch-protondb check-protondb-data logs-loader reload cef-debug-enable live-reload-enable

default: build

help:
	@echo "================ usage ================ "
	@echo "Usage: make <target>"
	@echo "       DECK_IP=192.168.1.x make deploy     (remote Deck)"
	@echo "       DECK_IP=local make get-logs          (force local mode)"
	@echo ""
	@echo "DECK_IP controls remote vs local mode."
	@echo "When set, device targets run against the remote Deck over SSH."
	@echo ""
	@echo "Set DECK_IP persistently (pick one):"
	@echo "  echo '192.168.1.x' > ~/.deckip"
	@echo "  export DECK_IP=192.168.1.x"
	@echo ""
	@echo "Switch back to local: unset DECK_IP, rm ~/.deckip, or pass DECK_IP=local"
	@echo ""
	@echo "============= main targets ============= "
	@printf "  %-27s %s\n" "build" "Clean, test, then build frontend"
	@printf "  %-27s %s\n" "install" "Install plugin files into a local Decky plugin directory"
	@printf "  %-27s %s\n" "watch" "Watch frontend for changes (pnpm watch)"
	@printf "  %-27s %s\n" "test" "Run all tests, print a per-language coverage table, and enforce minimums"
	@printf "  %-27s %s\n" "coverage" "Run both coverage suites and fail below the enforced minimums"
	@printf "  %-27s %s\n" "coverage-diff" "Fail if changed lines drop below the diff coverage minimum"
	@printf "  %-27s %s\n" "check-translations" "Enforce translation coverage and refresh coverage metrics"
	@printf "  %-27s %s\n" "check-ui-strings" "Scan UI sources for likely hardcoded English strings"
	@printf "  %-27s %s\n" "translate" "Alias for check-translations"
	@printf "  %-27s %s\n" "typecheck" "Run strict pyright type checking on all Python code"
	@printf "  %-27s %s\n" "test-ts" "Run TypeScript tests only (vitest)"
	@printf "  %-27s %s\n" "test-py" "Run Python tests only (pytest via uv)"
	@printf "  %-27s %s\n" "setup" "Install mise (if missing), runtime toolchains, and dependencies"
	@printf "  %-27s %s\n" "" "Termux: uses pkg for base tools and keeps uv cache out of /tmp"
	@printf "  %-27s %s\n" "setup-termux-ssh" "Install and start sshd on Termux (port 8022)"
	@printf "  %-27s %s\n" "" "Sets password, generates host keys, prints connect instructions"
	@printf "  %-27s %s\n" "deploy" "Build and deploy to Steam Deck (requires DECK_IP)"
	@printf "  %-27s %s\n" "deploy-reload" "Build, deploy, then restart plugin_loader (requires DECK_IP)"
	@printf "  %-27s %s\n" "build-and-deploy" "Clean, test, build, and deploy (requires DECK_IP)"
	@printf "  %-27s %s\n" "package" "Build and create the local release zip for the current VERSION"
	@printf "  %-27s %s\n" "release" "Build, package, and prepare a GitHub release using CHANGELOG.md notes"
	@printf "  %-27s %s\n" "" "Safe by default: DRY_RUN=true (set DRY_RUN=false for live changes)"
	@printf "  %-27s %s\n" "pre-release" "Build, package, and prepare a GitHub pre-release using CHANGELOG.md notes"
	@printf "  %-27s %s\n" "" "Safe by default: DRY_RUN=true (set DRY_RUN=false for live changes)"
	@printf "  %-27s %s\n" "github-release" "GitHub-only release flow (no Decky database submission)"
	@printf "  %-27s %s\n" "" "Safe by default: DRY_RUN=true (set DRY_RUN=false for live changes)"
	@printf "  %-27s %s\n" "github-pre-release" "GitHub-only pre-release flow (no Decky database submission)"
	@printf "  %-27s %s\n" "" "Safe by default: DRY_RUN=true (set DRY_RUN=false for live changes)"
	@printf "  %-27s %s\n" "clean" "Remove build output (dist/) and generated release archives"
	@echo ""
	@echo "============= device targets ============= "
	@echo "On-device debugging (require DECK_IP):"
	@printf "  %-27s %s\n" "logs" "Follow plugin app log in real time"
	@printf "  %-27s %s\n" "get-logs" "Sync plugin logs from the Steam Deck into the project root"
	@printf "  %-27s %s\n" "take-screenshot" "Capture the current Steam UI into ../screenshots/"
	@printf "  %-27s %s\n" "" "Optional: SCREENSHOT_BASE=my-name make take-screenshot"
	@printf "  %-27s %s\n" "" "Optional catalog metadata: SCREENSHOT_GROUP=manage-game SCREENSHOT_KEY=default"
	@printf "  %-27s %s\n" "" "Optional language gallery: LANG=cn (also supports SCREENSHOT_LANGUAGE=...)"
	@printf "  %-27s %s\n" "take-screenshot-wiki" "Capture and register a grouped wiki screenshot"
	@printf "  %-27s %s\n" "" "Required: SCREENSHOT_GROUP=... SCREENSHOT_KEY=..."
	@printf "  %-27s %s\n" "" "Optional: SCREENSHOT_TITLE='Manage Game default' SCREENSHOT_CAPTION='...'"
	@printf "  %-27s %s\n" "capture-project-screenshots" "Zero-prompt batch capture for the screenshot manifest"
	@printf "  %-27s %s\n" "" "Uses --auto and captures each manifest step without prompting"
	@printf "  %-27s %s\n" "" "Optional: SCREENSHOT_MATCH=manage-game to limit the run"
	@printf "  %-27s %s\n" "" "Optional language gallery: LANG=cn or LANG=all (also supports SCREENSHOT_LANGUAGE=...)"
	@printf "  %-27s %s\n" "" "Optional review target: SCREENSHOT_TARGET=../screenshots/review or SCREENSHOT_TARGET=gist"
	@printf "  %-27s %s\n" "publish-screenshots-wiki" "Copy catalogued screenshots into ../decky-proton-pulse.wiki"
	@printf "  %-27s %s\n" "" "Also copies the saved PNG to the local clipboard when supported."
	@printf "  %-27s %s\n" "" "Linux tip: install wl-clipboard for Wayland clipboard copy."
	@printf "  %-27s %s\n" "" "Warning: this may capture private on-screen content such as account, chat, or store UI."
	@printf "  %-27s %s\n" "take-video" "Record the current Steam UI into ../videos/ until Ctrl+C"
	@printf "  %-27s %s\n" "" "Optional: SCREENSHOT_BASE=my-name make take-video"
	@printf "  %-27s %s\n" "" "Note: press Enter to stop and finalize cleanly."
	@printf "  %-27s %s\n" "fetch-protondb" "Clone or update upstream protondb-data for local inspection"
	@printf "  %-27s %s\n" "" "Prefers ../protondb-data when present, otherwise uses ~/src/protondb-data"
	@printf "  %-27s %s\n" "check-protondb-data" "Run the proton-pulse-data splitter against the local upstream repo into /tmp"
	@printf "  %-27s %s\n" "" "Optional: APP_ID=1145350 make check-protondb-data"
	@printf "  %-27s %s\n" "logs-loader" "Follow plugin_loader journal in real time"
	@printf "  %-27s %s\n" "reload" "Restart plugin_loader locally, or on the Deck when DECK_IP is set"
	@printf "  %-27s %s\n" "cef-debug-enable" "Enable remote CEF debugging (React DevTools on port 8081)"
	@printf "  %-27s %s\n" "live-reload-enable" "Configure LIVE_RELOAD=1 on plugin_loader service"

build: clean test
	$(PNPM) build
	@echo ""
	@echo "Build complete."
	@echo "Next steps:"
	@echo "  Local install: make install"
	@echo "  Deck deploy:   DECK_IP=192.168.1.x make deploy"

install: build
	@REAL_HOME="$$(cd ~ && pwd -P)"; \
	LOCAL_DIR="$${LOCAL_DECKY_PLUGIN_DIR:-$$REAL_HOME/homebrew/plugins}"; \
	TARGET_DIR="$${LOCAL_DIR}/decky-proton-pulse"; \
	USE_SUDO=""; \
	if [ ! -d "$$LOCAL_DIR" ]; then \
		echo "Decky Loader plugin directory not found: $$LOCAL_DIR"; \
		echo "Install Decky Loader first, or set LOCAL_DECKY_PLUGIN_DIR to your plugin path."; \
		echo ""; \
		echo "Stable install command:"; \
		echo "  curl -L https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh | sh"; \
		echo ""; \
		echo "Pre-release install command:"; \
		echo "  curl -L https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_prerelease.sh | sh"; \
		exit 1; \
	fi; \
	if { [ ! -w "$$LOCAL_DIR" ] && [ ! -d "$$TARGET_DIR" ]; } || { [ -d "$$TARGET_DIR" ] && [ ! -w "$$TARGET_DIR" ]; }; then \
		if ! command -v sudo >/dev/null 2>&1; then \
			echo "Decky Loader plugin directory needs elevated permissions, but sudo is not available."; \
			echo "Plugin root: $$LOCAL_DIR"; \
			echo "Target dir:  $$TARGET_DIR"; \
			exit 1; \
		fi; \
		USE_SUDO="sudo"; \
		echo "Installing into root-owned Decky plugin directory with sudo: $$TARGET_DIR"; \
	fi; \
	echo "Installing plugin into $$TARGET_DIR"; \
	$$USE_SUDO mkdir -p "$$TARGET_DIR/dist"; \
	$$USE_SUDO cp dist/index.js "$$TARGET_DIR/dist/"; \
	$$USE_SUDO cp main.py plugin.json package.json LICENSE "$$TARGET_DIR/"; \
	$$USE_SUDO rsync -a --delete --exclude='__pycache__' lib/ "$$TARGET_DIR/lib/"
	@echo "Installed. Restart Decky/plugin_loader if needed."

watch:
	$(PNPM) watch

test: coverage

coverage: node_modules
	$(PNPM) run coverage:check
	$(PNPM) run coverage:summary
	$(PNPM) run coverage:badges

coverage-diff: node_modules
	$(PNPM) run coverage:check
	$(PNPM) run coverage:diff

check-translations: node_modules
	$(PNPM) run sync-version
	$(PNPM) run check-translations

check-ui-strings: node_modules
	$(PNPM) run check-ui-strings

translate: check-translations

node_modules: package.json
	$(PNPM) i

test-ts: node_modules
	$(PNPM) test

typecheck:
	npx pyright
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m mypy

test-py:
	npx pyright
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m mypy
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m pylint main.py lib/
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m pytest tests/ -v

ensure-mise:
	@if [ -n "$(IS_TERMUX)" ]; then \
		echo "Termux detected via PREFIX=$$PREFIX"; \
		echo "Installing Termux base packages with pkg ..."; \
		pkg update -y && pkg install -y bash ca-certificates curl git make nodejs-lts python openssh rsync unzip xz-utils; \
		echo "Termux: skipping mise (Android linker cant run it)."; \
		echo "Using pkg-installed toolchain: node=$$(node --version 2>/dev/null || echo missing), python=$$(python3 --version 2>/dev/null || echo missing)"; \
		if ! command -v uv >/dev/null 2>&1; then \
			echo "Installing uv via pip ..."; \
			pip install uv; \
		fi; \
		echo "uv=$$(uv --version 2>/dev/null || echo missing)"; \
		exit 0; \
	fi
	@if command -v mise >/dev/null 2>&1; then \
		echo "mise already installed: $$(command -v mise)"; \
	else \
		echo "Installing mise via https://mise.run ..."; \
		curl https://mise.run | sh; \
	fi
	@MISE_BIN="$$(command -v mise 2>/dev/null || echo "$$HOME/.local/bin/mise")"; \
	"$$MISE_BIN" --version

setup: ensure-mise
	@mkdir -p "$(UV_CACHE_DIR)"
	@echo "Using UV_CACHE_DIR=$(UV_CACHE_DIR)"
	@if [ -z "$(IS_TERMUX)" ] && [ -f mise.toml ]; then \
		MISE_BIN="$$(command -v mise 2>/dev/null || echo "$$HOME/.local/bin/mise")"; \
		"$$MISE_BIN" trust --yes mise.toml >/dev/null 2>&1 || "$$MISE_BIN" trust mise.toml; \
		"$$MISE_BIN" install || echo "Warning: mise install failed (likely offline). Continuing with currently installed toolchain."; \
	elif [ -z "$(IS_TERMUX)" ]; then \
		echo "No mise.toml found; skipping mise toolchain install."; \
	fi
	$(PNPM) i
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --group dev

# Set up SSH server on Termux so you can connect from a desktop/laptop.
# Termux sshd runs on port 8022 (not 22) since Android doesn't allow
# binding to privileged ports without root.
# Ref: https://wiki.termux.com/wiki/Remote_Access
setup-termux-ssh:
	@if [ -z "$(IS_TERMUX)" ]; then \
		echo "This target is only for Termux. Skipping."; \
		exit 0; \
	fi
	@echo "=== Termux SSH setup ==="
	pkg install -y openssh
	@# generate host keys if they dont exist yet
	@if [ ! -f "$$PREFIX/etc/ssh/ssh_host_rsa_key" ]; then \
		echo "Generating SSH host keys ..."; \
		ssh-keygen -A; \
	else \
		echo "Host keys already exist, skipping keygen."; \
	fi
	@# set a password so password auth works (Termux has no default password)
	@echo ""
	@echo "Set a login password for sshd (you'll need this to connect):"
	@passwd
	@echo ""
	@echo "Starting sshd on port 8022 ..."
	@sshd
	@echo ""
	@# grab the local IP and username so the user knows where to connect
	@TERM_IP=$$(ip -4 addr show wlan0 2>/dev/null | grep -oP 'inet \K[\d.]+' || echo "<unknown>"); \
	TERM_USER=$$(whoami); \
	echo "=== SSH is running ==="; \
	echo ""; \
	echo "Your Termux username is: $$TERM_USER"; \
	echo "  (This is auto-generated by Android and cant be changed.)"; \
	echo ""; \
	echo "Connect from your desktop/laptop with:"; \
	echo "  ssh -p 8022 $$TERM_USER@$$TERM_IP"; \
	echo ""; \
	echo "To copy your public key (no password prompts after this):"; \
	echo "  ssh-copy-id -p 8022 $$TERM_USER@$$TERM_IP"; \
	echo ""; \
	echo "Tip: add this to ~/.ssh/config on your desktop to avoid"; \
	echo "typing the username and port every time:"; \
	echo ""; \
	echo "  Host termux"; \
	echo "    HostName $$TERM_IP"; \
	echo "    User $$TERM_USER"; \
	echo "    Port 8022"; \
	echo ""; \
	echo "Then just: ssh termux"; \
	echo ""; \
	echo "To stop sshd later: pkill sshd"; \
	echo "To auto-start on Termux boot, add 'sshd' to ~/.bashrc"

deploy: build
	bash scripts/deploy.sh --skip-build --target $(TARGET) $(if $(DECK_IP),--deck-ip $(DECK_IP),) --deck-user $(DECK_USER)

deploy-reload: deploy reload

build-and-deploy: clean test build
	bash scripts/deploy.sh --skip-build --target $(TARGET) $(if $(DECK_IP),--deck-ip $(DECK_IP),) --deck-user $(DECK_USER)

package: build
	bash scripts/deploy.sh --skip-build

$(RELEASE_NOTES_FILE): CHANGELOG.md VERSION scripts/release-notes.mjs
	node scripts/release-notes.mjs > $(RELEASE_NOTES_FILE)

release: package
	DRY_RUN=$(DRY_RUN) bash scripts/deploy.sh --skip-build --release

pre-release: package
	DRY_RUN=$(DRY_RUN) bash scripts/deploy.sh --skip-build --prerelease

github-release: package
	DRY_RUN=$(DRY_RUN) bash scripts/deploy.sh --skip-build --github-release

github-pre-release: package
	DRY_RUN=$(DRY_RUN) bash scripts/deploy.sh --skip-build --github-prerelease

clean:
	rm -rf dist/
	rm -f ./*.zip ./*.tar.gz

# ─── On-device debugging ───────────────────────────────────────────────────────

define require_deck_ip
	$(if $(DECK_IP),,$(error DECK_IP is required: DECK_IP=192.168.1.x make $@))
endef

# print which mode we're running in so it's obvious in the output
define show_mode
	@if [ -n "$(DECK_IP)" ]; then \
		echo "[remote] DECK_IP=$(DECK_IP) DECK_USER=$(DECK_USER)"; \
	else \
		echo "[local] no DECK_IP set, running locally (pass DECK_IP=x.x.x.x for remote)"; \
	fi
endef

logs:
	$(call show_mode)
	@if [ -n "$(DECK_IP)" ]; then \
		ssh $(DECK_USER)@$(DECK_IP) "tail -f ~/homebrew/logs/decky-proton-pulse/plugin.log"; \
	else \
		tail -f $$HOME/homebrew/logs/decky-proton-pulse/plugin.log; \
	fi

get-logs:
	$(call show_mode)
	@mkdir -p ../logs
	@if [ -n "$(DECK_IP)" ]; then \
		rsync -rav $(DECK_USER)@$(DECK_HOST):~/homebrew/logs/decky-proton-pulse/ ../logs/; \
	else \
		rsync -rav $$HOME/homebrew/logs/decky-proton-pulse/ ../logs/; \
	fi
	@cd ../logs && ls -1t *.log 2>/dev/null | grep -v '^plugin-debug\.log$$' | tail -n +20 | xargs -r rm -f

take-screenshot:
	@echo "Capturing the current Steam UI via CEF remote debugging..."
	@echo "This may include private on-screen content visible on the Steam UI."
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/take_cef_screenshot.py $(if $(DECK_IP),--deck-ip $(DECK_IP) --deck-user $(DECK_USER),) --output-dir ../screenshots $(if $(SCREENSHOT_LANGUAGE),--language $(SCREENSHOT_LANGUAGE),) $(if $(SCREENSHOT_BASE),--filename-base $(SCREENSHOT_BASE),) $(if $(SCREENSHOT_GROUP),--group $(SCREENSHOT_GROUP),) $(if $(SCREENSHOT_KEY),--shot-key $(SCREENSHOT_KEY),) $(if $(SCREENSHOT_TITLE),--title "$(SCREENSHOT_TITLE)",) $(if $(SCREENSHOT_CAPTION),--caption "$(SCREENSHOT_CAPTION)",)

take-screenshot-wiki:
	$(call require_deck_ip)
ifndef SCREENSHOT_GROUP
	$(error SCREENSHOT_GROUP is required: SCREENSHOT_GROUP=manage-game make take-screenshot-wiki)
endif
ifndef SCREENSHOT_KEY
	$(error SCREENSHOT_KEY is required: SCREENSHOT_KEY=default make take-screenshot-wiki)
endif
	@$(MAKE) take-screenshot SCREENSHOT_GROUP="$(SCREENSHOT_GROUP)" SCREENSHOT_KEY="$(SCREENSHOT_KEY)" SCREENSHOT_TITLE="$(SCREENSHOT_TITLE)" SCREENSHOT_CAPTION="$(SCREENSHOT_CAPTION)" SCREENSHOT_BASE="$(if $(SCREENSHOT_BASE),$(SCREENSHOT_BASE),$(SCREENSHOT_KEY))"
	@$(MAKE) publish-screenshots-wiki

capture-project-screenshots:
	@if [ -n "$(DECK_IP)" ]; then \
		UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/capture_project_screenshots.py --deck-ip $(DECK_IP) --deck-user $(DECK_USER) --manifest $(SCREENSHOT_MANIFEST) --match "$(SCREENSHOT_MATCH)" --auto --output-dir ../screenshots --wiki-dir ../decky-proton-pulse.wiki --language $(if $(SCREENSHOT_LANGUAGE),$(SCREENSHOT_LANGUAGE),$(if $(LANG),$(LANG),en)) $(if $(SCREENSHOT_TARGET),--target "$(SCREENSHOT_TARGET)",); \
	else \
		echo "No DECK_IP set; capturing local review screenshots"; \
		UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/capture_project_screenshots.py --manifest $(SCREENSHOT_MANIFEST) --match "$(SCREENSHOT_MATCH)" --auto --output-dir ../screenshots/review --skip-publish --language $(if $(SCREENSHOT_LANGUAGE),$(SCREENSHOT_LANGUAGE),$(if $(LANG),$(LANG),en)) $(if $(SCREENSHOT_TARGET),--target "$(SCREENSHOT_TARGET)",); \
	fi

publish-screenshots-wiki:
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/publish_screenshots_to_wiki.py --screenshots-dir ../screenshots --wiki-dir ../decky-proton-pulse.wiki

take-video:
	@echo "Recording the current Steam UI via the Deck's native gamescope video source..."
	@echo "This may include private on-screen content visible on the Steam UI."
	@echo "Press Enter in this terminal to stop and process the video cleanly."
	@echo "Ctrl+C may interrupt make before the video finalizes."
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --with aiohttp python scripts/take_cef_video.py $(if $(DECK_IP),--deck-ip $(DECK_IP) --deck-user $(DECK_USER),) --output-dir ../videos $(if $(SCREENSHOT_BASE),--filename-base $(SCREENSHOT_BASE),)

fetch-protondb:
	bash scripts/fetch-protondb.sh "$(PROTONDB_REPO_URL)" "$(PROTONDB_REPO_DIR)"

check-protondb-data: fetch-protondb
	bash scripts/check-protondb-data.sh "$(PROTONDB_REPO_DIR)" "$(PROTONDB_LOCAL_OUTPUT)" "$(UV_CACHE_DIR)" "$(APP_ID)"

reload:
	$(call show_mode)
	@echo "Reloading Decky plugin service..."
	@sleep 2
	@if [ -n "$(DECK_IP)" ]; then \
		echo "Reloading remote plugin_loader on $(DECK_USER)@$(DECK_IP)"; \
		ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart plugin_loader"; \
	elif systemctl list-unit-files plugin_loader.service >/dev/null 2>&1; then \
		echo "Reloading local plugin_loader service"; \
		if systemctl is-active --quiet plugin_loader.service 2>/dev/null || systemctl status plugin_loader.service >/dev/null 2>&1; then \
			if systemctl restart plugin_loader.service >/dev/null 2>&1; then \
				echo "Local plugin_loader restarted."; \
			elif command -v sudo >/dev/null 2>&1; then \
				sudo systemctl restart plugin_loader.service; \
				echo "Local plugin_loader restarted with sudo."; \
			else \
				echo "plugin_loader.service exists locally but requires elevated permissions to restart."; \
				exit 1; \
			fi; \
		else \
			echo "plugin_loader.service exists locally but does not appear to be available to restart."; \
			exit 1; \
		fi; \
	else \
		echo "No local plugin_loader.service found and DECK_IP is not set."; \
		echo "Use make reload DECK_IP=192.168.1.x for a remote Deck reload."; \
		exit 1; \
	fi

logs-loader:
	@if [ -n "$(DECK_IP)" ]; then \
		ssh $(DECK_USER)@$(DECK_IP) "journalctl -u plugin_loader -f"; \
	else \
		journalctl -u plugin_loader -f; \
	fi

# Enable remote CEF debugging so React DevTools can connect.
# After running: open http://$(DECK_IP):8081 in a Chromium browser on your dev machine,
# or use chrome://inspect → Configure → add $(DECK_IP):8081
cef-debug-enable:
	@if [ -n "$(DECK_IP)" ]; then \
		ssh $(DECK_USER)@$(DECK_IP) "touch ~/.steam/steam/.cef-enable-remote-debugging"; \
		ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart steam"; \
		echo "CEF debugging enabled. Connect at http://$(DECK_IP):8081 in a Chromium browser."; \
	else \
		touch $$HOME/.steam/steam/.cef-enable-remote-debugging; \
		if systemctl restart steam >/dev/null 2>&1; then \
			echo "CEF debugging enabled locally. Connect at http://localhost:8081 in a Chromium browser."; \
		else \
			sudo systemctl restart steam; \
			echo "CEF debugging enabled locally. Connect at http://localhost:8081 in a Chromium browser."; \
		fi; \
	fi

# Enable LIVE_RELOAD=1 on the plugin_loader service so redeploying dist/index.js
# triggers an automatic frontend reload (close the plugin panel first, then deploy).
live-reload-enable:
	@if [ -n "$(DECK_IP)" ]; then \
		ssh -tt $(DECK_USER)@$(DECK_IP) \
		  "sudo mkdir -p /etc/systemd/system/plugin_loader.service.d && \
		   echo -e '[Service]\nEnvironment=LIVE_RELOAD=1' | \
		   sudo tee /etc/systemd/system/plugin_loader.service.d/live-reload.conf > /dev/null && \
		   sudo systemctl daemon-reload && \
		   sudo systemctl restart plugin_loader"; \
	else \
		if systemctl daemon-reload >/dev/null 2>&1; then \
			sudo mkdir -p /etc/systemd/system/plugin_loader.service.d; \
			printf '[Service]\nEnvironment=LIVE_RELOAD=1\n' | sudo tee /etc/systemd/system/plugin_loader.service.d/live-reload.conf >/dev/null; \
			sudo systemctl daemon-reload; \
			sudo systemctl restart plugin_loader; \
		else \
			sudo mkdir -p /etc/systemd/system/plugin_loader.service.d; \
			printf '[Service]\nEnvironment=LIVE_RELOAD=1\n' | sudo tee /etc/systemd/system/plugin_loader.service.d/live-reload.conf >/dev/null; \
			sudo systemctl daemon-reload; \
			sudo systemctl restart plugin_loader; \
		fi; \
	fi
	@echo "Live reload enabled. Close the plugin panel, then: make deploy && (plugin auto-reloads)"
