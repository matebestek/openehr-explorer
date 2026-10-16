import { describe, expect, it } from "vitest";
import {
  codeListEntryToDescription,
  codeListEntryToValidation,
  filterCodeListItems,
  localSystemOptions,
  terminologySystemAnalyticsKey,
} from "./terminology";

describe("terminologySystemAnalyticsKey", () => {
  it("maps known shortcuts case-insensitively", () => {
    expect(terminologySystemAnalyticsKey("SNOMED-CT")).toBe("snomed-ct");
    expect(terminologySystemAnalyticsKey(" loinc ")).toBe("loinc");
  });

  it("maps canonical URIs of known systems to their shortcut", () => {
    expect(terminologySystemAnalyticsKey("http://snomed.info/sct")).toBe("snomed-ct");
    expect(terminologySystemAnalyticsKey("http://hl7.org/fhir/sid/icd-10")).toBe("icd-10");
  });

  it("never leaks custom system identifiers", () => {
    expect(terminologySystemAnalyticsKey("http://example.org/private-codes")).toBe("other");
    expect(terminologySystemAnalyticsKey("")).toBe("other");
  });
});

describe("local code systems (code-list service)", () => {
  const entry = {
    code_system: "A06_smoking",
    code: "2",
    description: "Former smoker",
    user_code: "A06.2",
    source_url:
      "https://cdr.example/terminology-adapter/rest/terminology/codesystem/A06_smoking/entity/2?language=en",
  };

  it("builds picker options labelled by description, sorted by label", () => {
    expect(
      localSystemOptions([
        { code: "Z_lymph_nodes", description: "Z_lymph_nodes", languages: ["sl"] },
        { code: "Gender", description: "Spol", languages: ["sl", "en"] },
      ]),
    ).toEqual([
      { value: "Gender", label: "Spol (Gender)", languages: ["sl", "en"] },
      { value: "Z_lymph_nodes", label: "Z_lymph_nodes", languages: ["sl"] },
    ]);
  });

  it("turns an entry into a code description with user code and language", () => {
    expect(codeListEntryToDescription(entry, "en")).toEqual({
      system: "A06_smoking",
      code: "2",
      display: "Former smoker",
      designations: [],
      properties: [
        { code: "user_code", value: "A06.2" },
        { code: "language", value: "en" },
      ],
    });
  });

  it("turns an entry lookup into a validation result", () => {
    expect(codeListEntryToValidation(entry, "A06_smoking", "2")).toEqual({
      result: true,
      message: null,
      display: "Former smoker",
    });
    expect(codeListEntryToValidation(null, "A06_smoking", "99")).toEqual({
      result: false,
      message: "Code 99 is not in A06_smoking.",
      display: null,
    });
  });

  it("filters a code list by code, description or user code, ignoring case", () => {
    const items = [
      { code: "1", description: "Never smoked", user_code: "A06.1" },
      { code: "2", description: "Former smoker", user_code: "A06.2" },
      { code: "3", description: "Current smoker", user_code: "A06.3" },
    ];
    expect(filterCodeListItems(items, "SMOKER").map((i) => i.code)).toEqual(["2", "3"]);
    expect(filterCodeListItems(items, "a06.1").map((i) => i.code)).toEqual(["1"]);
    expect(filterCodeListItems(items, "  ")).toHaveLength(3);
  });
});
