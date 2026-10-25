// src/lib/steamDefaultState.ts
//
// Pure state for "Default" Proton reports (#115), kept free of @decky/api so
// formatters can import it. compatToolSelect.ts loads the tool from Steam and
// stores it here.

const STEAM_DEFAULT_RE = /^(steam|proton)?[\s_-]*default$/i;

/** True for report versions that mean "whatever Steam's default was". */
export function isSteamDefaultProton(version: string | null | undefined): boolean {
  return !!version && STEAM_DEFAULT_RE.test(version.trim());
}

export interface SteamDefaultTool { toolName: string; displayName: string }

let _tool: SteamDefaultTool | null = null;

/** Last loaded Steam default tool, or null if not loaded / not set. */
export function steamDefaultToolSync(): SteamDefaultTool | null {
  return _tool;
}

export function setSteamDefaultTool(tool: SteamDefaultTool | null): void {
  _tool = tool;
}
