import { describe, expect, it } from "vitest";
import {
  childAqlPath,
  extractRecordedCode,
  findTemplateNodeByAqlPath,
  stripNamePredicates,
} from "./valueList";

const OBS = "openEHR-EHR-OBSERVATION.tobacco_smoking_summary.v1";
const ELEMENT_PATH = `/content[${OBS}]/data[at0001]/events[at0002]/data[at0003]/items[at0004]/value`;

/** Minimal Web Template whose leaf nodes sit under one OBSERVATION. */
function template(leaves: Record<string, unknown>[], archetype = OBS): Record<string, unknown> {
  return {
    templateId: "Anamnesis",
    tree: {
      id: "anamnesis",
      rmType: "COMPOSITION",
      aqlPath: "/",
      children: [
        {
          id: "tobacco_smoking_summary",
          rmType: "OBSERVATION",
          nodeId: archetype,
          aqlPath: `/content[${archetype}]`,
          children: leaves,
        },
      ],
    },
  };
}

describe("stripNamePredicates", () => {
  it("drops name predicates but keeps node ids", () => {
    expect(
      stripNamePredicates(
        "/content[openEHR-EHR-OBSERVATION.x.v1,'Smoking']/data[at0001]/items[at0004,'Status']/value",
      ),
    ).toBe("/content[openEHR-EHR-OBSERVATION.x.v1]/data[at0001]/items[at0004]/value");
  });
});

describe("childAqlPath", () => {
  it("appends the archetype node id as a predicate when the child has one", () => {
    expect(childAqlPath("", "content", { archetype_node_id: "openEHR-EHR-OBSERVATION.x.v1" })).toBe(
      "/content[openEHR-EHR-OBSERVATION.x.v1]",
    );
    expect(
      childAqlPath("/content[openEHR-EHR-OBSERVATION.x.v1]", "data", {
        archetype_node_id: "at0001",
      }),
    ).toBe("/content[openEHR-EHR-OBSERVATION.x.v1]/data[at0001]");
  });

  it("appends a bare attribute for children without a node id (e.g. the ELEMENT value)", () => {
    expect(childAqlPath("/items[at0004]", "value", { _type: "DV_CODED_TEXT" })).toBe(
      "/items[at0004]/value",
    );
  });
});

describe("extractRecordedCode", () => {
  it("reads a DV_CODED_TEXT", () => {
    expect(
      extractRecordedCode({
        _type: "DV_CODED_TEXT",
        value: "Former smoker",
        defining_code: { terminology_id: { value: "A06_smoking" }, code_string: "2" },
      }),
    ).toEqual({
      rmType: "DV_CODED_TEXT",
      terminology: "A06_smoking",
      code: "2",
      label: "Former smoker",
      ordinal: null,
    });
  });

  it("reads a DV_ORDINAL via symbol.defining_code", () => {
    expect(
      extractRecordedCode({
        _type: "DV_ORDINAL",
        value: 3,
        symbol: {
          value: "Severe",
          defining_code: { terminology_id: { value: "local" }, code_string: "at0012" },
        },
      }),
    ).toEqual({
      rmType: "DV_ORDINAL",
      terminology: "local",
      code: "at0012",
      label: "Severe",
      ordinal: 3,
    });
  });

  it("returns null for DV_TEXT and for coded values without a code", () => {
    expect(extractRecordedCode({ _type: "DV_TEXT", value: "free text" })).toBeNull();
    expect(
      extractRecordedCode({
        _type: "DV_CODED_TEXT",
        value: "x",
        defining_code: { terminology_id: { value: "local" } },
      }),
    ).toBeNull();
  });
});

describe("findTemplateNodeByAqlPath", () => {
  it("finds the node whose aqlPath (name predicates stripped) equals the path", () => {
    const tpl = template([
      { id: "overall_status", rmType: "DV_CODED_TEXT", aqlPath: `${ELEMENT_PATH}` },
      {
        id: "comment",
        rmType: "DV_TEXT",
        aqlPath: `/content[${OBS}]/data[at0001]/events[at0002]/data[at0003]/items[at0099]/value`,
      },
    ]);
    const match = findTemplateNodeByAqlPath(tpl, ELEMENT_PATH, "Overall status");
    expect(match.status).toBe("found");
    expect(match.status === "found" && match.node.id).toBe("overall_status");
  });

  it("disambiguates same-path siblings by the element name (localizedNames or name)", () => {
    const tpl = template([
      {
        id: "status_a",
        name: "Status A",
        rmType: "DV_CODED_TEXT",
        aqlPath: ELEMENT_PATH.replace("items[at0004]", "items[at0004,'Status A']"),
      },
      {
        id: "status_b",
        name: "Status B",
        localizedNames: { sl: "Stanje B" },
        rmType: "DV_CODED_TEXT",
        aqlPath: ELEMENT_PATH.replace("items[at0004]", "items[at0004,'Status B']"),
      },
    ]);
    const byName = findTemplateNodeByAqlPath(tpl, ELEMENT_PATH, "Status B");
    expect(byName.status === "found" && byName.node.id).toBe("status_b");
    const byLocalizedName = findTemplateNodeByAqlPath(tpl, ELEMENT_PATH, "Stanje B");
    expect(byLocalizedName.status === "found" && byLocalizedName.node.id).toBe("status_b");
  });

  it("reports ambiguous when same-path siblings can't be told apart by name", () => {
    const tpl = template([
      { id: "status_a", name: "Status A", rmType: "DV_CODED_TEXT", aqlPath: ELEMENT_PATH },
      { id: "status_b", name: "Status B", rmType: "DV_CODED_TEXT", aqlPath: ELEMENT_PATH },
    ]);
    expect(findTemplateNodeByAqlPath(tpl, ELEMENT_PATH, "Something else")).toEqual({
      status: "ambiguous",
      count: 2,
    });
  });

  it("reports not-found rather than matching the same at-code elsewhere", () => {
    const other = "openEHR-EHR-OBSERVATION.alcohol_consumption_summary.v1";
    const tpl = template(
      [
        {
          id: "overall_status",
          rmType: "DV_CODED_TEXT",
          aqlPath: ELEMENT_PATH.replace(OBS, other),
        },
      ],
      other,
    );
    expect(findTemplateNodeByAqlPath(tpl, ELEMENT_PATH, "Overall status")).toEqual({
      status: "not-found",
    });
  });
});
