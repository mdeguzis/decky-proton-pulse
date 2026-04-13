# Decky Proton Pulse

| Autobuild | Status |
|---|---|
| Ubuntu | [![Ubuntu Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/autobuild.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/autobuild.yml) |
| Debian | [![Debian Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-debian.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-debian.yml) |
| Arch Linux | [![Arch Linux Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-arch.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-arch.yml) |
| Bazzite | [![Bazzite Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-bazzite.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-bazzite.yml) |
| Termux | [![Termux Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-termux.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-termux.yml) |

[![Python Coverage](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/python-coverage.json&cacheSeconds=300)](https://mdeguzis.github.io/decky-proton-pulse/)
[![TypeScript Coverage](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/ts-coverage.json&cacheSeconds=300)](https://mdeguzis.github.io/decky-proton-pulse/)

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for Steam Deck that pulls [ProtonDB](https://www.protondb.com) reports for the game in front of you, scores them against your hardware, and lets you apply useful launch options without typing them by hand.

Coverage policy: overall Python and TypeScript coverage must stay at or above `90%`, and pull requests must keep changed-line coverage at `95%` or higher.

## Screenshots

see: [UI screenshot gallery](https://github.com/mdeguzis/decky-proton-pulse/wiki/UI-Screenshot-Gallery)

---

## Acknowledgments & Credits

Proton Pulse would not exist without the open-source projects below. Parts of this plugin were borrowed from them directly, and plenty more was shaped by their ideas and prior work.

| Project | Author | License |
|---|---|---|
| [ProtonDB Badges (protondb-decky)](https://github.com/OMGDuke/protondb-decky) | OMGDuke | — |
| [Decky Proton Launch](https://github.com/moi952/decky-proton-launch) | moi952 | — |
| [Wine Cellar (decky-wine-cellar)](https://github.com/FlashyReese/decky-wine-cellar) | FlashyReese | MIT |
| [SteamGridDB Decky Plugin (decky-steamgriddb)](https://github.com/SteamGridDB/decky-steamgriddb) | SteamGridDB | GPL-3.0-or-later |

If you find Proton Pulse useful, please consider starring or contributing to these upstream projects as well.

---

## AI-Assisted Development

This plugin was built with the help of AI coding tools. I use these for brainstorming, wiring up tricky parts, chasing down bugs, and knocking out boilerplate code. I review, test, and rework everything that comes out the other end before it goes anywhere.

Every change still has to pass the same bar: strict typing in both TypeScript and Python, linting, unit tests, and hands-on smoke testing on a real Steam Deck. 

---

## What it does

Getting Proton launch options right usually means opening ProtonDB, reading a pile of reports, guessing which ones match your hardware, and then copying flags into Steam by hand. Proton Pulse handles that from the Steam Deck UI:

1. Open the plugin from the **Quick Access sidebar** or navigate to a game in your library.
2. The plugin fetches ProtonDB reports and scores them against your GPU, driver, and Proton version.
3. Pick a report and press **Apply**. Proton Pulse writes the launch options straight to that game through Steam's CEF API.

You can also review, edit, or clear the options later from the sidebar.

## Features

* **ProtonDB report fetching** — pulls from cached, mirrored, and live ProtonDB sources so the plugin still has something useful to show when one source comes up empty
* **Hardware-aware scoring** — ranks reports by GPU vendor, driver version, Proton build, report age, and compatibility tier
* **Launch option management** — apply, review, edit, and clear launch options directly from the Steam Deck UI
* **Saved configurations** — keep reusable per-game setups with custom variables and a live launch preview
* **Compatibility tool management** — browse, install, refresh, and manage Proton and GE versions without leaving the plugin
* **Detailed report browsing** — open full report cards with filters, diagnostics, vote counts, and score breakdowns
* **ProtonDB contribution helpers** — vote on reports and prep system info for ProtonDB submissions from inside the plugin
* **ProtonDB badge** — shows the game's ProtonDB tier at a glance
* **System detection** — detects CPU, RAM, GPU, driver, kernel, distro, and custom Proton versions automatically
* **Sidebar tools** — quick access to settings, logs, cache tools, and plugin controls from the Decky panel
* **Translations** — interface support for 10 languages, with coverage tracked in generated build metrics
* **Diagnostics and logging** — built-in logs, cache inspection, performance metrics, and backend troubleshooting support

## Translation Coverage

<!-- translation-coverage:start -->
Generated from [metrics/translation-coverage.json](metrics/translation-coverage.json) during `pnpm run build`.

Proton Pulse supports 10 languages. Translation coverage is measured during build and can be enforced with `pnpm run check-translations` (90% minimum).

| Language | Code | Coverage | Status |
|---|---|---|---|
| English | en | 100.0% (canonical) | canonical |
| Deutsch | de | 100.0% | pass |
| Español | es | 100.0% | pass |
| Français | fr | 100.0% | pass |
| 日本語 | ja | 100.0% | pass |
| 한국어 | ko | 100.0% | pass |
| Português (BR) | pt-BR | 100.0% | pass |
| Русский | ru | 100.0% | pass |
| Türkçe | tr | 100.0% | pass |
| 简体中文 | zh-CN | 100.0% | pass |
<!-- translation-coverage:end -->

Want to help translate? See `src/lib/translations/` for the translation files.

## Installation

Proton Pulse currently supports two installation routes:

### Install From Source

Use this route if you want to build locally, tweak the plugin, or deploy straight to your Steam Deck.

```bash
git clone https://github.com/mdeguzis/decky-proton-pulse.git
cd decky-proton-pulse
make setup
make build
DECK_IP=192.168.1.x make deploy
```

Useful variants:

```bash
make watch
DECK_IP=192.168.1.x make deploy-reload
```

See the [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) for the full setup and deployment workflow.

### Install From Release ZIP

Use this route if you just want a published build and do not need the source tree.

1. Download the latest plugin ZIP from the [Releases page](https://github.com/mdeguzis/decky-proton-pulse/releases).
2. Open Decky Loader on your Steam Deck.
3. Use Decky Loader's manual ZIP install flow and select the downloaded release archive.
4. Restart Decky Loader or Steam if the plugin does not appear immediately.

### Quick Start

```bash
git clone https://github.com/mdeguzis/decky-proton-pulse.git
cd decky-proton-pulse
bash scripts/dev-setup.sh
```

Versioning uses a single source of truth:

- `VERSION`

Normal build and deploy commands sync that value into `package.json` and `pyproject.toml` automatically.

### Requirements

* Steam Deck with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed
* Node.js v16.14+ and pnpm v9 (for building from source)
* Python 3.x with [uv](https://github.com/astral-sh/uv)

## Documentation

* [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) — setup, build, deploy, testing, CEF debugging
* [Architecture](https://github.com/mdeguzis/decky-proton-pulse/wiki/Architecture) — file-by-file code breakdown and ownership boundaries
* [System Design](https://github.com/mdeguzis/decky-proton-pulse/wiki/System-Design) — end-to-end flow diagrams, data ownership, scoring model
* [Scoring Algorithm](https://github.com/mdeguzis/decky-proton-pulse/wiki/Scoring-Algorithm) — how reports are weighted and ranked
* [API Reference](https://github.com/mdeguzis/decky-proton-pulse/wiki/API-Reference) — Python callables and TypeScript interfaces
* [ProtonDB Data Resolution](https://github.com/mdeguzis/decky-proton-pulse/wiki/ProtonDB-Data-Resolution) — app ID resolution, mirror misses, and live fallback

## License

See [LICENSE](https://github.com/mdeguzis/decky-proton-pulse/blob/main/LICENSE).
