import { describe, expect, it } from "vitest";
import { canOpenInAqlRunner, filterViews, isAqlStep, type ViewSummary } from "./views";

const views: ViewSummary[] = [
  { name: "allergy", description: "Gets allergies for a patient", steps: ["jsonAql"] },
  { name: "Get HPV reports", description: "v1.0.0 Get HPV report summary", steps: ["jsonAql"] },
  { name: "getIncompleteComposition", description: null, steps: ["js"] },
];

describe("filterViews", () => {
  it("matches name or description, ignoring case", () => {
    expect(filterViews(views, "HPV").map((v) => v.name)).toEqual(["Get HPV reports"]);
    expect(filterViews(views, "patient").map((v) => v.name)).toEqual(["allergy"]);
    expect(filterViews(views, "incomplete").map((v) => v.name)).toEqual([
      "getIncompleteComposition",
    ]);
  });

  it("returns everything for empty text", () => {
    expect(filterViews(views, "  ")).toHaveLength(3);
  });
});

describe("step kinds", () => {
  const step = (processor_name: string) => ({ processor_name, processor_data: "x" });

  it("treats jsonAql and jsonFtlAql as AQL, but only jsonAql opens in the AQL Runner", () => {
    expect([isAqlStep(step("jsonAql")), canOpenInAqlRunner(step("jsonAql"))]).toEqual([true, true]);
    expect([isAqlStep(step("jsonFtlAql")), canOpenInAqlRunner(step("jsonFtlAql"))]).toEqual([
      true,
      false,
    ]);
    expect([isAqlStep(step("js")), canOpenInAqlRunner(step("js"))]).toEqual([false, false]);
  });
});
