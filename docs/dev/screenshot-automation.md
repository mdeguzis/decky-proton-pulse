# Screenshot Automation

This workflow defines how we capture and publish project UI screenshots into the wiki.

## Scope

`make capture-project-screenshots` is a guided batch capture flow. It captures every screenshot defined in the project manifest, registers each image in the local screenshot catalog, and republishes the wiki gallery at the end.

The current workflow is guided, not fully hands-off. It does not yet drive Steam Deck navigation automatically. For each manifest step, the operator positions the UI on the Deck, then confirms the capture in the terminal.

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
- `instructions`: operator guidance describing what to put on screen before capture

## Command

```bash
cd decky-proton-pulse
DECK_IP=$(cat ~/.deckip) make capture-project-screenshots
```

Optional filters:

```bash
DECK_IP=$(cat ~/.deckip) SCREENSHOT_MATCH=manage-game make capture-project-screenshots
```

## Output Flow

1. Load the screenshot manifest.
2. Prompt the operator for each defined UI state.
3. Capture the current CEF page from the Deck.
4. Store the PNG under `../screenshots/<group>/`.
5. Update `../screenshots/catalog.json`.
6. Copy catalogued screenshots into the wiki checkout.
7. Regenerate `UI-Screenshot-Gallery.md`.

## Follow-up Work

To make this fully automatic later, we would need a reliable UI-navigation layer that can:

- route to the correct plugin tab or modal
- focus the intended game or state
- wait for stable rendering before capture
- recover safely if Steam UI state drifts

Until then, the manifest-driven guided flow keeps the capture set reproducible and wiki-friendly.
