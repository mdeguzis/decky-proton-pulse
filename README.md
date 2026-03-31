# Decky Proton Pulse

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck that fetches [ProtonDB](https://www.protondb.com) compatibility reports for the focused game, scores them against your local system specs, and lets you apply launch options directly via the Steam CEF API.

## Documentation

All documentation lives in the [GitHub Wiki](https://github.com/mdeguzis/decky-proton-pulse/wiki):

- [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) — setup, build, deploy, testing, CEF debugging
- [Architecture](https://github.com/mdeguzis/decky-proton-pulse/wiki/Architecture) — code structure and data flow
- [Scoring Algorithm](https://github.com/mdeguzis/decky-proton-pulse/wiki/Scoring-Algorithm) — how reports are weighted and ranked
- [API Reference](https://github.com/mdeguzis/decky-proton-pulse/wiki/API-Reference) — Python callables and TypeScript interfaces
- [Phase 1 Status](https://github.com/mdeguzis/decky-proton-pulse/wiki/Phase-1-Status) — current status and pending items

## Quick Start (Developers)

```bash
git clone https://github.com/mdeguzis/decky-proton-pulse.git
cd decky-proton-pulse
bash scripts/dev-setup.sh
```

See the [Developer Guide](https://github.com/mdeguzis/decky-proton-pulse/wiki/Developer-Guide) for full instructions.

## Requirements

- Node.js v16.14+ and pnpm v9
- Python 3.x with [uv](https://github.com/astral-sh/uv)
- A Steam Deck with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) installed

## License

See [LICENSE](LICENSE).
