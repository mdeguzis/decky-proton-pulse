# Decky Proton Pulse — Makefile
# Usage: make <target> [DECK_IP=x.x.x.x make deploy]
#
# DECK_IP can also be set persistently in any of:
#   ~/.deckip         (just the IP: 192.168.1.x)
#   ~/.bashrc / ~/.zshrc / ~/.zshenv  (export DECK_IP=192.168.1.x)

ifneq ($(wildcard $(HOME)/.deckip),)
  DECK_IP ?= $(shell cat $(HOME)/.deckip)
endif

DECK_IP   ?=
DECK_USER ?= deck
DECK_HOST ?= $(if $(DECK_IP),$(DECK_IP),steamdeck)
TARGET    ?= stable
UV_CACHE_DIR ?= /tmp/uv-cache
PROTONDB_REPO_URL ?= https://github.com/bdefore/protondb-data
PROTONDB_PROJECT_REPO_DIR := $(abspath ../protondb-data)
PROTONDB_REPO_DIR ?= $(if $(wildcard $(PROTONDB_PROJECT_REPO_DIR)/.git),$(PROTONDB_PROJECT_REPO_DIR),$(HOME)/src/protondb-data)
PROTONDB_LOCAL_OUTPUT ?= /tmp/proton-pulse-protondb-data
APP_ID ?=
SCREENSHOT_BASE ?=

.PHONY: help build watch test test-ts test-py setup deploy deploy-reload build-and-deploy clean \
        logs get-logs take-screenshot take-video fetch-protondb check-protondb-data logs-loader reload cef-debug-enable live-reload-enable

help:
	@echo "Usage: make <target>"
	@echo "       DECK_IP=x.x.x.x make deploy"
	@echo "       DECK_IP=x.x.x.x DECK_USER=deck TARGET=stable make deploy"
	@echo ""
	@echo "Persistent DECK_IP (pick one):"
	@echo "  echo '192.168.1.x' > ~/.deckip"
	@echo "  echo 'export DECK_IP=192.168.1.x' >> ~/.zshenv"
	@echo ""
	@echo "  build             Clean, test, then build frontend"
	@echo "  watch             Watch frontend for changes (pnpm watch)"
	@echo "  test              Run all tests (Python + TypeScript)"
	@echo "  test-ts           Run TypeScript tests only (vitest)"
	@echo "  test-py           Run Python tests only (pytest via uv)"
	@echo "  setup             Install all dependencies (pnpm + uv)"
	@echo "  deploy            Build and deploy to Steam Deck (requires DECK_IP)"
	@echo "  deploy-reload     Build, deploy, then restart plugin_loader (requires DECK_IP)"
	@echo "  build-and-deploy  Clean, test, build, and deploy (requires DECK_IP)"
	@echo "  clean             Remove build output (dist/)"
	@echo ""
	@echo "On-device debugging (require DECK_IP):"
	@echo "  logs              Follow plugin app log in real time"
	@echo "  get-logs          Sync plugin logs from the Steam Deck into the project root"
	@echo "  take-screenshot   Capture the current Steam UI into ../screenshots/"
	@echo "                    Optional: SCREENSHOT_BASE=my-name make take-screenshot"
	@echo "                    Also copies the saved PNG to the local clipboard when supported."
	@echo "                    Linux tip: install wl-clipboard for Wayland clipboard copy."
	@echo "                    Warning: this may capture private on-screen content such as account, chat, or store UI."
	@echo "  take-video        Record the current Steam UI into ../videos/ until Ctrl+C"
	@echo "                    Optional: SCREENSHOT_BASE=my-name make take-video"
	@echo "                    Note: press Enter to stop and finalize cleanly."
	@echo "  fetch-protondb    Clone or update upstream protondb-data for local inspection"
	@echo "                    Prefers ../protondb-data when present, otherwise uses ~/src/protondb-data"
	@echo "  check-protondb-data  Run the proton-pulse-data splitter against the local upstream repo into /tmp"
	@echo "                    Optional: APP_ID=1145350 make check-protondb-data"
	@echo "  logs-loader       Follow plugin_loader journal in real time"
	@echo "  reload            Restart plugin_loader on the Deck (equivalent to Decky UI reload)"
	@echo "  cef-debug-enable  Enable remote CEF debugging (React DevTools on port 8081)"
	@echo "  live-reload-enable  Configure LIVE_RELOAD=1 on plugin_loader service"

build: clean test
	pnpm build

watch:
	pnpm watch

test: test-py test-ts

test-ts:
	pnpm test

test-py:
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group dev python -m pytest tests/ -v

setup:
	pnpm i
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --group dev

deploy: build
ifndef DECK_IP
	$(error DECK_IP is required: DECK_IP=192.168.1.x make deploy)
endif
	bash scripts/deploy.sh --target $(TARGET) --deck-ip $(DECK_IP) --deck-user $(DECK_USER)

deploy-reload: deploy reload

build-and-deploy: clean test build
ifndef DECK_IP
	$(error DECK_IP is required: DECK_IP=192.168.1.x make build-and-deploy)
endif
	bash scripts/deploy.sh --target $(TARGET) --deck-ip $(DECK_IP) --deck-user $(DECK_USER)

clean:
	rm -rf dist/

# ─── On-device debugging ───────────────────────────────────────────────────────

define require_deck_ip
	$(if $(DECK_IP),,$(error DECK_IP is required: DECK_IP=192.168.1.x make $@))
endef

logs:
	$(call require_deck_ip)
	ssh $(DECK_USER)@$(DECK_IP) "tail -f ~/homebrew/logs/decky-proton-pulse/plugin.log"

get-logs:
	@mkdir -p ../logs
	rsync -rav $(DECK_USER)@$(DECK_HOST):~/homebrew/logs/decky-proton-pulse/ ../logs/
	@cd ../logs && ls -1t *.log 2>/dev/null | grep -v '^plugin-debug\.log$$' | tail -n +20 | xargs -r rm -f

take-screenshot:
	$(call require_deck_ip)
	@echo "Capturing the current Steam UI via CEF remote debugging..."
	@echo "This may include private on-screen content visible on the Steam Deck."
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python scripts/take_cef_screenshot.py --deck-ip $(DECK_IP) --deck-user $(DECK_USER) --output-dir ../screenshots $(if $(SCREENSHOT_BASE),--filename-base $(SCREENSHOT_BASE),)

take-video:
	$(call require_deck_ip)
	@echo "Recording the current Steam UI via the Deck's native gamescope video source..."
	@echo "This may include private on-screen content visible on the Steam Deck."
	@echo "Press Enter in this terminal to stop and process the video cleanly."
	@echo "Ctrl+C may interrupt make before the video finalizes."
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --with aiohttp python scripts/take_cef_video.py --deck-ip $(DECK_IP) --deck-user $(DECK_USER) --output-dir ../videos $(if $(SCREENSHOT_BASE),--filename-base $(SCREENSHOT_BASE),)

fetch-protondb:
	@mkdir -p "$(dir $(PROTONDB_REPO_DIR))"
	@if [ -d "$(PROTONDB_REPO_DIR)/.git" ] && git -C "$(PROTONDB_REPO_DIR)" rev-parse --verify HEAD >/dev/null 2>&1; then \
		echo "Updating $(PROTONDB_REPO_DIR)..."; \
		git -C "$(PROTONDB_REPO_DIR)" sparse-checkout set reports; \
		git -C "$(PROTONDB_REPO_DIR)" pull --rebase; \
	elif [ -e "$(PROTONDB_REPO_DIR)" ]; then \
		echo "Resetting incomplete checkout at $(PROTONDB_REPO_DIR)..."; \
		rm -rf "$(PROTONDB_REPO_DIR)"; \
		echo "Cloning $(PROTONDB_REPO_URL) -> $(PROTONDB_REPO_DIR)"; \
		git clone --depth=1 --filter=blob:none --sparse "$(PROTONDB_REPO_URL)" "$(PROTONDB_REPO_DIR)"; \
		git -C "$(PROTONDB_REPO_DIR)" sparse-checkout set reports; \
	else \
		echo "Cloning $(PROTONDB_REPO_URL) -> $(PROTONDB_REPO_DIR)"; \
		git clone --depth=1 --filter=blob:none --sparse "$(PROTONDB_REPO_URL)" "$(PROTONDB_REPO_DIR)"; \
		git -C "$(PROTONDB_REPO_DIR)" sparse-checkout set reports; \
	fi

check-protondb-data: fetch-protondb
	@mkdir -p "$(PROTONDB_LOCAL_OUTPUT)"
	@OUT_DIR="$$(mktemp -d "$(PROTONDB_LOCAL_OUTPUT).XXXXXX")"; \
		echo "Using upstream repo: $(PROTONDB_REPO_DIR)"; \
		echo "Writing split output to $$OUT_DIR"; \
		UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --with ijson python ../proton-pulse-data/scripts/split_reports.py "$(PROTONDB_REPO_DIR)/reports" "$$OUT_DIR"; \
		if [ -n "$(APP_ID)" ]; then \
			if [ -f "$$OUT_DIR/data/$(APP_ID)/index.json" ]; then \
				echo "Found AppID $(APP_ID) in split output:"; \
				ls -1 "$$OUT_DIR/data/$(APP_ID)"; \
			else \
				echo "AppID $(APP_ID) was not found in split output."; \
			fi; \
		fi

reload:
	@echo "⏱ Reloading Steam Deck decky plugin service..."
	@sleep 2
	$(call require_deck_ip)
	@ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart plugin_loader"

logs-loader:
	$(call require_deck_ip)
	ssh $(DECK_USER)@$(DECK_IP) "journalctl -u plugin_loader -f"

# Enable remote CEF debugging so React DevTools can connect.
# After running: open http://$(DECK_IP):8081 in a Chromium browser on your dev machine,
# or use chrome://inspect → Configure → add $(DECK_IP):8081
cef-debug-enable:
	$(call require_deck_ip)
	ssh $(DECK_USER)@$(DECK_IP) "touch ~/.steam/steam/.cef-enable-remote-debugging"
	ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart steam"
	@echo "CEF debugging enabled. Connect at http://$(DECK_IP):8081 in a Chromium browser."

# Enable LIVE_RELOAD=1 on the plugin_loader service so redeploying dist/index.js
# triggers an automatic frontend reload (close the plugin panel first, then deploy).
live-reload-enable:
	$(call require_deck_ip)
	ssh -tt $(DECK_USER)@$(DECK_IP) \
	  "sudo mkdir -p /etc/systemd/system/plugin_loader.service.d && \
	   echo -e '[Service]\nEnvironment=LIVE_RELOAD=1' | \
	   sudo tee /etc/systemd/system/plugin_loader.service.d/live-reload.conf > /dev/null && \
	   sudo systemctl daemon-reload && \
	   sudo systemctl restart plugin_loader"
	@echo "Live reload enabled. Close the plugin panel, then: make deploy && (plugin auto-reloads)"
