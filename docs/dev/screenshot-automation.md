# Screenshot Automation

This doc covers how we capture project UI screenshots and publish them to the wiki.

## Scope

`make capture-project-screenshots` is the project screenshot capture flow. It walks through the screenshot manifest, drives the Deck UI to the requested route or modal, registers each image in the local screenshot catalog, and refreshes the wiki gallery at the end.

The flow is now mostly automated for the wired states. It uses the plugin's screenshot automation bridge plus remote CEF debugging to navigate, wait, and capture the visible Steam UI. Manual verification is still important because Steam UI state can drift and a capture can be "close but wrong" if the visible page does not fully settle.

## Source of Truth

- Manifest: `config/ui_screenshot_manifest.json`
- Local catalog: `../screenshots/catalog.json`
- Wiki assets: `../decky-proton-pulse.wiki/assets/screenshots/`
- Wiki gallery page: `../decky-proton-pulse.wiki/UI-Screenshot-Gallery.md`

## Manifest Schema

Each manifest entry is a JSON object with:

- `group`: logical interface area, for example `manage-game`
- `key`: stable shot key within the group, for example `default`
- `title`: human-readable screenshot title for the wiki gallery
- `caption`: optional description shown under the screenshot in the gallery
- `instructions`: a short note explaining what should be on screen before capture

## Command

```bash
cd decky-proton-pulse
DECK_IP=$(cat ~/.deckip) make capture-project-screenshots
```

Optional filters:

```bash
DECK_IP=$(cat ~/.deckip) SCREENSHOT_MATCH=manage-game make capture-project-screenshots
```

## What Happens

1. Load the screenshot manifest.
2. Prompt the operator for each defined UI state.
3. Capture the current CEF page from the Deck.
4. Store the PNG under `../screenshots/<group>/`.
5. Update `../screenshots/catalog.json`.
6. Copy catalogued screenshots into the wiki checkout.
7. Regenerate `UI-Screenshot-Gallery.md`.

The published gallery preserves manifest order, so it should read like the plugin's real navigation flow instead of an alphabetical list.

## What Still Needs Work

The remaining work is mostly about expanding coverage to more modal states and making waits even more robust for Steam UI drift. Current high-value additions are:

- Manage Configurations config editor modal
- Manage Configurations ProtonDB submit modal
- Manage Game missing-version decision modal
- Manage Game installed-version picker modal
- Compatibility Tools install-from-ZIP modal
- Logs tab base view
- Settings advanced cache/performance section
