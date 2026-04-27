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

  it("returns an empty context when there is no app id anywhere", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 0,
        focusedAppName: "",
        initialAppId: 0,
        lookedUpAppName: "",
        routeAppId: 0,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 0,
      appName: "",
    });
  });

  it("prefers the looked up name when the chosen app is not the focused app", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 1910310,
        focusedAppName: "Old Focus",
        initialAppId: 0,
        lookedUpAppName: "Selected Game",
        routeAppId: 730,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 730,
      appName: "Selected Game",
    });
  });

  it("falls back to the focused name when the selected app has no looked up name", () => {
    expect(
      selectMenuAppContext({
        focusedAppId: 1910310,
        focusedAppName: "Fallback Focus",
        initialAppId: 730,
        lookedUpAppName: "",
        routeAppId: 0,
        treeAppId: 0,
      })
    ).toEqual({
      appId: 730,
      appName: "Fallback Focus",
    });
  });
});
