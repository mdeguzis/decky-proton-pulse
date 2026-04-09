export interface MenuAppSelectionInput {
  focusedAppId: number;
  focusedAppName: string;
  initialAppId: number;
  lookedUpAppName: string;
  routeAppId: number;
  treeAppId: number;
}

export interface MenuAppSelection {
  appId: number;
  appName: string;
}

export function selectMenuAppContext(
  input: MenuAppSelectionInput
): MenuAppSelection {
  const appId =
    input.treeAppId ||
    input.routeAppId ||
    input.initialAppId ||
    input.focusedAppId;

  if (!appId) {
    return { appId: 0, appName: "" };
  }

  const appName =
    appId === input.focusedAppId && input.focusedAppName
      ? input.focusedAppName
      : input.lookedUpAppName || input.focusedAppName;

  return { appId, appName };
}
