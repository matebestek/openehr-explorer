<script setup lang="ts">
// A Better form's layout grid (PRD-0020) as an indented outline of cells,
// columns and the field ids they place.
import type { OutlineLine } from "../lib/forms";

defineProps<{
  lines: OutlineLine[];
}>();
</script>

<template>
  <div class="form-layout-outline">
    <p v-if="lines.length === 0" class="empty">This form has no layout.</p>
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="outline-line"
      :class="{ cell: line.depth === 0 }"
      :style="{ paddingLeft: `${line.depth * 16}px` }"
    >
      {{ line.text }}
    </div>
  </div>
</template>

<style scoped>
.form-layout-outline {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text);
}
.outline-line {
  padding: 1px 0;
  overflow-wrap: anywhere;
}
.outline-line.cell {
  margin-top: 6px;
  font-weight: 600;
}
.empty {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
