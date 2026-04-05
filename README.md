# Decky Proton Pulse

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck that pulls [ProtonDB](https://www.protondb.com) compatibility reports for any game in your library, scores them against your hardware, and lets you apply the most relevant launch options in a couple of button presses.

---

## Acknowledgments & Credits

Proton Pulse would not exist without the work of the open-source projects below. A sincere and prominent thank you to each of these developers and communities — components, patterns, and ideas were directly borrowed from, inspired by, or built on top of their code.

| Project | Author | License |
|---|---|---|
| [ProtonDB Badges (protondb-decky)](https://github.com/OMGDuke/protondb-decky) | OMGDuke | — |
| [Decky Proton Launch](https://github.com/moi952/decky-proton-launch) | moi952 | — |
| [Wine Cellar (decky-wine-cellar)](https://github.com/FlashyReese/decky-wine-cellar) | FlashyReese | MIT |
| [SteamGridDB Decky Plugin (decky-steamgriddb)](https://github.com/SteamGridDB/decky-steamgriddb) | SteamGridDB | GPL-3.0-or-later |

If you find Proton Pulse useful, please consider starring or contributing to these upstream projects as well.

---

## What it does

Getting Proton launch options right for a specific game usually involves searching ProtonDB, digging through a dozen reports, figuring out which ones were written by people with similar hardware, and then manually copying the flags into Steam's Properties dialog. Proton Pulse handles that workflow from the Steam Deck UI:

1. Open the plugin from the **Quick Access sidebar** or navigate to a game in your library.
2. The plugin fetches ProtonDB reports and scores them against your GPU, driver, and Proton version.
3. Pick a report and press **Apply** — the launch options are written directly to that game via the Steam CEF API. No typing required.

You can also review or clear applied options from the plugin's sidebar panel.

## Features

* **ProtonDB report fetching** — live summary and detailed reports pulled from the ProtonDB API with retry logic and caching
* **Hardware-aware scoring** — reports ranked by relevance using GPU vendor, driver version, Proton build, report age, and compatibility tier
* **System detection** — automatic detection of CPU, RAM, GPU, driver, kernel, distro, and custom Proton versions
* **Full-screen report modal** — browse scored reports with GPU filter tabs (Nvidia / AMD / Other), apply or clear launch options without leaving Game Mode
* **ProtonDB badge** — displays the game's ProtonDB compatibility tier
* **Report card view** — detailed per-report view with scoring breakdown
* **Log viewer** — built-in log viewer with auto-scroll and polling for debug output
* **Sidebar panel** — settings, log viewer, and plugin controls accessible from the Quick Access menu
* **Library route patching** — hooks into `/library/app/:appid` via Decky's `routerHook`
* **Rotating debug logs** — separate rotating file handler for troubleshooting
* **Python backend** — structured logging, game guard, full test suite

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

## License

See [LICENSE](https://github.com/mdeguzis/decky-proton-pulse/blob/main/LICENSE).
