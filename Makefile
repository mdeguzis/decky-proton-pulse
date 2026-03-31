# Decky Proton Pulse — Makefile
# Usage: make <target> [DECK_IP=192.168.1.x] [DECK_USER=deck] [TARGET=stable]

DECK_IP   ?=
DECK_USER ?= deck
TARGET    ?= stable

.PHONY: help build watch test test-ts test-py setup deploy clean

help:
	@echo "Usage: make <target> [DECK_IP=x.x.x.x] [DECK_USER=deck] [TARGET=stable]"
	@echo ""
	@echo "  build      Build frontend (pnpm build)"
	@echo "  watch      Watch frontend for changes (pnpm watch)"
	@echo "  test       Run all tests (Python + TypeScript)"
	@echo "  test-ts    Run TypeScript tests only (vitest)"
	@echo "  test-py    Run Python tests only (pytest via uv)"
	@echo "  setup      Install all dependencies (pnpm + uv)"
	@echo "  deploy     Build and deploy to Steam Deck (requires DECK_IP)"
	@echo "  clean      Remove build output (dist/)"

build:
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
	$(error DECK_IP is required: make deploy DECK_IP=192.168.1.x)
endif
	bash scripts/deploy.sh --target $(TARGET) --deck-ip $(DECK_IP) --deck-user $(DECK_USER)

clean:
	rm -rf dist/
