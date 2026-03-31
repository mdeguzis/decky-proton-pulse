# Decky Proton Pulse

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck that pulls [ProtonDB](https://www.protondb.com) compatibility reports for any game in your library, scores them against your hardware, and lets you apply the most relevant launch options in a couple of button presses.

## What it does

Getting Proton launch options right for a specific game usually involves searching ProtonDB, digging through a dozen reports, figuring out which ones were written by people with similar hardware, and then manually copying the flags into Steam's Properties dialog. Proton Pulse handles that workflow from the Steam Deck UI:

1. **Right-click any game** in your library and select **ProtonDB Config** from the context menu.
2. The plugin opens a full-screen view showing ProtonDB reports ranked by relevance to your GPU, driver, and Proton version.
3. Pick a report and press **Apply** — the launch options are written directly to that game via the Steam CEF API. No typing required.

You can also open **Manage Configurations** from the Quick Access sidebar to review or clear applied options across your library.

## Features

- Context menu entry on every game in your library (no need to navigate the sidebar first)
- Reports fetched live from ProtonDB and scored against your system — GPU vendor, driver version, Proton build, and report age all factor in
- GPU filter tabs (Nvidia / AMD / Other) to focus on reports from similar hardware
- Apply or clear launch options without leaving the Steam Deck UI
- Debug logging with a separate rotating log file when enabled
- Settings and log viewer accessible from the plugin's sidebar panel

## Installation

> Installation from the Decky Plugin Marketplace is pending publication. For now, build and deploy from source.

See the [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) for setup and deployment instructions.

**Requirements:**
- Steam Deck with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed
- Node.js v16.14+ and pnpm v9 (for building from source)
- Python 3.x with [uv](https://github.com/astral-sh/uv)

## Documentation

- [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) — setup, build, deploy, testing, CEF debugging
- [Architecture](https://github.com/mdeguzis/decky-proton-pulse/wiki/Architecture) — code structure and data flow
- [Scoring Algorithm](https://github.com/mdeguzis/decky-proton-pulse/wiki/Scoring-Algorithm) — how reports are weighted and ranked
- [API Reference](https://github.com/mdeguzis/decky-proton-pulse/wiki/API-Reference) — Python callables and TypeScript interfaces

## License

See [LICENSE](LICENSE).
