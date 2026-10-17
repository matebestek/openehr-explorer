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
  /** `null` for an empty resource — or one whose content wasn't requested. */
  content: unknown;
  /** False for a resource the backend didn't ask for, so `null` content means "not fetched". */
  requested: boolean;
}

export interface FormDefinition {
  summary: FormSummary;
  href: string | null;
  resources: FormResource[];
  /** The form object as the server sent it, minus resources — nothing the app doesn't model is lost. */
  raw: unknown;
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

// --- Form definition view models --------------------------------------------

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A resource's content by name; `null` when the form has none. */
export function resource(def: FormDefinition, name: string): unknown {
  return def.resources.find((r) => r.name === name)?.content ?? null;
}

export type FieldBadge =
  | { kind: "hidden" }
  | { kind: "read-only" }
  | { kind: "required" }
  | { kind: "label-overridden" }
  | { kind: "code-list"; value: string }
  | { kind: "remote"; value: string };

export interface FieldNode {
  /** `formId`, else `id`, else the node's position path. */
  key: string;
  label: string;
  rmType: string | null;
  badges: FieldBadge[];
  children: FieldNode[];
  /** The node's own definition, without `children`. */
  raw: Json;
}

const OPENEHR_TERMINOLOGIES = new Set(["openehr", "local"]);

function fieldBadges(node: Json): FieldBadge[] {
  const viewConfig = asObject(node.viewConfig);
  const advanced = asObject(viewConfig?.advanced);
  const fieldConfigs = Object.values(asObject(viewConfig?.field) ?? {}).map(asObject);
  const datasource = asObject(viewConfig?.datasource);

  const badges: FieldBadge[] = [];
  if (advanced?.hidden === true) badges.push({ kind: "hidden" });
  if (fieldConfigs.some((f) => f?.readonly === true || f?.disabled === true)) {
    badges.push({ kind: "read-only" });
  }
  if (typeof node.min === "number" && node.min >= 1) badges.push({ kind: "required" });
  if (advanced?.overrideLabel === true) badges.push({ kind: "label-overridden" });

  const codeLists = new Set<string>();
  for (const input of asArray(node.inputs).map(asObject)) {
    const terminology = str(input?.terminology);
    if (terminology && !OPENEHR_TERMINOLOGIES.has(terminology)) codeLists.add(terminology);
  }
  for (const value of codeLists) badges.push({ kind: "code-list", value });

  const remoteUrl = str(datasource?.loadRemoteUrl);
  if (datasource?.loadRemote === true && remoteUrl)
    badges.push({ kind: "remote", value: remoteUrl });
  return badges;
}

function toFieldNode(node: Json, language: string | null, path: string): FieldNode {
  const localizedNames = asObject(node.localizedNames);
  const localized = language ? str(localizedNames?.[language]) : null;
  const { children, ...raw } = node;
  return {
    key: str(node.formId) ?? str(node.id) ?? path,
    label: localized ?? str(node.localizedName) ?? str(node.name) ?? str(node.id) ?? "(unnamed)",
    rmType: str(node.rmType),
    badges: fieldBadges(node),
    children: asArray(children)
      .map(asObject)
      .filter((c): c is Json => c !== null)
      .map((c, i) => toFieldNode(c, language, `${path}/${i}`)),
    raw,
  };
}

/** The form-description tree, labelled in `language` (falling back to `name`). */
export function buildFieldTree(description: unknown, language: string | null): FieldNode | null {
  const root = asObject(description);
  return root ? toFieldNode(root, language, "0") : null;
}

/** Every language in the tree's `localizedNames`, sorted, with `defaultLanguage` first. */
export function formLanguages(description: unknown): string[] {
  const root = asObject(description);
  if (!root) return [];
  const languages = new Set<string>();
  const visit = (node: Json) => {
    for (const lang of Object.keys(asObject(node.localizedNames) ?? {})) languages.add(lang);
    for (const child of asArray(node.children).map(asObject)) if (child) visit(child);
  };
  visit(root);
  const defaultLanguage = str(root.defaultLanguage);
  const rest = [...languages].filter((l) => l !== defaultLanguage).sort();
  return defaultLanguage ? [defaultLanguage, ...rest] : rest;
}

export interface EnvironmentCall {
  name: string;
  method: string | null;
  url: string | null;
  bodyType: string | null;
  pathParams: Record<string, string>;
  parameters: { name: string; value: string }[];
  sampleResponse: unknown;
}

export interface EnvironmentModel {
  variables: {
    name: string;
    type: string | null;
    source: string | null;
    mandatory: boolean;
    value: string | null;
  }[];
  apis: {
    name: string;
    authType: string | null;
    headers: unknown[];
    parameters: unknown[];
    calls: EnvironmentCall[];
  }[];
}

function nameValuePairs(value: unknown): { name: string; value: string }[] {
  return asArray(value)
    .map(asObject)
    .filter((p): p is Json => p !== null)
    .map((p) => ({ name: str(p.name) ?? "", value: p.value == null ? "" : String(p.value) }));
}

/** The form-environment: variables and external APIs with their calls. */
export function environmentModel(env: unknown): EnvironmentModel {
  const root = asObject(env);
  if (!root) return { variables: [], apis: [] };
  return {
    variables: asArray(root.variables)
      .map(asObject)
      .filter((v): v is Json => v !== null)
      .map((v) => ({
        name: str(v.name) ?? "",
        type: str(v.type),
        source: str(v.source),
        mandatory: v.mandatory === true,
        value: v.value == null ? null : String(v.value),
      })),
    apis: asArray(root.externalApis)
      .map(asObject)
      .filter((a): a is Json => a !== null)
      .map((a) => ({
        name: str(a.name) ?? "",
        authType: str(asObject(a.authentication)?.type),
        headers: asArray(a.headers),
        parameters: asArray(a.parameters),
        calls: asArray(a.calls)
          .map(asObject)
          .filter((c): c is Json => c !== null)
          .map((c) => ({
            name: str(c.name) ?? "",
            method: str(c.requestMethod),
            url: str(c.url),
            bodyType: str(c.bodyType),
            pathParams: Object.fromEntries(
              Object.entries(asObject(c.pathParams) ?? {}).map(([k, v]) => [k, String(v)]),
            ),
            parameters: nameValuePairs(c.parameters),
            sampleResponse: c.sampleResponse ?? null,
          })),
      })),
  };
}

export interface OutlineLine {
  depth: number;
  text: string;
}

function outlineItem(item: Json, depth: number, lines: OutlineLine[]) {
  const id = str(item.id);
  if (id) lines.push({ depth, text: id });
  for (const row of asArray(item.rows).map(asObject)) {
    for (const col of asArray(row?.cols).map(asObject)) {
      if (!col) continue;
      lines.push({ depth: depth + 1, text: `Column ${String(col.width ?? "auto")}` });
      for (const child of asArray(col.children).map(asObject)) {
        if (child) outlineItem(child, depth + 2, lines);
      }
    }
  }
}

/** The form-layout grid as an indented outline of cells, columns and field ids. */
export function layoutOutline(layout: unknown): OutlineLine[] {
  const lines: OutlineLine[] = [];
  for (const cell of asArray(layout).map(asObject)) {
    if (!cell) continue;
    lines.push({
      depth: 0,
      text: `Cell row ${String(cell.row ?? "?")}, col ${String(cell.col ?? "?")}, width ${String(cell.width ?? "?")}`,
    });
    for (const child of asArray(cell.children).map(asObject)) {
      if (child) outlineItem(child, 1, lines);
    }
  }
  return lines;
}

/** Whether a resource has content, is genuinely empty, or simply wasn't fetched. */
export function resourceStatus(res: FormResource): "content" | "empty" | "not-fetched" {
  if (res.content !== null && res.content !== undefined) return "content";
  return res.requested ? "empty" : "not-fetched";
}

/**
 * Whether an open form must be left when the active server changes: a form
 * route from the previous server would otherwise be requested from the new
 * one. `previous` is `undefined` on the first (initial) run.
 */
export function returnToListOnServerChange(
  previous: string | null | undefined,
  current: string | null,
): boolean {
  return previous !== undefined && previous !== current;
}
