# Decky Proton Pulse

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck that pulls [ProtonDB](https://www.protondb.com) compatibility reports for any game in your library, scores them against your hardware, and lets you apply the most relevant launch options in a couple of button presses.

> **Status: Phase 1 — Pre-release / In Development**
> Core functionality is implemented and unit-tested. On-device smoke testing on Steam Deck hardware is pending. See [Phase 1 Status](https://github.com/mdeguzis/decky-proton-pulse/wiki/Phase-1-Status) for details.

## What it does

Getting Proton launch options right for a specific game usually involves searching ProtonDB, digging through a dozen reports, figuring out which ones were written by people with similar hardware, and then manually copying the flags into Steam's Properties dialog. Proton Pulse handles that workflow from the Steam Deck UI:

1. Open the plugin from the **Quick Access sidebar** or navigate to a game in your library.
2. The plugin fetches ProtonDB reports and scores them against your GPU, driver, and Proton version.
3. Pick a report and press **Apply** — the launch options are written directly to that game via the Steam CEF API. No typing required.

You can also review or clear applied options from the plugin's sidebar panel.

## Features

### Implemented (Phase 1)

* **ProtonDB report fetching** — live summary and detailed reports pulled from the ProtonDB API with retry logic and caching
* **Hardware-aware scoring** — reports ranked by relevance using GPU vendor, driver version, Proton build, report age, and compatibility tier (9 unit tests passing)
* **System detection** — automatic detection of CPU, RAM, GPU, driver, kernel, distro, and custom Proton versions
* **Full-screen report modal** — browse scored reports with GPU filter tabs (Nvidia / AMD / Other), apply or clear launch options, all without leaving Game Mode
* **ProtonDB badge component** — displays the game's ProtonDB compatibility tier
* **Report card component** — detailed per-report view with scoring breakdown
* **Log viewer** — built-in log viewer with auto-scroll and 3-second polling for debug output
* **Sidebar panel** — settings, log viewer, and plugin controls accessible from the Quick Access menu
* **Library route patching** — plugin hooks into `/library/app/:appid` via Decky's `routerHook`
* **Rotating log files** — debug logging with separate rotating file handler
* **Python backend** — 17 tests passing, game guard via `pgrep`, structured logging
* **Developer tooling** — `dev-setup.sh` and `deploy.sh` helper scripts, VS Code tasks for build/deploy

### Pending (Pre-Deploy)

* On-device smoke test on Steam Deck hardware
* Badge injection positioning (requires live Steam DOM inspection via CEF DevTools)
* ProtonDB reports endpoint on-device verification (full `/api/v1/reports/app/{id}` endpoint returned 404 during automated testing — likely rate limiting or geo-restriction)
* `showModal` / `closeModal` signature verification against target `@decky/ui` version

### Planned (Phase 2)

* Local SQLite thumbs-up/down database for user ratings
* Score adjustment from local user feedback
* Settings overrides for detected system specs

## Acknowledgments & Credits

Proton Pulse would not exist without the work of the open-source projects below. Huge thank you to each of these developers and communities — components, patterns, and ideas were directly borrowed from, inspired by, or built on top of their code.

### [ProtonDB Badges (protondb-decky)](https://github.com/OMGDuke/protondb-decky) — by OMGDuke

The original Decky plugin for ProtonDB integration on Steam Deck. Proton Pulse draws heavily from this project's approach to fetching and displaying ProtonDB data within the Decky Loader environment, including the ProtonDB API integration patterns, badge/rating display concepts, and the overall plugin architecture for interfacing with ProtonDB from Game Mode.

### [Decky Proton Launch](https://github.com/moi952/decky-proton-launch) — by moi952

A plugin for managing Proton launch options directly from the Steam Deck UI. Proton Pulse was inspired by and borrows from this project's approach to injecting and managing launch parameters for Steam games, including the method for writing launch options via the Steam client, the collapsible category UI patterns, and the concept of applying environment variables directly from Game Mode without manual typing.

### [Wine Cellar (decky-wine-cellar)](https://github.com/FlashyReese/decky-wine-cellar) — by FlashyReese (MIT)

A Decky Loader plugin for managing Steam Play compatibility tools. Proton Pulse references Wine Cellar's patterns for interacting with Proton/Wine compatibility layers on the Steam Deck, including its approach to detecting and working with compatibility tool directories and its plugin settings/management UI structure.

### [SteamGridDB Decky Plugin (decky-steamgriddb)](https://github.com/SteamGridDB/decky-steamgriddb) — by SteamGridDB (GPL-3.0-or-later)

A Decky Loader plugin for managing custom game artwork from within Game Mode. Proton Pulse was influenced by this project's implementation of the game context menu integration pattern (adding custom entries to the right-click menu on games in the Steam library), its approach to full-screen overlay views triggered from game pages, and general Decky plugin UI/UX conventions.

---

A sincere thank you to all of the above maintainers and contributors. If you find Proton Pulse useful, please consider starring or contributing to these upstream projects as well.

## Installation

> Installation from the Decky Plugin Marketplace is pending publication. For now, build and deploy from source.

See the [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) for setup and deployment instructions.

### Quick Start

```bash
git clone https://github.com/mdeguzis/decky-proton-pulse.git
cd decky-proton-pulse
bash scripts/dev-setup.sh
```

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
* [On-Device Test Plan](https://github.com/mdeguzis/decky-proton-pulse/wiki/On-Device-Test-Plan) — manual test checklist for hardware validation
* [Phase 1 Status](https://github.com/mdeguzis/decky-proton-pulse/wiki/Phase-1-Status) — current implementation status and pending items

## License

See [LICENSE](https://github.com/mdeguzis/decky-proton-pulse/blob/main/LICENSE).
