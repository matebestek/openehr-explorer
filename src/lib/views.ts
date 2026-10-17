/**
 * Better Platform views (PRD-0021): the shapes the `list_views` / `get_view`
 * commands return (src-tauri/src/commands/view.rs, read from the Better
 * admin console) and small pure helpers for the Views section.
 */
import { invoke } from "@tauri-apps/api/core";

export interface ViewSummary {
  name: string;
  description: string | null;
  /** Processor names of the view's steps, e.g. `jsonAql`, `js`. */
  steps: string[];
}

export interface ViewParameter {
  name: string;
  /** The parameter's declared `type`. */
  param_type: string | null;
  format: string | null;
  description: string | null;
}

export interface ViewStep {
  processor_name: string;
  /** The step's code or configuration: AQL, FreeMarker, JavaScript, ... */
  processor_data: string;
}

export interface ViewDefinition {
  name: string;
  category: string | null;
  description: string | null;
  parameters: ViewParameter[];
  steps: ViewStep[];
  /** The definition exactly as downloaded from the admin console. */
  raw: unknown;
}

/** Every view on the server, sorted by name. */
export function listViews(serverId: string): Promise<ViewSummary[]> {
  return invoke<ViewSummary[]>("list_views", { serverId });
}

/** One view's full definition. */
export function getView(serverId: string, name: string): Promise<ViewDefinition> {
  return invoke<ViewDefinition>("get_view", { serverId, name });
}

/** Case-insensitive filter over name and description. */
export function filterViews(views: ViewSummary[], text: string): ViewSummary[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return views;
  return views.filter(
    (v) =>
      v.name.toLowerCase().includes(needle) || (v.description ?? "").toLowerCase().includes(needle),
  );
}

/** Steps whose code is AQL (possibly FreeMarker-templated) — shown in the AQL editor. */
export function isAqlStep(step: ViewStep): boolean {
  return step.processor_name === "jsonAql" || step.processor_name === "jsonFtlAql";
}

/**
 * Steps whose code is plain AQL the AQL Runner can take as-is. `jsonFtlAql`
 * is excluded: its FreeMarker directives aren't valid AQL.
 */
export function canOpenInAqlRunner(step: ViewStep): boolean {
  return step.processor_name === "jsonAql";
}
