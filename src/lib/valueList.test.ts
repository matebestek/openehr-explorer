import { describe, expect, it } from "vitest";
import {
  buildValueListModel,
  childAqlPath,
  extractRecordedCode,
  extractValueSetUrl,
  findTemplateNodeByAqlPath,
  normaliseBindings,
  pickLanguage,
  stripNamePredicates,
  templateLanguages,
  visibleOptions,
  type RecordedCode,
  type ValueListOption,
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

describe("templateLanguages", () => {
  it("reads languages and defaultLanguage from the Web Template root", () => {
    expect(templateLanguages({ languages: ["en", "sl"], defaultLanguage: "sl" })).toEqual({
      languages: ["en", "sl"],
      defaultLanguage: "sl",
    });
    expect(templateLanguages({})).toEqual({ languages: [], defaultLanguage: null });
  });
});

describe("pickLanguage", () => {
  it("prefers the composition language when the template has it", () => {
    expect(pickLanguage("sl", ["en", "sl"], "en")).toBe("sl");
  });

  it("falls back to the template default, then the first language", () => {
    expect(pickLanguage("de", ["en", "sl"], "sl")).toBe("sl");
    expect(pickLanguage(null, ["en", "sl"], null)).toBe("en");
    expect(pickLanguage(null, [], null)).toBeNull();
  });
});

describe("normaliseBindings", () => {
  it("accepts { TERM: { value: { codeString } } }, { TERM: { codeString } } and '[TERM::code]' shapes", () => {
    expect(normaliseBindings({ "SNOMED-CT": { value: { codeString: "8517006" } } })).toEqual([
      { terminology: "SNOMED-CT", code: "8517006" },
    ]);
    expect(normaliseBindings({ LOINC: { codeString: "72166-2" } })).toEqual([
      { terminology: "LOINC", code: "72166-2" },
    ]);
    expect(normaliseBindings({ "SNOMED-CT": "[SNOMED-CT(2003)::8517006]" })).toEqual([
      { terminology: "SNOMED-CT", code: "8517006" },
    ]);
  });

  it("returns [] for missing or unrecognised input", () => {
    expect(normaliseBindings(undefined)).toEqual([]);
    expect(normaliseBindings(42)).toEqual([]);
  });
});

describe("extractValueSetUrl", () => {
  it("reads url= from a terminology:// expand reference", () => {
    expect(
      extractValueSetUrl({
        inputs: [
          {
            suffix: "code",
            terminology:
              "terminology://fhir.hl7.org/ValueSet/$expand?url=http://example.org/vs/smoking",
          },
        ],
      }),
    ).toBe("http://example.org/vs/smoking");
  });

  it("accepts a direct http(s) ValueSet URL", () => {
    expect(
      extractValueSetUrl({
        inputs: [{ suffix: "code", terminology: "http://example.org/fhir/ValueSet/smoking" }],
      }),
    ).toBe("http://example.org/fhir/ValueSet/smoking");
  });

  it("returns null for plain terminology ids", () => {
    expect(
      extractValueSetUrl({ inputs: [{ suffix: "code", terminology: "SNOMED-CT" }] }),
    ).toBeNull();
  });
});

const smokingNode = {
  id: "overall_status",
  name: "Smoking status",
  localizedNames: { en: "Smoking status", sl: "Status kajenja" },
  localizedDescriptions: {
    en: "Current or past tobacco use",
    sl: "Trenutna ali pretekla raba tobaka",
  },
  rmType: "DV_CODED_TEXT",
  aqlPath: ELEMENT_PATH,
  termBindings: { "SNOMED-CT": { value: { codeString: "229819007" } } },
  annotations: { comment: "Asked at every visit" },
  inputs: [
    {
      suffix: "code",
      type: "CODED_TEXT",
      terminology: "A06_smoking",
      list: [
        {
          value: "1",
          label: "Never smoked",
          localizedLabels: { en: "Never smoked", sl: "Nekadilec" },
          localizedDescriptions: { en: "Never smoked", sl: "Nikoli kadil" },
        },
        {
          value: "2",
          label: "Former smoker",
          localizedLabels: { en: "Former smoker" },
          termBindings: { "SNOMED-CT": { value: { codeString: "8517006" } } },
        },
      ],
    },
  ],
};

const ordinalNode = {
  id: "severity",
  name: "Severity",
  rmType: "DV_ORDINAL",
  inputs: [
    {
      type: "CODED_TEXT",
      list: [{ value: "at0012", label: "Severe", ordinal: 3 }],
    },
  ],
};

describe("buildValueListModel", () => {
  it("uses the selected language for field and option text", () => {
    const m = buildValueListModel(smokingNode, "sl");
    expect(m.fieldName).toBe("Status kajenja");
    expect(m.fieldDescription).toBe("Trenutna ali pretekla raba tobaka");
    expect(m.terminology).toBe("A06_smoking");
    expect(m.rmType).toBe("DV_CODED_TEXT");
    expect(m.options[0]).toMatchObject({
      code: "1",
      label: "Nekadilec",
      description: "Nikoli kadil",
    });
  });

  it("falls back to the default label and a null description when a translation is missing", () => {
    expect(buildValueListModel(smokingNode, "sl").options[1]).toMatchObject({
      code: "2",
      label: "Former smoker",
      description: null,
    });
  });

  it("carries option and field bindings and annotations", () => {
    const m = buildValueListModel(smokingNode, "en");
    expect(m.options[1].bindings).toEqual([{ terminology: "SNOMED-CT", code: "8517006" }]);
    expect(m.fieldBindings).toEqual([{ terminology: "SNOMED-CT", code: "229819007" }]);
    expect(m.annotations).toEqual({ comment: "Asked at every visit" });
    expect(m.listOpen).toBe(false);
    expect(m.valueSetUrl).toBeNull();
  });

  it("carries ordinals for DV_ORDINAL lists", () => {
    expect(buildValueListModel(ordinalNode, "en").options[0].ordinal).toBe(3);
  });
});

function opt(code: string): ValueListOption {
  return { code, label: `Label ${code}`, description: null, ordinal: null, bindings: [] };
}

function rec(code: string): RecordedCode {
  return { rmType: "DV_CODED_TEXT", terminology: "local", code, label: null, ordinal: null };
}

describe("visibleOptions", () => {
  it("flags a recorded code that is not in the list", () => {
    expect(visibleOptions([opt("1"), opt("3")], rec("2")).recordedNotInList).toBe(true);
    expect(visibleOptions([opt("1"), opt("2")], rec("2")).recordedNotInList).toBe(false);
  });

  it("caps rows but always includes the recorded option", () => {
    const many = Array.from({ length: 500 }, (_, i) => opt(String(i)));
    const v = visibleOptions(many, rec("450"), 200);
    expect(v.rows).toHaveLength(200);
    expect(v.rows.some((r) => r.code === "450")).toBe(true);
    expect(v.hiddenCount).toBe(300);
  });
});
