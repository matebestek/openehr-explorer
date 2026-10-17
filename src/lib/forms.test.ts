import { describe, expect, it } from "vitest";
import { filterGroups, formTypeLabels, groupForms, typeChips, type FormSummary } from "./forms";

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
