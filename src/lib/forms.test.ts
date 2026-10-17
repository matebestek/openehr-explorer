import { describe, expect, it } from "vitest";
import {
  buildFieldTree,
  environmentModel,
  filterGroups,
  formLanguages,
  formTypeLabels,
  groupForms,
  layoutOutline,
  resource,
  resourceStatus,
  returnToListOnServerChange,
  typeChips,
  type FormDefinition,
  type FormSummary,
} from "./forms";

function e(name: string, version: string, label?: string): FormSummary {
  return {
    name,
    version,
    template_id: name.split(" ")[0],
    created_timestamp: null,
    status: "active",
    category: "default",
    creator: "admin",
    form_type: "JSON",
    schema_version: "2.3",
    tags: label === undefined ? {} : { _form_labels: label },
  };
}

describe("formTypeLabels", () => {
  it("splits and trims comma-separated _form_labels; none means []", () => {
    expect(formTypeLabels({ _form_labels: "Gineko Portal, CLINICAL FORM" })).toEqual([
      "Gineko Portal",
      "CLINICAL FORM",
    ]);
    expect(formTypeLabels({ _form_labels: "HISTOPATO Z2 2345,Deprecated" })).toEqual([
      "HISTOPATO Z2 2345",
      "Deprecated",
    ]);
    expect(formTypeLabels({})).toEqual([]);
    expect(formTypeLabels({ _form_labels: " , " })).toEqual([]);
  });
});

describe("groupForms", () => {
  it("groups versions by name, newest first by numeric version", () => {
    const g = groupForms([
      e("HPV Report", "1.0.20"),
      e("HPV Report", "1.0.157"),
      e("HPV Report", "1.0.3"),
      e("Alerts", "1.0.3"),
    ]);
    expect(g.map((x) => x.name)).toEqual(["Alerts", "HPV Report"]);
    expect(g[1].versions).toEqual(["1.0.157", "1.0.20", "1.0.3"]);
    expect(g[1].latest.version).toBe("1.0.157");
  });

  it("takes template and type labels from the latest version", () => {
    const older = { ...e("Anamnesis", "1.0.1", "REQUEST"), template_id: "Old" };
    const latest = { ...e("Anamnesis", "1.0.2", "VIEW"), template_id: "Anamnesis" };
    const [g] = groupForms([latest, older]);
    expect(g.templateId).toBe("Anamnesis");
    expect(g.typeLabels).toEqual(["VIEW"]);
  });

  it("sorts names case-insensitively", () => {
    expect(groupForms([e("beta", "1.0.0"), e("Alpha", "1.0.0")]).map((g) => g.name)).toEqual([
      "Alpha",
      "beta",
    ]);
  });
});

describe("typeChips", () => {
  it("builds chips from all labels with No type last", () => {
    expect(
      typeChips(
        groupForms([e("A", "1.0.1", "REQUEST"), e("B", "1.0.1"), e("C", "1.0.1", "CLINICAL FORM")]),
      ),
    ).toEqual(["CLINICAL FORM", "REQUEST", "No type"]);
  });
});

describe("filterGroups", () => {
  const groups = groupForms([
    { ...e("Anamnesis Treatment", "1.0.1", "CLINICAL FORM"), template_id: "Anamnesis" },
    { ...e("HPV Report", "1.0.1"), template_id: "HPV" },
    { ...e("Alerts", "1.0.1", "REQUEST"), template_id: "Alerts" },
  ]);

  it("filters by text over name and template, ignoring case", () => {
    expect(filterGroups(groups, "anam", null).map((g) => g.name)).toEqual(["Anamnesis Treatment"]);
    expect(filterGroups(groups, "hpv", null).map((g) => g.name)).toEqual(["HPV Report"]);
  });

  it("filters by chip, including No type", () => {
    expect(filterGroups(groups, "", "REQUEST").map((g) => g.name)).toEqual(["Alerts"]);
    expect(filterGroups(groups, "", "No type").map((g) => g.name)).toEqual(["HPV Report"]);
  });
});

describe("buildFieldTree", () => {
  it("labels nodes in the chosen language, falling back to name", () => {
    const t = buildFieldTree(
      {
        id: "anamnesis",
        name: "Anamnesis",
        rmType: "COMPOSITION",
        defaultLanguage: "en",
        children: [
          {
            id: "overall_status",
            formId: "anamnesis/x/overall_status",
            name: "Overall status",
            localizedNames: { en: "Smoking", sl: "Kajenje" },
            rmType: "DV_CODED_TEXT",
            min: 0,
            viewConfig: { advanced: { hidden: true, overrideLabel: true } },
          },
        ],
      },
      "sl",
    )!;
    expect(t.label).toBe("Anamnesis");
    expect(t.children[0].label).toBe("Kajenje");
    expect(t.children[0].key).toBe("anamnesis/x/overall_status");
    expect(t.children[0].badges).toEqual([{ kind: "hidden" }, { kind: "label-overridden" }]);
  });

  it("badges required, read-only, code list and remote data", () => {
    const t = buildFieldTree(
      {
        id: "source",
        name: "Source",
        min: 1,
        inputs: [
          { suffix: "code", terminology: "A02_anamnesis_source" },
          { suffix: "value", terminology: "A02_anamnesis_source" },
          { terminology: "openehr" },
        ],
        viewConfig: {
          field: { code: { readonly: true } },
          datasource: { loadRemote: true, loadRemoteUrl: "guideline" },
        },
      },
      "en",
    )!;
    expect(t.badges).toEqual([
      { kind: "read-only" },
      { kind: "required" },
      { kind: "code-list", value: "A02_anamnesis_source" },
      { kind: "remote", value: "guideline" },
    ]);
  });

  it("renders a bare node with no viewConfig, localizedNames or children", () => {
    expect(buildFieldTree({ id: "x", name: "X" }, "sl")).toEqual({
      key: "x",
      label: "X",
      rmType: null,
      badges: [],
      children: [],
      raw: { id: "x", name: "X" },
    });
    expect(buildFieldTree(null, "en")).toBeNull();
  });
});

describe("formLanguages", () => {
  it("lists the form's languages with the default first", () => {
    expect(
      formLanguages({
        defaultLanguage: "sl",
        localizedNames: { en: "a", sl: "b" },
        children: [{ localizedNames: { de: "c" } }],
      }),
    ).toEqual(["sl", "de", "en"]);
    expect(formLanguages(undefined)).toEqual([]);
  });
});

describe("environmentModel", () => {
  it("models environment variables and external API calls", () => {
    const m = environmentModel({
      variables: [
        { name: "terminologyUrl", type: "string", source: "EXTERNALLY_PROVIDED", value: "" },
      ],
      externalApis: [
        {
          name: "Zorica Terminologies",
          authentication: { type: "None" },
          calls: [
            {
              name: "getTerminology",
              requestMethod: "GET",
              url: "terminologyUrl",
              bodyType: "JSON",
              pathParams: { "{codeSystem}": "Z_lymph_nodes" },
              parameters: [{ name: "code", value: "1" }],
              sampleResponse: { items: [] },
            },
          ],
        },
      ],
    });
    expect(m.variables[0]).toEqual({
      name: "terminologyUrl",
      type: "string",
      source: "EXTERNALLY_PROVIDED",
      mandatory: false,
      value: "",
    });
    expect(m.apis[0].authType).toBe("None");
    expect(m.apis[0].calls[0]).toMatchObject({
      name: "getTerminology",
      method: "GET",
      url: "terminologyUrl",
      bodyType: "JSON",
      pathParams: { "{codeSystem}": "Z_lymph_nodes" },
      parameters: [{ name: "code", value: "1" }],
    });
    expect(environmentModel(undefined)).toEqual({ variables: [], apis: [] });
  });
});

describe("layoutOutline", () => {
  it("outlines the layout grid", () => {
    expect(
      layoutOutline([
        {
          col: 1,
          row: 1,
          width: 12,
          children: [
            {
              id: "anamnesis/context",
              rows: [{ cols: [{ width: "100%", children: [{ id: "anamnesis/context/a" }] }] }],
            },
          ],
        },
      ]),
    ).toEqual([
      { depth: 0, text: "Cell row 1, col 1, width 12" },
      { depth: 1, text: "anamnesis/context" },
      { depth: 2, text: "Column 100%" },
      { depth: 3, text: "anamnesis/context/a" },
    ]);
    expect(layoutOutline(null)).toEqual([]);
  });
});

describe("resource", () => {
  it("returns a resource's content, or null when missing or empty", () => {
    const def: FormDefinition = {
      summary: e("A", "1.0.0"),
      href: null,
      resources: [
        {
          name: "form-layout",
          mimetype: "application/json",
          href: null,
          content: [1],
          requested: true,
        },
        {
          name: "form-metadata",
          mimetype: "application/json",
          href: null,
          content: null,
          requested: true,
        },
      ],
      raw: {},
    };
    expect(resource(def, "form-layout")).toEqual([1]);
    expect(resource(def, "form-metadata")).toBeNull();
    expect(resource(def, "app-pages")).toBeNull();
  });
});

describe("resourceStatus", () => {
  it("tells empty resources from ones whose content wasn't requested", () => {
    const base = { name: "x", mimetype: null, href: null };
    expect(resourceStatus({ ...base, content: { a: 1 }, requested: true })).toBe("content");
    expect(resourceStatus({ ...base, content: null, requested: true })).toBe("empty");
    expect(resourceStatus({ ...base, content: null, requested: false })).toBe("not-fetched");
  });
});

describe("returnToListOnServerChange", () => {
  it("leaves an open form only when the server actually changes after the first load", () => {
    expect(returnToListOnServerChange(undefined, "a")).toBe(false);
    expect(returnToListOnServerChange("a", "a")).toBe(false);
    expect(returnToListOnServerChange("a", "b")).toBe(true);
    expect(returnToListOnServerChange("a", null)).toBe(true);
  });
});
