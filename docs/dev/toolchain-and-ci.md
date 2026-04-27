# Toolchain And CI

This repo builds the plugin frontend with Node 24.

## Local Toolchain

Use the repo setup target instead of hand-installing each runtime:

```bash
make setup
```

That reads `mise.toml`, installs the pinned runtimes, installs frontend dependencies with pnpm, and syncs Python dev dependencies with uv.

Current pins:

- Node.js: `24`
- Python: `3.11`
- uv: latest

Useful checks:

```bash
node --version
pnpm --version
uv --version
```

If you need to force a command through the pinned Node runtime:

```bash
mise exec node@24 -- corepack pnpm build
```

`pnpm` 9 or newer works with the current lockfile. GitHub Actions still installs pnpm 9 explicitly, while local machines may use newer pnpm through Corepack or an existing install.

## GitHub Actions

The reusable build workflow and coverage Pages workflow both use Node 24:

- `.github/workflows/build-reusable.yml`
- `.github/workflows/coverage-badges.yml`

Both workflows also set:

```yaml
FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

That opts JavaScript actions such as `actions/checkout` into the GitHub runner's Node 24 action runtime ahead of the GitHub-hosted default switch.

## Coverage Policy

Local and CI coverage thresholds:

- Overall TypeScript coverage: `90%`
- Overall Python coverage: `90%`
- Pull request changed-line coverage: `95%`

Run the full local gate with:

```bash
make coverage
```

For the full deploy path used during Deck testing:

```bash
DECK_IP=$(cat ~/.deckip) make deploy-reload
```

## Remote Deck Dev Helpers

Bootstrap a Deck once:

```bash
make setup-remote-dev DECK_IP=$(cat ~/.deckip)
```

That installs a narrow sudoers rule from `config/remote-dev-sudoers.template`, enables CEF remote debugging, enables Decky live reload, and restarts `plugin_loader`.

After that, these targets should not ask for a Deck sudo password:

```bash
make deploy-reload DECK_IP=$(cat ~/.deckip)
make cef-debug-enable DECK_IP=$(cat ~/.deckip)
make get-logs DECK_IP=$(cat ~/.deckip)
make get-cef-capture DECK_IP=$(cat ~/.deckip)
```

Keep the generated sudoers file scoped. Do not add Supabase secrets, service keys, or broad shell access to the template.

## CEF Capture Packs

When Deck browser or Steam CEF behavior is weird, save a capture pack:

```bash
make get-cef-capture DECK_IP=$(cat ~/.deckip)
```

The pack lands under `../cef-captures/<timestamp>` and includes CEF target metadata plus a `latest` pointer. Use it together with `make get-logs`; the capture tells us what CEF exposed, while the logs tell us what the plugin did.
