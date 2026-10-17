<script setup lang="ts">
// A Better form's field tree (PRD-0020): one row per form-description node,
// with its label, RM type and badges (hidden, read-only, required, code
// list, remote data, label overridden). Rows are buttons that select the
// node; nesting below depth 2 starts collapsed so large forms stay usable.
import { ref } from "vue";
import CaretIcon from "./CaretIcon.vue";
import type { FieldBadge, FieldNode } from "../lib/forms";

const props = withDefaults(
  defineProps<{
    tree: FieldNode;
    selectedKey: string | null;
    depth?: number;
  }>(),
  { depth: 0 },
);

const emit = defineEmits<{
  select: [node: FieldNode];
}>();

const open = ref(props.depth < 2);

function badgeText(badge: FieldBadge): string {
  switch (badge.kind) {
    case "hidden":
      return "hidden";
    case "read-only":
      return "read-only";
    case "required":
      return "required";
    case "label-overridden":
      return "label overridden";
    case "code-list":
      return `code list ${badge.value}`;
    case "remote":
      return `remote ${badge.value}`;
  }
}
</script>

<template>
  <div class="form-field-tree" :role="depth === 0 ? 'tree' : undefined">
    <div class="field-row" :style="{ paddingLeft: `${depth * 16}px` }">
      <button
        v-if="tree.children.length > 0"
        type="button"
        class="toggle"
        :aria-expanded="open"
        :aria-label="`${open ? 'Collapse' : 'Expand'} ${tree.label}`"
        @click="open = !open"
      >
        <CaretIcon :direction="open ? 'down' : 'right'" :size="12" />
      </button>
      <span v-else class="toggle-spacer" />
      <button
        type="button"
        class="field-button"
        :class="{ selected: selectedKey === tree.key }"
        :aria-pressed="selectedKey === tree.key"
        @click="emit('select', tree)"
      >
        <span class="field-label">{{ tree.label }}</span>
        <span v-if="tree.rmType" class="field-type">{{ tree.rmType }}</span>
        <span
          v-for="(badge, i) in tree.badges"
          :key="i"
          class="field-badge"
          :class="`badge-${badge.kind}`"
          >{{ badgeText(badge) }}</span
        >
      </button>
    </div>
    <template v-if="open">
      <FormFieldTree
        v-for="child in tree.children"
        :key="child.key"
        :tree="child"
        :selected-key="selectedKey"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.field-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.toggle,
.toggle-spacer {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.field-button {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.field-button:hover {
  background: var(--color-surface);
}
.field-button.selected {
  background: var(--color-bg-tertiary);
}
.toggle:focus-visible,
.field-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
.field-type {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}
.field-badge {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}
.badge-hidden,
.badge-read-only {
  border-color: var(--color-warning);
}
.badge-required {
  border-color: var(--color-error);
}
.badge-code-list,
.badge-remote {
  border-color: var(--color-primary);
  font-family: var(--font-mono);
}
</style>
