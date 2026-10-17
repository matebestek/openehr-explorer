import { describe, expect, it } from "vitest";
import {
  navItems,
  pathForShortcutKey,
  shortcutKeyForIndex,
  shortcutRangeLabel,
} from "./navShortcuts";

describe("navShortcuts", () => {
  it("maps every tab to its position-based key", () => {
    navItems.forEach((item, i) => {
      expect(pathForShortcutKey(shortcutKeyForIndex(i))).toBe(item.path);
    });
  });

  it("maps comma to settings", () => {
    expect(pathForShortcutKey(",")).toBe("/settings");
  });

  it("ignores keys beyond the tab list and non-shortcut keys", () => {
    expect(pathForShortcutKey(String(navItems.length + 1))).toBeNull();
    expect(pathForShortcutKey("0")).toBeNull();
    expect(pathForShortcutKey("a")).toBeNull();
  });

  it("places Forms directly after Templates", () => {
    const paths = navItems.map((i) => i.path);
    expect(paths.indexOf("/forms")).toBe(paths.indexOf("/templates") + 1);
    expect(pathForShortcutKey("4")).toBe("/forms");
  });

  it("places Views directly after Forms", () => {
    const paths = navItems.map((i) => i.path);
    expect(paths.indexOf("/views")).toBe(paths.indexOf("/forms") + 1);
    expect(pathForShortcutKey("5")).toBe("/views");
  });

  it("describes the range from the tab count", () => {
    expect(shortcutRangeLabel()).toBe(`1–${navItems.length}`);
  });
});
