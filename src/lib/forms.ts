/**
 * Better Platform forms (PRD-0020): the shapes the `list_forms` / `get_form`
 * commands return (src-tauri/src/commands/form.rs) and pure functions that
 * turn them into what the Forms view shows. All interpretation lives here so
 * it can be unit-tested; the view and components only render.
 */
import { invoke } from "@tauri-apps/api/core";
import { compareVersions } from "./whats-new";

export interface FormSummary {
  name: string;
  version: string;
  template_id: string | null;
  created_timestamp: string | null;
  status: string | null;
  category: string | null;
  creator: string | null;
  /** Better's `type` attribute (e.g. `JSON`). */
  form_type: string | null;
  schema_version: string | null;
  tags: Record<string, string>;
}

export interface FormResource {
  name: string;
  mimetype: string | null;
  href: string | null;
  /** `null` for an empty resource. */
  content: unknown;
}

export interface FormDefinition {
  summary: FormSummary;
  href: string | null;
  resources: FormResource[];
}

/** Every form entry (one per version) on the server. */
export function listForms(serverId: string): Promise<FormSummary[]> {
  return invoke<FormSummary[]>("list_forms", { serverId });
}

/** One form version with all of its resources. */
export function getForm(serverId: string, name: string, version: string): Promise<FormDefinition> {
  return invoke<FormDefinition>("get_form", { serverId, name, version });
}

/** One form name with all its versions. */
export interface FormGroup {
  name: string;
  templateId: string | null;
  latest: FormSummary;
  /** Newest first. */
  versions: string[];
  typeLabels: string[];
}

/** Chip for forms without a `_form_labels` tag. */
export const NO_TYPE = "No type";

/** A form's type labels from its comma-separated `_form_labels` tag. */
export function formTypeLabels(tags: Record<string, string>): string[] {
  return (tags._form_labels ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Groups the per-version list by form name; versions newest first, groups by name. */
export function groupForms(entries: FormSummary[]): FormGroup[] {
  const byForm = new Map<string, FormSummary[]>();
  for (const entry of entries) {
    const list = byForm.get(entry.name) ?? [];
    list.push(entry);
    byForm.set(entry.name, list);
  }
  return [...byForm.entries()]
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => compareVersions(b.version, a.version));
      const latest = sorted[0];
      return {
        name,
        templateId: latest.template_id,
        latest,
        versions: sorted.map((s) => s.version),
        typeLabels: formTypeLabels(latest.tags),
      };
    })
    .sort((a, b) => byName(a.name, b.name));
}

/** Type chips: every label present, sorted, then "No type" if any form has none. */
export function typeChips(groups: FormGroup[]): string[] {
  const labels = new Set<string>();
  let untyped = false;
  for (const g of groups) {
    if (g.typeLabels.length === 0) untyped = true;
    for (const l of g.typeLabels) labels.add(l);
  }
  const chips = [...labels].sort(byName);
  return untyped ? [...chips, NO_TYPE] : chips;
}

/** Text filter over name and template (case-insensitive), plus an optional type chip. */
export function filterGroups(groups: FormGroup[], text: string, chip: string | null): FormGroup[] {
  const needle = text.trim().toLowerCase();
  return groups.filter((g) => {
    if (
      needle &&
      !g.name.toLowerCase().includes(needle) &&
      !(g.templateId ?? "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (chip === null) return true;
    return chip === NO_TYPE ? g.typeLabels.length === 0 : g.typeLabels.includes(chip);
  });
}
