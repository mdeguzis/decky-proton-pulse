// src/lib/gameSource.ts
// Frontend wrappers around backend game-source callables.
import { callable } from '@decky/api';

export interface GameSourceInfo {
  is_steam: boolean;
  source: string;
  steam_app_id_match: string | null;
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
