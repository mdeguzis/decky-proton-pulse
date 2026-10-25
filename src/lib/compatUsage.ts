// src/lib/compatUsage.ts
// Display helpers for "which games use this compat tool" (#133). The backend
// reads Steam's CompatToolMapping from config.vdf and returns used_by_app_ids
// per tool: null when config.vdf could not be read, [] when nothing uses it.
import { t } from './i18n';
import { resolveAppName } from './steamApps';

export interface CompatToolUsage {
  used_by_app_ids?: string[] | null;
  is_steam_default?: boolean;
}

// "used by N games", shown after the version on a tool row's second line,
// prefixed with "Steam default" when Steam uses the tool for every unmapped
// title. Returns null when usage is unknown so the row shows nothing rather
// than a false zero.
export function compatUsageLabel(tool: CompatToolUsage | null | undefined): string | null {
  const ids = tool?.used_by_app_ids;
  if (!Array.isArray(ids)) return null;
  const extras = t().extras!;
  const parts: string[] = [];
  if (tool?.is_steam_default) parts.push(extras.compatSteamDefault());
  if (ids.length > 0 || !tool?.is_steam_default) parts.push(extras.compatUsedByGames(ids.length));
  return parts.join(', ');
}

// Game names for the Info modal, sorted by name. Stale mappings for games
// that are no longer in the library fall back to "AppID <id>".
export function compatUsageGameNames(appIds: string[]): string[] {
  const extras = t().extras!;
  return appIds
    .map((id) => {
      const numeric = Number(id);
      const name = Number.isFinite(numeric) ? resolveAppName(numeric) : '';
      return name || extras.appIdLabel(id);
    })
    .sort((a, b) => a.localeCompare(b));
}

// Rolling latest slots first, everything else in its original order.
export function sortRollingSlotsFirst<T extends { tool?: { managed_slot?: string | null } | null }>(rows: T[]): T[] {
  const isSlot = (row: T) => (row.tool?.managed_slot === 'latest' ? 0 : 1);
  return [...rows].sort((a, b) => isSlot(a) - isSlot(b));
}
