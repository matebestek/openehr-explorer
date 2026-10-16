/**
 * Value List panel logic (PRD-0019): match a coded value in a canonical
 * composition to its Web Template field, and describe that field's full
 * value list. Pure functions only — the panel and viewer just render what
 * these return, so all of the matching/fallback behaviour is unit-tested here.
 */

import {
  describeCode,
  expandValueSet,
  type CodeDescription,
  type ValueSetExpansion,
} from "./terminology";

type TemplateNode = Record<string, unknown>;

/** The code actually recorded in the composition for a clicked value. */
export interface RecordedCode {
  rmType: "DV_CODED_TEXT" | "DV_ORDINAL";
  terminology: string;
  code: string;
  label: string | null;
  ordinal: number | null;
}

/** What the composition tree reports when a coded value is clicked. */
export interface CodedValueSelection {
  /** AQL-style path of the clicked value node, e.g. `.../items[at0004]/value`. */
  aqlPath: string;
  /** CompositionTree's own node path (unique per rendered value). */
  treePath: string;
  /** `name/value` of the ELEMENT that holds the value. */
  elementName: string | null;
  recorded: RecordedCode;
}

export type TemplateMatch =
  | { status: "found"; node: TemplateNode }
  | { status: "not-found" }
  | { status: "ambiguous"; count: number };

/** `[at0004,'Name']` → `[at0004]` — name predicates differ between template and data. */
export function stripNamePredicates(path: string): string {
  return path.replace(/\[([^\],]+),\s*(?:'[^']*'|"[^"]*")\]/g, "[$1]");
}

/** Extends an AQL-style path by one attribute, with the child's node id as predicate if it has one. */
export function childAqlPath(parentAqlPath: string, attribute: string, child: unknown): string {
  const nodeId =
    child !== null && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>).archetype_node_id
      : undefined;
  return typeof nodeId === "string" && nodeId
    ? `${parentAqlPath}/${attribute}[${nodeId}]`
    : `${parentAqlPath}/${attribute}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readCode(codePhrase: unknown): { terminology: string; code: string } | null {
  const cp = asRecord(codePhrase);
  const terminology = asRecord(cp?.terminology_id)?.value;
  const code = cp?.code_string;
  if (typeof terminology !== "string" || !terminology) return null;
  if (typeof code !== "string" || !code) return null;
  return { terminology, code };
}

/** The recorded code of a `DV_CODED_TEXT` or `DV_ORDINAL`, or null for anything else. */
export function extractRecordedCode(value: Record<string, unknown>): RecordedCode | null {
  if (value._type === "DV_CODED_TEXT") {
    const coded = readCode(value.defining_code);
    if (!coded) return null;
    return {
      rmType: "DV_CODED_TEXT",
      ...coded,
      label: typeof value.value === "string" ? value.value : null,
      ordinal: null,
    };
  }
  if (value._type === "DV_ORDINAL") {
    const symbol = asRecord(value.symbol);
    const coded = readCode(symbol?.defining_code);
    if (!coded) return null;
    return {
      rmType: "DV_ORDINAL",
      ...coded,
      label: typeof symbol?.value === "string" ? symbol.value : null,
      ordinal: typeof value.value === "number" ? value.value : null,
    };
  }
  return null;
}

function collectByAqlPath(node: TemplateNode, target: string, out: TemplateNode[]): void {
  const aqlPath = node.aqlPath;
  if (typeof aqlPath === "string" && stripNamePredicates(aqlPath) === target) out.push(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const c = asRecord(child);
      if (c) collectByAqlPath(c, target, out);
    }
  }
}

function nodeHasName(node: TemplateNode, name: string): boolean {
  if (node.name === name || node.localizedName === name) return true;
  const localized = asRecord(node.localizedNames);
  return localized ? Object.values(localized).includes(name) : false;
}

/**
 * Finds the Web Template node for a composition value by its AQL-style path.
 * Never falls back to a looser match (e.g. by at-code alone): a list from the
 * wrong field is worse than no list.
 */
export function findTemplateNodeByAqlPath(
  webTemplate: Record<string, unknown>,
  aqlPath: string,
  elementName: string | null,
  rmType: string | null = null,
): TemplateMatch {
  const tree = asRecord(webTemplate.tree);
  if (!tree) return { status: "not-found" };

  const matches: TemplateNode[] = [];
  collectByAqlPath(tree, stripNamePredicates(aqlPath), matches);

  if (matches.length === 0) return { status: "not-found" };
  if (matches.length === 1) return { status: "found", node: matches[0] };

  // A choice ELEMENT (e.g. DV_CODED_TEXT | DV_TEXT) has one node per allowed
  // type, all sharing path and name — the recorded value's type picks one.
  const typed = rmType ? matches.filter((n) => n.rmType === rmType) : [];
  const candidates = typed.length > 0 ? typed : matches;
  if (candidates.length === 1) return { status: "found", node: candidates[0] };

  const named = elementName ? candidates.filter((n) => nodeHasName(n, elementName)) : [];
  if (named.length === 1) return { status: "found", node: named[0] };
  return { status: "ambiguous", count: matches.length };
}

export interface TermBindingRef {
  terminology: string;
  code: string;
}

export interface ValueListOption {
  code: string;
  label: string | null;
  description: string | null;
  ordinal: number | null;
  bindings: TermBindingRef[];
}

/** Everything the panel shows about a field, in one language. */
export interface ValueListModel {
  fieldName: string;
  fieldDescription: string | null;
  rmType: string;
  terminology: string | null;
  listOpen: boolean;
  valueSetUrl: string | null;
  options: ValueListOption[];
  /** Size of the full list when only part of it was fetched (value set expansion), else null. */
  total: number | null;
  fieldBindings: TermBindingRef[];
  annotations: Record<string, string>;
}

export interface VisibleOptions {
  /** At most `cap` rows, always including the recorded option if it's in the list. */
  rows: ValueListOption[];
  hiddenCount: number;
  /** The recorded code isn't in the list at all (open list or data drift). */
  recordedNotInList: boolean;
  /** The recorded code wasn't among the fetched part of a larger list. */
  recordedNotLoaded: boolean;
}

export function templateLanguages(webTemplate: Record<string, unknown>): {
  languages: string[];
  defaultLanguage: string | null;
} {
  const languages = Array.isArray(webTemplate.languages)
    ? webTemplate.languages.filter((l): l is string => typeof l === "string")
    : [];
  const defaultLanguage =
    typeof webTemplate.defaultLanguage === "string" ? webTemplate.defaultLanguage : null;
  return { languages, defaultLanguage };
}

/** Composition language if the template has it, else the template default, else its first language. */
export function pickLanguage(
  compositionLanguage: string | null,
  languages: string[],
  defaultLanguage: string | null,
): string | null {
  if (compositionLanguage && languages.includes(compositionLanguage)) return compositionLanguage;
  return defaultLanguage ?? languages[0] ?? null;
}

/** `[SNOMED-CT(2003)::8517006]` → `{ terminology: "SNOMED-CT", code: "8517006" }`. */
function parseBracketedCode(raw: string, fallbackTerminology: string): TermBindingRef | null {
  const stripped = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const [terminologyPart, code] = stripped.includes("::")
    ? stripped.split("::", 2)
    : [fallbackTerminology, stripped];
  const terminology = terminologyPart.split("(")[0];
  return code ? { terminology, code } : null;
}

/**
 * Term bindings as the Web Template carries them, keyed by terminology. Better
 * and EHRBase shape the per-terminology value differently, so accept the known
 * shapes and ignore anything else.
 */
export function normaliseBindings(raw: unknown): TermBindingRef[] {
  const map = asRecord(raw);
  if (!map) return [];
  const out: TermBindingRef[] = [];
  for (const [terminology, entry] of Object.entries(map)) {
    if (typeof entry === "string") {
      const parsed = parseBracketedCode(entry, terminology);
      if (parsed) out.push(parsed);
      continue;
    }
    const e = asRecord(entry);
    const code = asRecord(e?.value)?.codeString ?? e?.codeString;
    if (typeof code === "string" && code) out.push({ terminology, code });
  }
  return out;
}

function codeInput(node: TemplateNode): Record<string, unknown> | undefined {
  const inputs = Array.isArray(node.inputs) ? node.inputs.map(asRecord) : [];
  return inputs.find((i) => i && (i.suffix === "code" || i.suffix === undefined)) ?? undefined;
}

/** A FHIR ValueSet URL the template names for this field, if any. */
export function extractValueSetUrl(node: TemplateNode): string | null {
  const terminology = codeInput(node)?.terminology;
  if (typeof terminology !== "string") return null;
  if (terminology.startsWith("terminology:")) {
    const match = /[?&]url=([^&]+)/.exec(terminology);
    return match ? decodeURIComponent(match[1]) : null;
  }
  if (/^https?:\/\//.test(terminology) && terminology.includes("/ValueSet/")) return terminology;
  return null;
}

function localized(map: unknown, language: string | null): string | null {
  const m = asRecord(map);
  const value = language && m ? m[language] : undefined;
  return typeof value === "string" ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function buildValueListModel(node: TemplateNode, language: string | null): ValueListModel {
  const input = codeInput(node);
  const list = Array.isArray(input?.list) ? input.list.map(asRecord) : [];

  const options: ValueListOption[] = [];
  for (const item of list) {
    if (!item || typeof item.value !== "string") continue;
    options.push({
      code: item.value,
      label: localized(item.localizedLabels, language) ?? str(item.label),
      description: localized(item.localizedDescriptions, language),
      ordinal: typeof item.ordinal === "number" ? item.ordinal : null,
      bindings: normaliseBindings(item.termBindings),
    });
  }

  const annotations: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(node.annotations) ?? {})) {
    if (typeof value === "string") annotations[key] = value;
  }

  return {
    fieldName:
      localized(node.localizedNames, language) ??
      str(node.localizedName) ??
      str(node.name) ??
      str(node.id) ??
      "",
    fieldDescription: localized(node.localizedDescriptions, language),
    rmType: str(node.rmType) ?? "",
    terminology: str(input?.terminology),
    listOpen: input?.listOpen === true,
    valueSetUrl: extractValueSetUrl(node),
    options,
    total: null,
    fieldBindings: normaliseBindings(node.termBindings),
    annotations,
  };
}

export function visibleOptions(
  options: ValueListOption[],
  recorded: RecordedCode,
  cap = 200,
  total: number | null = null,
): VisibleOptions {
  const recordedIndex = options.findIndex((o) => o.code === recorded.code);
  const complete = total === null || total <= options.length;
  const recordedNotInList = recordedIndex === -1 && complete;
  const recordedNotLoaded = recordedIndex === -1 && !complete;

  const rows =
    options.length <= cap
      ? options
      : recordedIndex === -1 || recordedIndex < cap
        ? options.slice(0, cap)
        : [...options.slice(0, cap - 1), options[recordedIndex]];
  const fullSize = Math.max(total ?? options.length, options.length);
  return { rows, hiddenCount: fullSize - rows.length, recordedNotInList, recordedNotLoaded };
}

/** What the value list panel shows. Reason strings are user-facing. */
export type PanelState =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "list"; model: ValueListModel; source: "template" | "terminology-server" }
  | {
      kind: "external-unavailable";
      model: ValueListModel;
      reason: string;
      description: CodeDescription | null;
    };

export interface ExternalDeps {
  expandValueSet: (
    serverId: string,
    valueSet: string,
    filter?: string,
    count?: number,
  ) => Promise<ValueSetExpansion>;
  describeCode: (serverId: string, system: string, code: string) => Promise<CodeDescription>;
}

/** Most concepts requested from `ValueSet/$expand`; the panel renders at most 200 of them. */
const EXPANSION_COUNT = 1000;

/**
 * The synchronous part of opening the panel: everything the Web Template can
 * answer. Fields without a list come back as `needs-external` for
 * `loadExternalState` to fill in from the terminology server.
 */
export function resolvePanelState(
  webTemplate: Record<string, unknown> | null,
  selection: CodedValueSelection,
  language: string | null,
): PanelState | { kind: "needs-external"; model: ValueListModel } {
  if (!webTemplate) {
    return {
      kind: "unavailable",
      reason: "The template for this composition could not be loaded.",
    };
  }
  const match = findTemplateNodeByAqlPath(
    webTemplate,
    selection.aqlPath,
    selection.elementName,
    selection.recorded.rmType,
  );
  if (match.status === "not-found") {
    return { kind: "unavailable", reason: "This value's field was not found in the template." };
  }
  if (match.status === "ambiguous") {
    return {
      kind: "unavailable",
      reason: `This value matches ${match.count} fields in the template that can't be told apart.`,
    };
  }
  const model = buildValueListModel(match.node, language);
  if (model.options.length > 0) return { kind: "list", model, source: "template" };
  return { kind: "needs-external", model };
}

/**
 * Fills in an external-terminology field from the terminology server: the
 * expanded value set if the template names one, else a description of the
 * recorded code plus why the list is missing. Never rejects.
 */
export async function loadExternalState(
  serverId: string | null,
  model: ValueListModel,
  recorded: RecordedCode,
  deps: ExternalDeps = { expandValueSet, describeCode },
): Promise<PanelState> {
  if (!serverId) {
    return {
      kind: "external-unavailable",
      model,
      reason: "No server is selected, so the terminology server can't be asked.",
      description: null,
    };
  }

  let reason = "The template doesn't name a value set for this field.";
  if (model.valueSetUrl) {
    try {
      const expansion = await deps.expandValueSet(
        serverId,
        model.valueSetUrl,
        undefined,
        EXPANSION_COUNT,
      );
      const options: ValueListOption[] = expansion.concepts
        .filter((c) => c.code)
        .map((c) => ({
          code: c.code as string,
          label: c.display,
          description: null,
          ordinal: null,
          bindings: [],
        }));
      return {
        kind: "list",
        model: { ...model, options, total: expansion.total },
        source: "terminology-server",
      };
    } catch (e) {
      reason = `The terminology server couldn't expand the value set: ${String(e)}`;
    }
  }

  let description: CodeDescription | null = null;
  try {
    description = await deps.describeCode(serverId, recorded.terminology, recorded.code);
  } catch {
    description = null;
  }
  return { kind: "external-unavailable", model, reason, description };
}

/**
 * Whether a window-level keydown should close the value list panel. The
 * window listener sees an Escape only after components (e.g. the search
 * overlay) have handled it, so those mark it with `preventDefault()`.
 */
export function shouldEscapeCloseValuePanel(
  event: { key: string; defaultPrevented: boolean },
  view: { panelOpen: boolean; dialogOpen: boolean },
): boolean {
  return event.key === "Escape" && !event.defaultPrevented && view.panelOpen && !view.dialogOpen;
}
