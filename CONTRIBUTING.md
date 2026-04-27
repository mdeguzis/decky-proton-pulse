# Contributing to Proton Pulse

Thanks for taking an interest in Proton Pulse.

This project is built for Steam Deck players who rely on Proton, ProtonDB, and Linux gaming tools every day. The goal is simple: make ProtonDB data useful on-device, help people compare reports against their own hardware, and make it easier to apply, test, and share launch configurations without leaving the Deck.

## Before You Start

- Read the main [README](README.md) for the project overview.
- Check existing issues before starting a larger change.
- If you are changing user-facing behavior, screenshots and translation checks are usually worth revisiting too.

## Local Setup

From the plugin repo:

```bash
pnpm install
UV_CACHE_DIR=/tmp/uv-cache uv sync --group dev
```

Useful commands:

```bash
make build
make test
make test-ts
make test-py
make check-translations
```

If you are working with a real Steam Deck:

```bash
DECK_IP=$(cat ~/.deckip) make deploy-reload
```

## What Good Contributions Look Like

- Keep changes focused.
- Prefer fixing the root cause instead of layering on workarounds.
- Preserve the Steam Deck controller-first experience.
- Keep translations in sync for user-facing strings.
- Add or update tests when behavior changes.

## Code Style Notes

- TypeScript and Python are both used here.
- Keep UI text in i18n instead of hardcoding English strings in components.
- Favor small, readable helpers over deeply nested conditionals.
- If a change affects settings, configs, screenshots, or local storage, think about migration and backup/restore behavior too.

## Tests and Checks

Before opening a PR, try to run the relevant checks for your change:

```bash
make build
make test
```

If your work touches translations:

```bash
make check-translations
```

If your work touches the Steam Deck UI or screenshot flows:

```bash
DECK_IP=$(cat ~/.deckip) make deploy-reload
make take-screenshot
```

## Screenshots and Localization

This project keeps a screenshot gallery for documentation and translation review.

Useful examples:

```bash
LANG=cn DECK_IP=$(cat ~/.deckip) make capture-project-screenshots
LANG=all DECK_IP=$(cat ~/.deckip) make capture-project-screenshots
```

When adding or changing user-facing text:

- update translations
- review affected screenshots if possible
- call out any remaining untranslated text that comes from external content, such as ProtonDB report prose

## Pull Requests

PRs are easiest to review when they include:

- a short explanation of the problem
- a clear summary of what changed
- testing notes
- screenshots for UI changes when relevant

Small PRs move faster than large ones. If a change is big, splitting it into a couple of focused PRs is usually better.

### DCO Sign-Off

This repository enforces DCO sign-off on pull requests. Every commit in the PR needs a `Signed-off-by` trailer from the commit author.

The easiest way to add it is when you create the commit:

```bash
git commit -s -m "your message"
```

If you already created a local commit without the sign-off, you can add it with:

```bash
git commit --amend -s --no-edit
```

Then push the updated commit:

```bash
git push --force-with-lease
```

## Issues

Bug reports are most helpful when they include:

- what you expected
- what actually happened
- whether it happened on-device, in Desktop Mode, or in screenshots/docs
- logs, screenshots, or a short video when available

## Questions and Rough Edges

You do not need a perfect patch to contribute. If you are unsure about a direction, opening an issue first is completely fine.

The project covers a few moving parts:

- the Decky plugin
- localization
- screenshot automation
- the `proton-pulse-data` pipeline and CDN-backed data flow

So if something feels connected to one of those systems, it probably is.
