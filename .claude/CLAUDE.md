# Claude Code Rules

## Git Commits

- Do NOT add `Co-Authored-By` lines to commit messages
- Commit messages should only contain the subject line and optional body describing the change

## Decky Plugin Conventions

- This is a Decky Loader plugin based on https://github.com/SteamDeckHomebrew/decky-plugin-template
- Frontend: React + TypeScript, bundled with Rollup via `@decky/rollup`
- Backend: Python (`main.py`), using the `decky` module for logging, settings, and lifecycle
- UI components come from `@decky/ui` (Focusable, DialogButton, ToggleField, DropdownItem, PanelSection, etc.)
- API calls between frontend/backend use `callable` from `@decky/api`
- Gamepad navigation: use `Focusable` wrappers with `onGamepadDirection` for D-pad support
- Side-effect imports get tree-shaken by Rollup — use explicit named exports + references instead
- Test with `pnpm test` (vitest) for frontend, `uv run python -m pytest` for backend
- Deploy with `DECK_IP=x.x.x.x make deploy-reload`

## i18n / Translations

- **Never hardcode English strings in components.** All user-facing text must use `t()` keys from `src/lib/i18n.ts`
- When adding new `t()` keys to the `TranslationTree` interface:
  1. Add the key to the interface
  2. Add the English value in the `en` tree
  3. Update ALL 9 translation files in `src/lib/translations/` (zh-CN, ru, pt-BR, de, es, fr, ja, ko, tr)
  4. Run `pnpm build` to verify TypeScript catches any missing keys
- Translation files export named constants (e.g. `export const de`) — registration happens in `src/lib/translations/index.ts`
- Keep `ratings` keys untranslated in code (they map to ProtonDB API values) — only translate the display labels
- Brand names (NVIDIA, AMD, Intel, Proton, Steam) stay untranslated
