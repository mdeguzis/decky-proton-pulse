# Decky Proton Pulse

| Status | OS Version |
|---|---|
| [![Ubuntu Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/autobuild.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/autobuild.yml) | [![Ubuntu OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-ubuntu.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |
| [![Debian Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-debian.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-debian.yml) | [![Debian OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-debian.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |
| [![Arch Linux Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-arch.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-arch.yml) | [![Arch Linux OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-arch.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |
| [![Fedora Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-fedora.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-fedora.yml) | [![Fedora OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-fedora.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |
| [![Termux Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-termux.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-termux.yml) | [![Termux OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-termux.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |
| [![Windows Build](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-windows.yml/badge.svg)](https://github.com/mdeguzis/decky-proton-pulse/actions/workflows/build-windows.yml) | [![Windows OS](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/os-windows.json&cacheSeconds=86400)](https://mdeguzis.github.io/decky-proton-pulse/) |

Windows CI currently validates that the repo toolchain can install and build on a GitHub-hosted Windows runner. It is not a claim that the Decky plugin runtime or hardware-detection backend is fully supported on Windows.

[![Python Coverage](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/python-coverage.json&cacheSeconds=300)](https://mdeguzis.github.io/decky-proton-pulse/)
[![TypeScript Coverage](https://img.shields.io/endpoint?url=https://mdeguzis.github.io/decky-proton-pulse/badges/ts-coverage.json&cacheSeconds=300)](https://mdeguzis.github.io/decky-proton-pulse/)
[![Pulse Reports](https://img.shields.io/endpoint?url=https://www.proton-pulse.com/badges/pulse-reports.json&cacheSeconds=3600)](https://www.proton-pulse.com/)

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for Steam Deck that pulls [ProtonDB](https://www.protondb.com) reports for the game in front of you, scores them against your hardware, and lets you apply useful launch options without typing them by hand.

> Website: **<https://www.proton-pulse.com/>** - the companion web app now lives on its own domain. If you had the old `mdeguzis.github.io/proton-pulse-data/*` URLs bookmarked, please update them. The plugin itself already points at the new host.

Browse community reports, Pulse configs, and per-game compatibility data on the **[Proton Pulse site](https://www.proton-pulse.com/)** - works on mobile with a collapsible left-side nav.

Coverage policy: overall Python and TypeScript coverage must stay at or above `90%`, and pull requests must keep changed-line coverage at `95%` or higher.

## Screenshots

see: [UI screenshot gallery](https://github.com/mdeguzis/decky-proton-pulse/wiki/UI-Screenshot-Gallery)

---

## How This Compares to Other Decky Plugins

The closest alternative is [ProtonDB Badges (protondb-decky)](https://github.com/OMGDuke/protondb-decky) by OMGDuke, which was archived in June 2025. Proton Pulse was inspired by that project and adds hardware-aware scoring, launch-option management, report submission, cloud sync, and more.

| Feature | Proton Pulse | ProtonDB Badges (archived) |
|---|---|---|
| ProtonDB tier badge on game page | Yes | Yes |
| Tier badges on library grid tiles | Yes | No |
| Launch option apply (no copy/paste) | Yes | No |
| Hardware-aware report scoring | Yes -- GPU, driver, Proton version, age, tier | No |
| Native Pulse report submission | Yes | No |
| Companion website | Yes -- proton-pulse.com | No |
| Cloud sync (configs + reports) | Yes -- Supabase | No |
| Saved per-game configurations | Yes | No |
| Compatibility tool management | Yes -- install/manage Proton/GE | No |
| Non-Steam game support (Heroic, GOG, etc.) | Yes -- resolves to Steam store ID | No |
| Self-updater (built-in) | Yes -- GitHub Releases, no store needed | No (Decky store only) |
| Decky store availability | No (not submitted) | Yes (was in store) |
| Translation support | 19 languages (build-tracked) | 24+ languages (Crowdin) |
| Active maintenance | Yes | No (archived June 2025) |

---

## How Proton Pulse Works -- Apply ProtonDB Launch Options Without Copy/Paste

Getting Proton launch options right usually means opening ProtonDB, reading a pile of reports, guessing which ones match your hardware, and then copying flags into Steam by hand. Proton Pulse handles that from the Steam Deck UI:

1. Open the plugin from the **Quick Access sidebar**, navigate to a game in your library, or browse Steam search results -- a Y-button hint lets you jump straight to a game's Proton data without leaving search.
2. The plugin fetches ProtonDB reports and scores them against your GPU, driver, and Proton version.
3. Pick a report and press **Apply**. Proton Pulse writes the launch options straight to that game through Steam's CEF API.

Tier badges appear directly on game library pages and Steam store pages so you know compatibility at a glance. Non-Steam games (Heroic, Lutris, Epic, GOG, etc.) are resolved to their Steam store counterpart for accurate report data.

## Optional Proton Pulse Account Link

Linking the Decky plugin to a Proton Pulse account is optional. The plugin works without it for local report browsing, scoring, and launch-option management.

- **On the website:** Steam login is only the sign-in method for your Proton Pulse account.
- **In the Decky plugin:** linking uses a Proton Pulse install ID plus a short link code.
- **Privacy boundary:** the plugin does not upload Steam profile names or Steam usernames, and Steam auth is not used as the plugin identity.

After linking, uploads from that Decky install can show up as yours on the website, and the website can manage synced systems and reports for the same Proton Pulse user.

![Proton Pulse account linking in Decky settings](docs/assets/proton-pulse-account-linking.png)

## Features

* **ProtonDB report fetching** - pulls from cached, mirrored, and live ProtonDB sources so the plugin still has something useful to show when one source comes up empty
* **Native Pulse reports** - submit your own compatibility report directly from the plugin; hardware (CPU, GPU, RAM, VRAM, driver, kernel, OS, resolution) is captured automatically so you only need to pick a rating and Proton version
* **Dynamic ProtonDB hardware scoring & filtering** - ranks reports by GPU vendor, driver version, Proton build, report age, and compatibility tier so results match your exact setup, not just the general tier
* **Steam Proton launch option management (no copy/paste)** - apply, review, edit, and clear launch options directly from the Steam Deck UI without a keyboard
* **Saved configurations** - keep reusable per-game setups with custom variables and a live launch preview
* **Compatibility tool management** - browse, install, refresh, and manage Proton and GE versions without leaving the plugin
* **Detailed report browsing** - open full report cards with filters, diagnostics, vote counts, and score breakdowns
* **ProtonDB contribution helpers** - vote on reports and prep system info for ProtonDB submissions from inside the plugin
* **Game library badge** - floating tier badge (PLATINUM/GOLD/etc.) injected into the game page header; for non-Steam games with a resolved Steam store match, shows the tier badge alongside the launcher source label (Heroic, Epic, GOG, etc.)
* **Store page badge** - Proton Pulse icon badge injected into the Steam store page header when browsing a game's store page in the embedded browser
* **Search results hint** - Y-button gamepad hint appears at the bottom of the screen when a search result tile is focused, letting you jump straight to Proton Pulse for that game without opening the library first
* **Non-Steam game support** - resolves non-Steam shortcuts (Heroic, Lutris, Bottles, itch.io, etc.) to their matching Steam store app ID for accurate ProtonDB data and report lookup
* **Library guard** - report action buttons (apply, edit, upload, clear, vote) are disabled for games not in the user's library, with a visible "Not in library" notice at the top of the manage-game tab
* **System detection** - detects CPU, RAM, GPU, driver, kernel, distro, and custom Proton versions automatically
* **Sidebar tools** - quick access to settings, logs, cache tools, and plugin controls from the Decky panel
* **Translations** - interface support for 19 languages, with coverage tracked in generated build metrics
* **Diagnostics and logging** - built-in logs, cache inspection, performance metrics, and backend troubleshooting support

## Translation Coverage

<!-- translation-coverage:start -->
Generated from [metrics/translation-coverage.json](metrics/translation-coverage.json) during `pnpm run build`.

Proton Pulse supports 19 languages. Translation coverage is measured during build and can be enforced with `pnpm run check-translations` (90% minimum).

| Language | Code | Coverage | Status |
|---|---|---|---|
| English | en | 100.0% (canonical) | canonical |
| Deutsch | de | 100.0% | pass |
| Español | es | 100.0% | pass |
| Français | fr | 100.0% | pass |
| Italiano | it | 100.0% | pass |
| 日本語 | ja | 100.0% | pass |
| 한국어 | ko | 100.0% | pass |
| Nederlands | nl | 100.0% | pass |
| Polski | pl | 100.0% | pass |
| Português (BR) | pt-BR | 100.0% | pass |
| Русский | ru | 100.0% | pass |
| Türkçe | tr | 100.0% | pass |
| Українська | uk | 100.0% | pass |
| Svenska | sv | 100.0% | pass |
| Čeština | cs | 100.0% | pass |
| ภาษาไทย | th | 100.0% | pass |
| Tiếng Việt | vi | 100.0% | pass |
| 简体中文 | zh-CN | 100.0% | pass |
| 繁體中文 | zh-TW | 100.0% | pass |
<!-- translation-coverage:end -->

Want to help translate? See `src/lib/translations/` for the translation files.

## Installation -- Decky Loader Plugin Setup for Steam Deck

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

### Updating the Plugin

Proton Pulse has a built-in updater on the **About** tab (the last tab in the plugin sidebar).

1. Open the plugin and navigate to the About tab.
2. Press **Check for Updates** -- the plugin queries the GitHub Releases API and shows the latest version.
3. If an update is available, press **Update to vX.Y.Z** -- the ZIP downloads in the background with a live progress bar (percentage, bytes transferred, and ETA), identical to the Proton-GE installer in the Compatibility Tools tab.
4. When the download and extraction finish, press **Reload Plugin** -- the plugin attempts a hot-reload via Decky Loader first (no Steam restart needed); if that is unavailable it falls back to a full Steam restart.

> **Note:** Because Proton Pulse is not in the Decky store, it cannot use the store's automatic update path. The built-in updater provides an equivalent experience from within the plugin itself.

### Quick Start

```bash
git clone https://github.com/mdeguzis/decky-proton-pulse.git
cd decky-proton-pulse
bash scripts/dev-setup.sh
```

Versioning uses a single source of truth:

- `VERSION`

Normal build and deploy commands sync that value into `package.json` and `pyproject.toml` automatically.

### Plugin Loader Compatibility

Proton Pulse is built for [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader). Other plugin loaders for the Steam Deck ecosystem are listed below.

| Loader | Platform | Status | Notes |
|---|---|---|---|
| [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) | SteamOS / Linux | Yes | Primary target |
| [Decky Loader for Windows](https://github.com/ACCESS-DENIIED/Decky-Loader-For-Windows) | Windows | Yes (AFAIK) | Community port; not officially tested |
| [Condenser](https://github.com/kmturley/condenser) | TBD | WIP | Plugin API not yet finalized |
| [Millennium](https://github.com/SteamClientHomebrew/Millennium) | SteamOS / Windows | No | Different plugin model; not compatible |

### Requirements

* Steam Deck with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed
* Node.js 24 and pnpm v9+ (for building from source)
* Python 3.x with [uv](https://github.com/astral-sh/uv)

## Documentation

* [Proton Pulse Site](https://www.proton-pulse.com/) - browse community reports, Pulse configs, and per-game data
* [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) - setup, build, deploy, testing, CEF debugging
* [Architecture](https://github.com/mdeguzis/decky-proton-pulse/wiki/Architecture) - file-by-file code breakdown and ownership boundaries
* [System Design](https://github.com/mdeguzis/decky-proton-pulse/wiki/System-Design) - end-to-end flow diagrams, data ownership, scoring model
* [Scoring Algorithm](https://github.com/mdeguzis/decky-proton-pulse/wiki/Scoring-Algorithm) - how reports are weighted and ranked
* [API Reference](https://github.com/mdeguzis/decky-proton-pulse/wiki/API-Reference) - Python callables and TypeScript interfaces
* [ProtonDB Data Resolution](https://github.com/mdeguzis/decky-proton-pulse/wiki/ProtonDB-Data-Resolution) - app ID resolution, mirror misses, and live fallback
* [Local dev notes](docs/dev/toolchain-and-ci.md) - Node 24, CI, remote Deck helpers, and CEF captures

## Troubleshooting

### Connect To Steam CEF Remote Debugging

If you need to inspect Deck UI patches, injected buttons, or console errors live on the Deck, you can enable Steam's CEF remote debugger and connect from your desktop browser.

1. Enable the remote debugger on the Deck:

```bash
DECK_IP=192.168.1.x make cef-debug-enable
```

2. Open the debugger endpoint from your desktop browser:

```text
http://192.168.1.x:8081
```

3. If your browser does not auto-discover the targets, open:

```text
http://192.168.1.x:8081/json
```

That page lists the active Steam CEF targets and their DevTools URLs.

Tips:

* Keep `make get-logs` handy in another terminal so you can compare frontend console behavior with the plugin log.
* If you are debugging a game page patch, open the game page first, then refresh the target list so the correct CEF view is visible.
* Use the inspector console to confirm route changes, DOM anchor selection, and injected button state when UI patches do not show up where expected.

## Acknowledgments & Credits

Proton Pulse would not exist without the open-source projects below. Many pieces of this project were inspired by their work.

| Project | Author | License |
|---|---|---|
| [ProtonDB Badges (protondb-decky)](https://github.com/OMGDuke/protondb-decky) | OMGDuke | GPL-3.0 |
| [Decky Proton Launch](https://github.com/moi952/decky-proton-launch) | moi952 | BSD-3-Clause |
| [Wine Cellar (decky-wine-cellar)](https://github.com/FlashyReese/decky-wine-cellar) | FlashyReese | MIT |
| [SteamGridDB Decky Plugin (decky-steamgriddb)](https://github.com/SteamGridDB/decky-steamgriddb) | SteamGridDB | GPL-3.0-or-later |
| [Decky Plugin Template](https://github.com/SteamDeckHomebrew/decky-plugin-template) | SteamDeckHomebrew | BSD-3-Clause |

If you find Proton Pulse useful, please consider starring or contributing to these upstream projects as well.

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/mdeguzis/decky-proton-pulse/blob/main/LICENSE) or later. Upstream license copies are in the [LICENSES/](https://github.com/mdeguzis/decky-proton-pulse/tree/main/LICENSES) directory.
