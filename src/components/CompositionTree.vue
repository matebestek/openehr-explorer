<script setup lang="ts">
import { computed } from "vue";
import { resolveNodeLabel } from "../lib/webtemplate";
import { childAqlPath, extractRecordedCode, type CodedValueSelection } from "../lib/valueList";
import CaretIcon from "./CaretIcon.vue";

interface Props {
  data: Record<string, unknown>;
  webTemplate: Record<string, unknown> | null;
  highlightedPath?: string | null;
  searchQuery?: string;
  depth?: number;
  serverId?: string | null;
  // CompositionTree path of the value whose value list is open (PRD-0019).
  selectedTreePath?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  highlightedPath: null,
  searchQuery: "",
  depth: 0,
  serverId: null,
  selectedTreePath: null,
});

// "list": the terminology badge was clicked — show the full value list.
// "detail": the value itself was clicked — show only the recorded code.
const emit = defineEmits<{
  "select-coded-value": [selection: CodedValueSelection, mode: "list" | "detail"];
}>();

const onSelectCodedValue = (selection: CodedValueSelection, mode: "list" | "detail") =>
  emit("select-coded-value", selection, mode);

interface TreeNode {
  key: string;
  label: string;
  archetypeId: string | null;
  rmType: string | null;
  value: unknown;
  children: TreeNode[];
  path: string;
  codedValue?: {
    terminology: string;
    code: string;
  } | null;
  terminologyBadge?: string | null;
  // Set on DV_CODED_TEXT / DV_ORDINAL values: clicking opens the value list.
  selection?: CodedValueSelection | null;
}

interface FilteredTreeNode extends TreeNode {
  isMatch: boolean;
  isAncestor: boolean;
}

// `parentAqlPath`/`attribute` build the AQL-style path (`/content[...]/data[at0001]/...`)
// used to find a value's field in the Web Template; `parentName` is the
// enclosing object's name, i.e. the ELEMENT's name for a DV_* value.
function buildTree(
  data: unknown,
  parentPath: string = "",
  key: string = "root",
  parentAqlPath: string = "",
  attribute: string | null = null,
  parentName: string | null = null,
): TreeNode[] {
  if (data === null || data === undefined) return [];

  if (Array.isArray(data)) {
    return data.flatMap((item, i) =>
      buildTree(item, `${parentPath}[${i}]`, `${key}[${i}]`, parentAqlPath, attribute, parentName),
    );
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const aqlPath = attribute ? childAqlPath(parentAqlPath, attribute, obj) : parentAqlPath;
    const name = (obj.name as any)?.value ?? (obj.name as string) ?? key;
    const archetypeId =
      (obj.archetype_node_id as string) ??
      (obj.archetype_details as any)?.archetype_id?.value ??
      null;
    const rmType = (obj._type as string) ?? null;

    // Resolve label from web template if available
    const label = props.webTemplate ? resolveNodeLabel(props.webTemplate, archetypeId, name) : name;

    const children: TreeNode[] = [];
    const valueFields: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      if (["name", "_type", "archetype_node_id", "archetype_details", "uid"].includes(k)) {
        continue;
      }

      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        const childObj = v as Record<string, unknown>;
        if (childObj._type || childObj.archetype_node_id) {
          children.push(...buildTree(v, `${parentPath}/${k}`, k, aqlPath, k, String(name)));
          continue;
        }
      }

      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
        children.push(...buildTree(v, `${parentPath}/${k}`, k, aqlPath, k, String(name)));
        continue;
      }

      // Leaf value
      if (v !== null && v !== undefined) {
        valueFields[k] = v;
      }
    }

    const displayValue = formatValue(valueFields);

    // Detect DV_CODED_TEXT terminology info
    let codedValue: TreeNode["codedValue"] = null;
    let terminologyBadge: string | null = null;
    if (rmType === "DV_CODED_TEXT" || rmType === "DV_TEXT") {
      const defCode = obj.defining_code as Record<string, unknown> | undefined;
      if (defCode) {
        const termId = defCode.terminology_id as Record<string, unknown> | undefined;
        const terminology = (termId?.value as string) ?? "";
        const code = (defCode.code_string as string) ?? "";
        if (terminology) {
          terminologyBadge = terminology;
          // Only set codedValue for external terminologies (for lazy lookup)
          if (terminology !== "local" && terminology !== "openehr" && code) {
            codedValue = { terminology, code };
          }
        }
      }
    }

    // A DV_ORDINAL's `symbol` is itself a DV_CODED_TEXT; the ordinal row is
    // the clickable one, so its symbol child isn't.
    const recorded = attribute === "symbol" ? null : extractRecordedCode(obj);
    const selection: CodedValueSelection | null = recorded
      ? { aqlPath, treePath: parentPath || "/", elementName: parentName, recorded }
      : null;
    // Ordinals carry their terminology on `symbol`; badge it like coded text
    // so the value list can be opened from it.
    if (recorded && !terminologyBadge) terminologyBadge = recorded.terminology;

    return [
      {
        key,
        label: String(label),
        archetypeId,
        rmType,
        value: displayValue,
        children,
        path: parentPath || "/",
        codedValue,
        terminologyBadge,
        selection,
      },
    ];
  }

  return [
    {
      key,
      label: key,
      archetypeId: null,
      rmType: null,
      value: data,
      children: [],
      path: parentPath,
    },
  ];
}

function formatValue(fields: Record<string, unknown>): string | null {
  if (Object.keys(fields).length === 0) return null;

  // Common openEHR value patterns
  if ("magnitude" in fields && "units" in fields) {
    return `${fields.magnitude} ${fields.units}`;
  }
  if ("value" in fields && Object.keys(fields).length <= 2) {
    return String(fields.value);
  }
  if ("numerator" in fields && "denominator" in fields) {
    return `${fields.numerator}/${fields.denominator}`;
  }

  const parts = Object.entries(fields)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `${k}: ${v}`);

  return parts.length > 0 ? parts.join(", ") : null;
}

const tree = computed(() => buildTree(props.data));

// Tree filtering with ancestor preservation
function filterTreeNode(node: TreeNode, query: string): FilteredTreeNode | null {
  if (!query) {
    return { ...node, isMatch: false, isAncestor: false };
  }

  const lowerQuery = query.toLowerCase();
  const matchesQuery =
    node.label.toLowerCase().includes(lowerQuery) ||
    node.key.toLowerCase().includes(lowerQuery) ||
    (node.rmType && node.rmType.toLowerCase().includes(lowerQuery)) ||
    (node.archetypeId && node.archetypeId.toLowerCase().includes(lowerQuery)) ||
    (node.value && String(node.value).toLowerCase().includes(lowerQuery)) ||
    node.path.toLowerCase().includes(lowerQuery);

  const filteredChildren = node.children
    .map((child) => filterTreeNode(child, query))
    .filter((child): child is FilteredTreeNode => child !== null);

  if (matchesQuery || filteredChildren.length > 0) {
    return {
      ...node,
      children: filteredChildren as TreeNode[],
      isMatch: matchesQuery,
      isAncestor: !matchesQuery && filteredChildren.length > 0,
    } as FilteredTreeNode;
  }

  return null;
}

const filteredTree = computed(() => {
  if (!props.searchQuery) return tree.value;
  return tree.value
    .map((node) => filterTreeNode(node, props.searchQuery))
    .filter((node): node is FilteredTreeNode => node !== null);
});
</script>

<template>
  <div class="composition-tree">
    <div v-if="searchQuery && filteredTree.length === 0" class="empty-state">
      <p>No nodes match "{{ searchQuery }}"</p>
    </div>
    <div v-else-if="filteredTree.length === 0" class="empty-state">
      <p>No data to display.</p>
    </div>
    <div v-for="node in filteredTree" :key="node.path" class="tree-root">
      <TreeNodeComponent
        :node="node"
        :depth="0"
        :highlighted-path="highlightedPath"
        :search-query="searchQuery"
        :server-id="serverId"
        :selected-tree-path="selectedTreePath"
        :on-select-coded-value="onSelectCodedValue"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, h, ref as vueRef, type PropType, type VNode } from "vue";
import { lookupCode as lookupCodeFn } from "../lib/terminology";
import type { CodedValueSelection as Selection } from "../lib/valueList";

interface TreeNodeType {
  key: string;
  label: string;
  archetypeId: string | null;
  rmType: string | null;
  value: unknown;
  children: TreeNodeType[];
  path: string;
  isMatch?: boolean;
  isAncestor?: boolean;
  codedValue?: {
    terminology: string;
    code: string;
  } | null;
  terminologyBadge?: string | null;
  selection?: Selection | null;
}

const INTERNAL_TERMINOLOGIES = new Set(["openehr", "local"]);

const TreeNodeComponent: ReturnType<typeof defineComponent> = defineComponent({
  name: "TreeNodeComponent",
  props: {
    node: { type: Object as PropType<TreeNodeType>, required: true },
    depth: { type: Number, default: 0 },
    highlightedPath: { type: String, default: null },
    searchQuery: { type: String, default: "" },
    serverId: { type: String, default: null },
    selectedTreePath: { type: String, default: null },
    onSelectCodedValue: {
      type: Function as PropType<(selection: Selection, mode: "list" | "detail") => void>,
      default: null,
    },
  },
  setup(props): () => VNode {
    const collapsed = vueRef(props.depth > 3);
    const resolvedTerm = vueRef<string | null>(null);
    const resolving = vueRef(false);
    const resolved = vueRef(false);

    const toggle = () => {
      collapsed.value = !collapsed.value;
    };

    // Lazy terminology resolution on hover
    const handleHover = async () => {
      if (resolved.value || resolving.value || !props.serverId) return;
      const cv = props.node.codedValue;
      if (!cv) return;
      resolving.value = true;
      try {
        const display = await lookupCodeFn(props.serverId, cv.terminology, cv.code);
        resolvedTerm.value = display;
      } finally {
        resolving.value = false;
        resolved.value = true;
      }
    };

    // Helper to highlight text
    const highlightText = (text: string): string | VNode => {
      if (!props.searchQuery) return text;
      const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escapeRegex(props.searchQuery)})`, "gi");
      const highlighted = text.replace(regex, '<mark class="tree-search-match">$1</mark>');
      if (highlighted !== text) {
        return h("span", { innerHTML: highlighted });
      }
      return text;
    };

    return (): VNode => {
      const node = props.node;
      const hasChildren = node.children.length > 0;

      const elements = [];

      // Node header
      const headerChildren = [];

      if (hasChildren) {
        headerChildren.push(
          h(
            "button",
            {
              type: "button",
              class: "toggle",
              "aria-expanded": !collapsed.value,
              "aria-label": `${collapsed.value ? "Expand" : "Collapse"} ${node.label}`,
              onClick: toggle,
            },
            [h(CaretIcon, { direction: collapsed.value ? "right" : "down", size: 12 })],
          ),
        );
      } else {
        headerChildren.push(h("span", { class: "toggle-spacer" }));
      }

      headerChildren.push(h("span", { class: "node-label" }, highlightText(node.label)));

      if (node.rmType) {
        headerChildren.push(h("span", { class: "badge rm-type" }, node.rmType));
      }

      if (node.terminologyBadge) {
        const isInternal = INTERNAL_TERMINOLOGIES.has(node.terminologyBadge);
        const tooltip = isInternal
          ? `Internal terminology — codes defined within the openEHR reference model`
          : `External terminology — codes from ${node.terminologyBadge} require lookup against a terminology server`;
        const badgeClass = ["badge", "term-badge", isInternal ? "term-internal" : "term-external"];
        const selection = node.selection;
        headerChildren.push(
          selection && props.onSelectCodedValue
            ? // Clicking the terminology opens the field's full value list (PRD-0019).
              h(
                "button",
                {
                  type: "button",
                  class: [...badgeClass, "term-badge-button"],
                  title: `${tooltip}. Click to show all values of ${node.terminologyBadge}.`,
                  "aria-label": `Show all values of ${node.terminologyBadge}`,
                  onClick: () => props.onSelectCodedValue?.(selection, "list"),
                },
                node.terminologyBadge,
              )
            : h("span", { class: badgeClass, title: tooltip }, node.terminologyBadge),
        );
      }

      if (node.archetypeId) {
        headerChildren.push(h("span", { class: "badge archetype-id" }, node.archetypeId));
      }

      if (node.value !== null && node.value !== undefined) {
        // Show resolved terminology term if available
        const valueContent =
          node.codedValue && resolvedTerm.value
            ? [
                resolvedTerm.value,
                h(
                  "span",
                  { class: "coded-ref" },
                  ` [${node.codedValue.terminology} ${node.codedValue.code}]`,
                ),
              ]
            : String(node.value);
        const valueClass = [
          "node-value",
          { "resolved-term": !!(node.codedValue && resolvedTerm.value) },
        ];
        const selection = node.selection;
        if (selection && props.onSelectCodedValue) {
          // Coded values open their value list (PRD-0019).
          headerChildren.push(
            h(
              "button",
              {
                type: "button",
                class: [
                  ...valueClass,
                  "coded-value-button",
                  { selected: props.selectedTreePath === node.path },
                ],
                title: "Show the recorded code",
                "aria-pressed": props.selectedTreePath === node.path,
                onClick: () => props.onSelectCodedValue?.(selection, "detail"),
              },
              valueContent,
            ),
          );
        } else {
          headerChildren.push(h("span", { class: valueClass }, valueContent));
        }
      }

      elements.push(
        h(
          "div",
          {
            class: [
              "tree-node-header",
              {
                highlighted: props.highlightedPath === node.path,
                "is-match": node.isMatch,
                "is-ancestor": node.isAncestor,
              },
            ],
            style: { paddingLeft: `${props.depth * 20}px` },
            onMouseenter: node.codedValue ? handleHover : undefined,
          },
          headerChildren,
        ),
      );

      // Children - auto-expand if there's a search query
      const shouldShowChildren = hasChildren && (!collapsed.value || props.searchQuery);
      if (shouldShowChildren) {
        elements.push(
          ...node.children.map((child) =>
            h(TreeNodeComponent, {
              node: child,
              depth: props.depth + 1,
              highlightedPath: props.highlightedPath,
              searchQuery: props.searchQuery,
              serverId: props.serverId,
              selectedTreePath: props.selectedTreePath,
              onSelectCodedValue: props.onSelectCodedValue,
            }),
          ),
        );
      }

      return h("div", { class: "tree-node" }, elements);
    };
  },
});
</script>

<style scoped>
.composition-tree {
  font-size: 13px;
}

:deep(.tree-node-header) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: default;
  transition: background 0.1s;
}
:deep(.tree-node-header:hover) {
  background: var(--color-surface);
}
:deep(.tree-node-header.highlighted) {
  background: rgba(100, 255, 218, 0.1);
  border-left: 2px solid var(--color-primary);
}

:deep(.toggle) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  padding: 0;
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  color: var(--color-text-muted);
  user-select: none;
}
:deep(.toggle:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
  border-radius: 3px;
}
:deep(.toggle-spacer) {
  width: 16px;
}

:deep(.node-label) {
  font-weight: 500;
}

:deep(.rm-type) {
  font-size: 10px;
}
:deep(.archetype-id) {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

:deep(.term-badge) {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  opacity: 1;
}
:deep(.term-external) {
  background: rgba(255, 165, 0, 0.15);
  color: #ffa500;
  border-color: rgba(255, 165, 0, 0.3);
}
:deep(.term-internal) {
  background: rgba(138, 148, 158, 0.1);
  color: var(--color-text-muted);
  border-color: rgba(138, 148, 158, 0.2);
}

:deep(.node-value) {
  margin-left: 8px;
  color: var(--color-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}
:deep(.coded-value-button) {
  padding: 0 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
:deep(.coded-value-button:hover) {
  text-decoration: underline;
}
:deep(.coded-value-button:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
:deep(.term-badge-button) {
  font-family: inherit;
  cursor: pointer;
}
:deep(.term-badge-button:hover) {
  text-decoration: underline;
}
:deep(.term-badge-button:focus-visible) {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
:deep(.coded-value-button.selected) {
  background: var(--color-bg-tertiary);
}

:deep(.resolved-term) {
  color: var(--color-success);
}

:deep(.coded-ref) {
  color: var(--color-text-muted);
  font-size: 11px;
}

/* Search highlighting */
:deep(.tree-search-match) {
  background: rgba(255, 215, 0, 0.4);
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 600;
}

:deep(.tree-node-header.is-match) {
  background: rgba(255, 215, 0, 0.15);
  border-left: 3px solid rgba(255, 215, 0, 0.8);
  padding-left: calc(var(--depth) * 20px - 3px);
}

:deep(.tree-node-header.is-ancestor) {
  font-style: italic;
}
</style>
