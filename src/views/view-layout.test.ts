import { describe, expect, it } from "vitest";
import viewBrowserSfc from "./ViewBrowser.vue?raw";

// JsonViewer fills its container through `flex: 1; min-height: 0` and
// virtualises against that height (ADR-0023). In a plain block container it
// grows to its full content height instead and spills over the sections
// below it — so the Views view's JSON boxes must be bounded flex columns.
const rule = (selector: string): string => {
  const match = viewBrowserSfc.match(
    new RegExp(`\\n${selector.replace(".", "\\.")} \\{([^}]*)\\}`),
  );
  return match?.[1] ?? "";
};

describe("ViewBrowser JSON boxes", () => {
  it("are bounded flex columns that clip their content", () => {
    const box = rule(".json-box");
    expect(box).toMatch(/height:\s*\d+px/);
    expect(box).toMatch(/display:\s*flex/);
    expect(box).toMatch(/flex-direction:\s*column/);
    expect(box).toMatch(/overflow:\s*hidden/);
  });
});
