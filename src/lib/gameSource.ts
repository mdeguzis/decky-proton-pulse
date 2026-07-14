// src/lib/gameSource.ts
// Frontend wrappers around backend game-source callables.
import { callable } from '@decky/api';

export interface GameSourceInfo {
  is_steam: boolean;
  source: string;
  steam_app_id_match: string | null;
  full_game_app_id: string | null;
  full_game_name: string | null;
  gog_product_id: string | null;
  epic_game_id: string | null;
}

export type AppType = 'steam' | 'gog' | 'epic' | 'nonsteam';

export function appTypeFromSource(info: GameSourceInfo): AppType {
  if (info.is_steam) return 'steam';
  if (info.gog_product_id) return 'gog';
  if (info.epic_game_id) return 'epic';
  if (info.source === 'GOG') return 'gog';
  if (info.source === 'Epic') return 'epic';
  return 'nonsteam';
}

export function nativeAppIdFromSource(info: GameSourceInfo, fallbackId: number): string {
  if (info.gog_product_id) return `gog:${info.gog_product_id}`;
  if (info.epic_game_id) return `epic:${info.epic_game_id}`;
  if (info.steam_app_id_match) return info.steam_app_id_match;
  return String(fallbackId);
}

// Human-readable store name inferred from Heroic / launcher metadata. Heroic
// carries the underlying store in its launch URL (heroic://launch/gog/... or
// heroic://launch/legendary/... which is Epic). Returns null when the store
// cannot be identified so the caller only shows the launcher pill.
export function sourceStoreLabel(info: GameSourceInfo | null | undefined): string | null {
  if (!info) return null;
  if (info.epic_game_id) return 'Epic Games';
  if (info.gog_product_id) return 'GOG';
  return null;
}

const _getGameSource = callable<[string, string], GameSourceInfo>('get_game_source');
const _getShortcutName = callable<[string], string>('get_shortcut_name');

export async function getGameSource(appId: number, appName: string): Promise<GameSourceInfo | null> {
  try {
    return await _getGameSource(String(appId), appName);
  } catch {
    return null;
  }
}

export async function getShortcutName(appId: number): Promise<string> {
  try {
    return await _getShortcutName(String(appId));
  } catch {
    return '';
  }
}
