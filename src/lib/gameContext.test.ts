import { describe, expect, it } from "vitest";

import { selectMenuAppContext } from "./gameContext";

describe("selectMenuAppContext", () => {
  it("prefers the explicit menu app over stale focused app state", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 1910310,
        focusedAppName: "Wukong",
        initialAppId: 2358720,
        lookedUpAppName: "Black Myth: Wukong",
        routeAppId: 0,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 2358720,
      appName: "Black Myth: Wukong",
    });
  });

  it("uses the focused app only as the last fallback", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 1910310,
        focusedAppName: "Wukong",
        initialAppId: 0,
        lookedUpAppName: "",
        routeAppId: 0,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 1910310,
      appName: "Wukong",
    });
  });

  it("keeps the focused name only when it still matches the selected app", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 2358720,
        focusedAppName: "Black Myth: Wukong",
        initialAppId: 2358720,
        lookedUpAppName: "",
        routeAppId: 0,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 2358720,
      appName: "Black Myth: Wukong",
    });
  });
});
