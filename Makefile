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
TARGET    ?= stable

.PHONY: help build watch test test-ts test-py setup deploy deploy-reload build-and-deploy clean \
        logs logs-loader reload cef-debug-enable live-reload-enable

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
	uv run pytest tests/ -v

setup:
	pnpm i
	uv sync

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
	$(call require_deck_ip)
	ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart plugin_loader"

clean:
	rm -rf dist/

# ─── On-device debugging ───────────────────────────────────────────────────────

define require_deck_ip
	$(if $(DECK_IP),,$(error DECK_IP is required: DECK_IP=192.168.1.x make $@))
endef

logs:
	$(call require_deck_ip)
	ssh $(DECK_USER)@$(DECK_IP) "tail -f ~/homebrew/logs/decky-proton-pulse/plugin.log"

reload:
	$(call require_deck_ip)
	ssh -tt $(DECK_USER)@$(DECK_IP) "sudo systemctl restart plugin_loader"

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
