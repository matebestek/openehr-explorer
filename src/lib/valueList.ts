/**
 * Value List panel logic (PRD-0019): match a coded value in a canonical
 * composition to its Web Template field, and describe that field's full
 * value list. Pure functions only — the panel and viewer just render what
 * these return, so all of the matching/fallback behaviour is unit-tested here.
 */

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
): TemplateMatch {
  const tree = asRecord(webTemplate.tree);
  if (!tree) return { status: "not-found" };

  const matches: TemplateNode[] = [];
  collectByAqlPath(tree, stripNamePredicates(aqlPath), matches);

  if (matches.length === 0) return { status: "not-found" };
  if (matches.length === 1) return { status: "found", node: matches[0] };

  const named = elementName ? matches.filter((n) => nodeHasName(n, elementName)) : [];
  if (named.length === 1) return { status: "found", node: named[0] };
  return { status: "ambiguous", count: matches.length };
}
